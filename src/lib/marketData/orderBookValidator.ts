import { OrderBookLevel, NormalizedOrderBook } from './types';
export interface RawLevel { price: number; size: number }

// Precision belongs to rendering. Preserve source units and small quantities here.
// A crossed or malformed snapshot must be rejected, never cosmetically repaired.
export function normalizeOrderBook(
  rawBids: RawLevel[], rawAsks: RawLevel[], _priceDecimals = 2, _quantityDecimals = 4,
  timestamp = Date.now(),
): NormalizedOrderBook | null {
  function process(raw: RawLevel[], descending: boolean): OrderBookLevel[] | null {
    if (!Array.isArray(raw)) return null;
    const levels = new Map<number, number>();
    for (const item of raw) {
      if (!item || !Number.isFinite(item.price) || !Number.isFinite(item.size)) return null;
      if (item.price <= 0 || item.size < 0) return null;
      if (item.size === 0) continue;
      const size = (levels.get(item.price) ?? 0) + item.size;
      if (!Number.isFinite(size)) return null;
      levels.set(item.price, size);
    }
    const sorted = [...levels].map(([price, size]) => ({ price, size }))
      .sort((a, b) => descending ? b.price - a.price : a.price - b.price);
    const maxSize = sorted.reduce((max, row) => Math.max(max, row.size), 0);
    let total = 0;
    const result = sorted.map(row => ({ ...row, total: total += row.size, depthPct: row.size / maxSize * 100 }));
    return Number.isFinite(total) ? result : null;
  }
  const bids = process(rawBids, true), asks = process(rawAsks, false);
  if (!bids || !asks || (!bids.length && !asks.length)) return null;
  if (bids.length && asks.length && bids[0].price >= asks[0].price) return null;
  const twoSided = bids.length > 0 && asks.length > 0;
  const spread = twoSided ? asks[0].price - bids[0].price : 0;
  const midPrice = twoSided ? bids[0].price / 2 + asks[0].price / 2 : 0;
  const spreadPct = midPrice ? spread / midPrice * 100 : 0;
  if (![spread, midPrice, spreadPct, timestamp].every(Number.isFinite)) return null;
  return { bids, asks, spread, midPrice, spreadPct, timestamp };
}
