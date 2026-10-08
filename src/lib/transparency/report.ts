import { Connection, PublicKey } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { getPaymentsConfig } from '@/lib/payments/config';
import { associatedTokenAddress, USDC_DECIMALS } from '@/lib/payments/transferTx';

/**
 * Публичный отчёт прозрачности (пункт T4 аудита). Только агрегаты, без персональных данных.
 * Деньги — Decimal и уходят в JSON строками; number — только счётчики и доля (безразмерная).
 */

/** Порог показа passRate: пока решённых челленджей меньше, доля — шум (audit T4). */
export const PASS_RATE_MIN_DECIDED = 20;

export interface TransparencyReport {
  /** env TREASURY_WALLET; null, если не задан. */
  treasuryWallet: string | null;
  /** Баланс ATA казны в USDC, строка с 2 знаками; null — RPC упал или ATA нет (не 0). */
  treasuryUsdc: string | null;
  /** Число оплаченных покупок челленджа (Purchase PAID). */
  challengesSold: number;
  /** PASSED / (PASSED + FAILED); null при знаменателе < PASS_RATE_MIN_DECIDED. */
  passRate: number | null;
  /** Сумма выполненных выплат (Payout PAID), USDC строкой. */
  payoutsPaidUsd: string;
  payoutsCount: number;
  /** Счета в funded-стадии (phase FUNDED_SIM или mode FUNDED — как в метриках админки). */
  fundedAccounts: number;
  updatedAt: string;
}

/** Порт источника баланса казны: минорные единицы USDC на ATA; тесты подменяют фейком. */
export interface TreasuryBalanceSource {
  tokenBalanceMinor(ata: string): Promise<string | null>;
}

export function createTreasuryBalanceSource(rpcUrl: string): TreasuryBalanceSource {
  const connection = new Connection(rpcUrl, 'confirmed');
  return {
    async tokenBalanceMinor(ata) {
      const res = await connection.getTokenAccountBalance(new PublicKey(ata), 'confirmed');
      return res.value ? res.value.amount : null;
    },
  };
}

/** RPC для баланса казны: PAYMENTS_RPC_URL || SOLANA_RPC_URL (конфиг платежей); null — без env. */
export function treasuryRpcUrl(): string | null {
  try {
    return getPaymentsConfig().rpcUrl;
  } catch {
    return null;
  }
}

export async function buildTransparencyReport(deps?: {
  db?: typeof db;
  balance?: TreasuryBalanceSource;
}): Promise<TransparencyReport> {
  const database = deps?.db ?? db;

  let treasuryWallet: string | null = null;
  let treasuryUsdc: string | null = null;
  try {
    const config = getPaymentsConfig();
    treasuryWallet = config.treasuryWallet;
    if (deps?.balance) {
      const ata = associatedTokenAddress(config.treasuryWallet, config.usdcMint);
      // Любая ошибка RPC или отсутствие ATA → null: неизвестное не выдаём за ноль.
      const minor = await deps.balance.tokenBalanceMinor(ata);
      if (minor !== null) treasuryUsdc = new Decimal(minor).div(10 ** USDC_DECIMALS).toFixed(2);
    }
  } catch {
    treasuryUsdc = null; // нет TREASURY_WALLET или RPC недоступен
  }

  const [challengesSold, passed, failed, fundedAccounts, payoutsAgg] = await Promise.all([
    database.purchase.count({ where: { status: 'PAID' } }),
    database.tradingAccount.count({ where: { status: 'PASSED' } }),
    database.tradingAccount.count({ where: { status: 'FAILED' } }),
    database.tradingAccount.count({ where: { OR: [{ phase: 'FUNDED_SIM' }, { mode: 'FUNDED' }] } }),
    database.payout.aggregate({ _sum: { amountUsd: true }, _count: true, where: { status: 'PAID' } }),
  ]);

  const decided = passed + failed;
  return {
    treasuryWallet,
    treasuryUsdc,
    challengesSold,
    passRate: decided >= PASS_RATE_MIN_DECIDED ? passed / decided : null,
    payoutsPaidUsd: (payoutsAgg._sum.amountUsd ?? new Decimal(0)).toFixed(2),
    payoutsCount: payoutsAgg._count,
    fundedAccounts,
    updatedAt: new Date().toISOString(),
  };
}
