import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import type { ParsedTransaction, SolanaRpc } from '../solanaPay';

// Ревью (агент L), H1: одна транзакция Solana Pay может подтвердить N покупок.
// getSignaturesForAddress(reference) возвращает все транзакции, где pubkey
// reference встречается среди account keys — в том числе read-only без подписи.
// Атакующий создаёт покупки P1..PN и собирает ОДИН перевод 89 USDC на ATA казны,
// включив все N reference-ключей в account keys.
//
// Исправление (волна 4, агент X1): Purchase.txSignature @unique + в
// confirmPurchase отвергается подпись, уже использованная другой покупкой
// (уникальный конфликт → покупка остаётся PENDING). Первой подтверждается
// ровно одна покупка транзакции.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

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

before(async () => {
  treasury = Keypair.generate().publicKey.toBase58();
  process.env.TREASURY_WALLET = treasury;
  mint = process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  payments = await import('../../../worker/payments');
  purchase = await import('../purchase');
  solanaPay = await import('../solanaPay');

  const user = await db.user.create({ data: { walletAddress: 'review-pay-test' } });
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

test('one on-chain transfer must confirm at most one purchase (multi-reference transaction)', async () => {
  const ata = solanaPay.associatedTokenAddress(treasury, mint);
  const p1 = await purchase.createPendingPurchase(userId, 10000, 'CORE');
  const p2 = await purchase.createPendingPurchase(userId, 10000, 'CORE');

  // Один перевод 89 USDC; RPC для ОБЕИХ reference возвращает одну и ту же
  // сигнатуру — ровно так отвечает getSignaturesForAddress, когда одна
  // транзакция содержит несколько reference-ключей в account keys.
  const tx: ParsedTransaction = {
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [p1.reference, p2.reference, 'source', 'authority', ata],
        instructions: [
          {
            programId: TOKEN_PROGRAM_ID,
            parsed: { type: 'transfer', info: { source: 'source', authority: 'authority', destination: ata, amount: '89000000' } },
          },
        ],
      },
    },
  };
  const rpc: SolanaRpc = {
    getSignaturesForAddress: async () => [{ signature: 'sig-shared' }],
    getParsedTransaction: async () => tx,
  };

  const { paid } = await payments.checkPendingPayments({ rpc });

  // Желаемое поведение: одна транзакция = одна подтверждённая покупка.
  assert.equal(paid, 1, 'повторное использование txSignature не должно подтверждать вторую покупку');
  assert.equal(await db.purchase.count({ where: { status: 'PAID', txSignature: 'sig-shared' } }), 1);
  assert.equal(await db.tradingAccount.count(), 1, 'один платёж — один счёт');
  // Подтверждена ровно одна из двух — вторая остаётся не-PAID (PENDING):
  // порядок обработки findMany не гарантирован, поэтому не привязываемся к P2.
  const rows = await db.purchase.findMany({ where: { id: { in: [p1.purchaseId, p2.purchaseId] } } });
  assert.equal(rows.filter((r) => r.status === 'PAID').length, 1);
  assert.equal(rows.filter((r) => r.status !== 'PAID').length, 1);
});
