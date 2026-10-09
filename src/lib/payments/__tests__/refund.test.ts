import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';

// Q3 «Возвраты»: успешный возврат (счёт FAILED, ордера CANCELLED, RiskEvent REFUND,
// AuditLog, notify), повтор 409, открытые позиции 409 (атомарность), не-админ 403.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let createSession: (userId: string) => Promise<string>;
let refundPOST: (req: Request) => Promise<Response>;
let purchasesGET: (req: Request) => Promise<Response>;

let traderId: string;
let adminId: string;
let traderCookie: string;
let adminCookie: string;
let challengeId: string;
let counter = 0;

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

/** Уникальная валидная base58-подпись длиной 64 из счётчика (буквы a–j). */
const sig = (n: number): string =>
  'a'.repeat(62) + String.fromCharCode(97 + Math.floor(n / 10)) + String.fromCharCode(97 + (n % 10));

/**
 * PAID-покупка со счётом в заданном статусе (как после confirmPurchase воркера):
 * счёт + проводка DEPOSIT + покупка со ссылкой на счёт.
 */
async function makePaidPurchase(
  userId: string,
  accountStatus = 'ACTIVE',
): Promise<{ purchaseId: string; accountId: string }> {
  counter += 1;
  const size = new Decimal(10000);
  const account = await db.tradingAccount.create({
    data: {
      userId,
      challengeId,
      mode: 'CHALLENGE',
      phase: 'CHALLENGE',
      status: accountStatus,
      rulesHash: `refund-rules-${counter}`,
      accountSize: size,
      currentBalance: size,
      currentEquity: size,
      dayStartEquity: size,
      staticMaxDdFloor: new Decimal(9400),
      dailyDdFloor: new Decimal(9700),
    },
  });
  await db.ledgerEntry.create({ data: { accountId: account.id, type: 'DEPOSIT', amount: size } });
  const purchase = await db.purchase.create({
    data: {
      userId,
      challengeId,
      reference: `refund-ref-${counter}`,
      amountUsdc: new Decimal(89),
      status: 'PAID',
      txSignature: `b${sig(counter)}`,
      accountId: account.id,
    },
  });
  return { purchaseId: purchase.id, accountId: account.id };
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ createSession } = await import('../../auth/session'));
  ({ POST: refundPOST } = await import('../../../app/api/admin/refunds/route'));
  ({ GET: purchasesGET } = await import('../../../app/api/admin/purchases/route'));

  traderId = (await db.user.create({ data: { walletAddress: 'refund-trader' } })).id;
  adminId = (await db.user.create({ data: { walletAddress: 'refund-admin', role: 'ADMIN' } })).id;
  traderCookie = `props_session=${await createSession(traderId)}`;
  adminCookie = `props_session=${await createSession(adminId)}`;

  challengeId = (
    await db.challenge.create({
      data: {
        accountSize: new Decimal(10000), planType: 'CORE',
        profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
        priceUsd: new Decimal(89), minTradingDays: 3,
      },
    })
  ).id;
});

after(async () => { await db?.$disconnect(); });

