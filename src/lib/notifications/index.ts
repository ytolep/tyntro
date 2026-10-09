import type { Notification, Prisma } from '@prisma/client';
import { db } from '../db';

/**
 * Уведомления в приложении (K3). notify() всегда получает tx события — запись
 * живёт в той же транзакции и откатывается вместе с ней. Суммы в текстах —
 * только через Decimal.toFixed, без number.
 */

export type NotificationKind =
  | 'PURCHASE_PAID'
  | 'ACCOUNT_FAILED'
  | 'ACCOUNT_PASSED'
  | 'FUNDED_APPROVED'
  | 'FUNDED_REJECTED'
  | 'PAYOUT_APPROVED'
  | 'PAYOUT_REJECTED'
  | 'PAYOUT_PAID'
  | 'KYC_VERIFIED'
  | 'KYC_REJECTED';

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  accountId?: string | null;
}

/** Пишет уведомление в переданной транзакции события. */
export async function notify(tx: Prisma.TransactionClient, input: NotifyInput): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 120),
      body: input.body.slice(0, 500),
      accountId: input.accountId ?? null,
    },
  });
}

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  accountId: string | null;
  readAt: string | null;
  createdAt: string;
}

function toDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    accountId: n.accountId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Свои последние уведомления + счётчик непрочитанных. */
export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<{ notifications: NotificationDto[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: rows.map(toDto), unreadCount };
}

/** Отметить прочитанными: свои по ids либо все свои разом. Возвращает число отмеченных. */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const where: Prisma.NotificationWhereInput = { userId, readAt: null };
  if (ids) {
    if (ids.length === 0) return 0;
    where.id = { in: ids };
  }
  const res = await db.notification.updateMany({ where, data: { readAt: new Date() } });
  return res.count;
}
