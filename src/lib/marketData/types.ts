export type MarketType = 'spot' | 'perp';

export interface Market {
  name?: string;
  status?: string;
  symbol: string;         // e.g. "SOL/USDC" or "SOL-PERP"
  type: MarketType;
  baseAsset: string;      // e.g. "SOL"
  quoteAsset: string;     // e.g. "USDC"
  address?: string;
  baseMint?: string;
  quoteMint?: string;
  tickSize?: number;
  lotSize?: number;
  /** Taker-комиссия рынка (доля, не процент) из каталога Phoenix; нет поля — запасное значение takerFeeOf. */
  takerFee?: number;
  /** Максимальное плечо рынка из leverageTiers каталога. */
  maxLeverage?: number;
  priceDecimals?: number;
  quantityDecimals?: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total?: number;
  depthPct?: number;
}

export interface NormalizedOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
  spread: number;
  spreadPct: number;
  midPrice: number;
}

export interface NormalizedTicker {
  symbol: string;
  type: MarketType;
  lastPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  change24h: number | null;
  change24hUsd: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  openInterest: number | null; // null for spot
  fundingRate: number | null;  // null for spot
  fundingTimeLeft: string | null;
  timestamp: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface MarketSnapshot {
  marketId: string;
  market: Market;
  source: 'phoenix-spot' | 'phoenix-perp';
  sourceMarketId: string;
  sourceTimestamp: number;
  receivedAt: number;
  slot: number;
  orderBook: NormalizedOrderBook;
  ticker: NormalizedTicker;
  referencePrice: number | null;
  priceKind: 'mid' | 'mark';
}

export const MAX_DATA_AGE_MS = 30_000;
export function isFreshSnapshot(snapshot: MarketSnapshot, symbol: string, now = Date.now()): boolean {
  return snapshot.marketId === symbol && snapshot.market.symbol === symbol &&
    Number.isFinite(snapshot.sourceTimestamp) && Number.isFinite(snapshot.receivedAt) &&
    snapshot.sourceTimestamp <= now + 5_000 && snapshot.receivedAt <= now + 5_000 &&
    now - snapshot.sourceTimestamp <= MAX_DATA_AGE_MS && now - snapshot.receivedAt <= MAX_DATA_AGE_MS;
}
