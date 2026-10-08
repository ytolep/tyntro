import { Market } from './types';
// Initial selection only, never a fallback catalogue or server authorization.
export const DEFAULT_MARKET: Market = { symbol: 'SOL-PERP', type: 'perp', baseAsset: 'SOL', quoteAsset: 'USD' };
export function findMarket(markets: Market[], symbol: string, type?: string) {
  return markets.find(m => (m.symbol.toUpperCase() === symbol.toUpperCase() ||
    (type && m.baseAsset.toUpperCase() === symbol.toUpperCase())) && (!type || m.type === type));
}
// Phoenix Rise uses 6 quote-lot decimals. Preserve source casing (e.g. kPEPE).
export function parsePhoenixMarkets(raw: unknown): Market[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Phoenix market catalogue is empty');
  const seen = new Set<string>();
  return raw.map(m => {
    if (!m || typeof m.symbol !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(m.symbol) ||
        typeof m.marketStatus !== 'string' || !Number.isSafeInteger(m.tickSize) || m.tickSize <= 0 ||
        !Number.isInteger(m.baseLotsDecimals) || Math.abs(m.baseLotsDecimals) > 12 ||
        seen.has(m.symbol.toUpperCase())) throw new Error('Invalid Phoenix market metadata');
    seen.add(m.symbol.toUpperCase());
    let tick = m.tickSize, zeros = 0;
    while (tick % 10 === 0) { tick /= 10; zeros++; }
    const decimals = Math.max(0, 6 - m.baseLotsDecimals - zeros);
    return { symbol: `${m.symbol}-PERP`, baseAsset: m.symbol, type: 'perp', quoteAsset: 'USD',
      name: typeof m.metadata?.name === 'string' ? m.metadata.name : m.symbol,
      status: m.marketStatus, address: m.marketPubkey,
      tickSize: Number((m.tickSize * 10 ** (m.baseLotsDecimals - 6)).toPrecision(12)), lotSize: 10 ** -m.baseLotsDecimals,
      priceDecimals: decimals === 1 ? 2 : decimals, quantityDecimals: Math.max(0, m.baseLotsDecimals) };
  });
}
