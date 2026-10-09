// Q1: heartbeat воркера. Живость процесса и свежесть его циклов:
// воркер раз в HEARTBEAT_INTERVAL_MS делает upsert строки id='main',
// /api/health сравнивает времена последних завершённых итераций с порогами.
import { db } from '../lib/db';

export const HEARTBEAT_ID = 'main';
export const HEARTBEAT_INTERVAL_MS = 5_000;

const startedAt = new Date();

// Времена последних УСПЕШНЫХ завершений итераций циклов (loop ловит ошибки —
// падающая итерация не обновляет время, и health видит устаревание).
type LoopName = 'tick' | 'payments' | 'dayRoll';
const lastDoneAt: Record<LoopName, Date | null> = { tick: null, payments: null, dayRoll: null };

/** Обернуть шаг цикла: после успешного шага отметить время завершения. */
export function markDoneAfter(name: LoopName, step: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    await step();
    lastDoneAt[name] = new Date();
  };
}

/** Upsert строки-сердцебиения. Цикл обязан выполняться НЕ чаще порогов health. */
export async function writeHeartbeat(pid: number): Promise<void> {
  const data = {
    lastTickAt: lastDoneAt.tick ?? startedAt,
    lastPaymentsCheckAt: lastDoneAt.payments,
    lastDayRollCheckAt: lastDoneAt.dayRoll,
    pid,
    startedAt,
  };
  await db.workerHeartbeat.upsert({
    where: { id: HEARTBEAT_ID },
    update: data,
    create: { id: HEARTBEAT_ID, ...data },
  });
}
