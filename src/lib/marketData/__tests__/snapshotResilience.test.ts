// M1: при сбое или 429 Phoenix сервер отдаёт ещё свежий снапшот и не долбит upstream в паузе.
import test from 'node:test';
import assert from 'node:assert/strict';

let phoenixCalls = 0;
let mode: 'ok' | '429' | 'down' = 'ok';
let slot = 1_000_000;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('/v1/view/exchange/markets')) return json([{ symbol: 'SOL', tickSize: 100, baseLotsDecimals: 2, marketStatus: 'active' }]);
  if (url.includes('perp-api.phoenix.trade')) {
    phoenixCalls++;
    if (mode === '429') return json({ error: 'rate limit' }, 429);
    if (mode === 'down') return json({ error: 'down' }, 500);
    slot += 5;
    if (url.includes('/orderbook/')) return json({ symbol: 'SOL', slot, bids: [[100, 1]], asks: [[101, 1]] });
    return json({ symbol: 'SOL', markPrice: { price: 100.5, slot } });
  }
  // Solana JSON-RPC getBlockTime: текущий слот — «сейчас», более ранние — на 400 мс за слот раньше.
  const body = JSON.parse(String(init?.body ?? '{}'));
  const requested = Number(body.params?.[0] ?? slot);
  return json({ jsonrpc: '2.0', id: body.id, result: Math.floor((Date.now() - (slot - requested) * 400) / 1000) });
}) as typeof fetch;

// WS-поток здесь недоступен (конструктор падает) — работает запасной REST-путь.
const realWebSocket = globalThis.WebSocket;
class OfflineWebSocket {
  constructor() { throw new Error('offline'); }
}
globalThis.WebSocket = OfflineWebSocket as unknown as typeof WebSocket;

test.after(() => { globalThis.fetch = realFetch; globalThis.WebSocket = realWebSocket; });

test('serves the last fresh snapshot when Phoenix fails, and pauses upstream after 429', async (t) => {
  const { getMarketSnapshot } = await import('../server');
  const first = await getMarketSnapshot('SOL-PERP');
  assert.equal(first.ticker.markPrice, 100.5);

  // Кэш короче 2 с переиспользуется; сдвигаем время, чтобы пошёл новый запрос.
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  const base = realNow();
  Date.now = () => base + 3_000;

  mode = 'down';
  const onFailure = await getMarketSnapshot('SOL-PERP');
  assert.equal(onFailure.slot, first.slot, 'upstream failure must return the still-fresh snapshot');

  mode = '429';
  Date.now = () => base + 6_000;
  await getMarketSnapshot('SOL-PERP'); // 429 включает паузу
  const callsAfterTrip = phoenixCalls;
  Date.now = () => base + 6_500; // внутри паузы 2 с
  const paused = await getMarketSnapshot('SOL-PERP');
  assert.equal(phoenixCalls, callsAfterTrip, 'no upstream calls while the breaker is open');
  assert.equal(paused.slot, first.slot);

  // Снапшот старше 30 с больше не отдаётся: честный отказ вместо устаревшей цены.
  Date.now = () => base + 45_000;
  await assert.rejects(getMarketSnapshot('SOL-PERP'));
});
