import { Market } from './types';
// Initial selection only, never a fallback catalogue or server authorization.
export const DEFAULT_MARKET: Market = { symbol: 'SOL-PERP', type: 'perp', baseAsset: 'SOL', quoteAsset: 'USD' };

/** Запасная taker-комиссия, если каталог Phoenix поле не отдал (переопределяется TAKER_FEE_RATE). */
export const FALLBACK_TAKER_FEE = Number(process.env.TAKER_FEE_RATE ?? '0.0005') || 0.0005;

/** Taker-комиссия рынка; без поля в каталоге — запасное значение. Деньги считает Decimal на вызывающей стороне. */
export function takerFeeOf(market: Market | undefined): number {
  return typeof market?.takerFee === 'number' && Number.isFinite(market.takerFee) && market.takerFee >= 0
    ? market.takerFee
    : FALLBACK_TAKER_FEE;
}
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
      takerFee: positiveRate(m.takerFee),
      maxLeverage: maxLeverageOf(m.leverageTiers),
      priceDecimals: decimals === 1 ? 2 : decimals, quantityDecimals: Math.max(0, m.baseLotsDecimals) };
  });
}

/** Конечная неотрицательная доля или undefined — каталог без поля не отбраковывается (есть запасная комиссия). */
function positiveRate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Максимум maxLeverage по leverageTiers; без корректных тиров — undefined (лимит остаётся общим 5x). */
function maxLeverageOf(tiers: unknown): number | undefined {
  if (!Array.isArray(tiers)) return undefined;
  let best: number | undefined;
  for (const tier of tiers) {
    const lev = positiveRate((tier as { maxLeverage?: unknown } | null)?.maxLeverage);
    if (lev !== undefined && lev > 0) best = Math.max(best ?? 0, lev);
  }
  return best;
}
