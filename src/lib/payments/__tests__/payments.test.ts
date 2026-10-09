import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import type { ParsedTransaction, SolanaRpc } from '../solanaPay';

// Оплата Solana Pay с подменённым RPC: верный перевод → счёт ровно один,
// недоплата/чужой адрес/упавшая транзакция → счёта нет, просрочка → EXPIRED.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

let db: typeof import('../../db').db;
let payments: typeof import('../../../worker/payments');
let purchase: typeof import('../purchase');
let solanaPay: typeof import('../solanaPay');
let userId: string;
let treasury: string;
let mint: string;

const fakeRpc = (signatures: string[], txs: Record<string, ParsedTransaction>): SolanaRpc => ({
  getSignaturesForAddress: async () => signatures.map((signature) => ({ signature })),
  getParsedTransaction: async (signature) => txs[signature] ?? null,
});

// Реалистичный фейк: reference присутствует среди account keys — именно поэтому
// getSignaturesForAddress(reference) и возвращает сигнатуру этой транзакции.
const transferTx = (amountMinor: string, destination: string, reference: string): ParsedTransaction => ({
  meta: { err: null, innerInstructions: [] },
  transaction: {
    message: {
      accountKeys: [reference, 'source', 'authority', destination],
      instructions: [
        {
          programId: TOKEN_PROGRAM_ID,
          parsed: { type: 'transfer', info: { source: 'source', authority: 'authority', destination, amount: amountMinor } },
        },
      ],
    },
  },
});

before(async () => {
  treasury = Keypair.generate().publicKey.toBase58();
  process.env.TREASURY_WALLET = treasury;
  mint = process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  payments = await import('../../../worker/payments');
  purchase = await import('../purchase');
  solanaPay = await import('../solanaPay');

  const user = await db.user.create({ data: { walletAddress: 'pay-test' } });
  userId = user.id;
  await db.challenge.create({
    data: {
      accountSize: new Decimal(10000), planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: new Decimal(89), minTradingDays: 3,
    },
  });
});

after(async () => { await db?.$disconnect(); });

test('correct transfer confirms purchase exactly once, even on repeated and concurrent cycles', async () => {
  const ata = solanaPay.associatedTokenAddress(treasury, mint);
  const created = await purchase.createPendingPurchase(userId, 10000, 'CORE');
  assert.equal(created.amount.toFixed(0), '89');
  assert.ok(created.payUrl.startsWith(`solana:${treasury}?`));
  assert.ok(created.payUrl.includes(`reference=${created.reference}`));

  const rpc = fakeRpc(['sig-ok'], { 'sig-ok': transferTx('89000000', ata, created.reference) });
  assert.deepEqual(await payments.checkPendingPayments({ rpc }), { paid: 1, expired: 0 });
  // Повторный цикл ничего не создаёт и не меняет.
  assert.deepEqual(await payments.checkPendingPayments({ rpc }), { paid: 0, expired: 0 });

  const p = await db.purchase.findUniqueOrThrow({ where: { id: created.purchaseId } });
  assert.equal(p.status, 'PAID');
  assert.equal(p.txSignature, 'sig-ok');
  assert.ok(p.accountId);

  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: p.accountId! } });
  assert.equal(account.mode, 'CHALLENGE');
  assert.equal(account.phase, 'CHALLENGE');
  assert.equal(account.status, 'ACTIVE');
  assert.match(account.rulesHash!, /^[0-9a-f]{64}$/);
  assert.equal(account.currentBalance.toFixed(2), '10000.00');
  assert.equal(account.staticMaxDdFloor.toFixed(2), '9400.00');
  assert.equal(account.dailyDdFloor.toFixed(2), '9700.00');
  // Инвариант §5: баланс равен сумме проводок.
  const entries = await db.ledgerEntry.findMany({ where: { accountId: account.id } });
  const ledgerSum = entries.reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
  assert.equal(ledgerSum.toFixed(2), account.currentBalance.toFixed(2));
  assert.equal(entries[0].type, 'DEPOSIT');

  // Гонка: два одновременных цикла по одной PENDING-покупке дают ровно один счёт.
  // Своя on-chain транзакция (H1: одна сигнатура не может подтвердить две покупки).
  const second = await purchase.createPendingPurchase(userId, 10000, 'CORE');
  const rpc2 = fakeRpc(['sig-ok-2'], { 'sig-ok-2': transferTx('89000000', ata, second.reference) });
  const [a, b] = await Promise.all([
    payments.checkPendingPayments({ rpc: rpc2 }),
    payments.checkPendingPayments({ rpc: rpc2 }),
  ]);
  assert.equal(a.paid + b.paid, 1);
  const secondAccounts = await db.tradingAccount.count({
    where: { purchases: { some: { id: second.purchaseId } } },
  });
  assert.equal(secondAccounts, 1);
  assert.equal((await db.tradingAccount.count()), 2);
});

test('underpaid, wrong-destination and failed transfers never create an account', async () => {
  const ata = solanaPay.associatedTokenAddress(treasury, mint);
  const otherAta = solanaPay.associatedTokenAddress(Keypair.generate().publicKey.toBase58(), mint);
  const created = await purchase.createPendingPurchase(userId, 10000, 'CORE');

  const failed = transferTx('89000000', ata, created.reference);
  failed.meta = { err: 'InstructionError', innerInstructions: [] };

  const rpc = fakeRpc(
    ['sig-low', 'sig-wrong-dest', 'sig-failed'],
    {
      'sig-low': transferTx('88000000', ata, created.reference), // 88 < 89 — недоплата
      'sig-wrong-dest': transferTx('89000000', otherAta, created.reference), // перевод не на ATA казны
      'sig-failed': failed, // упавшая транзакция
    },
  );
  assert.deepEqual(await payments.checkPendingPayments({ rpc }), { paid: 0, expired: 0 });

  const p = await db.purchase.findUniqueOrThrow({ where: { id: created.purchaseId } });
  assert.equal(p.status, 'PENDING');
  assert.equal(p.accountId, null);
  assert.equal(await db.tradingAccount.count({ where: { purchases: { some: { id: created.purchaseId } } } }), 0);
});

