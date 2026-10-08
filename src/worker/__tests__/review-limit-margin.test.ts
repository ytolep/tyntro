import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import type { MarketSnapshot } from '../../lib/marketData/types';
import { runRiskTick } from '../riskTick';
import type { RiskTickDeps } from '../riskTick';
import { applyFill } from '../../lib/core/position';
import { evaluateAccount } from '../../lib/core/risk';
import { withAccountLock } from '../../lib/db/lock';

// Ревью (агент L): воркер исполняет стоячие лимитки БЕЗ проверки маржи.
// API-путь (simulated.ts fillAndSettle, checkMargin) отклоняет ордер, если
// Σ margin > equity; путь воркера (riskTick.processAccount, шаг 1) применяет
// applyFill без всякой маржинальной проверки — и аккаунт остаётся жить с
// margin > equity, пока equity не упадёт ниже maintenance (0.5 × margin).
//
// Сценарий: счёт $10 000, стоячий LONG-лимит 300 BTC @ $100, плечо 2 →
// margin = 15 000 > equity. Рынок доходит до лимита → позиция открывается
// с плечом выше правил (equity 9 685 > maintenance 7 500 → ликвидации нет).
// На FUNDED_SIM-счетах это реальные деньги в выплатах.
//
// Skip снят после исправления M1 (docs/REVIEW.md): воркер проверяет маржу
// той же функцией execution/margin, лимит отменяется с RiskEvent.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../lib/db').db;
let userId: string;
let challengeId: string;

const START = new Decimal(10000);
const NOW_MS = Date.parse('2026-10-08T12:00:00.000Z');

const prices = new Map<string, number>();
const fakeGetMarketSnapshot = (symbol: string): Promise<MarketSnapshot> =>
  Promise.resolve({
    marketId: symbol,
    ticker: { markPrice: prices.get(symbol) ?? null },
    referencePrice: prices.get(symbol) ?? null,
  } as unknown as MarketSnapshot);

// Ядро — настоящее (core/position, core/risk): воспроизводим продакшн-математику.
function deps(): RiskTickDeps {
  return {
    db,
    withAccountLock,
    getMarketSnapshot: fakeGetMarketSnapshot,
    applyFill,
    evaluateAccount,
    maintenanceRatio: 0.5,
    feeRate: () => new Decimal('0.0005'),
    now: () => NOW_MS,
    log: () => {},
  };
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../lib/db')).db;
  const user = await db.user.create({ data: { walletAddress: 'review-margin-test' } });
  userId = user.id;
  const challenge = await db.challenge.create({
    data: {
      accountSize: START, planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: new Decimal(89), minTradingDays: 3,
    },
  });
  challengeId = challenge.id;
});

after(async () => { await db?.$disconnect(); });

test('worker must not fill a standing limit order whose margin exceeds equity', async () => {
  const acc = await db.tradingAccount.create({
    data: {
      userId, challengeId,
      accountSize: START, currentBalance: START, currentEquity: START, dayStartEquity: START,
      staticMaxDdFloor: new Decimal(9400), dailyDdFloor: new Decimal(9700),
    },
  });
  await db.ledgerEntry.create({ data: { accountId: acc.id, type: 'DEPOSIT', amount: START } });

  // LONG-лимит: margin при филле = 300×100/2 = 15 000 > equity 10 000.
  // Такой же рыночный ордер API отверг бы с INSUFFICIENT_MARGIN.
  const order = await db.order.create({
    data: {
      accountId: acc.id, symbol: 'BTC-PERP', side: 'LONG', type: 'LIMIT',
      price: new Decimal(100), size: new Decimal(300), leverage: 2, status: 'OPEN',
    },
  });
  prices.set('BTC-PERP', 99); // mark ≤ limit → лимит срабатывает

  await runRiskTick(deps());

  // Исправление M1: маржи не хватает → ордер CANCELLED с RiskEvent, филла нет.
  const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.status, 'CANCELLED', 'лимит с margin > equity отменяется воркером');
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 0);
  assert.equal(await db.position.count({ where: { accountId: acc.id, status: 'OPEN' } }), 0);

  const events = await db.riskEvent.findMany({ where: { accountId: acc.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].ruleName, 'INSUFFICIENT_MARGIN');

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.ok(
    (account.currentBalance as Decimal).eq(START) && (account.currentEquity as Decimal).eq(START),
    'счёт не меняется без исполнения',
  );
  assert.equal(account.status, 'ACTIVE');
});
