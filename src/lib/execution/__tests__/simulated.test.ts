import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import type { Market, MarketSnapshot } from '../../marketData/types';
import { executeSimulatedOrder } from '../simulated';
import type { SimulatedOrderDeps } from '../simulated';
import { ExecutionError } from '../policy';

// Исполнение на ядре core/* + withAccountLock на Postgres (props_test из .env.test).
// Цены и каталог — фейковые через deps: тест не зависит от Phoenix.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

type Db = typeof import('../../db')['db'];
let db: Db;
let user: { id: string; walletAddress: string; role: 'USER' };
let challengeId: string;

const ZERO = new Decimal(0);
const START = new Decimal(10000);
const NOW_MS = Date.parse('2026-10-08T12:00:00.000Z');

// ---- Фейковый рынок и цены ----

let price = 100;
const market: Market = {
  symbol: 'BTC-PERP', type: 'perp', baseAsset: 'BTC', quoteAsset: 'USD',
  status: 'active', tickSize: 0.01, lotSize: 0.0001, takerFee: 0.0005, maxLeverage: 5,
};

const deps: SimulatedOrderDeps = {
  resolveMarket: async (symbol) => (symbol === 'BTC-PERP' ? market : undefined),
  getMarketSnapshot: async (symbol) =>
    ({ marketId: symbol, ticker: { markPrice: price }, referencePrice: price } as unknown as MarketSnapshot),
  now: () => NOW_MS,
};

const openBody = (over: Record<string, unknown> = {}) => ({
  action: 'OPEN_POSITION', symbol: 'BTC-PERP', side: 'LONG', orderMode: 'Market',
  sizeUsd: 100, leverage: 1, idempotencyKey: 'key', ...over,
});

async function makeAccount(over: Record<string, unknown> = {}) {
  const account = await db.tradingAccount.create({
    data: {
      userId: user.id,
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

const isExec = (status: number, code?: string) => (e: unknown): boolean =>
  e instanceof ExecutionError && e.status === status && (code === undefined || e.code === code);

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  const row = await db.user.create({ data: { walletAddress: 'sim-exec-test' } });
  user = { id: row.id, walletAddress: row.walletAddress, role: 'USER' };
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

// ---- Тесты ----

test('повтор OPEN с тем же idempotencyKey → один ордер и тот же ответ', async () => {
  const acc = await makeAccount();
  const first = await executeSimulatedOrder(user, acc, openBody({ idempotencyKey: 'dup' }), deps);
  const second = await executeSimulatedOrder(user, acc, openBody({ idempotencyKey: 'dup' }), deps);

  assert.equal(first.status, 'FILLED');
  assert.equal(second.status, 'FILLED');
  assert.equal((second.order as { id: string }).id, (first.order as { id: string }).id);
  assert.equal(second.duplicate, true);

  assert.equal(await db.order.count({ where: { accountId: acc.id } }), 1);
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 1);
  // баланс изменился ровно один раз: fee = 1 × 100 × 0.0005 = 0.05
  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.currentBalance.toFixed(2), '9999.95');
});

test('20 параллельных OPEN на один счёт → баланс равен сумме проводок', async () => {
  const acc = await makeAccount();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    executeSimulatedOrder(user, acc, openBody({ idempotencyKey: `par-${i}` }), deps)));

  assert.equal(results.filter((r) => r.status === 'FILLED').length, 20);
  assert.equal(await db.order.count({ where: { accountId: acc.id } }), 20);

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  const entries = await db.ledgerEntry.findMany({ where: { accountId: acc.id } });
  const sum = entries.reduce((s, e) => s.plus(e.amount), ZERO);
  assert.equal(sum.toFixed(3), account.currentBalance.toFixed(3));
  assert.equal(account.currentBalance.toFixed(3), '9999.000'); // 10000 − 20 × 0.05
  assert.equal(account.totalTrades, 20);
  assert.equal(account.lastTradeDay, '2026-10-08');

  const position = await db.position.findFirstOrThrow({ where: { accountId: acc.id, status: 'OPEN' } });
  assert.equal(position.quantity.toFixed(0), '20'); // 20 × 1 BTC, усреднение в одну позицию
});

test('маржа выше equity → 409 INSUFFICIENT_MARGIN без записей', async () => {
  const acc = await makeAccount();
  await assert.rejects(
    executeSimulatedOrder(user, acc, openBody({ sizeUsd: 30000, idempotencyKey: 'big' }), deps),
    isExec(409, 'INSUFFICIENT_MARGIN'),
  );
  assert.equal(await db.order.count({ where: { accountId: acc.id } }), 0);
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 0);
  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.currentBalance.toFixed(2), '10000.00');
});

