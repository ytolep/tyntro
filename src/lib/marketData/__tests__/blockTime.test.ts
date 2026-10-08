import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHOR_SLOT_OFFSET, createBlockTimeResolver, SLOT_MS } from '../blockTime';

const BASE = 1_700_000_000;
/** Оценка для слота slot, когда опора получена запросом по самому этому слоту (slot-32). */
const estimateFromOwnAnchor = (slot: number) =>
  (BASE + slot - ANCHOR_SLOT_OFFSET + ANCHOR_SLOT_OFFSET * SLOT_MS / 1000) * 1000;

test('запрашивает время слота slot-32, от него оценивает свежий слот и кэширует опору', async () => {
  let now = 0;
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => { calls.push(slot); return BASE + slot; }, () => now);
  assert.equal(await resolve(200), estimateFromOwnAnchor(200));   // опора от slot-32, оценка свежего слота
  assert.deepEqual(calls, [200 - ANCHOR_SLOT_OFFSET]);
  assert.equal(await resolve(200), estimateFromOwnAnchor(200));   // повтор — из кэша, без RPC
  assert.deepEqual(calls, [200 - ANCHOR_SLOT_OFFSET]);
  now = 5_000;                                                    // внутри 10-с окна: оценка, без RPC
  assert.equal(await resolve(225), (BASE + 168 + 57 * SLOT_MS / 1000) * 1000);
  assert.deepEqual(calls, [200 - ANCHOR_SLOT_OFFSET]);
  now = 10_000;                                                   // окно истекло — RPC снова разрешён
  assert.equal(await resolve(230), estimateFromOwnAnchor(230));
  assert.deepEqual(calls, [200 - ANCHOR_SLOT_OFFSET, 230 - ANCHOR_SLOT_OFFSET]);
});

test('коалесирует одновременные запросы в один RPC-вызов', async () => {
  let now = 0;
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => {
    calls.push(slot); await new Promise(r => setTimeout(r, 5)); return BASE + slot;
  }, () => now);
  const results = await Promise.all([resolve(200), resolve(201), resolve(202), resolve(203), resolve(204)]);
  assert.deepEqual(calls, [200 - ANCHOR_SLOT_OFFSET]);            // один вызов на процесс
  assert.equal(results[0], estimateFromOwnAnchor(200));           // своя опора — точная оценка
  assert.equal(results[4], (BASE + 168 + 36 * SLOT_MS / 1000) * 1000); // соседний слот — от той же опоры
});

test('отказывается оценивать, когда опора старше 60 с, а RPC не отвечает', async () => {
  let now = 0;
  let rpcTime: number | null = BASE;
  const resolve = createBlockTimeResolver(async () => rpcTime, () => now);
  // стаб возвращает константу BASE для slot-32 → оценка = BASE + 32 слота
  assert.equal(await resolve(100), (BASE + ANCHOR_SLOT_OFFSET * SLOT_MS / 1000) * 1000);
  now = 61_000; rpcTime = null;                                   // опора старше 60 с, RPC не отвечает
  assert.equal(await resolve(150), null);                         // fail-closed: без оценки
});

test('null или ошибка RPC не блокируют повтор на 10 с', async () => {
  let now = 0;
  let mode = 0; // 0 — ошибка, 1 — null, 2 — успех
  const calls: number[] = [];
  const resolve = createBlockTimeResolver(async slot => {
    calls.push(slot);
    if (mode === 0) throw new Error('RPC 503');
    if (mode === 1) return null;
    return BASE + slot;
  }, () => now);
  assert.equal(await resolve(100), null);                         // публичный RPC упал
  now = 1_500; mode = 1;                                          // повтор уже через 1,5 с, не через 10
  assert.equal(await resolve(130), null);                         // опоры нет — fail-closed
  assert.deepEqual(calls, [100 - ANCHOR_SLOT_OFFSET, 130 - ANCHOR_SLOT_OFFSET]);
  now = 2_500; mode = 2;                                          // RPC ожил — опора от slot-32
  assert.equal(await resolve(130), estimateFromOwnAnchor(130));
});

test('повторяет один раз с задержкой на 429, на других ошибках сдаётся', async () => {
  let attempts = 0;
  const resolve = createBlockTimeResolver(async slot => {
    attempts++;
    if (attempts === 1) throw new Error('429 Too Many Requests');
    return BASE + slot;
  });
  assert.equal(await resolve(100), estimateFromOwnAnchor(100));
  assert.equal(attempts, 2);                                      // один повтор с короткой задержкой
  let other = 0;
  const strict = createBlockTimeResolver(async () => { other++; throw new Error('ECONNRESET'); });
  assert.equal(await strict(100), null);                          // не 429 — без повторов, fail-closed
  assert.equal(other, 1);
});
