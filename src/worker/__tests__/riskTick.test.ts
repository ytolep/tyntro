import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import type { MarketSnapshot } from '../../lib/marketData/types';
import type { ApplyFillResult, FillInput, PositionState } from '../../lib/core/position';
import type { BreachType, EvaluateAccountInput, RiskEvaluation } from '../../lib/core/risk';
import { runRiskTick } from '../riskTick';
import type { RiskTickDeps } from '../riskTick';
import { withAccountLock } from '../../lib/db/lock';

// Интеграционный тест тика риска на Postgres (.env.test). Ядро core/* и цены —
// фейковые, внедрены через deps: тест не зависит от готовности агента A и Phoenix.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

type Db = typeof import('../../lib/db')['db'];
let db: Db;
let userId: string;
let challengeId: string;

const ZERO = new Decimal(0);
const FEE_RATE = new Decimal('0.001');
const START = new Decimal(10000);
const NOW_MS = Date.parse('2026-10-08T12:00:00.000Z');

// ---- Фейковое ядро (контракты core/position и core/risk, простая верная математика) ----

function fakeApplyFill(pos: PositionState | null, fill: FillInput): ApplyFillResult {
  const fee = fill.quantity.mul(fill.price).mul(fill.feeRate);
  if (!pos || pos.side === fill.side) {
    const quantity = (pos?.quantity ?? ZERO).plus(fill.quantity);
    const notional = (pos ? pos.quantity.mul(pos.entryPrice) : ZERO).plus(fill.quantity.mul(fill.price));
    return {
      position: {
        side: fill.side,
        quantity,
        entryPrice: notional.div(quantity),
        leverage: fill.leverage,
        margin: (pos?.margin ?? ZERO).plus(fill.quantity.mul(fill.price).div(fill.leverage)),
      },
      realizedPnl: ZERO,
      fee,
      closedQuantity: ZERO,
    };
  }
  const closed = Decimal.min(pos.quantity, fill.quantity);
  const realizedPnl = closed.mul(fill.price.minus(pos.entryPrice)).mul(pos.side === 'LONG' ? 1 : -1);
  const rest = fill.quantity.minus(closed);
  let position: PositionState | null = null;
  if (rest.gt(0))
    position = { side: fill.side, quantity: rest, entryPrice: fill.price, leverage: fill.leverage, margin: rest.mul(fill.price).div(fill.leverage) };
  else if (pos.quantity.gt(closed))
    position = { ...pos, quantity: pos.quantity.minus(closed), margin: pos.margin.mul(pos.quantity.minus(closed)).div(pos.quantity) };
  return { position, realizedPnl, fee, closedQuantity: closed };
}

function fakeEvaluateAccount(input: EvaluateAccountInput): RiskEvaluation {
  const upnl = input.positions.reduce(
    (sum, { pos, mark }) => sum.plus(pos.quantity.mul(mark.minus(pos.entryPrice)).mul(pos.side === 'LONG' ? 1 : -1)),
    ZERO,
  );
  const equity = input.balance.plus(upnl);
  const staticFloor = input.accountSize.mul(new Decimal(1).minus(new Decimal(input.rules.maxDdPct).div(100)));
  const dailyFloor = input.dayStartEquity.mul(new Decimal(1).minus(new Decimal(input.rules.dailyDdPct).div(100)));
  const marginSum = input.positions.reduce((sum, { pos }) => sum.plus(pos.margin), ZERO);
  const liquidate = equity.lt(marginSum.mul(input.maintenanceRatio));
  let breach: BreachType | null = null;
  if (!liquidate && equity.lte(staticFloor)) breach = 'STATIC_DD';
  else if (!liquidate && equity.lte(dailyFloor)) breach = 'DAILY_DD';
  const target = input.accountSize.mul(new Decimal(1).plus(new Decimal(input.rules.profitTargetPct).div(100)));
  const passed = !liquidate && breach === null && input.positions.length === 0 &&
    equity.gte(target) && input.tradingDays >= input.rules.minTradingDays;
  return { equity, staticFloor, dailyFloor, liquidate, breach, passed, riskLevel: liquidate || breach ? 'FAILED' : 'SAFE', targetProgressPct: 0 };
}

// ---- Фейковые цены ----

const prices = new Map<string, number>();
const fakeGetMarketSnapshot = (symbol: string): Promise<MarketSnapshot> =>
  Promise.resolve({
    marketId: symbol,
    ticker: { markPrice: prices.get(symbol) ?? null },
    referencePrice: prices.get(symbol) ?? null,
  } as unknown as MarketSnapshot);

function deps(over: Partial<RiskTickDeps> = {}): RiskTickDeps {
  return {
    db,
    withAccountLock,
    getMarketSnapshot: fakeGetMarketSnapshot,
    applyFill: fakeApplyFill,
    evaluateAccount: fakeEvaluateAccount,
    maintenanceRatio: 0.5,
    feeRate: () => FEE_RATE,
    now: () => NOW_MS,
    log: () => {},
    ...over,
  };
}

// ---- Фикстуры ----

