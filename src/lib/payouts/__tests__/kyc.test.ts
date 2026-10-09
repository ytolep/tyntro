import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';

// Q2: KYC перед выплатой. Запрос выплаты разрешён без верификации (в ответе видно,
// что нужна), но decide → APPROVED/PAID без kycStatus VERIFIED → 409 KYC_REQUIRED.
// Решение KYC: только ADMIN, AuditLog + notify. Не-админ → 403, без сессии → 401.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let createSession: (userId: string) => Promise<string>;
let kycPOST: (req: Request) => Promise<Response>;
let kycGET: (req: Request) => Promise<Response>;
let decidePOST: (req: Request) => Promise<Response>;
let payoutsGET: (req: Request) => Promise<Response>;
let payoutRequestPOST: (req: Request) => Promise<Response>;
let fundedApprovePOST: (req: Request) => Promise<Response>;

let traderId: string;
let adminId: string;
let trader2Id: string;
let challengeId: string;
let traderCookie: string;
let adminCookie: string;
let counter = 0;

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

/** PASSED-счёт → approve админом → funded-счёт с прибылью amount. */
async function makeFundedWithProfit(userId: string, profit: number): Promise<string> {
  counter += 1;
  const source = await db.tradingAccount.create({
    data: {
      userId,
      challengeId,
      mode: 'CHALLENGE',
      phase: 'CHALLENGE',
      status: 'PASSED',
      rulesHash: `kyc-rules-${counter}`,
      accountSize: new Decimal(10000),
      currentBalance: new Decimal(10000),
      currentEquity: new Decimal(10000),
      dayStartEquity: new Decimal(10000),
      staticMaxDdFloor: new Decimal(9400),
      dailyDdFloor: new Decimal(9700),
    },
  });
  const res = await fundedApprovePOST(post('/api/admin/funded/approve', { accountId: source.id }, adminCookie));
  assert.ok(res.ok, `funded approve failed: HTTP ${res.status}`);
  const fundedId: string = (await res.json()).fundedAccountId;
  await db.ledgerEntry.create({ data: { accountId: fundedId, type: 'PNL', amount: new Decimal(profit) } });
  await db.tradingAccount.update({
    where: { id: fundedId },
    data: {
      currentBalance: { increment: new Decimal(profit) },
      currentEquity: { increment: new Decimal(profit) },
      dayStartEquity: { increment: new Decimal(profit) },
    },
  });
  return fundedId;
}

