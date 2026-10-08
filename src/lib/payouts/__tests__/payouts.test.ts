import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';

// Полный путь агента G: PASSED → approve (admin) → FUNDED_SIM → прибыль (ledger)
// → request → APPROVED → PAID (ledger PAYOUT, возврат к accountSize).
// Плюс: запрос больше доступного → 400, не-админ approve/decide → 403, чужой счёт → 404.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let createSession: (userId: string) => Promise<string>;
let approvePOST: (req: Request) => Promise<Response>;
let rejectPOST: (req: Request) => Promise<Response>;
let decidePOST: (req: Request) => Promise<Response>;
let payoutsGET: (req: Request) => Promise<Response>;
let payoutRequestPOST: (req: Request) => Promise<Response>;
let fundedRequestPOST: (req: Request) => Promise<Response>;

let traderId: string;
let adminId: string;
let strangerId: string;
let challengeId: string;
let traderCookie: string;
let adminCookie: string;
let strangerCookie: string;
let counter = 0;

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

async function makeAccount(userId: string, status: string): Promise<string> {
  counter += 1;
  const account = await db.tradingAccount.create({
    data: {
      userId,
      challengeId,
      mode: 'CHALLENGE',
      phase: 'CHALLENGE',
      status,
      rulesHash: `rules-hash-${counter}`,
      accountSize: new Decimal(10000),
      currentBalance: new Decimal(10000),
      currentEquity: new Decimal(10000),
      dayStartEquity: new Decimal(10000),
      staticMaxDdFloor: new Decimal(9400),
      dailyDdFloor: new Decimal(9700),
    },
  });
  await db.ledgerEntry.create({
    data: { accountId: account.id, type: 'DEPOSIT', amount: new Decimal(10000) },
  });
  return account.id;
}

/** Прибыль напрямую через ledger (как если бы трейдер закрыл позиции с прибылью). */
async function addProfit(accountId: string, amount: number): Promise<void> {
  await db.ledgerEntry.create({ data: { accountId, type: 'PNL', amount: new Decimal(amount) } });
  await db.tradingAccount.update({
    where: { id: accountId },
    data: {
      currentBalance: { increment: new Decimal(amount) },
      currentEquity: { increment: new Decimal(amount) },
      dayStartEquity: { increment: new Decimal(amount) },
    },
  });
}

/** Инвариант §5: баланс счёта равен сумме его проводок. */
async function assertLedgerInvariant(accountId: string): Promise<void> {
  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const entries = await db.ledgerEntry.findMany({ where: { accountId } });
  const sum = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
  assert.equal(sum.toFixed(2), account.currentBalance.toFixed(2), 'ledger sum must equal currentBalance');
}

async function approveAndGetFundedId(accountId: string): Promise<string> {
  const res = await approvePOST(post('/api/admin/funded/approve', { accountId }, adminCookie));
  assert.ok(res.ok, `approve failed: HTTP ${res.status}`);
  return (await res.json()).fundedAccountId;
}

async function requestPayoutId(accountId: string, amount: string): Promise<string> {
  const res = await payoutRequestPOST(post('/api/payouts/request', { accountId, amount }, traderCookie));
  assert.ok(res.ok, `payout request failed: HTTP ${res.status}`);
  return (await res.json()).id;
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ createSession } = await import('../../auth/session'));
  ({ POST: approvePOST } = await import('../../../app/api/admin/funded/approve/route'));
  ({ POST: rejectPOST } = await import('../../../app/api/admin/funded/reject/route'));
  ({ POST: decidePOST } = await import('../../../app/api/admin/payouts/decide/route'));
  ({ GET: payoutsGET } = await import('../../../app/api/payouts/route'));
  ({ POST: payoutRequestPOST } = await import('../../../app/api/payouts/request/route'));
  ({ POST: fundedRequestPOST } = await import('../../../app/api/funded/request/route'));

  traderId = (await db.user.create({ data: { walletAddress: 'payout-trader' } })).id;
  adminId = (await db.user.create({ data: { walletAddress: 'payout-admin', role: 'ADMIN' } })).id;
  strangerId = (await db.user.create({ data: { walletAddress: 'payout-stranger' } })).id;
  traderCookie = `props_session=${await createSession(traderId)}`;
  adminCookie = `props_session=${await createSession(adminId)}`;
  strangerCookie = `props_session=${await createSession(strangerId)}`;

  const challenge = await db.challenge.create({
    data: {
      accountSize: new Decimal(10000), planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: new Decimal(89), minTradingDays: 3,
    },
  });
  challengeId = challenge.id;
});

