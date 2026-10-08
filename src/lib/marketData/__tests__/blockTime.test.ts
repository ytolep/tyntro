import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlockTimeResolver, SLOT_MS } from '../blockTime';

const BASE = 1_700_000_000;

test('resolves exact block time from RPC and caches it per slot', async () => {
  let now = 0;
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => { calls.push(slot); return BASE; }, () => now);
  assert.equal(await resolve(100), BASE * 1000);
  assert.equal(await resolve(100), BASE * 1000); // точное попадание в кэш, RPC не дёргается
  assert.deepEqual(calls, [100]);
});

test('estimates age from the RPC anchor at ~400 ms/slot without another RPC call', async () => {
  let now = 0;
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => { calls.push(slot); return BASE; }, () => now);
  assert.equal(await resolve(100), BASE * 1000);        // опорная точка получена из RPC
  now = 5_000;                                          // внутри 10-с окна: оценка, без RPC
  assert.equal(await resolve(125), (BASE + 25 * SLOT_MS / 1000) * 1000);
  assert.deepEqual(calls, [100]);
  now = 10_000;                                         // окно истекло — RPC снова разрешён
  assert.equal(await resolve(130), BASE * 1000);
  assert.deepEqual(calls, [100, 130]);
});

test('coalesces simultaneous resolves into a single RPC call', async () => {
  let now = 0;
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => {
    calls.push(slot); await new Promise(r => setTimeout(r, 5)); return BASE;
  }, () => now);
  const results = await Promise.all([resolve(200), resolve(201), resolve(202), resolve(203), resolve(204)]);
  assert.deepEqual(calls, [200]);                                     // один вызов на процесс
  assert.equal(results[0], BASE * 1000);                              // свой слот — точное время
  assert.equal(results[4], (BASE + 4 * SLOT_MS / 1000) * 1000);       // остальные — оценка от опорной точки
});

test('refuses to estimate when the anchor is older than 60 s and RPC fails', async () => {
  let now = 0;
  let rpcTime: number | null = BASE;
  const resolve = createBlockTimeResolver(async () => rpcTime, () => now);
  assert.equal(await resolve(100), BASE * 1000);       // опорная точка получена в t = 0
  now = 61_000; rpcTime = null;                        // опора старше 60 с, RPC не отвечает
  assert.equal(await resolve(150), null);              // fail-closed: без оценки
});

test('retries once with backoff on 429, gives up on other errors', async () => {
  let attempts = 0;
  const resolve = createBlockTimeResolver(async () => {
    attempts++;
    if (attempts === 1) throw new Error('429 Too Many Requests');
    return BASE;
  });
  assert.equal(await resolve(100), BASE * 1000);
  assert.equal(attempts, 2);                           // один повтор с коротким backoff
  let other = 0;
  const strict = createBlockTimeResolver(async () => { other++; throw new Error('ECONNRESET'); });
  assert.equal(await strict(100), null);               // не 429 — без повторов, fail-closed
  assert.equal(other, 1);
});
