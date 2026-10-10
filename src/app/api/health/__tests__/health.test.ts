import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Q1: /api/health отражает живость воркера по WorkerHeartbeat.
// Свежий heartbeat → 200; старый тик/проверка оплат или нет строки → 503 degraded;
// ?scope=web → только БД (healthcheck контейнера web не зависит от воркера).
// Без TREASURY_WALLET: payments disabled — пустой lastPaymentsCheckAt не роняет health.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../../../lib/db').db;
let healthGET: (request: Request) => Promise<Response>;

const get = (query = '') => healthGET(new Request(`http://localhost:3000/api/health${query}`));

// .env.test не содержит TREASURY_WALLET — payments-enabled кейсы задают его сами.
const TREASURY = 'TestTreasuryWallet1111111111111111111111111111';
const setTreasury = () => { process.env.TREASURY_WALLET = TREASURY; };

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../../../lib/db')).db;
  ({ GET: healthGET } = await import('../route'));
});

after(async () => { await db?.$disconnect(); });

test('нет строки heartbeat → 503 degraded, worker.ok=false', async () => {
  const res = await get();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.db, 'up');
  assert.equal(body.worker.ok, false);
  assert.equal(body.worker.lastTickAgeMs, null);
});

test('свежий heartbeat → 200 ok', async () => {
  setTreasury();
  const now = new Date();
  await db.workerHeartbeat.create({
    data: {
      id: 'main', lastTickAt: now, lastPaymentsCheckAt: now, lastDayRollCheckAt: now,
      pid: 4242, startedAt: new Date(now.getTime() - 60_000),
    },
  });
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'up');
  assert.equal(body.worker.ok, true);
  assert.equal(body.worker.payments, 'enabled');
  assert.ok(body.worker.lastTickAgeMs < 30_000);
  assert.ok(body.worker.lastPaymentsCheckAgeMs < 90_000);
});

test('старый тик (>30 с) → 503 degraded', async () => {
  setTreasury();
  const now = new Date();
  await db.workerHeartbeat.update({
    where: { id: 'main' },
    data: { lastTickAt: new Date(now.getTime() - 60_000), lastPaymentsCheckAt: now },
  });
  const res = await get();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.worker.ok, false);
  assert.ok(body.worker.lastTickAgeMs >= 30_000);
});

test('старая проверка оплат (>90 с) → 503 degraded', async () => {
  setTreasury();
  const now = new Date();
  await db.workerHeartbeat.update({
    where: { id: 'main' },
    data: { lastTickAt: now, lastPaymentsCheckAt: new Date(now.getTime() - 120_000) },
  });
  const res = await get();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.worker.ok, false);
  assert.ok(body.worker.lastPaymentsCheckAgeMs >= 90_000);
});

test('first payments check ещё не завершён: возраст считается от старта воркера', async () => {
  setTreasury();
  // только запустился, первая проверка оплат в полёте → не degraded
  const now = new Date();
  await db.workerHeartbeat.update({
    where: { id: 'main' },
    data: { lastTickAt: now, lastPaymentsCheckAt: null, startedAt: now },
  });
  assert.equal((await get()).status, 200);
  // воркер давно жив, а проверка оплат ни разу не завершилась → degraded
  await db.workerHeartbeat.update({
    where: { id: 'main' },
    data: { startedAt: new Date(now.getTime() - 120_000) },
  });
  const res = await get();
  assert.equal(res.status, 503);
  assert.ok((await res.json()).worker.lastPaymentsCheckAgeMs >= 90_000);
});

test('без TREASURY_WALLET: payments disabled, пустой lastPaymentsCheckAt → 200 ok', async () => {
  delete process.env.TREASURY_WALLET;
  const now = new Date();
  // тик свежий, проверка оплат ни разу не была (воркер жив давно) — норма.
  await db.workerHeartbeat.update({
    where: { id: 'main' },
    data: { lastTickAt: now, lastPaymentsCheckAt: null, startedAt: new Date(now.getTime() - 120_000) },
  });
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.worker.ok, true);
  assert.equal(body.worker.payments, 'disabled');
  assert.equal(body.worker.lastPaymentsCheckAgeMs, null);
});

test('scope=web без воркера → 200 (только БД)', async () => {
  await db.workerHeartbeat.delete({ where: { id: 'main' } });
  const res = await get('?scope=web');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'up');
  assert.equal(body.worker, undefined);
});
