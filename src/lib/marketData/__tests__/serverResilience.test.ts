import test from 'node:test';
import assert from 'node:assert/strict';
// server.ts импортируется динамически ПОСЛЕ подмены fetch/Date.now:
// createBlockTimeResolver захватывает Date.now при создании (импорт модуля), и тогда
// фейковые часы резолвера времени блока не подхватятся.
let server: typeof import('../server');

// Тесты устойчивости getMarketSnapshot: свежий кэш при сбое upstream, circuit breaker
// на 429 (пауза, рост, сброс), типизированный статус в phoenixJson. Phoenix и RPC
// подменяются стабом глобального fetch, время — фейковым Date.now.

const SLOT = 450_148_371;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let fakeNow = realNow();
let mode: 'ok' | 'down500' | 'rate429' = 'ok';
let retryAfter: string | null = null;
let orderbookCalls = 0;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
function upstreamResponse(): Response {
  if (mode === 'rate429') return json({ error: 'rate limit' }, 429, retryAfter ? { 'retry-after': retryAfter } : {});
  if (mode === 'down500') return json({ error: 'unavailable' }, 500);
  return json({ symbol: 'SOL', slot: SLOT, bids: [[116.91, 59.93]], asks: [[116.93, 59.93]] });
}
async function fetchStub(url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const target = new URL(String(url));
  if (target.hostname === 'perp-api.phoenix.trade') {
    if (target.pathname === '/v1/view/exchange/markets')
      return json([{ symbol: 'SOL', marketStatus: 'active', tickSize: 100, baseLotsDecimals: 2 }]);
    if (target.pathname === '/v1/view/orderbook/SOL') { orderbookCalls++; return upstreamResponse(); }
    if (target.pathname === '/v1/market/SOL/mark-price')
      return mode === 'ok' ? json({ symbol: 'SOL', markPrice: { price: 116.92, slot: SLOT } }) : upstreamResponse();
    return upstreamResponse();
  }
  // Всё остальное — JSON-RPC Solana: время слота ≈ сейчас −13 с, чтобы оценка была свежей.
  let id: number | string | null = 0;
  try { id = JSON.parse(String(init?.body ?? '{}')).id ?? 0; } catch { /* batch-запрос без id */ }
  return json({ jsonrpc: '2.0', id, result: Math.floor(Date.now() / 1000) - 13 });
}

test.before(async () => {
  globalThis.fetch = fetchStub as typeof fetch;
  Date.now = () => fakeNow;
  server = await import('../server');
});
test.beforeEach(() => { mode = 'ok'; retryAfter = null; });
test.after(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const snapshot = () => server.getMarketSnapshot('SOL-PERP');
const isMarketDataError = (status: number) => (error: unknown) =>
  error instanceof server.MarketDataError && error.status === status;

test('phoenixJson пробрасывает upstream-статус и Retry-After типизированно', async () => {
  mode = 'rate429'; retryAfter = '3';
  const grab: (e: unknown) => unknown = e => e;
  const error = await server.phoenixJson('/v1/health').then(() => { throw new Error('unreachable'); }, grab);
  assert.ok(error instanceof server.MarketDataError);
  assert.equal(error.upstreamStatus, 429);
  assert.equal(error.retryAfterMs, 3_000);
  assert.equal(error.status, 503);                       // клиенту — 503, а не чужой 429
  assert.match(error.message, /429/);
  retryAfter = '120';
  const capped = await server.phoenixJson('/v1/health').then(() => { throw new Error('unreachable'); }, grab);
  assert.ok(capped instanceof server.MarketDataError);
  assert.equal(capped.retryAfterMs, 16_000);             // пауза не длиннее потолка брейкера
});

test('429 без кэша: 503 и ни одного похода в Phoenix до конца паузы', async () => {
  mode = 'rate429';
  await assert.rejects(snapshot(), isMarketDataError(503));
  const hits = orderbookCalls;
  fakeNow += 1_000;                                      // внутри паузы 2 с
  await assert.rejects(snapshot(), isMarketDataError(503));
  assert.equal(orderbookCalls, hits);                    // upstream не вызывался
});

test('сбой upstream отдаёт прежний свежий снапшот из кэша', async () => {
  fakeNow += 20_000;                                     // прошлая пауза брейкера точно истекла
  const fresh = await snapshot();                        // успешная загрузка → кэш
  fakeNow += 3_000;                                      // fast-path 2 с истёк, снапшот ещё свежий (≤30 с)
  mode = 'down500';
  const served = await snapshot();
  assert.strictEqual(served, fresh);                     // честный кэш, а не ошибка
  fakeNow += 30_000;                                     // кэшу больше 30 с — свежесть потеряна
  await assert.rejects(snapshot(), isMarketDataError(503));
});

test('пауза брейкера растёт и сбрасывается успехом', async () => {
  fakeNow += 20_000;
  const first = await snapshot();                        // успех: брейкер чист
  const r = first.receivedAt;
  mode = 'rate429'; retryAfter = '1';                    // Retry-After: 1 с перекрывает старт паузы 2 с
  fakeNow = r + 3_000; await snapshot();                 // 429 №1 → пауза 1 с (до r+4000)
  let hits = orderbookCalls;
  fakeNow = r + 3_500; await snapshot();
  assert.equal(orderbookCalls, hits);                    // в паузе — ни одного вызова upstream
  retryAfter = null;
  fakeNow = r + 5_000; await snapshot();                 // 429 №2 → пауза 2 с (до r+7000)
  hits = orderbookCalls;
  fakeNow = r + 6_000; await snapshot();
  assert.equal(orderbookCalls, hits);                    // в паузе 2 с — тихо
  fakeNow = r + 8_000; await snapshot();                 // 429 №3 → пауза 4 с (до r+12000)
  hits = orderbookCalls;
  fakeNow = r + 10_000; await snapshot();
  assert.equal(orderbookCalls, hits);                    // в паузе 4 с — тихо
  mode = 'ok';
  fakeNow = r + 13_000; const renewed = await snapshot(); // успех — брейкер и лестница сброшены
  assert.notStrictEqual(renewed, first);
  mode = 'rate429';
  fakeNow = r + 16_000; await snapshot();                // 429 после сброса → снова пауза 2 с (до r+18000)
  hits = orderbookCalls;
  fakeNow = r + 17_000; await snapshot();
  assert.equal(orderbookCalls, hits);                    // в паузе — тихо
  fakeNow = r + 19_000; await snapshot();                // 2 с истекли — идём в upstream
  assert.equal(orderbookCalls, hits + 1);                // сброс подтверждён: пауза 2 с, а не 8/16 с
});
