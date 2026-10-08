import { Connection } from '@solana/web3.js';
import { resolveMarket } from './catalog';
import { normalizeOrderBook, RawLevel } from './orderBookValidator';
import { isFreshSnapshot, Market, MarketSnapshot, NormalizedTicker } from './types';

const API = 'https://perp-api.phoenix.trade';
export class MarketDataError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
const rpc = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
  commitment: 'confirmed', disableRetryOnRateLimit: true,
  fetch: (url, options) => fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
});

export async function phoenixJson(path: string): Promise<any> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new MarketDataError(`Phoenix market data unavailable (${response.status})`);
  return response.json();
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
export function parsePerpBook(raw: any, market: Market, timestamp: number) {
  if (raw?.symbol !== market.baseAsset || !Number.isSafeInteger(raw.slot) || raw.slot <= 0)
    throw new MarketDataError('Order book identity or slot is invalid', 502);
  function side(value: unknown): RawLevel[] {
    if (!Array.isArray(value)) throw new MarketDataError('Invalid order book side', 502);
    return value.map(row => {
      if (!Array.isArray(row) || row.length !== 2 || !positive(row[0]) ||
          typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] < 0)
        throw new MarketDataError('Invalid order book level', 502);
      return { price: row[0], size: row[1] };
    });
  }
  const book = normalizeOrderBook(side(raw.bids), side(raw.asks), undefined, undefined, timestamp);
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
export async function getMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
  const market = await resolveMarket(symbol);
  if (!market) throw new MarketDataError('Market is not supported', 400);
  const previous = cache.get(symbol);
  if (previous && Date.now() - previous.receivedAt < 2_000 && isFreshSnapshot(previous, symbol)) return previous;
  const running = pending.get(symbol);
  if (running) return running;
  const request = loadSnapshot(market).then(snapshot => {
    if (!isFreshSnapshot(snapshot, symbol)) throw new MarketDataError('Market data is stale');
    if (previous && snapshot.slot < previous.slot) throw new MarketDataError('Market data moved backwards');
    cache.set(symbol, snapshot);
    return snapshot;
  }).finally(() => pending.delete(symbol));
  pending.set(symbol, request);
  return request;
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
  const blockTime = await rpc.getBlockTime(slot);
  if (!blockTime) throw new MarketDataError('Cannot establish perpetual data age');
  const timestamp = blockTime * 1000;
  const book = parsePerpBook(raw, market, timestamp);
  const ticker = emptyTicker(market, timestamp);
  ticker.markPrice = mark.markPrice.price;
  // No fabricated last/index price, 24h OHLC, or funding. Historical stats are not a live ticker.
  return { marketId: market.symbol, market, source: 'phoenix-perp', sourceMarketId: market.baseAsset,
    sourceTimestamp: timestamp, receivedAt: Date.now(), slot, orderBook: book, ticker,
    referencePrice: ticker.markPrice, priceKind: 'mark' };
}
