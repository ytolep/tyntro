import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Q1: heartbeat воркера — upsert одной строки id='main' с временами последних
// УСПЕШНЫХ итераций циклов; упавший шаг время не обновляет (health увидит 503).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../lib/db').db;
let heartbeat: typeof import('../heartbeat');

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../lib/db')).db;
  heartbeat = await import('../heartbeat');
});

after(async () => { await db?.$disconnect(); });

test('writeHeartbeat до первого тика: строка одна, lastTickAt от старта, payments/dayRoll null', async () => {
  await heartbeat.writeHeartbeat(4242);
  const row = await db.workerHeartbeat.findUniqueOrThrow({ where: { id: 'main' } });
  assert.equal(row.pid, 4242);
  assert.ok(Math.abs(row.lastTickAt.getTime() - row.startedAt.getTime()) < 5_000, 'lastTickAt = старт, пока тик не завершён');
  assert.equal(row.lastPaymentsCheckAt, null);
  assert.equal(row.lastDayRollCheckAt, null);
  assert.equal(await db.workerHeartbeat.count(), 1);
});

test('успешный шаг отмечается, upsert не плодит строки', async () => {
  const prev = await db.workerHeartbeat.findUniqueOrThrow({ where: { id: 'main' } });
  await heartbeat.markDoneAfter('tick', async () => {})();
  await heartbeat.markDoneAfter('payments', async () => {})();
  const before = new Date();
  await heartbeat.writeHeartbeat(4243);
  const row = await db.workerHeartbeat.findUniqueOrThrow({ where: { id: 'main' } });
  // Метки выставляются в markDoneAfter ДО `before`, а PG timestamp(3) округляет до мс:
  // сравнение с `before` без допуска ложно падает при расхождении в единицы мс.
  // Осмысленность (метка обновилась, а не осталась старой) — сравнением с prev.
  assert.ok(row.lastTickAt.getTime() > prev.lastTickAt.getTime(), 'lastTickAt обновилась, а не осталась стартовой');
  assert.ok(row.lastPaymentsCheckAt!.getTime() >= before.getTime() - 2_000, 'lastPaymentsCheckAt свежая (допуск 2 с)');
  assert.equal(row.pid, 4243);
  assert.equal(row.lastDayRollCheckAt, null);
  assert.equal(await db.workerHeartbeat.count(), 1, 'upsert, а не вторая строка');
});

test('упавший шаг время не обновляет', async () => {
  await assert.rejects(
    heartbeat.markDoneAfter('dayRoll', async () => { throw new Error('rpc down'); })(),
  );
  const row = await db.workerHeartbeat.findUnique({ where: { id: 'main' } });
  assert.equal(row!.lastDayRollCheckAt, null);
});