test('purchase without payment expires after 30 minutes; fresh purchase does not', async () => {
  const expired = await purchase.createPendingPurchase(userId, 10000, 'CORE');
  await db.purchase.update({
    where: { id: expired.purchaseId },
    data: { createdAt: new Date(Date.now() - 31 * 60_000) },
  });
  const fresh = await purchase.createPendingPurchase(userId, 10000, 'CORE');

  const rpc = fakeRpc([], {});
  assert.deepEqual(await payments.checkPendingPayments({ rpc }), { paid: 0, expired: 1 });

  const expiredRow = await db.purchase.findUniqueOrThrow({ where: { id: expired.purchaseId } });
  assert.equal(expiredRow.status, 'EXPIRED');
  assert.equal(expiredRow.accountId, null);
  const freshRow = await db.purchase.findUniqueOrThrow({ where: { id: fresh.purchaseId } });
  assert.equal(freshRow.status, 'PENDING');
});

test('transfer request url matches Solana Pay spec; transferChecked with wrong amount rejected', async () => {
  const recipient = Keypair.generate().publicKey.toBase58();
  const splToken = Keypair.generate().publicKey.toBase58();
  const reference = Keypair.generate().publicKey.toBase58();
  const url = solanaPay.buildTransferRequestUrl({
    recipient, amount: new Decimal(89), splToken, reference,
    label: 'TYNTRO', message: 'TYNTRO CORE challenge 10000',
  });
  assert.equal(
    url,
    `solana:${recipient}?amount=89&spl-token=${splToken}&reference=${reference}` +
      `&label=TYNTRO&message=${encodeURIComponent('TYNTRO CORE challenge 10000')}`,
  );

  const ata = solanaPay.associatedTokenAddress(recipient, splToken);
  const txChecked: ParsedTransaction = {
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [reference, ata],
        instructions: [
          {
            programId: TOKEN_PROGRAM_ID,
            parsed: { type: 'transferChecked', info: { destination: ata, tokenAmount: { amount: '89000000', decimals: 6 } } },
          },
        ],
      },
    },
  };
  assert.ok(solanaPay.verifyUsdcTransfer(txChecked, { treasury: recipient, splToken, expectedAmount: new Decimal(89), reference }));
  assert.ok(!solanaPay.verifyUsdcTransfer(txChecked, { treasury: recipient, splToken, expectedAmount: new Decimal(90), reference }));
  // Чужой reference отсутствует в accountKeys → перевод не подтверждает покупку (H1).
  const foreign = Keypair.generate().publicKey.toBase58();
  assert.ok(!solanaPay.verifyUsdcTransfer(txChecked, { treasury: recipient, splToken, expectedAmount: new Decimal(89), reference: foreign }));
  assert.ok(!solanaPay.verifyUsdcTransfer(txChecked, { treasury: recipient, splToken: reference, expectedAmount: new Decimal(89), reference }));
});

test('at most 3 pending purchases per user; expiry frees the slots (L3)', async () => {
  const flood = await db.user.create({ data: { walletAddress: 'pay-flood' } });
  for (let i = 0; i < purchase.MAX_PENDING_PURCHASES; i++) {
    await purchase.createPendingPurchase(flood.id, 10000, 'CORE');
    // Старше окна повторной выдачи (15 мин), но не просрочены — следующий вызов создаёт новую.
    await db.purchase.updateMany({ where: { userId: flood.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
  }

  await assert.rejects(
    () => purchase.createPendingPurchase(flood.id, 10000, 'CORE'),
    (e: unknown) => e instanceof purchase.CheckoutError && e.status === 409,
  );

  // Старые PENDING истекают как раньше — слоты освобождаются.
  await db.purchase.updateMany({
    where: { userId: flood.id, status: 'PENDING' },
    data: { createdAt: new Date(Date.now() - 31 * 60_000) },
  });
  const res = await payments.checkPendingPayments({ rpc: fakeRpc([], {}) });
  assert.equal(res.expired, purchase.MAX_PENDING_PURCHASES);
  const again = await purchase.createPendingPurchase(flood.id, 10000, 'CORE');
  assert.ok(again.purchaseId);
});

test('повторный checkout того же плана отдаёт ту же свежую PENDING, а не упирается в лимит', async () => {
  const u = await db.user.create({ data: { walletAddress: 'pay-reload' } });
  const first = await purchase.createPendingPurchase(u.id, 10000, 'CORE');
  for (let i = 0; i < purchase.MAX_PENDING_PURCHASES + 1; i++)
    assert.equal((await purchase.createPendingPurchase(u.id, 10000, 'CORE')).purchaseId, first.purchaseId);
  assert.equal(await db.purchase.count({ where: { userId: u.id } }), 1);

  // Старше 15 минут — уже не отдаём: создаётся новая со своим reference.
  await db.purchase.update({ where: { id: first.purchaseId }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
  const next = await purchase.createPendingPurchase(u.id, 10000, 'CORE');
  assert.notEqual(next.purchaseId, first.purchaseId);
  assert.notEqual(next.reference, first.reference);
});
