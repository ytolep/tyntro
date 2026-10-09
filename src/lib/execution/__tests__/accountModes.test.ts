import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import { evaluateAccount } from '../../core/risk';
import { d } from '../../core/money';
import { executionPolicy, assertSimulationAction } from '../policy';

// Тесты режимов счёта и api/orders + api/accounts/active на Postgres
// (props_test из .env.test). Схема пересоздаётся db push --force-reset перед прогоном.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды (db push --force-reset), если видит
// переменные окружения AI-агента. Тест сам создаёт и сбрасывает свою базу props_test,
// поэтому срезаем эти переменные для дочернего процесса.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: any, accounts: any, orders: any, createSession: any;
let demoCookie: string, otherCookie: string;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  accounts = (await import('../../../app/api/accounts/active/route')).GET;
  // Легаси-роут /api/checkout удалён (docs/REVIEW.md C1): счёт создаётся только
  // через /api/checkout/create + подтверждение оплаты воркером (payments.test.ts).
  orders = (await import('../../../app/api/orders/route')).POST;
  createSession = (await import('../../auth/session')).createSession;
  await db.user.create({ data: { id: 'demo', walletAddress: 'demo' } });
  await db.user.create({ data: { id: 'other', walletAddress: 'other' } });
  demoCookie = `props_session=${await createSession('demo')}`;
  otherCookie = `props_session=${await createSession('other')}`;
  const challenge = await db.challenge.create({ data: {
    accountSize: new Decimal(10000), planType: 'CORE',
    profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
    priceUsd: new Decimal(89), minTradingDays: 3,
  } });
  const base = {
    userId: 'demo', challengeId: challenge.id,
    accountSize: new Decimal(10000), currentBalance: new Decimal(10000),
    currentEquity: new Decimal(10000), dayStartEquity: new Decimal(10000),
    staticMaxDdFloor: new Decimal(9400), dailyDdFloor: new Decimal(9700),
  };
  for (const a of [
    { id: 'challenge', mode: 'CHALLENGE', status: 'ACTIVE' },
    { id: 'funded', mode: 'FUNDED', status: 'FUNDED' },
    { id: 'legacy-funded', mode: 'CHALLENGE', status: 'FUNDED' },
    { id: 'passed', mode: 'CHALLENGE', status: 'PASSED' },
    { id: 'foreign', mode: 'CHALLENGE', status: 'ACTIVE', userId: 'other' },
  ]) await db.tradingAccount.create({ data: { ...base, ...a } });
});

after(async () => { await db?.$disconnect(); });

const request = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('funded account view cannot present local virtual ledger as Phoenix balances or fills', async () => {
  const response = await accounts(new Request('http://localhost/api/accounts/active?accountId=funded', { headers: { cookie: demoCookie } }));
  const result = await response.json();
  assert.equal(result.execution.provider, 'PHOENIX');
  assert.equal(result.execution.canTrade, false);
  assert.equal(result.account.currentEquity, null);
  assert.equal(result.account.currentBalance, null);
  assert.deepEqual(result.account.orders, []);
  assert.equal(result.riskEval, null);
  // Чужой счёт неотличим от несуществующего; без сессии — 401.
  assert.equal((await accounts(new Request('http://localhost/api/accounts/active?accountId=foreign', { headers: { cookie: demoCookie } }))).status, 404);
  assert.equal((await accounts(new Request('http://localhost/api/accounts/active'))).status, 401);
  assert.equal((await accounts(new Request('http://localhost/api/accounts/active', { headers: { cookie: demoCookie } }))).status, 200);
});

test('simulator account view carries decimal-strings and a live riskEval from evaluateAccount', async () => {
  const response = await accounts(new Request('http://localhost/api/accounts/active?accountId=challenge', { headers: { cookie: demoCookie } }));
  const result = await response.json();
  assert.equal(result.execution.provider, 'SIMULATOR');
  assert.equal(typeof result.account.currentEquity, 'string');
  assert.equal(result.riskEval.stale, false);
  assert.equal(typeof result.riskEval.equity, 'string');
  assert.equal(result.riskEval.equity, '10000');
  assert.equal(result.riskEval.riskLevel, 'SAFE');
  assert.equal(result.riskEval.breach, null);
});


