import { Connection } from '@solana/web3.js';
import { createBlockTimeResolver } from './blockTime';
import { resolveMarket } from './catalog';
import { parseOrderBookSides } from './orderBookValidator';
import { createPhoenixStream, PhoenixStream } from './phoenixStream';
import { isFreshSnapshot, Market, MarketSnapshot, NormalizedTicker } from './types';

const API = 'https://perp-api.phoenix.trade';
export class MarketDataError extends Error {
  /** status — код ответа клиенту; upstreamStatus/retryAfterMs — типизированный статус
   *  upstream (например 429 от Phoenix) и его Retry-After; по ним работает circuit breaker. */
  constructor(message: string, public status = 503, public upstreamStatus?: number, public retryAfterMs?: number) {
    super(message);
  }
}
const rpc = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
  commitment: 'confirmed', disableRetryOnRateLimit: true,
  fetch: (url, options) => fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
});
// M1: время блока — из кэша/оценки, RPC дёргается не чаще раза в 10 с (см. blockTime.ts).
const resolveBlockTimeMs = createBlockTimeResolver(slot => rpc.getBlockTime(slot));

// Горячий путь рыночных данных — один WebSocket на процесс (wss://perp-api.phoenix.trade/v1/ws):
// allMids всегда, orderbook+market по символу по требованию. getBlockTime/RPC в горячем
// пути не участвует: slot приходит из allMids, свежесть — по времени получения сообщений.
// RPC остаётся санитарной сверкой раз в 30 с: отставание слота потока больше чем на
// 150 слотов — поток считается застрявшим, данные недоступны до переподключения.
// Синглтон на процесс через globalThis: Next собирает route-хендлеры отдельными
// бандлами, и без этого каждый роут получил бы свой экземпляр модуля (и свой WebSocket).
// SAFETY: globalThis живёт дольше бандлов Next; поле __phoenixMarketStream записываем только мы и только один раз на процесс.
const globalForStream = globalThis as unknown as { __phoenixMarketStream?: PhoenixStream };
export const phoenixStream: PhoenixStream = globalForStream.__phoenixMarketStream ?? createPhoenixStream({
  getRpcSlot: async () => { try { return await rpc.getSlot(); } catch { return null; } },
});
globalForStream.__phoenixMarketStream = phoenixStream;

// Circuit breaker на 429 от Phoenix: пауза по символу, во время паузы upstream не дёргается —
// отдаём свежий кэш (isFreshSnapshot, ≤30 с) или MarketDataError 503. Пауза: Retry-After
// (не длиннее потолка), иначе 2 с с удвоением до 16 с при повторных 429; успех сбрасывает.
const BREAKER_FIRST_PAUSE_MS = 2_000;
const BREAKER_MAX_PAUSE_MS = 16_000;
const breaker = new Map<string, { pauseUntil: number; nextPauseMs: number }>();
function breakerPaused(symbol: string): boolean {
  const state = breaker.get(symbol);
  return !!state && Date.now() < state.pauseUntil;
}
function tripBreaker(symbol: string, retryAfterMs?: number): void {
  const state = breaker.get(symbol);
  const pauseMs = retryAfterMs ?? Math.min(state?.nextPauseMs ?? BREAKER_FIRST_PAUSE_MS, BREAKER_MAX_PAUSE_MS);
  breaker.set(symbol, { pauseUntil: Date.now() + pauseMs, nextPauseMs: Math.min(pauseMs * 2, BREAKER_MAX_PAUSE_MS) });
}
function retryAfterToMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const text = header.trim();
  const seconds = text ? Number(text) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(text) - Date.now();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(ms, BREAKER_MAX_PAUSE_MS); // пауза дольше 30-с жизни кэша лишь гарантировала бы 503
}

export async function phoenixJson(path: string): Promise<any> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok)
    throw new MarketDataError(`Phoenix market data unavailable (${response.status})`, 503,
      response.status, retryAfterToMs(response.headers.get('retry-after')));
  return response.json();
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
export function parsePerpBook(raw: any, market: Market, timestamp: number) {
  if (raw?.symbol !== market.baseAsset || !Number.isSafeInteger(raw.slot) || raw.slot <= 0)
    throw new MarketDataError('Order book identity or slot is invalid', 502);
  const book = parseOrderBookSides(raw.bids, raw.asks, timestamp);
  if (!book) throw new MarketDataError('Empty or crossed order book', 503);
  return book;
}
function emptyTicker(market: Market, timestamp: number): NormalizedTicker {
  return { symbol: market.symbol, type: market.type, lastPrice: null, markPrice: null, indexPrice: null,
    change24h: null, change24hUsd: null, high24h: null, low24h: null, volume24h: null,
    openInterest: null, fundingRate: null, fundingTimeLeft: null, timestamp };
}

