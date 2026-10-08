import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoenixCandles } from '../candles';
import { DEFAULT_MARKET } from '../markets';
const bar={time:1790334000000,open:120,high:122,low:119,close:121,volume:10};
const response={symbol:'SOL',timeframe:'5m',bars:[bar],page:{hasMore:false}};
test('Phoenix candles preserve OHLC and expose external history with timestamps in seconds',()=>{
 const result=parsePhoenixCandles({...response,bars:[{...bar,externalSource:'binance'}]},DEFAULT_MARKET,'5m');
 assert.deepEqual(result.bars,[{...bar,time:bar.time/1000}]);
 assert.deepEqual(result.externalSources,['binance']);
});
test('candles reject wrong market, interval, incomplete pages and malformed OHLC',()=>{
 for(const bad of [{...response,symbol:'BTC'},{...response,timeframe:'1h'},{...response,page:{hasMore:true}},
 {...response,bars:[{...bar,high:119}]},{...response,bars:[{...bar,low:123}]},
 {...response,bars:[{...bar,close:NaN}]},{...response,bars:[{...bar,volume:-1}]},{...response,bars:[bar,bar]}])
 assert.throws(()=>parsePhoenixCandles(bad,DEFAULT_MARKET,'5m'));
});
test('candles preserve k-prefixed identity and small prices; empty history remains empty',()=>{
 const market={...DEFAULT_MARKET,symbol:'kPEPE-PERP',baseAsset:'kPEPE'};
 const result=parsePhoenixCandles({...response,symbol:'kPEPE',bars:[{...bar,open:.004,close:.0041,high:.0042,low:.0039}]},market,'5m');
 assert.equal(result.bars[0].close,.0041);
 assert.deepEqual(parsePhoenixCandles({...response,bars:[]},DEFAULT_MARKET,'5m').bars,[]);
});
