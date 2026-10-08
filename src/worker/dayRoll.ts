import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { withAccountLock } from '../lib/db/lock';
import { db } from '../lib/db';
import { jsonLog } from './log';
import type { LogFn } from './log';

/** Действие AuditLog — маркер «день уже прокатан» (идемпотентность между запусками). */
export const DAY_ROLL_ACTION = 'day_roll';
/** Как часто воркер проверяет, не наступила ли полночь UTC. */
export const DAY_ROLL_CHECK_MS = 30_000;

export interface DayRollDeps {
  db: PrismaClient;
  withAccountLock: typeof withAccountLock;
  now: () => Date;
  log: LogFn;
}

export function defaultDayRollDeps(): DayRollDeps {
  return { db, withAccountLock, now: () => new Date(), log: jsonLog };
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Смена торгового дня в 00:00 UTC (и догоняющим запуском после простоя).
 * Для ACTIVE-счетов: dayStartEquity = equity, dailyDdFloor пересчитан,
 * tradingDaysCount++ только если последняя сделка была в завершившийся день.
 *
 * Идемпотентность: маркер day_roll за сегодняшнюю UTC-дату в AuditLog —
 * повторный запуск в тот же день (в том числе после рестарта) ничего не меняет.
 * ponytail: маркер пишется после ролла; два одновременно запущенных воркера
 * могли бы прокатать день дважды — по compose запускается ровно один воркер.
 */
export async function runDayRoll(deps: DayRollDeps = defaultDayRollDeps()): Promise<number> {
  const today = utcDay(deps.now());
  const startOfToday = new Date(`${today}T00:00:00.000Z`);

  const rolled = await deps.db.auditLog.findFirst({
    where: { action: DAY_ROLL_ACTION, createdAt: { gte: startOfToday } },
    select: { id: true },
  });
  if (rolled) return 0;

  const completedDay = utcDay(new Date(startOfToday.getTime() - 1));
  const accounts = await deps.db.tradingAccount.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  for (const { id } of accounts) {
    await deps.withAccountLock(id, async (tx: Prisma.TransactionClient) => {
      // Свежее состояние под блокировкой: статус мог измениться после выборки.
      const acc = await tx.tradingAccount.findUnique({
        where: { id },
        include: { challenge: true },
      });
      if (!acc || acc.status !== 'ACTIVE') return;

      const equity = acc.currentEquity as Decimal;
      const floor = equity.mul(new Decimal(1).minus(new Decimal(acc.challenge.dailyDdPct).div(100)));
      await tx.tradingAccount.update({
        where: { id },
        data: {
          dayStartEquity: equity,
          dailyDdFloor: floor,
          // Торговый день засчитан, только если последняя сделка была в завершившийся день.
          ...(acc.lastTradeDay === completedDay ? { tradingDaysCount: { increment: 1 } } : {}),
        },
      });
    });
  }

  await deps.db.auditLog.create({
    data: { action: DAY_ROLL_ACTION, data: { date: today, completedDay, accounts: accounts.length } },
  });
  deps.log('info', 'торговый день сменился', { date: today, completedDay, accounts: accounts.length });
  return accounts.length;
}
