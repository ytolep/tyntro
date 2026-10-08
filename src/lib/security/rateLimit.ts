/**
 * In-memory token bucket: чистые функции над состоянием бакета + хранилище на процесс.
 */

export interface BucketState {
  tokens: number;
  /** Время последнего обновления, ms. */
  updatedAt: number;
}

export interface BucketLimit {
  /** Скорость пополнения, токенов в секунду. */
  ratePerSec: number;
  /** Максимальный размер бёрста. */
  capacity: number;
}

/** Доливает токены по ставке; время в прошлом состояние не меняет. */
export function refill(state: BucketState, nowMs: number, limit: BucketLimit): BucketState {
  if (nowMs <= state.updatedAt) return state;
  const elapsedSec = (nowMs - state.updatedAt) / 1000;
  return {
    tokens: Math.min(limit.capacity, state.tokens + elapsedSec * limit.ratePerSec),
    updatedAt: nowMs,
  };
}

/** Пытается снять один токен; возвращает решение и новое состояние. */
export function tryTake(
  state: BucketState,
  nowMs: number,
  limit: BucketLimit,
): { allowed: boolean; state: BucketState } {
  const current = refill(state, nowMs, limit);
  if (current.tokens < 1) return { allowed: false, state: current };
  return { allowed: true, state: { tokens: current.tokens - 1, updatedAt: nowMs } };
}

// ponytail: счётчики живут в памяти одного процесса (next start / один инстанс).
// За балансировщиком или при нескольких репликах каждый инстанс считает сам —
// эффективный лимит умножается на число инстансов. Переезжать на Redis, когда
// процессов станет больше одного.
export class RateLimiter {
  readonly #buckets = new Map<string, BucketState>();

  constructor(private readonly limits: Record<string, BucketLimit>) {}

  /** true = пропустить запрос; false = лимит исчерпан. */
  consume(key: string, limitName: string, nowMs: number): boolean {
    const limit = this.limits[limitName];
    if (!limit) throw new Error(`Unknown rate limit: ${limitName}`);
    const before = this.#buckets.get(key) ?? { tokens: limit.capacity, updatedAt: 0 };
    const { allowed, state } = tryTake(before, nowMs, limit);
    // Полностью восстановившийся бакет эквивалентен новому — удаляем, чтобы карта не росла.
    if (state.tokens >= limit.capacity) this.#buckets.delete(key);
    else this.#buckets.set(key, state);
    return allowed;
  }
}