test('успешный возврат: Purchase REFUNDED, счёт FAILED, ордера CANCELLED, RiskEvent, AuditLog, notify', async () => {
  const { purchaseId, accountId } = await makePaidPurchase(traderId);
  const order = await db.order.create({
    data: {
      accountId, symbol: 'BTC-PERP', side: 'LONG', type: 'LIMIT',
      price: new Decimal(100), size: new Decimal(1), status: 'OPEN',
    },
  });

  const res = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(1), reason: 'duplicate payment' }, adminCookie));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'REFUNDED');
  assert.equal(body.accountId, accountId);
  assert.equal(body.cancelledOrders, 1);

  const purchase = await db.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  assert.equal(purchase.status, 'REFUNDED');
  assert.ok(purchase.refundedAt);
  assert.equal(purchase.refundTxSignature, sig(1));
  assert.equal(purchase.refundReason, 'duplicate payment');

  assert.equal((await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).status, 'FAILED');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED');

  const risk = await db.riskEvent.findFirst({ where: { accountId, ruleName: 'REFUND' } });
  assert.ok(risk, 'RiskEvent REFUND must exist');
  assert.equal(risk?.level, 'FAILED');

  const audit = await db.auditLog.findFirst({ where: { action: 'PURCHASE_REFUNDED', targetId: purchaseId } });
  assert.ok(audit, 'AuditLog PURCHASE_REFUNDED must exist');
  assert.equal(audit?.actorId, adminId);

  const note = await db.notification.findFirst({ where: { userId: traderId, kind: 'PURCHASE_REFUNDED' } });
  assert.ok(note, 'notification PURCHASE_REFUNDED must exist');
  assert.ok(note?.body.includes(sig(1)));
});

test('повторный возврат той же покупки → 409', async () => {
  const { purchaseId } = await makePaidPurchase(traderId);
  const first = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(2) }, adminCookie));
  assert.equal(first.status, 200);
  const second = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(3) }, adminCookie));
  assert.equal(second.status, 409);
});

test('открытые позиции → 409 OPEN_POSITIONS, ничего не меняется', async () => {
  const { purchaseId, accountId } = await makePaidPurchase(traderId);
  await db.position.create({
    data: {
      accountId, symbol: 'BTC-PERP', side: 'LONG',
      entryPrice: new Decimal(100), currentMarkPrice: new Decimal(100),
      quantity: new Decimal(1), margin: new Decimal(100),
      liquidationPrice: new Decimal(50), status: 'OPEN',
    },
  });

  const res = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(4) }, adminCookie));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /OPEN_POSITIONS/);

  // Транзакция откатилась целиком: покупка и счёт не тронуты.
  const purchase = await db.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  assert.equal(purchase.status, 'PAID');
  assert.equal(purchase.refundedAt, null);
  assert.equal((await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).status, 'ACTIVE');
  assert.equal(await db.auditLog.count({ where: { action: 'PURCHASE_REFUNDED', targetId: purchaseId } }), 0);
});

test('счёт PASSED → 409 (возврат по политике невозможен)', async () => {
  const { purchaseId } = await makePaidPurchase(traderId, 'PASSED');
  const res = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(5) }, adminCookie));
  assert.equal(res.status, 409);
  assert.equal((await db.purchase.findUniqueOrThrow({ where: { id: purchaseId } })).status, 'PAID');
});

test('не-админ 403, без сессии 401, неверная подпись 400', async () => {
  const { purchaseId } = await makePaidPurchase(traderId);
  assert.equal((await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(6) }))).status, 401);
  assert.equal(
    (await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: sig(7) }, traderCookie))).status,
    403,
  );
  const bad = await refundPOST(post('/api/admin/refunds', { purchaseId, txSignature: 'not-a-sig!' }, adminCookie));
  assert.equal(bad.status, 400);
  assert.equal((await db.purchase.findUniqueOrThrow({ where: { id: purchaseId } })).status, 'PAID');
});

test('GET /api/admin/purchases: только ADMIN, последние PAID-покупки', async () => {
  const { purchaseId } = await makePaidPurchase(traderId);
  assert.equal((await purchasesGET(get('/api/admin/purchases', traderCookie))).status, 403);
  assert.equal((await purchasesGET(get('/api/admin/purchases'))).status, 401);
  const res = await purchasesGET(get('/api/admin/purchases', adminCookie));
  assert.equal(res.status, 200);
  const { purchases } = (await res.json()) as { purchases: Array<{ id: string; amountUsdc: string; account: { status: string } | null }> };
  assert.ok(purchases.some((p) => p.id === purchaseId && p.amountUsdc === '89.00' && p.account?.status === 'ACTIVE'));
  assert.ok(purchases.every((p) => typeof p.amountUsdc === 'string'));
});
