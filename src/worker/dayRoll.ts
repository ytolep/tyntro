import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '../lib/db';
import { deleteExpiredAuthRows } from '../lib/auth/cleanup';
import { jsonLog } from './log';
import type { LogFn } from './log';

/** Действие AuditLog — маркер «день уже прокатан» (идемпотентность между запусками). */
export const DAY_ROLL_ACTION = 'day_roll';
/** Как часто воркер проверяет, не наступила ли полночь UTC. */
export const DAY_ROLL_CHECK_MS = 30_000;

export interface DayRollDeps {
  db: PrismaClient;
  now: () => Date;
  log: LogFn;
}

export function defaultDayRollDeps(): DayRollDeps {
  return { db, now: () => new Date(), log: jsonLog };
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Смена торгового дня в 00:00 UTC (и догоняющим запуском после простоя).
 * Для ACTIVE-счетов: dayStartEquity = equity, dailyDdFloor пересчитан,
 * tradingDaysCount++ только если последняя сделка была в завершившийся день.
 *
 * L5 (docs/REVIEW.md): проверка маркера, сам ролл и запись маркера — в одной
 * транзакции под pg_advisory_xact_lock с константой. Два параллельных воркера
 * сериализуются на локе: второй видит маркер и не прокатывает день дважды.
 * Локи счетов берутся той же формулой, что withAccountLock (hashtext(id)) —
 * сериализация с API и riskTick; порядок «лок дня → локи счетов» исключает
 * дедлок (другие пути лок дня не берут).
 * L6: раз в сутки после успешного ролла удаляются просроченные Session/AuthNonce.
 */
export async function runDayRoll(deps: DayRollDeps = defaultDayRollDeps()): Promise<number> {
  const today = utcDay(deps.now());
  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  const completedDay = utcDay(new Date(startOfToday.getTime() - 1));

  const accountIds = await deps.db.tradingAccount.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const rolled = await deps.db.$transaction(async (tx: Prisma.TransactionClient) => {
    // SAFETY: константа в тексте запроса — не пользовательский ввод, параметров нет.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(420317)`;
    const marker = await tx.auditLog.findFirst({
      // Идентичность маркера — сам прокатанный день (data.date), а не createdAt:
      // часы БД и воркера могут расходиться (L5-тест с фейковыми датами это ловит).
      where: { action: DAY_ROLL_ACTION, data: { path: ['date'], equals: today } },
      select: { id: true },
    });
    if (marker) return null;

    await tx.auditLog.create({
      data: { action: DAY_ROLL_ACTION, data: { date: today, completedDay, accounts: accountIds.length } },
    });

    let count = 0;
    for (const { id } of accountIds) {
      // Тот же advisory-ключ, что withAccountLock: сериализация с API и riskTick.
      // SAFETY: $1 — bind-параметр Prisma ($executeRawUnsafe с аргументами,
      // без интерполяции строк); ключ тот же, что withAccountLock (hashtext(id)).
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', id);
      // Свежее состояние под блокировкой: статус мог измениться после выборки.
      const acc = await tx.tradingAccount.findUnique({
        where: { id },
        include: { challenge: true },
      });
      if (!acc || acc.status !== 'ACTIVE') continue;
      count++;

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
    }
    return count;
  }, { timeout: 60_000 });

  if (rolled === null) return 0;

  try {
    await deleteExpiredAuthRows(deps.db);
  } catch (error) {
    deps.log('warn', 'чистка просроченных auth-строк не прошла', { error: String(error) });
  }
  deps.log('info', 'торговый день сменился', { date: today, completedDay, accounts: rolled });
  return rolled;
}
