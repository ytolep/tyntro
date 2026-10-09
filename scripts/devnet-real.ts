/**
 * Проверка полного пути на РЕАЛЬНЫХ devnet-кошельках и настоящих транзакциях USDC.
 * Сид-фразы только из env (MN1 — трейдер, MN2 — казна и админ), на диск не пишутся.
 *
 *   MN1="..." MN2="..." BASE_URL=http://localhost:3100 \
 *   DATABASE_URL=postgresql://props:props@localhost:54339/props_realtest \
 *   USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
 *   npx tsx scripts/devnet-real.ts
 *
 * Приложение (web + worker) должно быть запущено с TREASURY_WALLET = адрес MN2,
 * тем же USDC_MINT и PAYMENTS_RPC_URL=https://api.devnet.solana.com.
 *
 * Реально: вход подписью, оплата переводом USDC с reference, подтверждение воркером,
 * сделки по живым ценам Phoenix, одобрение funded админом, выплата переводом USDC.
 * Тестовые приёмы (помечены): PASSED и прибыль на funded — проводкой ADJUST,
 * потому что естественное прохождение требует минимум 3 торговых дня.
 */
import { createHmac, createPrivateKey, pbkdf2Sync, sign as ed25519Sign } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { REFUNDS_VERSION, RULES_VERSION, TERMS_VERSION } from '../src/lib/legal/versions';
import { buildUsdcTransferInstructions, parseTransferRequestUrl } from '../src/lib/payments/transferTx';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const USDC_MINT = new PublicKey(process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const RPC = new Connection(process.env.PAYMENTS_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PAYOUT_USDC = new Decimal(1);
const prisma = new PrismaClient();
const d = (x: Decimal | string | number) => new Decimal(x);

function fromMnemonic(mn: string | undefined): Keypair {
  if (!mn) throw new Error('MN1 и MN2 обязательны');
  const seed = pbkdf2Sync(mn.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  let I = createHmac('sha512', 'ed25519 seed').update(seed).digest();
  let k = I.subarray(0, 32), c = I.subarray(32);
  for (const i of [44, 501, 0, 0]) {
    const data = Buffer.alloc(37); k.copy(data, 1); data.writeUInt32BE((i | 0x80000000) >>> 0, 33);
    I = createHmac('sha512', c).update(data).digest(); k = I.subarray(0, 32); c = I.subarray(32);
  }
  return Keypair.fromSeed(k);
}
const trader = fromMnemonic(process.env.MN1);
const admin = fromMnemonic(process.env.MN2);

function signBase58(message: string, kp: Keypair): string {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]),
    format: 'der', type: 'pkcs8',
  });
  return bs58.encode(ed25519Sign(null, Buffer.from(message, 'utf8'), key));
}

async function http(method: string, path: string, opts: { json?: unknown; cookie?: string } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  const token = res.headers.get('set-cookie')?.match(/props_session=([^;]+)/)?.[1];
  return { status: res.status, body, cookie: token ? `props_session=${token}` : '' };
}

const failures: string[] = [];
let n = 0;
async function step(name: string, fn: () => Promise<void>) {
  const label = String(++n).padStart(2, '0');
  try { await fn(); console.log(`PASS ${label} ${name}`); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); console.log(`FAIL ${label} ${name}: ${m}`); failures.push(label); throw e; }
}
function check(cond: unknown, message: string): asserts cond { if (!cond) throw new Error(message); }

const ata = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), USDC_MINT.toBuffer()], ATA_PROGRAM)[0];

async function usdc(owner: PublicKey): Promise<Decimal> {
  const r = await RPC.getTokenAccountBalance(ata(owner)).catch(() => null);
  return d(r?.value.uiAmountString ?? '0');
}

/** Перевод USDC по спецификации Solana Pay: общий сборщик из src/lib/payments/transferTx. */
async function payUsdc(from: Keypair, to: PublicKey, amount: Decimal, reference?: PublicKey): Promise<string> {
  const ixs = buildUsdcTransferInstructions({
    payer: from.publicKey.toBase58(),
    recipient: to.toBase58(),
    mint: USDC_MINT.toBase58(),
    amountUi: amount.toFixed(),
    reference: reference?.toBase58(),
  });
  return sendAndConfirmTransaction(RPC, new Transaction().add(...ixs), [from], { commitment: 'confirmed' });
}

