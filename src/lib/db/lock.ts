import { Prisma } from '@prisma/client';
import { db } from '../db';

/**
 * Единственная точка изменения счёта: любое изменение баланса, позиций и ордеров
 * идёт внутри prisma.$transaction под pg_advisory_xact_lock по идентификатору счёта.
 * API и воркер, выполняющие withAccountLock по одному accountId, сериализуются
 * в Postgres и не могут затереть обновления друг друга.
 */
export async function withAccountLock<T>(
  accountId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    // SAFETY: $executeRaw с tagged-template — параметризованный запрос Prisma, ${accountId}
    // уходит как bind-параметр $1, не как текст SQL; идентификаторов в запросе нет.
    // hashtext даёт стабильный bigint-ключ из строки; xact-вариант снимает блокировку
    // автоматически при коммите или откате транзакции.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;
    return fn(tx);
  });
}
