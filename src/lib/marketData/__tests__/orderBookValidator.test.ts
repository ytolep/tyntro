import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrderBook } from '../orderBookValidator';

test('sorts and aggregates exact source prices without discarding quantity', () => {
  const book = normalizeOrderBook([{price:100,size:2},{price:102,size:5},{price:100,size:3}], [{price:105,size:4},{price:103,size:1},{price:105,size:6}])!;
  assert.deepEqual(book.bids.map(x=>[x.price,x.size]), [[102,5],[100,5]]);
  assert.deepEqual(book.asks.map(x=>[x.price,x.size]), [[103,1],[105,10]]);
  assert.equal(book.spread,1); assert.equal(book.asks[1].total,11);
});
test('preserves small quantities and tick precision independently of display precision', () => {
  const book=normalizeOrderBook([{price:100.001,size:0.000001}],[{price:100.002,size:1}],2,4)!;
  assert.equal(book.bids[0].price,100.001); assert.equal(book.bids[0].size,0.000001);
  assert.ok(book.spread>0);
});
test('rejects nonfinite, negative and malformed levels', () => {
  for (const price of [NaN,Infinity,-Infinity,-1,0]) assert.equal(normalizeOrderBook([{price,size:1}],[]),null);
  for (const size of [NaN,Infinity,-Infinity,-1]) assert.equal(normalizeOrderBook([{price:1,size}],[]),null);
});
test('rejects crossed or locked books rather than deleting inconvenient levels', () => {
  for (const ask of [99,100]) assert.equal(normalizeOrderBook([{price:100,size:1}],[{price:ask,size:1},{price:102,size:1}]),null);
});
test('zero levels and empty books cannot masquerade as liquid markets', () => {
  assert.equal(normalizeOrderBook([{price:1,size:0}],[]),null);
  const book=normalizeOrderBook([{price:1,size:1}],[])!;
  assert.equal(book.midPrice,0);
});
test('rejects cumulative overflow and preserves source timestamp', () => {
  assert.equal(normalizeOrderBook([{price:1,size:Number.MAX_VALUE},{price:2,size:Number.MAX_VALUE}],[]),null);
  assert.equal(normalizeOrderBook([{price:1,size:1}],[{price:2,size:1}],2,4,123)!.timestamp,123);
});
