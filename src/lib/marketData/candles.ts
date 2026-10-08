import type { Market } from './types';
export const CHART_INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as const;
export type ChartInterval = keyof typeof CHART_INTERVALS;
export type ChartBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export function parsePhoenixCandles(raw: any, market: Market, timeframe: ChartInterval) {
  if (raw?.symbol !== market.baseAsset || raw.timeframe !== timeframe || !Array.isArray(raw.bars) || raw.page?.hasMore !== false)
    throw new Error('Invalid or incomplete Phoenix candle response');
  const seen = new Set<number>(), externalSources = new Set<string>();
  const bars: ChartBar[] = raw.bars.map((b: any) => {
    if (!b || !Number.isSafeInteger(b.time) || b.time <= 0 || b.time % 1000 !== 0 ||
        ![b.open,b.high,b.low,b.close].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
        b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close,b.high) ||
        (b.volume != null && (typeof b.volume !== 'number' || !Number.isFinite(b.volume) || b.volume < 0)) || seen.has(b.time))
      throw new Error('Invalid Phoenix candle');
    seen.add(b.time);
    if (typeof b.externalSource === 'string' && b.externalSource) externalSources.add(b.externalSource);
    return {time:b.time/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume ?? 0};
  });
  bars.sort((a,b)=>a.time-b.time);
  return { symbol: market.symbol, timeframe, bars, externalSources: [...externalSources],
    priceDecimals: market.priceDecimals ?? 2, tickSize: market.tickSize ?? 0.01, fetchedAt: Date.now() };
}
