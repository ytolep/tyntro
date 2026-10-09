import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import type { Challenge } from '@prisma/client';
import { db } from '@/lib/db';
import { REFUNDS_VERSION, RULES_VERSION, TERMS_VERSION } from '@/lib/legal/versions';
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

/** L3: максимум одновременно PENDING-покупок на пользователя (анти-флуд). */
export const MAX_PENDING_PURCHASES = 3;

/** K2: метаданные согласия, сохраняемые вместе с покупкой (ip/userAgent). */
export interface ConsentMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Purchase PENDING с новым reference-ключом (или свежая PENDING того же плана) и ссылкой Solana Pay.
 * Цена — из строки Challenge (сидится из pricingConfig), не из запроса клиента.
 * При consent — в той же транзакции создаётся TermsAcceptance с текущими
 * версиями документов (маршрут уже проверил совпадение) и rulesHash плана.
 */
export async function createPendingPurchase(
  userId: string,
  accountSize: number,
  planType: string,
  consent?: ConsentMeta,
): Promise<CreatedPurchase> {
  const plan = planType as keyof typeof PLAN_CONFIGS;
  if (!PLAN_CONFIGS[plan] || !(ACCOUNT_SIZES as readonly number[]).includes(accountSize))
    throw new CheckoutError(400, 'Invalid challenge plan or size');

  const challenge = await db.challenge.findUnique({
    where: { accountSize_planType: { accountSize: new Decimal(accountSize), planType: plan } },
  });
  if (!challenge) throw new CheckoutError(409, 'Challenge is not configured');

  // Checkout создаёт покупку при каждом открытии страницы: свежая PENDING того же плана
  // по той же цене отдаётся повторно, иначе три перезагрузки упираются в лимит L3.
  const reusable = await db.purchase.findFirst({
    where: {
      userId,
      challengeId: challenge.id,
      status: 'PENDING',
      amountUsdc: challenge.priceUsd,
      createdAt: { gt: new Date(Date.now() - REUSE_PENDING_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  const purchase = reusable ?? (await createPurchaseRow(userId, challenge, consent));

  const cfg = getPaymentsConfig();
  const payUrl = buildTransferRequestUrl({
    recipient: cfg.treasuryWallet,
    amount: purchase.amountUsdc,
    splToken: cfg.usdcMint,
    reference: purchase.reference,
    label: 'PROPS',
    message: `PROPS ${plan} challenge ${accountSize}`,
  });
  return { purchaseId: purchase.id, reference: purchase.reference, amount: purchase.amountUsdc, payUrl };
}

/** Повторно отдаём только покупку моложе 15 мин: воркер просрочивает через 30 (PURCHASE_EXPIRE_MS), остаток — на оплату. */
const REUSE_PENDING_MS = 15 * 60 * 1000;

async function createPurchaseRow(
  userId: string,
  challenge: Challenge,
  consent: ConsentMeta | undefined,
) {
  // L3: каждая PENDING-покупка — цикл RPC-вызовов в воркере каждые 15 с;
  // просроченные уходят в EXPIRED и освобождают слоты.
  // ponytail: check-then-insert, гонка может выпустить лишнюю PENDING — потолок
  // не денежный; транзакционный гард, если понадобится строгий лимит.
  const pendingCount = await db.purchase.count({ where: { userId, status: 'PENDING' } });
  if (pendingCount >= MAX_PENDING_PURCHASES)
    throw new CheckoutError(409, 'Too many pending purchases: pay or wait for expiry');

  return db.purchase.create({
    data: {
      userId,
      challengeId: challenge.id,
      reference: Keypair.generate().publicKey.toBase58(),
      amountUsdc: challenge.priceUsd,
      status: 'PENDING',
      // K2: согласие фиксируется атомарно с покупкой — одного без другого не бывает.
      ...(consent && {
        termsAcceptance: {
          create: {
            userId,
            termsVersion: TERMS_VERSION,
            refundsVersion: REFUNDS_VERSION,
            rulesVersion: RULES_VERSION,
            rulesHash: computeRulesHash(challenge),
            ip: consent.ip,
            userAgent: consent.userAgent,
          },
        },
      }),
    },
  });
}
