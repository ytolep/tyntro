// Заглушка волны 0: воркер как процесс существует, циклы приходят в волне 1 (агент B).
// ponytail: keep-alive интервал, пока нет циклов; убрать при появлении riskTick.
console.log(JSON.stringify({ level: 'info', msg: 'worker start', pid: process.pid }));
const keepAlive = setInterval(() => {}, 60_000);
keepAlive.unref?.();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'worker stop', signal }));
    process.exit(0);
  });
}