async function makeAccount(over: Record<string, unknown> = {}) {
  const account = await db.tradingAccount.create({
    data: {
      userId,
      challengeId,
      accountSize: START,
      currentBalance: START,
      currentEquity: START,
      dayStartEquity: START,
      staticMaxDdFloor: new Decimal(9400),
      dailyDdFloor: new Decimal(9700),
      ...over,
    },
  });
  await db.ledgerEntry.create({ data: { accountId: account.id, type: 'DEPOSIT', amount: START } });
  return account;
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../lib/db')).db;
  const user = await db.user.create({ data: { walletAddress: 'worker-risk-test' } });
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

after(async () => {
  await db?.$disconnect();
});

// ---- Тесты ----

test('лимит срабатывает один раз: fill + FEE + позиция + lastTradeDay', async () => {
  const acc = await makeAccount();
  const order = await db.order.create({
    data: {
      accountId: acc.id, symbol: 'BTC-PERP', side: 'LONG', type: 'LIMIT',
      price: new Decimal(100), size: new Decimal(10), leverage: 1, status: 'OPEN',
    },
  });
  prices.set('BTC-PERP', 99); // mark ≤ limit → LONG срабатывает

  await runRiskTick(deps());
  await runRiskTick(deps()); // второй тик не должен исполнять повторно

  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'FILLED');
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 1);

  const position = await db.position.findFirstOrThrow({ where: { accountId: acc.id } });
  assert.equal(position.status, 'OPEN');
  assert.equal(position.quantity.toFixed(0), '10');
  assert.equal(position.entryPrice.toFixed(0), '100');

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  // fee = 10 × 100 × 0.001 = 1; equity = 9999 + 10×(99−100) = 9989
  assert.equal(account.currentBalance.toFixed(3), '9999.000');
  assert.equal(account.currentEquity.toFixed(3), '9989.000');
  assert.equal(account.lastTradeDay, '2026-10-08');

  // Баланс = сумма проводок (§5)
  const entries = await db.ledgerEntry.findMany({ where: { accountId: acc.id } });
  const sum = entries.reduce((s, e) => s.plus(e.amount), ZERO);
  assert.equal(sum.toFixed(3), account.currentBalance.toFixed(3));

  // Снапшот equity не чаще раза в минуту: два тика — ровно один снапшот
  assert.equal(await db.equitySnapshot.count({ where: { accountId: acc.id } }), 1);
});

test('пробой дневного floor → FAILED, позиции закрыты по метке', async () => {
  const acc = await makeAccount();
  await db.position.create({
    data: {
      accountId: acc.id, symbol: 'BTC-PERP', side: 'LONG',
      entryPrice: new Decimal(100), currentMarkPrice: new Decimal(100),
      quantity: new Decimal(10), margin: new Decimal(1000), leverage: 1,
      liquidationPrice: new Decimal(500), status: 'OPEN',
    },
  });
  prices.set('BTC-PERP', 50); // equity = 10000 + 10×(50−100) = 9500 ≤ dailyFloor 9700

  await runRiskTick(deps());

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.status, 'FAILED');
  // закрытие по метке: PnL −500, fee 10×50×0.001 = 0.5 → баланс и equity 9499.5
  assert.equal(account.currentBalance.toFixed(3), '9499.500');
  assert.equal(account.currentEquity.toFixed(3), '9499.500');

  const position = await db.position.findFirstOrThrow({ where: { accountId: acc.id } });
  assert.equal(position.status, 'CLOSED');

  const events = await db.riskEvent.findMany({ where: { accountId: acc.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].level, 'FAILED');
  assert.equal(events[0].ruleName, 'DAILY_DD');

  const fills = await db.fill.findMany({ where: { accountId: acc.id } });
  assert.equal(fills.length, 1);
  assert.equal(fills[0].realizedPnl.toFixed(1), '-500.0');

  // FAILED-счёт больше не переоценивается
  await runRiskTick(deps());
  assert.equal(await db.riskEvent.count({ where: { accountId: acc.id } }), 1);
});

test('ликвидация по поддерживающей марже → FAILED и LIQUIDATION', async () => {
  const acc = await makeAccount();
  // notional 30000, margin 12000: equity при метке 85 → 5500 < 12000×0.5 = 6000
  await db.position.create({
    data: {
      accountId: acc.id, symbol: 'ETH-PERP', side: 'LONG',
      entryPrice: new Decimal(100), currentMarkPrice: new Decimal(100),
      quantity: new Decimal(300), margin: new Decimal(12000), leverage: 2.5,
      liquidationPrice: new Decimal(80), status: 'OPEN',
    },
  });
  prices.set('ETH-PERP', 85);

  await runRiskTick(deps());

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.status, 'FAILED');
  // PnL 300×(85−100) = −4500, fee 300×85×0.001 = 25.5 → 5474.5
  assert.equal(account.currentBalance.toFixed(3), '5474.500');
  assert.equal((await db.position.findFirstOrThrow({ where: { accountId: acc.id } })).status, 'CLOSED');
  const events = await db.riskEvent.findMany({ where: { accountId: acc.id } });
  assert.equal(events[0].ruleName, 'LIQUIDATION');
});

test('цель достигнута, позиций нет → PASSED, лимитки отменены', async () => {
  const acc = await makeAccount({ currentBalance: new Decimal(11000), currentEquity: new Decimal(11000), tradingDaysCount: 3 });
  await db.ledgerEntry.create({ data: { accountId: acc.id, type: 'ADJUST', amount: new Decimal(1000) } });
  const order = await db.order.create({
    data: {
      accountId: acc.id, symbol: 'SOL-PERP', side: 'SHORT', type: 'LIMIT',
      price: new Decimal(200), size: new Decimal(1), leverage: 1, status: 'OPEN',
    },
  });
  prices.set('SOL-PERP', 100); // mark < limit → SHORT не срабатывает

  await runRiskTick(deps());

  assert.equal((await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } })).status, 'PASSED');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED');
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 0);
});