test('policy rejects unknown modes and never lets a status override route into simulation', () => {
  assert.throws(() => assertSimulationAction({ mode: 'UNKNOWN', status: 'ACTIVE' }, 'OPEN_POSITION'));
  assert.throws(() => assertSimulationAction({ mode: 'FUNDED', status: 'ACTIVE' }, 'OPEN_POSITION'));
  assert.equal(executionPolicy({ mode: 'CHALLENGE', status: 'PASSED' }).canWithdraw, false);
});

// Волна 2 (агент F): исполнение ордеров переписано на core + withAccountLock + requireUser.
test('every funded action fails closed with 503 and no simulated writes, even if client spoofs mode', async () => {
  for (const accountId of ['funded', 'legacy-funded']) {
    const res = await orders(request({
      accountId, action: 'OPEN_POSITION', symbol: 'BTC-PERP', side: 'LONG', orderMode: 'Market',
      sizeUsd: 100, leverage: 1, idempotencyKey: 'spoof-1', mode: 'CHALLENGE', status: 'ACTIVE',
    }, demoCookie));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'FUNDED_EXECUTION_UNAVAILABLE');
    assert.equal(await db.order.count({ where: { accountId } }), 0);
    assert.equal(await db.fill.count({ where: { accountId } }), 0);
    assert.equal(await db.ledgerEntry.count({ where: { accountId, type: { in: ['FEE', 'PNL'] } } }), 0);
  }
});

test('order endpoint requires an explicitly selected owned account; no silent latest-account fallback', async () => {
  // Без sessionId → 400, а не «молча выбрали последний счёт».
  assert.equal((await orders(request({ action: 'OPEN_POSITION' }, demoCookie))).status, 400);
  // Без сессии → 401.
  assert.equal((await orders(request({ accountId: 'challenge', action: 'OPEN_POSITION', symbol: 'BTC-PERP' }))).status, 401);
  // Чужой счёт → 404.
  assert.equal((await orders(request({ accountId: 'challenge', action: 'CANCEL_ORDER', orderId: 'nope' }, otherCookie))).status, 404);
});

test('passed challenge cannot open or trigger new positions and is never auto-funded', async () => {
  const res = await orders(request({
    accountId: 'passed', action: 'OPEN_POSITION', symbol: 'BTC-PERP', side: 'LONG',
    orderMode: 'Market', sizeUsd: 100, leverage: 1, idempotencyKey: 'passed-1',
  }, demoCookie));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'ACCOUNT_NOT_TRADABLE');
  const a = await db.tradingAccount.findUniqueOrThrow({ where: { id: 'passed' } });
  assert.equal(a.status, 'PASSED'); // статус не «полечен» и не FUNDED
  assert.equal(a.mode, 'CHALLENGE');
  assert.equal(await db.order.count({ where: { accountId: 'passed' } }), 0);
  // CHECK_LIMIT_ORDERS больше не принимается вовсе — лимитки исполняет воркер.
  assert.equal((await orders(request({ accountId: 'passed', action: 'CHECK_LIMIT_ORDERS' }, demoCookie))).status, 400);
});

test('cancel cannot touch another account order', async () => {
  const order = await db.order.create({ data: {
    accountId: 'challenge', symbol: 'BTC-PERP', side: 'LONG', type: 'LIMIT',
    price: new Decimal(90), size: new Decimal(1), leverage: 1, status: 'OPEN',
  } });
  // Пользователь 'other' не может отменить чужой ордер, даже зная его id.
  assert.equal((await orders(request({ accountId: 'foreign', action: 'CANCEL_ORDER', orderId: order.id }, otherCookie))).status, 404);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'OPEN');
  // Владелец отменяет успешно.
  assert.equal((await orders(request({ accountId: 'challenge', action: 'CANCEL_ORDER', orderId: order.id }, demoCookie))).status, 200);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED');
});