after(async () => { await db?.$disconnect(); });

test('полный путь: PASSED → approve → FUNDED_SIM → прибыль 1000 → request 800 → APPROVED → PAID', async () => {
  const sourceId = await makeAccount(traderId, 'PASSED');

  // Доступ к approve: без сессии 401, не-админ 403, админ 200.
  assert.equal((await approvePOST(post('/api/admin/funded/approve', { accountId: sourceId }))).status, 401);
  assert.equal((await approvePOST(post('/api/admin/funded/approve', { accountId: sourceId }, traderCookie))).status, 403);
  const fundedId = await approveAndGetFundedId(sourceId);

  const funded = await db.tradingAccount.findUniqueOrThrow({ where: { id: fundedId } });
  assert.equal(funded.phase, 'FUNDED_SIM');
  assert.equal(funded.mode, 'CHALLENGE'); // исполнение симулированное
  assert.equal(funded.status, 'ACTIVE');
  assert.equal(funded.userId, traderId);
  assert.equal(funded.accountSize.toFixed(2), '10000.00');
  assert.equal(funded.rulesHash, (await db.tradingAccount.findUniqueOrThrow({ where: { id: sourceId } })).rulesHash);
  assert.equal(funded.challengeId, challengeId);
  assert.equal(funded.currentBalance.toFixed(2), '10000.00');
  assert.equal(funded.staticMaxDdFloor.toFixed(2), '9400.00');
  assert.equal(funded.dailyDdFloor.toFixed(2), '9700.00');

  // Старый счёт остаётся PASSED; связь — через AuditLog.
  assert.equal((await db.tradingAccount.findUniqueOrThrow({ where: { id: sourceId } })).status, 'PASSED');
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'FUNDED_APPROVED', targetId: sourceId } });
  assert.equal(audit.actorId, adminId);
  assert.equal((audit.data as { fundedAccountId: string }).fundedAccountId, fundedId);

  // DEPOSIT-проводка и инвариант суммы проводок.
  const deposit = await db.ledgerEntry.findFirstOrThrow({ where: { accountId: fundedId, type: 'DEPOSIT' } });
  assert.equal(deposit.amount.toFixed(2), '10000.00');
  await assertLedgerInvariant(fundedId);

  // Повторный approve того же счёта → 409.
  assert.equal((await approvePOST(post('/api/admin/funded/approve', { accountId: sourceId }, adminCookie))).status, 409);

  // Прибыль 1000 напрямую через ledger → доступно 800 (сплит 80 %).
  await addProfit(fundedId, 1000);
  const overviewRes = await payoutsGET(get('/api/payouts', traderCookie));
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.equal(overview.accounts.length, 1);
  assert.equal(overview.accounts[0].id, fundedId);
  assert.equal(overview.accounts[0].equity, '11000.00');
  assert.equal(overview.accounts[0].availableUsd, '800.00');
  assert.equal(overview.accounts[0].canRequest, true);

  // Запрос 800 → REQUESTED; сверх доступного → 400.
  const payoutId = await requestPayoutId(fundedId, '800');
  assert.equal((await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, 'REQUESTED');
  assert.equal(
    (await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: '0.01' }, traderCookie))).status,
    400,
  );
  assert.ok(
    await db.auditLog.findFirst({ where: { action: 'PAYOUT_REQUESTED', targetId: payoutId, actorId: traderId } }),
  );

  // Approve без подписи → APPROVED; с подписью → PAID.
  assert.equal((await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true }, adminCookie))).status, 200);
  assert.equal((await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, 'APPROVED');
  const paidRes = await decidePOST(
    post('/api/admin/payouts/decide', { payoutId, approve: true, txSignature: 'sig-full-1' }, adminCookie),
  );
  assert.equal(paidRes.status, 200);
  assert.equal((await paidRes.json()).status, 'PAID');

  const payout = await db.payout.findUniqueOrThrow({ where: { id: payoutId } });
  assert.equal(payout.status, 'PAID');
  assert.equal(payout.txSignature, 'sig-full-1');
  assert.equal(payout.approvedBy, adminId);
  assert.ok(payout.decidedAt);

  // Проводка PAYOUT = −1000 (полная прибыль: 800 / 80 × 100), счёт вернулся к accountSize.
  const payoutEntry = await db.ledgerEntry.findFirstOrThrow({ where: { accountId: fundedId, type: 'PAYOUT' } });
  assert.equal(payoutEntry.amount.toFixed(2), '-1000.00');
  assert.equal(payoutEntry.refId, payoutId);
  const after = await db.tradingAccount.findUniqueOrThrow({ where: { id: fundedId } });
  assert.equal(after.currentBalance.toFixed(2), '10000.00');
  assert.equal(after.currentEquity.toFixed(2), '10000.00');
  assert.equal(after.dayStartEquity.toFixed(2), '10000.00'); // 11000 − 1000: база дня сдвинута со списанием
  await assertLedgerInvariant(fundedId);
  assert.ok(await db.auditLog.findFirst({ where: { action: 'PAYOUT_PAID', targetId: payoutId } }));

  // Повторное решение по выплаченной → 409; доступно снова 0.
  assert.equal(
    (await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true, txSignature: 'x' }, adminCookie))).status,
    409,
  );
  const finalOverview = await (await payoutsGET(get('/api/payouts', traderCookie))).json();
  assert.equal(finalOverview.accounts[0].availableUsd, '0.00');
  assert.equal(finalOverview.payouts[0].status, 'PAID');
});

