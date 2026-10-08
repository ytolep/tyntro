import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { ACCOUNT_SIZES, PLAN_CONFIGS } from '@/lib/pricingConfig';
import { buildTransferRequestUrl } from './solanaPay';
import { getPaymentsConfig } from './config';

/** Ошибка чекаута: status — HTTP-код ответа. */
export class CheckoutError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface PlanRules {
  accountSize: Decimal;
  planType: string;
  profitTargetPct: number;
  dailyDdPct: number;
  maxDdPct: number;
  profitSplitPct: number;
  minTradingDays: number;
}

/** sha256 канонического JSON правил плана: ключи по алфавиту, деньги — строками. */
export function computeRulesHash(rules: PlanRules): string {
  const canonical = JSON.stringify({
    accountSize: rules.accountSize.toFixed(),
    dailyDdPct: rules.dailyDdPct,
    maxDdPct: rules.maxDdPct,
    minTradingDays: rules.minTradingDays,
    planType: rules.planType,
    profitSplitPct: rules.profitSplitPct,
    profitTargetPct: rules.profitTargetPct,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface CreatedPurchase {
  purchaseId: string;
  reference: string;
  amount: Decimal;
  payUrl: string;
}

/**
 * Purchase PENDING с новым reference-ключом и ссылкой Solana Pay.
 * Цена — из строки Challenge (сидится из pricingConfig), не из запроса клиента.
 */
export async function createPendingPurchase(
  userId: string,
  accountSize: number,
  planType: string,
): Promise<CreatedPurchase> {
  const plan = planType as keyof typeof PLAN_CONFIGS;
  if (!PLAN_CONFIGS[plan] || !(ACCOUNT_SIZES as readonly number[]).includes(accountSize))
    throw new CheckoutError(400, 'Invalid challenge plan or size');

  const challenge = await db.challenge.findUnique({
    where: { accountSize_planType: { accountSize: new Decimal(accountSize), planType: plan } },
  });
  if (!challenge) throw new CheckoutError(409, 'Challenge is not configured');

  const reference = Keypair.generate().publicKey.toBase58();
  const amount = challenge.priceUsd;
  const purchase = await db.purchase.create({
    data: { userId, challengeId: challenge.id, reference, amountUsdc: amount, status: 'PENDING' },
  });

  const cfg = getPaymentsConfig();
  const payUrl = buildTransferRequestUrl({
    recipient: cfg.treasuryWallet,
    amount,
    splToken: cfg.usdcMint,
    reference,
    label: 'PROPS',
    message: `PROPS ${plan} challenge ${accountSize}`,
  });
  return { purchaseId: purchase.id, reference, amount, payUrl };
}
