import type { PrismaClient } from '@prisma/client';

/**
 * Чистка авторизационных строк (docs/REVIEW.md L6): просроченные Session и
 * AuthNonce никогда не удалялись — таблицы росли монотонно. Вызывается воркером
 * в цикле dayRoll (подключит X3). Свежие строки не трогает.
 */
export async function deleteExpiredAuthRows(
  db: PrismaClient,
): Promise<{ sessions: number; nonces: number }> {
  const now = new Date();
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const nonces = await db.authNonce.deleteMany({ where: { expiresAt: { lt: now } } });
  return { sessions: sessions.count, nonces: nonces.count };
}