test('валидации запроса и решения: больше доступного 400, центы, позиции, пустая подпись, reject освобождает долю', async () => {
  const sourceId = await makeAccount(traderId, 'PASSED');
  const fundedId = await approveAndGetFundedId(sourceId);
  await addProfit(fundedId, 100); // equity 10100 → доступно 80

  // Больше доступного → 400; не-funded счёт → 400; мусорная сумма → 400.
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: '100' }, traderCookie))).status, 400);
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: sourceId, amount: '1' }, traderCookie))).status, 400);
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: '-5' }, traderCookie))).status, 400);
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: '10.001' }, traderCookie))).status, 400);
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: 'abc' }, traderCookie))).status, 400);

  // Открытая позиция блокирует запрос → 409; после закрытия доступно снова.
  const position = await db.position.create({
    data: {
      accountId: fundedId, symbol: 'BTC-PERP', side: 'LONG',
      entryPrice: new Decimal(100), currentMarkPrice: new Decimal(100),
      quantity: new Decimal(1), margin: new Decimal(100), leverage: 1,
      liquidationPrice: new Decimal(50), status: 'OPEN',
    },
  });
  assert.equal((await payoutRequestPOST(post('/api/payouts/request', { accountId: fundedId, amount: '10' }, traderCookie))).status, 409);
  await db.position.update({ where: { id: position.id }, data: { status: 'CLOSED' } });

  // 80 → REQUESTED; пустая подпись → 400; reject → REJECTED и доля свободна.
  const payoutId = await requestPayoutId(fundedId, '80');
  assert.equal(
    (await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true, txSignature: '' }, adminCookie))).status,
    400,
  );
  assert.equal((await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: false }, adminCookie))).status, 200);
  assert.equal((await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, 'REJECTED');
  const overview = await (await payoutsGET(get('/api/payouts', traderCookie))).json();
  const row = overview.accounts.find((a: { id: string }) => a.id === fundedId);
  assert.equal(row.availableUsd, '80.00'); // REJECTED не резервирует

  // Повторный запрос 80 → APPROVED → повторный approve без подписи 409 → PAID.
  const secondId = await requestPayoutId(fundedId, '80');
  assert.equal((await decidePOST(post('/api/admin/payouts/decide', { payoutId: secondId, approve: true }, adminCookie))).status, 200);
  assert.equal((await decidePOST(post('/api/admin/payouts/decide', { payoutId: secondId, approve: true }, adminCookie))).status, 409);
  assert.equal(
    (await decidePOST(post('/api/admin/payouts/decide', { payoutId: secondId, approve: true, txSignature: 'sig-partial-2' }, adminCookie))).status,
    200,
  );
  // Списание 100 (80/80×100) → баланс 10000, инвариант ledger.
  const after = await db.tradingAccount.findUniqueOrThrow({ where: { id: fundedId } });
  assert.equal(after.currentBalance.toFixed(2), '10000.00');
  await assertLedgerInvariant(fundedId);
});

