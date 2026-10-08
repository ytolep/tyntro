import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoenixMarkets, findMarket } from '../markets';
import { createMarketCatalog, CATALOG_TTL_MS } from '../catalog';
const rows = [
 {symbol:'SOL',tickSize:100,baseLotsDecimals:2,marketStatus:'active'},
 {symbol:'kPEPE',tickSize:100,baseLotsDecimals:-2,marketStatus:'active'},
 {symbol:'SKHY',tickSize:10,baseLotsDecimals:3,marketStatus:'paused',metadata:{name:'SK Hynix'}},
];
test('catalogue preserves every source market, exact case, names, status and units',()=>{
 const result=parsePhoenixMarkets(rows);
 assert.deepEqual(result.map(m=>m.baseAsset),rows.map(m=>m.symbol));
 assert.equal(result[1].symbol,'kPEPE-PERP');
 assert.equal(result[1].tickSize,0.000001);
 assert.equal(result[1].lotSize,100);
 assert.equal(result[1].priceDecimals,6);
 assert.equal(result[0].tickSize,0.01);
 assert.equal(result[2].name,'SK Hynix');
 assert.equal(result[2].status,'paused');
 assert.equal(findMarket(result,'KPEPE-PERP')?.baseAsset,'kPEPE');
});
test('catalogue rejects invalid or duplicate metadata rather than quietly dropping markets',()=>{
 for(const raw of [[],{},[...rows,rows[0]],[{...rows[0],tickSize:0}],[{...rows[0],baseLotsDecimals:NaN}]])
  assert.throws(()=>parsePhoenixMarkets(raw));
});
test('catalogue coalesces calls, adopts additions and removals, and never uses stale fallback on outage',async()=>{
 let now=0,calls=0,fail=false;
 let current=rows;
 const get=createMarketCatalog(async()=>{calls++;if(fail)throw new Error('offline');return current},()=>now);
 await Promise.all([get(),get(),get()]);assert.equal(calls,1);
 current=[rows[1]];now+=CATALOG_TTL_MS;
 assert.deepEqual((await get()).map(m=>m.symbol),['kPEPE-PERP']);
 fail=true;now+=CATALOG_TTL_MS;
 await assert.rejects(get());await assert.rejects(get());
 fail=false;current=rows;assert.equal((await get()).length,3);
});

test('decimal tick conversion avoids binary rounding tails in chart price scales',()=>{
 const [m]=parsePhoenixMarkets([{symbol:'TRX',tickSize:100,baseLotsDecimals:-1,marketStatus:'active'}]);
 assert.equal(m.tickSize,0.00001);
});
