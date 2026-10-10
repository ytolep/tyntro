import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Кэш публичного лидерборда (60 с в памяти процесса): второй GET в течение TTL не ходит
// в БД, после TTL — пересчёт, одновременные GET при протухшем кэше ждут один in-flight
// пересчёт, ошибка пересчёта не портит кэш навсегда (следующий запрос пробует снова).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

const TTL_MS = 60_000;

let db: typeof import('../../../../lib/db').db;
let GET: () => Promise<Response>;
let resetCache: () => void;

/** Счётчик запросов к БД: подменяем findMany на стабильном делегате Prisma-клиента. */
let findManyCalls = 0;
/** Подмена времени: TTL кэша проверяется через Date.now(). */
const realNow = Date.now;
let fakeNowMs = realNow();

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../../../lib/db')).db;
  ({ GET, __resetLeaderboardCacheForTests: resetCache } = await import('../route'));

  const accounts = db.tradingAccount;
  const origFindMany = accounts.findMany.bind(accounts);
  accounts.findMany = ((args?: unknown) => {
    findManyCalls++;
    return origFindMany(args as never);
  }) as unknown as typeof accounts.findMany;

  Date.now = () => fakeNowMs;
});

after(async () => {
  Date.now = realNow;
  await db?.$disconnect();
});

test('первый GET читает БД, второй в течение TTL — из кэша, без запросов к БД', async () => {
  resetCache();
  const first = await GET();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { entries: [] });
  assert.equal(first.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=60');

  const callsAfterFirst = findManyCalls;
  assert.ok(callsAfterFirst >= 1);

  const second = await GET();
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { entries: [] });
  assert.equal(findManyCalls, callsAfterFirst); // ни одного нового запроса к БД
});

test('после истечения TTL — пересчёт с новым запросом к БД', async () => {
  const callsBefore = findManyCalls; // кэш прогрет предыдущим тестом
  fakeNowMs += TTL_MS + 1;
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { entries: [] });
  assert.ok(findManyCalls > callsBefore); // пересчёт сделал свежий запрос
});

test('протухший кэш: два одновременных GET → один пересчёт', async () => {
  resetCache();
  const callsBefore = findManyCalls;
  const [a, b] = await Promise.all([GET(), GET()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(findManyCalls, callsBefore + 1); // оба дождались один in-flight пересчёт
});

test('ошибка пересчёта не портит кэш навсегда: 500, затем следующий запрос пробует снова', async () => {
  resetCache();
  await GET(); // прогрев успешным ответом
  fakeNowMs += TTL_MS + 1; // кэш протух

  const accounts = db.tradingAccount;
  const counting = accounts.findMany;
  accounts.findMany = (() => {
    findManyCalls++;
    return Promise.reject(new Error('db down'));
  }) as unknown as typeof accounts.findMany;

  const failed = await GET();
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).error, 'Failed to load leaderboard');

  // In-flight слот освобождён даже после ошибки — следующий запрос пробует снова.
  accounts.findMany = counting;
  const retried = await GET();
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { entries: [] });
});