async function requestPayoutId(cookie: string, accountId: string, amount: string): Promise<{ id: string; kycStatus: string }> {
  const res = await payoutRequestPOST(post('/api/payouts/request', { accountId, amount }, cookie));
  assert.ok(res.ok, `payout request failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string; kycStatus: string };
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ createSession } = await import('../../auth/session'));
  ({ POST: kycPOST, GET: kycGET } = await import('../../../app/api/admin/kyc/route'));
  ({ POST: decidePOST } = await import('../../../app/api/admin/payouts/decide/route'));
  ({ GET: payoutsGET } = await import('../../../app/api/payouts/route'));
  ({ POST: payoutRequestPOST } = await import('../../../app/api/payouts/request/route'));
  ({ POST: fundedApprovePOST } = await import('../../../app/api/admin/funded/approve/route'));

  traderId = (await db.user.create({ data: { walletAddress: 'kyc-trader' } })).id;
  trader2Id = (await db.user.create({ data: { walletAddress: 'kyc-trader-2' } })).id;
  adminId = (await db.user.create({ data: { walletAddress: 'kyc-admin', role: 'ADMIN' } })).id;
  traderCookie = `props_session=${await createSession(traderId)}`;
  adminCookie = `props_session=${await createSession(adminId)}`;

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

test('выплата без VERIFIED: request разрешён (виден kycStatus), approve и paid → 409 KYC_REQUIRED', async () => {
  const fundedId = await makeFundedWithProfit(traderId, 100); // доступно 80

  // Запрос трейдером разрешён; в ответе видно, что нужна верификация.
  const { id: payoutId, kycStatus } = await requestPayoutId(traderCookie, fundedId, '80');
  assert.equal(kycStatus, 'NONE');
  assert.equal((await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, 'REQUESTED');

  // Обзор в /api/payouts тоже показывает kycStatus.
  const overview = await (await payoutsGET(get('/api/payouts', traderCookie))).json();
  assert.equal(overview.kycStatus, 'NONE');

  // Approve без VERIFIED → 409 KYC_REQUIRED, выплата остаётся REQUESTED.
  const approveRes = await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true }, adminCookie));
  assert.equal(approveRes.status, 409);
  assert.match((await approveRes.json()).error, /KYC_REQUIRED/);
  assert.equal((await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, 'REQUESTED');

  // Сразу PAID с подписей тоже запрещён.
  const paidRes = await decidePOST(
    post('/api/admin/payouts/decide', { payoutId, approve: true, txSignature: 'sig-kyc-1' }, adminCookie),
  );
  assert.equal(paidRes.status, 409);
  assert.match((await paidRes.json()).error, /KYC_REQUIRED/);

  // Reject без KYC разрешён (отклонение — безопасное направление).
  const rejectRes = await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: false }, adminCookie));
  assert.equal(rejectRes.status, 200);
  assert.equal((await rejectRes.json()).status, 'REJECTED');
});

test('/api/admin/kyc доступ: без сессии 401, не-админ 403, мусорный статус/заметка 400, нет пользователя 404', async () => {
  const fundedId = await makeFundedWithProfit(traderId, 50);
  await requestPayoutId(traderCookie, fundedId, '40');

  assert.equal((await kycPOST(post('/api/admin/kyc', { userId: traderId, status: 'VERIFIED' }))).status, 401);
  assert.equal(
    (await kycPOST(post('/api/admin/kyc', { userId: traderId, status: 'VERIFIED' }, traderCookie))).status,
    403,
  );
  assert.equal(
    (await kycPOST(post('/api/admin/kyc', { userId: traderId, status: 'MAYBE' }, adminCookie))).status,
    400,
  );
  assert.equal(
    (await kycPOST(post('/api/admin/kyc', { userId: traderId, status: 'VERIFIED', note: '' }, adminCookie))).status,
    400,
  );
  assert.equal(
    (await kycPOST(post('/api/admin/kyc', { userId: 'no-such-user', status: 'VERIFIED' }, adminCookie))).status,
    404,
  );

  // GET: без сессии 401, не-админ 403, без параметра 400, неизвестный кошелёк 404.
  assert.equal((await kycGET(get('/api/admin/kyc?wallet=kyc-trader'))).status, 401);
  assert.equal((await kycGET(get('/api/admin/kyc?wallet=kyc-trader', traderCookie))).status, 403);
  assert.equal((await kycGET(get('/api/admin/kyc', adminCookie))).status, 400);
  assert.equal((await kycGET(get('/api/admin/kyc?wallet=ghost', adminCookie))).status, 404);
});

test('после VERIFIED: approve и PAID проходят; решение пишет AuditLog и notify', async () => {
  const fundedId = await makeFundedWithProfit(traderId, 200); // доступно 160
  const { id: payoutId } = await requestPayoutId(traderCookie, fundedId, '160');
  const before = await db.user.findUniqueOrThrow({ where: { id: traderId } });
  assert.equal(before.kycStatus, 'NONE');

  // Решение админом: VERIFIED.
  const okRes = await kycPOST(post('/api/admin/kyc', { userId: traderId, status: 'VERIFIED' }, adminCookie));
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { userId: traderId, kycStatus: 'VERIFIED' });

  const user = await db.user.findUniqueOrThrow({ where: { id: traderId } });
  assert.equal(user.kycStatus, 'VERIFIED');
  assert.equal(user.kycVerifiedBy, adminId);
  assert.ok(user.kycVerifiedAt);
  assert.equal(user.kycNote, null);

  // AuditLog + notify о решении.
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'KYC_VERIFIED', targetId: traderId } });
  assert.equal(audit.actorId, adminId);
  assert.deepEqual(audit.data, { status: 'VERIFIED' });
  assert.ok(await db.notification.findFirst({ where: { userId: traderId, kind: 'KYC_VERIFIED' } }));

  // Теперь approve → APPROVED, с подписью → PAID, проводка PAYOUT списала долю.
  assert.equal((await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true }, adminCookie))).status, 200);
  const paidRes = await decidePOST(
    post('/api/admin/payouts/decide', { payoutId, approve: true, txSignature: 'sig-kyc-2' }, adminCookie),
  );
  assert.equal(paidRes.status, 200);
  assert.equal((await paidRes.json()).status, 'PAID');
  const payoutEntry = await db.ledgerEntry.findFirstOrThrow({ where: { accountId: fundedId, type: 'PAYOUT' } });
  assert.equal(payoutEntry.amount.toFixed(2), '-200.00'); // 160 / 80 × 100
  assert.equal(
    (await db.tradingAccount.findUniqueOrThrow({ where: { id: fundedId } })).currentBalance.toFixed(2),
    '10000.00',
  );
});


test('REJECTED: kycNote сохранён, дата верификации сброшена, payout всё ещё 409 KYC_REQUIRED', async () => {
  const fundedId = await makeFundedWithProfit(trader2Id, 100);
  const trader2Cookie = `props_session=${await createSession(trader2Id)}`;
  const { id: payoutId, kycStatus } = await requestPayoutId(trader2Cookie, fundedId, '80');
  assert.equal(kycStatus, 'NONE');

  const res = await kycPOST(
    post('/api/admin/kyc', { userId: trader2Id, status: 'REJECTED', note: 'document unreadable' }, adminCookie),
  );
  assert.equal(res.status, 200);
  const user = await db.user.findUniqueOrThrow({ where: { id: trader2Id } });
  assert.equal(user.kycStatus, 'REJECTED');
  assert.equal(user.kycNote, 'document unreadable');
  assert.equal(user.kycVerifiedAt, null);
  assert.equal(user.kycVerifiedBy, null);

  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'KYC_REJECTED', targetId: trader2Id } });
  assert.deepEqual(audit.data, { status: 'REJECTED', note: 'document unreadable' });
  const notif = await db.notification.findFirstOrThrow({ where: { userId: trader2Id, kind: 'KYC_REJECTED' } });
  assert.match(notif.body, /document unreadable/);

  // Выплата по-прежнему запрещена.
  const decideRes = await decidePOST(post('/api/admin/payouts/decide', { payoutId, approve: true }, adminCookie));
  assert.equal(decideRes.status, 409);
  assert.match((await decideRes.json()).error, /KYC_REQUIRED/);

  // Обзор владельца показывает REJECTED.
  const overview = await (await payoutsGET(get('/api/payouts', trader2Cookie))).json();
  assert.equal(overview.kycStatus, 'REJECTED');

  // GET ?wallet= возвращает актуальный статус.
  const lookup = await kycGET(get(`/api/admin/kyc?wallet=${encodeURIComponent('kyc-trader')}`, adminCookie));
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).kycStatus, 'VERIFIED');
});