async function login(kp: Keypair, role: string): Promise<string> {
  const wallet = kp.publicKey.toBase58();
  const nonce = await http('POST', '/api/auth/nonce', { json: { wallet } });
  check(nonce.status === 200, `nonce ${nonce.status} ${JSON.stringify(nonce.body)}`);
  const v = await http('POST', '/api/auth/verify', { json: { wallet, message: nonce.body.message, signature: signBase58(nonce.body.message, kp) } });
  check(v.status === 200, `verify ${v.status} ${JSON.stringify(v.body)}`);
  check(v.body?.user?.role === role, `роль ${v.body?.user?.role}, ожидалась ${role}`);
  return v.cookie;
}

async function adjustTo(accountId: string, target: Decimal, note: string, status?: string) {
  await prisma.$transaction(async (tx) => {
    const acc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await tx.ledgerEntry.create({ data: { accountId, type: 'ADJUST', amount: target.minus(d(acc.currentBalance as Decimal)), refId: `devnet-real:${note}` } });
    await tx.tradingAccount.update({ where: { id: accountId }, data: { currentBalance: target, currentEquity: target, ...(status ? { status } : {}) } });
  });
  console.log(`     [тестовый приём] ADJUST ${note}: баланс → ${target.toFixed(2)}`);
}

async function main() {
  // Состояние сценария: заполняется шагами, последующие шаги читают с `!` (шаги идут по порядку).
  const S: {
    trader?: string; admin?: string; purchaseId?: string; reference?: PublicKey;
    amount?: Decimal; paySig?: string; accountId?: string; positionId?: string;
    fundedId?: string; payoutId?: string; payoutSig?: string;
  } = {};
  console.log(`трейдер ${trader.publicKey.toBase58()}, казна/админ ${admin.publicKey.toBase58()}, mint ${USDC_MINT.toBase58()}`);
  const before = { trader: await usdc(trader.publicKey), admin: await usdc(admin.publicKey) };
  console.log(`     USDC до: трейдер ${before.trader}, казна ${before.admin}`);

  await step('вход трейдера реальным ключом (SIWS)', async () => { S.trader = await login(trader, 'USER'); });
  await step('вход админа реальным ключом (роль ADMIN)', async () => { S.admin = await login(admin, 'ADMIN'); });

  await step('покупка SPRINT $5K: PENDING и ссылка Solana Pay на казну', async () => {
    const r = await http('POST', '/api/checkout/create', { json: { accountSize: 5000, planType: 'SPRINT', acceptedTerms: true, termsVersion: TERMS_VERSION, refundsVersion: REFUNDS_VERSION, rulesVersion: RULES_VERSION }, cookie: S.trader });
    check(r.status === 200, `checkout ${r.status} ${JSON.stringify(r.body)}`);
    const req = parseTransferRequestUrl(r.body.url);
    check(req.recipient === admin.publicKey.toBase58(), `получатель ${req.recipient}`);
    check(req.splToken === USDC_MINT.toBase58(), 'не тот mint');
    check(req.amount === d(r.body.amount).toFixed(), 'не та сумма в ссылке');
    const consent = await prisma.termsAcceptance.findFirst({ where: { purchaseId: r.body.id } });
    check(consent?.termsVersion === TERMS_VERSION, 'согласие с условиями не записано для покупки');
    Object.assign(S, { purchaseId: r.body.id, reference: new PublicKey(req.reference), amount: d(r.body.amount) });
    console.log(`     к оплате ${S.amount} USDC, reference ${req.reference}`);
  });

  await step('оплата настоящей транзакцией USDC на devnet', async () => {
    S.paySig = await payUsdc(trader, admin.publicKey, S.amount!, S.reference);
    console.log(`     tx https://explorer.solana.com/tx/${S.paySig}?cluster=devnet`);
  });

  await step('воркер подтвердил оплату, счёт создан', async () => {
    for (let i = 0; i < 24; i++) {
      const r = await http('GET', `/api/checkout/status?id=${S.purchaseId}`, { cookie: S.trader });
      if (r.body?.status === 'PAID') { S.accountId = r.body.accountId; break; }
      await new Promise((ok) => setTimeout(ok, 5000));
    }
    check(S.accountId, 'покупка не стала PAID за 2 минуты');
    const p = await prisma.purchase.findUniqueOrThrow({ where: { id: S.purchaseId! } });
    check(p.txSignature === S.paySig, `в покупке подпись ${p.txSignature}`);
  });

  await step('OPEN SOL-PERP LONG $500 по живой цене Phoenix', async () => {
    const r = await http('POST', '/api/orders', { cookie: S.trader, json: {
      accountId: S.accountId, action: 'OPEN_POSITION', symbol: 'SOL-PERP', side: 'LONG', orderMode: 'Market',
      sizeUsd: 500, leverage: 1, idempotencyKey: Keypair.generate().publicKey.toBase58() } });
    check(r.status === 200 && r.body?.status === 'FILLED', `open ${r.status} ${JSON.stringify(r.body)}`);
    S.positionId = r.body.position.id;
    console.log(`     цена ${r.body.order?.price}, комиссия ${r.body.fee}`);
  });

  await step('CLOSE позиции', async () => {
    const r = await http('POST', '/api/orders', { cookie: S.trader, json: {
      accountId: S.accountId, action: 'CLOSE_POSITION', positionId: S.positionId, idempotencyKey: Keypair.generate().publicKey.toBase58() } });
    check(r.status === 200 && r.body?.status === 'FILLED', `close ${r.status} ${JSON.stringify(r.body)}`);
    const acc = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.accountId! } });
    console.log(`     баланс после сделки ${acc.currentBalance}`);
  });

  await step('[тестовый приём] PASSED проводкой ADJUST до цели', async () => {
    const acc = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.accountId! }, include: { challenge: true } });
    await adjustTo(S.accountId!, d(5000).times(d(100).plus(d(acc.challenge.profitTargetPct))).div(100), 'passed', 'PASSED');
  });

  await step('админ одобрил funded', async () => {
    const r = await http('POST', '/api/admin/funded/approve', { cookie: S.admin, json: { accountId: S.accountId } });
    check(r.status === 200, `approve ${r.status} ${JSON.stringify(r.body)}`);
    S.fundedId = r.body.fundedAccountId;
  });

  await step('[тестовый приём] прибыль на funded и запрос выплаты 1 USDC', async () => {
    await adjustTo(S.fundedId!, d(5002.5), 'funded-profit');
    const r = await http('POST', '/api/payouts/request', { cookie: S.trader, json: { accountId: S.fundedId, amount: PAYOUT_USDC.toFixed(2) } });
    check(r.status === 200 && r.body?.status === 'REQUESTED', `request ${r.status} ${JSON.stringify(r.body)}`);
    S.payoutId = r.body.id;
  });

  await step('админ выплатил 1 USDC настоящей транзакцией и отметил PAID', async () => {
    S.payoutSig = await payUsdc(admin, trader.publicKey, PAYOUT_USDC);
    console.log(`     tx https://explorer.solana.com/tx/${S.payoutSig}?cluster=devnet`);
    const r = await http('POST', '/api/admin/payouts/decide', { cookie: S.admin, json: { payoutId: S.payoutId, approve: true, txSignature: S.payoutSig } });
    check(r.status === 200 && r.body?.status === 'PAID', `decide ${r.status} ${JSON.stringify(r.body)}`);
  });

  await step('балансы USDC на devnet сошлись с операциями', async () => {
    const after = { trader: await usdc(trader.publicKey), admin: await usdc(admin.publicKey) };
    console.log(`     USDC после: трейдер ${after.trader}, казна ${after.admin}`);
    check(after.trader.equals(before.trader.minus(S.amount!).plus(PAYOUT_USDC)), 'баланс трейдера не сходится');
    check(after.admin.equals(before.admin.plus(S.amount!).minus(PAYOUT_USDC)), 'баланс казны не сходится');
  });
}

main()
  .then(() => console.log('DEVNET REAL RESULT: PASS'))
  .catch(() => { console.log(`DEVNET REAL RESULT: FAIL (${failures.join(', ')})`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