test('доступ: чужой счёт 404, decide не-админом 403, без сессии 401, чужой обзор пуст', async () => {
  const strangerSourceId = await makeAccount(strangerId, 'PASSED');

  // Чужой счёт невидим: payout request и funded request → 404.
  assert.equal(
    (await payoutRequestPOST(post('/api/payouts/request', { accountId: strangerSourceId, amount: '1' }, traderCookie))).status,
    404,
  );
  assert.equal(
    (await fundedRequestPOST(post('/api/funded/request', { accountId: strangerSourceId }, traderCookie))).status,
    404,
  );

  // decide не-админом → 403; неизвестная выплата → 404; GET без сессии → 401.
  const sourceId = await makeAccount(traderId, 'PASSED');
  const fundedId = await approveAndGetFundedId(sourceId);
  await addProfit(fundedId, 50); // доступно 40
  const payoutId = await requestPayoutId(fundedId, '40');
  assert.equal(
    (await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true }, traderCookie))).status,
    403,
  );
  assert.equal(
    (await decidePOST(post('/api/admin/payouts/decide', { payoutId: 'no-such-payout', approve: true }, adminCookie))).status,
    404,
  );
  assert.equal((await payoutsGET(get('/api/payouts'))).status, 401);

  // Обзор чужого пользователя не видит счёта трейдера.
  const strangerOverview = await (await payoutsGET(get('/api/payouts', strangerCookie))).json();
  assert.equal(strangerOverview.accounts.length, 0);
  assert.equal(strangerOverview.payouts.length, 0);
});

test('funded review: запрос трейдером идемпотентен, reject — только аудит, approve после reject возможен', async () => {
  const sourceId = await makeAccount(traderId, 'PASSED');

  // Запрос трейдером → FUNDED_REQUESTED; повтор → duplicate.
  const first = await fundedRequestPOST(post('/api/funded/request', { accountId: sourceId }, traderCookie));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { requested: true, duplicate: false });
  const second = await fundedRequestPOST(post('/api/funded/request', { accountId: sourceId }, traderCookie));
  assert.deepEqual(await second.json(), { requested: true, duplicate: true });
  assert.ok(await db.auditLog.findFirst({ where: { action: 'FUNDED_REQUESTED', targetId: sourceId, actorId: traderId } }));
  // Обзор показывает счёт в fundRequestAccountIds.
  const overview = await (await payoutsGET(get('/api/payouts', traderCookie))).json();
  assert.ok(overview.fundRequestAccountIds.includes(sourceId));

  // Не-PASSED счёт → 409.
  const activeId = await makeAccount(traderId, 'ACTIVE');
  assert.equal((await fundedRequestPOST(post('/api/funded/request', { accountId: activeId }, traderCookie))).status, 409);

  // Reject админом: только аудит, счёт остаётся PASSED.
  assert.equal(
    (await rejectPOST(post('/api/admin/funded/reject', { accountId: sourceId, reason: 'manual review failed' }, adminCookie))).status,
    200,
  );
  const rejectAudit = await db.auditLog.findFirstOrThrow({ where: { action: 'FUNDED_REJECTED', targetId: sourceId } });
  assert.equal((rejectAudit.data as { reason: string }).reason, 'manual review failed');
  assert.equal((await db.tradingAccount.findUniqueOrThrow({ where: { id: sourceId } })).status, 'PASSED');

  // Approve после reject возможен; reject после approve → 409.
  const fundedId = await approveAndGetFundedId(sourceId);
  assert.equal(fundedId.length > 0, true);
  assert.equal(
    (await rejectPOST(post('/api/admin/funded/reject', { accountId: sourceId }, adminCookie))).status,
    409,
  );
});
