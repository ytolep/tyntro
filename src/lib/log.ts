// JSON-логгер одной функцией: одна JSON-строка на событие (план §1 — «структурные логи»).
// Контракт совпадает с src/worker/log.ts (волна 1); воркер может реэкспортировать отсюда.
export type LogLevel = 'info' | 'warn' | 'error';

export function jsonLog(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}
