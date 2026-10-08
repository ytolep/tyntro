import type { PrismaClient } from '@prisma/client';

/**
 * Чистка просроченных строк авторизации (docs/REVIEW.md L6): Session и
 * AuthNonce с expiresAt в прошлом. Вызывается раз в сутки из dayRoll воркера.
 *
 * Минимальная реализация агента X3; каноническая живёт у агента X2 —
 * при слиянии волн выбирается его версия (сигнатура совпадает).
 */
export async function deleteExpiredAuthRows(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: now } } });
}