// Bounded coalescing: one source request per market, shared by simultaneous clients.
const cache = new Map<string, MarketSnapshot>();
const pending = new Map<string, Promise<MarketSnapshot>>();
/** Запасной путь: REST к perp-api только когда WebSocket полностью недоступен
 *  (не открыт или застрял по санитарной проверке слота). Не чаще раза в 2 с на символ
 *  (кэш), coalescing одновременных запросов, пауза после 429 — как раньше. */
async function restSnapshot(market: Market): Promise<MarketSnapshot> {
  const symbol = market.symbol;
  const previous = cache.get(symbol);
  if (previous && Date.now() - previous.receivedAt < 2_000 && isFreshSnapshot(previous, symbol)) return previous;
  if (breakerPaused(symbol)) {
    // Пауза после 429: в Phoenix не ходим — свежий кэш или честный 503.
    if (previous && isFreshSnapshot(previous, symbol)) return previous;
    throw new MarketDataError('Phoenix market data rate-limited');
  }
  const running = pending.get(symbol);
  if (running) return running;
  const request = loadSnapshot(market).then(snapshot => {
    if (!isFreshSnapshot(snapshot, symbol)) throw new MarketDataError('Market data is stale');
    if (previous && snapshot.slot < previous.slot) throw new MarketDataError('Market data moved backwards');
    cache.set(symbol, snapshot);
    breaker.delete(symbol); // успех сбрасывает брейкер и лестницу пауз
    return snapshot;
  }).catch((error: unknown) => {
    if (error instanceof MarketDataError && error.upstreamStatus === 429)
      tripBreaker(symbol, error.retryAfterMs);
    // Сбой upstream, но прежний снапшот ещё свежий — честно отдаём его: возраст данных
    // проверяется и на клиенте, и в исполнении ордеров (isFreshSnapshot, ≤30 с).
    if (previous && isFreshSnapshot(previous, symbol)) return previous;
    throw error;
  }).finally(() => pending.delete(symbol));
  pending.set(symbol, request);
  return request;
}

// allMids приходит раз в ~5 с (замер 9.10.2026): новому подключению нужно до 5 с на первый слот.
const STREAM_FIRST_MESSAGE_TIMEOUT_MS = 6_000;

export async function getMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
  const market = await resolveMarket(symbol);
  if (!market) throw new MarketDataError('Market is not supported', 400);
  if (market.type !== 'perp') throw new MarketDataError('Only perpetual markets are supported', 400);
  // Горячий путь — память потока: подписка по требованию, новый символ ждёт первый
  // стакан и market до 3 с. WebSocket открыт, но символ молчит — честный 503 без REST.
  phoenixStream.ensureSubscribed(market.baseAsset);
  if (phoenixStream.available()) {
    const live = await phoenixStream.waitForSnapshot(market, STREAM_FIRST_MESSAGE_TIMEOUT_MS);
    if (live) return live;
    // Пока ждали, поток упал/застрял — работает запасной REST-путь.
    if (!phoenixStream.available()) return restSnapshot(market);
    throw new MarketDataError(`Market data is stale: ${phoenixStream.unavailableReason(market) ?? 'timeout'}`);
  }
  return restSnapshot(market);
}
async function loadSnapshot(market: Market): Promise<MarketSnapshot> {
  // Spot-путь удалён (план §1): @ellipsis-labs/phoenix-sdk больше не используется,
  // каталог содержит только бессрочные рынки.
  if (market.type !== 'perp') throw new MarketDataError('Only perpetual markets are supported', 400);
  const symbol = encodeURIComponent(market.baseAsset);
  const [raw, mark] = await Promise.all([
    phoenixJson(`/v1/view/orderbook/${symbol}`), phoenixJson(`/v1/market/${symbol}/mark-price`),
  ]);
  if (mark?.symbol !== market.baseAsset || !positive(mark?.markPrice?.price) ||
      !Number.isSafeInteger(mark?.markPrice?.slot) || mark.markPrice.slot <= 0 ||
      !Number.isSafeInteger(raw?.slot) || raw.slot <= 0)
    throw new MarketDataError('Invalid perpetual mark price or market identity', 502);
  const slot = Math.min(raw.slot, mark.markPrice.slot);
  const timestamp = await resolveBlockTimeMs(slot);
  if (timestamp == null) throw new MarketDataError('Cannot establish perpetual data age');
  const book = parsePerpBook(raw, market, timestamp);
  const ticker = emptyTicker(market, timestamp);
  ticker.markPrice = mark.markPrice.price;
  // No fabricated last/index price, 24h OHLC, or funding. Historical stats are not a live ticker.
  return { marketId: market.symbol, market, source: 'phoenix-perp', sourceMarketId: market.baseAsset,
    sourceTimestamp: timestamp, receivedAt: Date.now(), slot, orderBook: book, ticker,
    referencePrice: ticker.markPrice, priceKind: 'mark' };
}
