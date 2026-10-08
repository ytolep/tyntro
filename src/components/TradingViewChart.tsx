'use client';
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { CHART_INTERVALS, type ChartInterval, type ChartBar } from '@/lib/marketData/candles';
import { Loader2 } from 'lucide-react';

// TradingView's rendering library; candles are supplied by Phoenix, not a symbol-mapped iframe.
export default function TradingViewChart({ symbol, timeframe = '5m' }: {symbol:string; timeframe?:string}) {
 const [interval,setIntervalValue]=useState<ChartInterval>(timeframe in CHART_INTERVALS ? timeframe as ChartInterval : '5m');
 const host=useRef<HTMLDivElement>(null), chartRef=useRef<IChartApi|null>(null);
 const [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
 const [last,setLast]=useState<ChartBar|null>(null), [sources,setSources]=useState<string[]>([]), [updated,setUpdated]=useState<number|null>(null);
 const [precision,setPrecision]=useState(2), [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!host.current)return;
  const chart=createChart(host.current,{
   autoSize:true,layout:{background:{type:ColorType.Solid,color:'#09090d'},textColor:'#9993a7',attributionLogo:true},
   grid:{vertLines:{color:'#191720'},horzLines:{color:'#191720'}},
   rightPriceScale:{borderColor:'#292431',scaleMargins:{top:.08,bottom:.22}},
   timeScale:{borderColor:'#292431',timeVisible:true,secondsVisible:false},
   crosshair:{vertLine:{color:'#82729e'},horzLine:{color:'#82729e'}},
  });
  chartRef.current=chart;
  const candles=chart.addSeries(CandlestickSeries,{upColor:'#8ff0cc',downColor:'#ef8390',borderVisible:false,wickUpColor:'#8ff0cc',wickDownColor:'#ef8390'});
  const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});
  volume.priceScale().applyOptions({scaleMargins:{top:.83,bottom:0}});
  let disposed=false, first=true, timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  setLoading(true);setError(null);setLast(null);setUpdated(null);setSources([]);
  const load=async()=>{
   try {
    const params=new URLSearchParams({action:'candles',symbol,timeframe:interval});
    const res=await fetch(`/api/phoenix?${params}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
    if(!res.ok)throw new Error('Phoenix chart temporarily unavailable. Retrying automatically.');
    const data=await res.json();
    if(disposed)return;
    if(data.symbol!==symbol || data.timeframe!==interval || !Array.isArray(data.bars))throw new Error('Chart market mismatch');
    if(!data.bars.length)throw new Error('Phoenix has no candles for this market and interval yet.');
    const bars=data.bars as ChartBar[];
    candles.applyOptions({priceFormat:{type:'custom',minMove:data.tickSize,formatter:(value:number)=>value.toLocaleString('en-US',{minimumFractionDigits:data.priceDecimals,maximumFractionDigits:data.priceDecimals})}});
    candles.setData(bars.map(b=>({...b,time:b.time as UTCTimestamp})));
    volume.setData(bars.map(b=>({time:b.time as UTCTimestamp,value:b.volume,color:b.close>=b.open?'#8ff0cc40':'#ef839040'})));
    if(first){chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-100),to:bars.length+3});first=false;}
    setPrecision(data.priceDecimals);setLast(bars[bars.length-1]);setSources(data.externalSources||[]);setUpdated(data.fetchedAt);setError(null);
   } catch(e) {if(!disposed)setError(e instanceof Error?e.message:'Chart unavailable');}
   finally {if(!disposed){setLoading(false);timer=setTimeout(load,10000);}}
  };
  void load();
  return ()=>{disposed=true;controller.abort();clearTimeout(timer);chartRef.current=null;chart.remove();};
 },[symbol,interval,retry]);
 const price=(v:number)=>v.toLocaleString('en-US',{minimumFractionDigits:precision,maximumFractionDigits:precision});
 return <section className="phoenix-chart" aria-label={`${symbol} Phoenix candlestick chart`}>
  <div className="phoenix-chart-toolbar"><strong>{symbol}</strong><div role="group" aria-label="Chart interval">{Object.keys(CHART_INTERVALS).map(t=><button key={t} aria-pressed={interval===t} onClick={()=>setIntervalValue(t as ChartInterval)}>{t}</button>)}</div><button onClick={()=>chartRef.current?.timeScale().fitContent()}>Fit</button></div>
  <div className="phoenix-chart-ohlc">{last ? <><span>O {price(last.open)}</span><span>H {price(last.high)}</span><span>L {price(last.low)}</span><span className={last.close>=last.open?'text-profit':'text-loss'}>C {price(last.close)}</span></> : <span>Loading Phoenix candles…</span>}</div>
  <div className="phoenix-chart-canvas" ref={host}/>
  {loading && <div className="phoenix-chart-overlay"><Loader2 className="animate-spin" size={22}/><span>Loading Phoenix chart…</span></div>}
  {error && <div className={last?'phoenix-chart-warning':'phoenix-chart-overlay'} role="status"><span>{error}</span><button onClick={()=>setRetry(n=>n+1)}>Retry</button></div>}
  <div className="phoenix-chart-source"><span>Phoenix API · {sources.length ? `history includes ${sources.join(', ')}`:'exchange candles'}</span><span>{updated?`Updated ${new Date(updated).toLocaleTimeString()}`:'Waiting for data'} · UTC chart</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></div>
 </section>;
}
