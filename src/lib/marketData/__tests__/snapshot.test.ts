import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MARKET, findMarket, parsePhoenixMarkets } from '../markets';
import { isFreshSnapshot, MarketSnapshot } from '../types';
import { parsePerpBook } from '../server';
import { pollMarket } from '../pollMarket';
import { PhoenixSpotAdapter } from '../adapters/PhoenixSpotAdapter';
import { PhoenixPerpAdapter } from '../adapters/PhoenixPerpAdapter';
const catalogue=parsePhoenixMarkets([{symbol:'SOL',marketStatus:'active',tickSize:100,baseLotsDecimals:2}]);
const market=catalogue[0];
const spot = {...market,symbol:'SOL/USDC',type:'spot' as const};
const raw={symbol:'SOL',slot:450148371,bids:[[116.91,59.93]],asks:[[116.93,59.93]]};
function snapshot(symbol='SOL-PERP', slot=1): MarketSnapshot {
  const now=Date.now();
  return {marketId:symbol,market:{...market,symbol},source:'phoenix-perp',sourceMarketId:'SOL',sourceTimestamp:now,receivedAt:now,slot,
    orderBook:parsePerpBook(raw,market,now),ticker:{} as any,referencePrice:116.92,priceKind:'mark'};
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test('market registry uses only supplied Phoenix contracts and preserves instrument type',()=>{
  assert.equal(findMarket(catalogue,'SOL','perp')?.symbol,'SOL-PERP');
  assert.equal(findMarket(catalogue,'SOL-PERP','spot'),undefined);
  assert.equal(findMarket(catalogue,'SOL/USDC'),undefined);
  assert.equal(findMarket(catalogue,'PYTH-PERP'),undefined);
});
test('perp parser verifies symbol, slot, numeric format and keeps API human units',()=>{
  assert.equal(parsePerpBook(raw,market,1).bids[0].size,59.93);
  for(const bad of [{...raw,symbol:'BTC'},{...raw,slot:NaN},{...raw,bids:[['116.91',1]]},{...raw,asks:[[110,1]]}])
    assert.throws(()=>parsePerpBook(bad,market,1));
});
test('snapshot freshness checks source age, transport age, clock skew and identity',()=>{
  const s=snapshot(),now=Date.now();
  assert.equal(isFreshSnapshot(s,'SOL-PERP',now),true);
  for(const bad of [{...s,sourceTimestamp:now-30001},{...s,receivedAt:now-30001},{...s,sourceTimestamp:now+6000},{...s,marketId:'BTC-PERP'}])
    assert.equal(isFreshSnapshot(bad,'SOL-PERP',now),false);
});
test('adapters enforce instrument types',()=>{
  assert.throws(()=>new PhoenixSpotAdapter(market));
  assert.throws(()=>new PhoenixPerpAdapter(spot));
});
test('switch cleanup ignores a previous market response even if fetch ignores abort',async()=>{
  let resolve!: (s:MarketSnapshot)=>void;
  const results: unknown[]=[];
  const stop=pollMarket('SOL-PERP',()=>new Promise(r=>resolve=r),s=>results.push(s),()=>{},100,100);
  stop();resolve(snapshot());await delay(5);
  assert.deepEqual(results,[]);
});
test('requests are serialized and cleanup prevents another poll',async()=>{
  let active=0,maxActive=0,calls=0;
  const stop=pollMarket('SOL-PERP',async()=>{active++;calls++;maxActive=Math.max(active,maxActive);await delay(8);active--;return snapshot();},()=>{},()=>{},2,100);
  await delay(35);stop();const before=calls;await delay(20);
  assert.equal(maxActive,1);assert.equal(calls,before);assert.ok(calls>=2);
});
test('timeout aborts request, clears previous data and reports error',async()=>{
  let signal!:AbortSignal;
  const data:unknown[]=[],statuses:string[]=[];
  const stop=pollMarket('SOL-PERP',s=>{signal=s;return new Promise(()=>{});},s=>data.push(s),s=>statuses.push(s),100,5);
  await delay(20);stop();
  assert.equal(signal.aborted,true);assert.deepEqual(data,[null]);assert.deepEqual(statuses,['connecting','error']);
});
test('out-of-order snapshot is rejected, previous fresh one is kept',async()=>{
  let count=0;const data:(MarketSnapshot|null)[]=[];const statuses:string[]=[];
  const stop=pollMarket('SOL-PERP',async()=>snapshot('SOL-PERP',++count===1?10:9),s=>data.push(s),s=>statuses.push(s),2,100);
  await delay(15);stop();assert.equal(data[0]?.slot,10);
  assert.equal(data[1]?.slot,10);                       // M1: прежний свежий снапшот удержан
  assert.ok(!data.slice(1).includes(null));
  assert.ok(statuses.includes('reconnecting'));
});
test('single failed poll keeps the last fresh snapshot, then clears it once stale',async()=>{
  const s=snapshot('SOL-PERP',10);const data:(MarketSnapshot|null)[]=[];const statuses:string[]=[];
  let fail=false;
  const stop=pollMarket('SOL-PERP',async()=>{if(fail)throw new Error('network');return s;},v=>data.push(v),v=>statuses.push(v),2,100);
  await delay(6);fail=true;await delay(6);              // одиночная ошибка: снапшот держим
  s.sourceTimestamp=Date.now()-31_000;s.receivedAt=Date.now()-31_000;  // снапшоту больше 30 с
  await delay(25);stop();
  assert.equal(data[0]?.slot,10);                       // успех
  assert.equal(data[1]?.slot,10);                       // ошибка: свежий удержан, статус reconnecting
  assert.equal(data[data.length-1],null);               // после 30 с — прочерк
  assert.ok(statuses.includes('connected')&&statuses.includes('reconnecting')&&statuses.includes('error'));
});

test('terminal opens the Phoenix perpetual book explicitly, without relabelling spot', () => {
  assert.equal(DEFAULT_MARKET.symbol, 'SOL-PERP');
  assert.equal(DEFAULT_MARKET.type, 'perp');
  assert.equal(findMarket(catalogue,'SOL/USDC'), undefined);
});
