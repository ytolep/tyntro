import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { withAccountLock } from '@/lib/db/lock';
import { notify } from '@/lib/notifications';

/**
 * Возвраты (Q3). По /refunds возврат делает админ вручную: переводит USDC
 * и вводит подпись транзакции; код только фиксирует результат. Все суммы —
 * Prisma.Decimal, изменение счёта — под withAccountLock, действие — в AuditLog.
 */

/** Ошибка домена: status — HTTP-код ответа API. */
export class RefundError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RefundError';
  }
}

/** Подпись транзакции Solana: base58 (без 0, O, I, l), 64–88 символов. */
export const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

type Tx = Prisma.TransactionClient;

const MAX_REASON_LENGTH = 500;

export interface RefundResult {
  id: string;
  status: 'REFUNDED';
  accountId: string | null;
  cancelledOrders: number;
}

/** Фиксирует возврат: Purchase → REFUNDED, счёт → FAILED, ордера OPEN → CANCELLED. */
export async function refundPurchase(
  adminId: string,
  purchaseId: string,
  txSignature: unknown,
  reason?: unknown,
): Promise<RefundResult> {
  if (typeof txSignature !== 'string' || !BASE58_SIG.test(txSignature.trim()))
    throw new RefundError(400, 'txSignature must be a base58 string of 64–88 characters');
  const signature = txSignature.trim();
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH))
    throw new RefundError(400, `reason must be a string of at most ${MAX_REASON_LENGTH} characters`);
  const refundReason = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null;

  const existing = await db.purchase.findUnique({
    where: { id: purchaseId },
    select: { accountId: true },
  });
  if (!existing) throw new RefundError(404, 'Purchase not found');

  // Нет счёта — локируем по ключу покупки (как воркер при подтверждении оплаты).
  const lockKey = existing.accountId ?? `purchase:${purchaseId}`;
  return withAccountLock(lockKey, async (tx) => {
    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { challenge: true },
    });
    if (purchase.status === 'REFUNDED') throw new RefundError(409, 'Purchase is already refunded');
    if (purchase.status !== 'PAID')
      throw new RefundError(409, `Only PAID purchases can be refunded (status: ${purchase.status})`);

    let cancelledOrders = 0;
    if (purchase.accountId) cancelledOrders = await failAccountForRefund(tx, purchase.accountId, purchaseId);

    await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundTxSignature: signature, refundReason },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'PURCHASE_REFUNDED',
        targetId: purchaseId,
        data: {
          accountId: purchase.accountId,
          amountUsdc: (purchase.amountUsdc as Decimal).toFixed(2),
          txSignature: signature,
          ...(refundReason ? { reason: refundReason } : {}),
        },
      },
    });
    await notify(tx, {
      userId: purchase.userId,
      kind: 'PURCHASE_REFUNDED',
      title: 'Refund issued',
      body: `Your ${purchase.challenge.planType} challenge fee of ${(purchase.amountUsdc as Decimal).toFixed(
        2,
      )} USDC has been refunded. Transaction: ${signature}`,
      accountId: purchase.accountId,
    });
    return { id: purchaseId, status: 'REFUNDED' as const, accountId: purchase.accountId, cancelledOrders };
  });
}

/**
 * Судьба связанного счёта при возврате: возврат невозможен, если счёт уже
 * решён (PASSED/FAILED/…), имеет funded-наследника или открытые позиции
 * (закрыть их без цены нельзя). Иначе: OPEN-ордера → CANCELLED, счёт → FAILED,
 * RiskEvent ruleName REFUND. Счёт без позиций ничего не должен рынку, поэтому
 * ledger-проводок нет.
 */
async function failAccountForRefund(tx: Tx, accountId: string, purchaseId: string): Promise<number> {
  const account = await tx.tradingAccount.findUnique({
    where: { id: accountId },
    include: { positions: { where: { status: 'OPEN' }, select: { id: true } } },
  });
  if (!account) return 0;

  // Funded-наследник: approve уже создал новый счёт — возврат по политике невозможен.
  const funded = await tx.auditLog.findFirst({
    where: { action: 'FUNDED_APPROVED', targetId: accountId },
    select: { id: true },
  });
  if (funded) throw new RefundError(409, 'Account is already approved for a funded stage; refund is not possible');
  if (account.status !== 'ACTIVE')
    throw new RefundError(409, `Account is ${account.status}; refund is not possible by policy`);
  if (account.positions.length > 0)
    throw new RefundError(409, 'Account has open positions; close them before refund (OPEN_POSITIONS)');

  const cancelled = await tx.order.updateMany({
    where: { accountId, status: 'OPEN' },
    data: { status: 'CANCELLED' },
  });
  await tx.tradingAccount.update({ where: { id: accountId }, data: { status: 'FAILED' } });
  await tx.riskEvent.create({
    data: {
      accountId,
      level: 'FAILED',
      ruleName: 'REFUND',
      description: `Challenge fee refunded by admin (purchase ${purchaseId}); evaluation closed`,
    },
  });
  return cancelled.count;
}

/** Последние PAID-покупки для раздела «Recent purchases» админки. */
export async function recentPaidPurchases(limit = 20): Promise<Prisma.JsonValue> {
  const rows = await db.purchase.findMany({
    where: { status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      amountUsdc: true,
      createdAt: true,
      user: { select: { walletAddress: true } },
      challenge: { select: { planType: true, accountSize: true } },
      account: {
        select: {
          id: true,
          status: true,
          phase: true,
          _count: { select: { positions: { where: { status: 'OPEN' } } } },
        },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    amountUsdc: (p.amountUsdc as Decimal).toFixed(2),
    createdAt: p.createdAt.toISOString(),
    walletAddress: p.user.walletAddress,
    planType: p.challenge.planType,
    accountSize: (p.challenge.accountSize as Decimal).toFixed(0),
    account: p.account
      ? { id: p.account.id, status: p.account.status, phase: p.account.phase, openPositions: p.account._count.positions }
      : null,
  }));
}
