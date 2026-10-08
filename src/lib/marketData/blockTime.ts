// M1: rpc.getBlockTime на публичном RPC лимитируется и даёт ~20 % 503 на снапшотах.
// Поэтому время блока берём из кэша, дёргаем RPC не чаще раза в 10 с на процесс
// (одновременные запросы коалесятся в один), а между запросами оцениваем возраст
// слота по последней RPC-опорной точке и скорости ~400 мс/слот. Опорная точка
// учитывается только 60 с после получения и только взятая напрямую из RPC.
// Оценка чуть занижает время (реальный слот длиннее 400 мс), т.е. ошибается в
// сторону «данные старее» — fail-closed. Всё старше MAX_DATA_AGE_MS всё равно
// отклоняется проверкой свежести в server.ts.
export const SLOT_MS = 400;
export const ANCHOR_MAX_AGE_MS = 60_000;
export const FETCH_MIN_INTERVAL_MS = 10_000;
export const RATE_LIMIT_RETRY_MS = 500;

export type GetBlockTime = (slot: number) => Promise<number | null>;

function isRateLimited(error: unknown): boolean {
  const message = typeof (error as Error | null)?.message === 'string' ? (error as Error).message : '';
  return /429|rate limit|too many requests/i.test(message);
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createBlockTimeResolver(getBlockTime: GetBlockTime, clock: () => number = Date.now) {
  const slotTimes = new Map<number, number>();
  let anchor: { slot: number; time: number; receivedAt: number } | null = null;
  let inFlight: Promise<number | null> | null = null;
  let lastFetchAt = -Infinity;

  async function fetchWithRetry(slot: number): Promise<number | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getBlockTime(slot);
      } catch (error) {
        if (attempt === 0 && isRateLimited(error)) { await delay(RATE_LIMIT_RETRY_MS); continue; }
        return null;
      }
    }
  }

  return async function resolveBlockTimeMs(slot: number): Promise<number | null> {
    const cached = slotTimes.get(slot);
    if (cached !== undefined) return cached * 1000;
    const now = clock();
    if (!inFlight && now - lastFetchAt >= FETCH_MIN_INTERVAL_MS) {
      lastFetchAt = now;
      const fetchingSlot = slot;
      const request = fetchWithRetry(fetchingSlot).then(time => {
        if (typeof time === 'number' && time > 0) {
          if (slotTimes.size > 128) slotTimes.clear();
          slotTimes.set(fetchingSlot, time);
          if (!anchor || fetchingSlot >= anchor.slot) anchor = { slot: fetchingSlot, time, receivedAt: clock() };
        }
        return time;
      }).finally(() => { if (inFlight === request) inFlight = null; });
      inFlight = request;
    }
    if (inFlight) await inFlight; // чужой запрос тоже даёт опорную точку: слоты глобальны
    const exact = slotTimes.get(slot);
    if (exact !== undefined) return exact * 1000;
    if (anchor && clock() - anchor.receivedAt <= ANCHOR_MAX_AGE_MS)
      return (anchor.time + (slot - anchor.slot) * SLOT_MS / 1000) * 1000;
    return null;
  };
}
