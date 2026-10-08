import { Market } from './types';
import { parsePhoenixMarkets, findMarket } from './markets';
export const PHOENIX_MARKETS_URL = 'https://perp-api.phoenix.trade/v1/view/exchange/markets';
export const CATALOG_TTL_MS = 30_000;
export function createMarketCatalog(load: () => Promise<unknown>, now = Date.now) {
 let cached: Market[] | null = null, expires = 0, pending: Promise<Market[]> | null = null;
 return async () => {
  if (cached && now() < expires) return cached;
  if (pending) return pending;
  pending = load().then(raw => { const markets = parsePhoenixMarkets(raw); cached = markets; expires = now() + CATALOG_TTL_MS; return markets; })
   .catch(error => { cached = null; expires = 0; throw error; }).finally(() => { pending = null; });
  return pending;
 };
}
export const getPhoenixMarkets = createMarketCatalog(async () => {
 const res = await fetch(PHOENIX_MARKETS_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
 if (!res.ok) throw new Error('Phoenix market catalogue unavailable');
 return res.json();
});
export async function resolveMarket(symbol: string, type?: string) {
 return findMarket(await getPhoenixMarkets(), symbol, type);
}