// Волна 2 (агент I): admin/reset-day удалён; админ решает только судьбу PASSED-челленджа.
test('admin tools cannot mutate funded account or change its mode; reset-day route is gone', async () => {
  // Эндпоинта /api/admin/reset-day больше нет — файла маршрута не существует.
  const missingRoute = '../../../app/api/admin/reset-day/route';
  await assert.rejects(() => import(missingRoute));

  // Админ-действия funded/approve и funded/reject не трогают существующие FUNDED-счета.
  await db.user.create({ data: { id: 'admin', walletAddress: 'admin', role: 'ADMIN' } });
  const adminCookie = `props_session=${await createSession('admin')}`;
  const approve = (await import('../../../app/api/admin/funded/approve/route')).POST;
  const reject = (await import('../../../app/api/admin/funded/reject/route')).POST;
  const post = (handler: (req: Request) => Promise<Response>, accountId: string) =>
    handler(new Request('http://localhost/api/admin/funded/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ accountId }),
    }));

  for (const accountId of ['funded', 'legacy-funded']) {
    const before = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    // Одобрить/отклонить можно только PASSED-челлендж → 409, без каких-либо записей.
    for (const handler of [approve, reject])
      assert.equal((await post(handler, accountId)).status, 409);
    const after = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    assert.equal(after.mode, before.mode); // mode FUNDED не «переписан»
    assert.equal(after.status, before.status);
    assert.equal(after.phase, before.phase);
  }
  // FUNDED-счету не создали дубль phase FUNDED_SIM и не записали решений.
  assert.equal(await db.tradingAccount.count({ where: { phase: 'FUNDED_SIM' } }), 0);
  assert.equal(await db.auditLog.count({ where: { action: { in: ['FUNDED_APPROVED', 'FUNDED_REJECTED'] } } }), 0);
});

// Волна 1 (агент A): риск — чистая функция core/risk.evaluateAccount; юнит-детали в core/__tests__/risk.test.ts.
test('evaluation passes only with completed days and closed exposure, never activates funded', async () => {
  // Реальный CHALLENGE-счёт из фикстур + правила его челленджа; equity уже на цели 11000.
  const acc = await db.tradingAccount.findUniqueOrThrow({ where: { id: 'challenge' } });
  const ch = await db.challenge.findUniqueOrThrow({ where: { id: acc.challengeId } });
  const rules = {
    maxDdPct: ch.maxDdPct, dailyDdPct: ch.dailyDdPct,
    profitTargetPct: ch.profitTargetPct, minTradingDays: ch.minTradingDays,
  };
  const atTarget = {
    accountSize: acc.accountSize as Decimal, balance: d('11000'), dayStartEquity: d('11000'),
    rules, maintenanceRatio: 0.5, status: 'ACTIVE',
  };
  const openPosition = {
    pos: { side: 'LONG' as const, quantity: d(1), entryPrice: d(100), leverage: 1, margin: d(100) },
    mark: d(100),
  };

  // Открытая экспозиция — не прошёл, даже когда equity уже на цели.
  assert.equal(evaluateAccount({ ...atTarget, positions: [openPosition], tradingDays: rules.minTradingDays }).passed, false);
  // Незавершённые дни — не прошёл.
  assert.equal(evaluateAccount({ ...atTarget, positions: [], tradingDays: rules.minTradingDays - 1 }).passed, false);
  // Дни завершены, экспозиция закрыта, equity на цели — прошёл.
  assert.equal(evaluateAccount({ ...atTarget, positions: [], tradingDays: rules.minTradingDays }).passed, true);
  // Уже не ACTIVE — повторно не «прошёл».
  assert.equal(evaluateAccount({ ...atTarget, status: 'PASSED', positions: [], tradingDays: rules.minTradingDays }).passed, false);

  // Никакого автоматического funded: оценка — чистая функция, счёт в БД не изменился.
  const after = await db.tradingAccount.findUniqueOrThrow({ where: { id: 'challenge' } });
  assert.equal(after.mode, 'CHALLENGE');
  assert.equal(after.status, 'ACTIVE');
  assert.equal((after.currentBalance as Decimal).toFixed(2), '10000.00');
  assert.equal(await db.auditLog.count({ where: { action: 'FUNDED_APPROVED' } }), 0);
});
