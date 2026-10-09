import { db } from '@/lib/db';
import { notify } from '@/lib/notifications';

/**
 * Ручной KYC перед первой выплатой (Q2). Проверка без внешних сервисов:
 * админ решает сам; каждое решение — AuditLog + notify пользователю.
 * Выплата не может стать APPROVED/PAID, пока kycStatus != VERIFIED (см. service.ts).
 */

/** Ошибка домена: status — HTTP-код ответа API. */
export class KycError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'KycError';
  }
}

export const KYC_STATUSES = ['VERIFIED', 'REJECTED'] as const;
export type KycDecision = (typeof KYC_STATUSES)[number];

/** POST /api/admin/kyc: решение админа по идентификации пользователя. */
export async function setKycStatus(
  adminId: string,
  userId: string,
  status: KycDecision,
  note?: string,
): Promise<{ userId: string; kycStatus: string }> {
  if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0))
    throw new KycError(400, 'note must be a non-empty string');
  const noteText = typeof note === 'string' ? note.trim() : undefined;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new KycError(404, 'User not found');

  const approved = status === 'VERIFIED';
  const action = approved ? 'KYC_VERIFIED' : 'KYC_REJECTED';
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        kycStatus: status,
        // kycVerifiedAt/By фиксируют именно верификацию; при REJECTED сбрасываем.
        kycVerifiedAt: approved ? new Date() : null,
        kycVerifiedBy: approved ? adminId : null,
        kycNote: noteText ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action,
        targetId: userId,
        data: { status, ...(noteText ? { note: noteText } : {}) },
      },
    });
    await notify(tx, {
      userId,
      kind: approved ? 'KYC_VERIFIED' : 'KYC_REJECTED',
      title: approved ? 'Identity verified' : 'Identity verification rejected',
      body: approved
        ? 'Your identity has been verified. Your payout requests can now be approved and paid.'
        : noteText
          ? `Your identity verification was rejected: ${noteText}`
          : 'Your identity verification was rejected. Please contact support.',
    });
  });
  return { userId, kycStatus: status };
}

/** GET /api/admin/kyc?wallet=: kycStatus пользователя по адресу кошелька. */
export async function getKycByWallet(wallet: string): Promise<{ userId: string; walletAddress: string; kycStatus: string }> {
  const user = await db.user.findUnique({
    where: { walletAddress: wallet },
    select: { id: true, walletAddress: true, kycStatus: true },
  });
  if (!user) throw new KycError(404, 'User not found');
  return { userId: user.id, walletAddress: user.walletAddress, kycStatus: user.kycStatus };
}
