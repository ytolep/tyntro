import { PrismaClient } from '@prisma/client';

// SAFETY: известный паттерн Prisma-синглтона — расширяем globalThis типом с кэшем клиента,
// чтобы горячая перезагрузка Next не плодила соединения.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