test('стоячий лимит → ордер OPEN без проводок; пересекающий — филл по метке', async () => {
  const acc = await makeAccount();

  const pending = await executeSimulatedOrder(user, acc, openBody({ orderMode: 'Limit', limitPrice: 90, sizeUsd: 90, idempotencyKey: 'lim-1' }), deps);
  assert.equal(pending.status, 'PENDING_LIMIT_ORDER');
  const order = await db.order.findFirstOrThrow({ where: { accountId: acc.id } });
  assert.equal(order.status, 'OPEN');
  assert.equal(order.type, 'LIMIT');
  assert.equal(order.price.toFixed(0), '90');
  assert.equal(order.size.toFixed(0), '1'); // 90 USDC / 90
  assert.equal(await db.fill.count({ where: { accountId: acc.id } }), 0);
  assert.equal(await db.ledgerEntry.count({ where: { accountId: acc.id, type: 'FEE' } }), 0);

  // LONG limit 105 ≥ mark 100 → тейкер-филл по метке сервера, не по цене клиента
  const crossed = await executeSimulatedOrder(user, acc, openBody({ orderMode: 'Limit', limitPrice: 105, idempotencyKey: 'lim-2' }), deps);
  assert.equal(crossed.status, 'FILLED');
  const fill = await db.fill.findFirstOrThrow({ where: { accountId: acc.id } });
  assert.equal(fill.price.toFixed(0), '100');
});

test('CLOSE_POSITION: PnL без плеча, fee по метке, win/loss и закрытие позиции', async () => {
  const acc = await makeAccount();
  await executeSimulatedOrder(user, acc, openBody({ idempotencyKey: 'open-1' }), deps); // 1 BTC @ 100, fee 0.05
  price = 110;

  const position = await db.position.findFirstOrThrow({ where: { accountId: acc.id, status: 'OPEN' } });
  const closed = await executeSimulatedOrder(user, acc, { action: 'CLOSE_POSITION', positionId: position.id }, deps);

  assert.equal(closed.status, 'FILLED');
  assert.equal(closed.realizedPnl, '10'); // 1 × (110 − 100), без плеча
  assert.equal(closed.fee, '0.055'); // 1 × 110 × 0.0005
  assert.equal((await db.position.findUniqueOrThrow({ where: { id: position.id } })).status, 'CLOSED');

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.currentBalance.toFixed(3), '10009.895'); // 10000 − 0.05 + 10 − 0.055
  assert.equal(account.currentEquity.toFixed(3), '10009.895');
  assert.equal(account.winCount, 1);
  assert.equal(account.lossCount, 0);
  assert.equal(account.totalTrades, 2);

  // Инвариант §5: баланс = сумма проводок
  const entries = await db.ledgerEntry.findMany({ where: { accountId: acc.id } });
  const sum = entries.reduce((s, e) => s.plus(e.amount), ZERO);
  assert.equal(sum.toFixed(3), account.currentBalance.toFixed(3));
});

test('FUNDED → 503 без записей; CHECK_LIMIT_ORDERS → 400 (исполняет воркер)', async () => {
  const funded = await makeAccount({ mode: 'FUNDED', status: 'FUNDED' });
  await assert.rejects(
    executeSimulatedOrder(user, funded, openBody({ idempotencyKey: 'f1' }), deps),
    isExec(503, 'FUNDED_EXECUTION_UNAVAILABLE'),
  );
  await assert.rejects(
    executeSimulatedOrder(user, funded, { action: 'CHECK_LIMIT_ORDERS' }, deps),
    isExec(503, 'FUNDED_EXECUTION_UNAVAILABLE'),
  );
  assert.equal(await db.order.count({ where: { accountId: funded.id } }), 0);
  assert.equal(await db.ledgerEntry.count({ where: { accountId: funded.id, type: { in: ['FEE', 'PNL'] } } }), 0);

  const acc = await makeAccount();
  await assert.rejects(
    executeSimulatedOrder(user, acc, { action: 'CHECK_LIMIT_ORDERS' }, deps),
    isExec(400, 'CHECK_LIMIT_ORDERS_REMOVED'),
  );
});

test('L1: FAILED через API-путь отменяет открытые лимитки в той же транзакции', async () => {
  const acc = await makeAccount();
  // 50 BTC @ 100, плечо 2 → margin 2500 ≤ equity; метка падает до 30 → закрытие = пробой static floor.
  await executeSimulatedOrder(user, acc, openBody({ sizeUsd: 5000, leverage: 2, idempotencyKey: 'l1-open' }), deps);
  price = 30;
  // Стоячий лимит (mark 30 > 20) — до закрытия позиции счёт ещё ACTIVE.
  await executeSimulatedOrder(user, acc, openBody({ orderMode: 'Limit', limitPrice: 20, sizeUsd: 100, idempotencyKey: 'l1-limit' }), deps);
  const position = await db.position.findFirstOrThrow({ where: { accountId: acc.id, status: 'OPEN' } });

  const closed = await executeSimulatedOrder(user, acc, { action: 'CLOSE_POSITION', positionId: position.id }, deps);

  assert.equal(closed.status, 'FILLED');
  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } });
  assert.equal(account.status, 'FAILED'); // закрытие реализовало убыток ниже static floor
  const limit = await db.order.findFirstOrThrow({ where: { accountId: acc.id, type: 'LIMIT' } });
  assert.equal(limit.status, 'CANCELLED', 'открытые лимитки отменяются и при FAILED');
  assert.equal(await db.order.count({ where: { accountId: acc.id, status: 'OPEN' } }), 0);
});
