export type LogLevel = 'info' | 'warn' | 'error';
export type LogFn = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;

/** Единственный формат логов воркера: одна JSON-строка на событие (план §1 — «структурные логи»). */
export const jsonLog: LogFn = (level, msg, extra) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
};
