import type { Market } from './types';
import { CHART_INTERVALS, ChartInterval, parsePhoenixCandles } from './candles';
import { phoenixJson, MarketDataError } from './server';
type Result = ReturnType<typeof parsePhoenixCandles>;
const cache = new Map<string, Result>();
const pending = new Map<string, Promise<Result>>();
export async function getPhoenixCandles(market: Market, interval: string) {
  if (!Object.prototype.hasOwnProperty.call(CHART_INTERVALS, interval)) throw new MarketDataError('Unsupported chart interval',400);
  const timeframe=interval as ChartInterval, key=`${market.symbol}:${timeframe}`;
  const old=cache.get(key);
  if (old && Date.now()-old.fetchedAt<5000) return old;
  if (pending.has(key)) return pending.get(key)!;
  const to=Date.now(), step=CHART_INTERVALS[timeframe]*1000;
  const from=Math.floor(to/step)*step-step*299;
  const query=new URLSearchParams({timeframe,from:String(from),to:String(to),limit:'500',includePartial:'true'});
  const request=phoenixJson(`/v1/candles_v2/${encodeURIComponent(market.baseAsset)}?${query}`)
    .then(raw=>parsePhoenixCandles(raw,market,timeframe)).then(result=>{
      if(cache.size>=600)cache.delete(cache.keys().next().value!);
      cache.set(key,result);return result;
    }).finally(()=>pending.delete(key));
  pending.set(key,request);return request;
}
