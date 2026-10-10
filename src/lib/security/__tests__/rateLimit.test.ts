import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refill, tryTake, RateLimiter } from '../rateLimit';

// Лимит ордеров из proxy: 10/с, бёрст 20.
const ORDERS = { ratePerSec: 10, capacity: 20 };

test('бакет начинается полным: бёрст=capacity проходит, следующий отклонён', () => {
  let state: ReturnType<typeof tryTake>['state'] = { tokens: ORDERS.capacity, updatedAt: 0 };
  for (let i = 0; i < 20; i++) {
    const result = tryTake(state, 1000 + i, ORDERS);
    assert.equal(result.allowed, true, `запрос ${i + 1} из бёрста`);
    state = result.state;
  }
  assert.equal(tryTake(state, 1020, ORDERS).allowed, false, '21-й сразу после бёрста');
});

test('refill: ставка 10/с, потолок capacity, время в прошлом ничего не меняет', () => {
  const after1s = refill({ tokens: 0, updatedAt: 0 }, 1000, ORDERS);
  assert.ok(Math.abs(after1s.tokens - 10) < 1e-9);
  const capped = refill({ tokens: 0, updatedAt: 0 }, 60_000, ORDERS);
  assert.equal(capped.tokens, ORDERS.capacity);
  const unchanged = refill({ tokens: 3, updatedAt: 5000 }, 1000, ORDERS);
  assert.deepEqual(unchanged, { tokens: 3, updatedAt: 5000 });
});

test('ворота плана: 30 запросов в секунду → 429', () => {
  let state: ReturnType<typeof tryTake>['state'] = { tokens: ORDERS.capacity, updatedAt: 0 };
  let rejected = 0;
  // 30 запросов равномерно за 1000 мс: 20 из бёрста + ~9 догоняет refill — часть отклонена.
  for (let i = 0; i < 30; i++) {
    const result = tryTake(state, (i * 1000) / 30, ORDERS);
    if (!result.allowed) rejected++;
    state = result.state;
  }
  assert.ok(rejected > 0, 'хотя бы один из 30 за секунду отклонён');
});

test('ровно 10/с (запрос каждые 100 мс) не упирается в лимит', () => {
  let state: ReturnType<typeof tryTake>['state'] = { tokens: ORDERS.capacity, updatedAt: 0 };
  for (let i = 0; i < 200; i++) {
    const result = tryTake(state, i * 100, ORDERS);
    assert.equal(result.allowed, true, `запрос ${i} в ${(i * 100)} мс`);
    state = result.state;
  }
});

test('после исчерпания бакет пропускает запрос, когда токен восстановился', () => {
  let state: ReturnType<typeof tryTake>['state'] = { tokens: ORDERS.capacity, updatedAt: 0 };
  for (let i = 0; i < 20; i++) state = tryTake(state, 0, ORDERS).state;
  assert.equal(tryTake(state, 10, ORDERS).allowed, false, 'через 10 мс — 0.1 токена');
  assert.equal(tryTake(state, 120, ORDERS).allowed, true, 'через 120 мс — 1.2 токена');
});

test('RateLimiter: ключи независимы, неизвестный лимит — ошибка', () => {
  const limiter = new RateLimiter({ auth: { ratePerSec: 5, capacity: 5 } });
  for (let i = 0; i < 5; i++) assert.equal(limiter.consume('session:a', 'auth', 0), true);
  assert.equal(limiter.consume('session:a', 'auth', 10), false, 'шестой за секунду');
  assert.equal(limiter.consume('session:b', 'auth', 10), true, 'другой ключ не задет');
  assert.throws(() => limiter.consume('session:a', 'nope', 0), /Unknown rate limit/);
});

test('RateLimiter: после паузы бакет полностью восстанавливается', () => {
  const limiter = new RateLimiter({ orders: ORDERS });
  for (let i = 0; i < 20; i++) limiter.consume('ip:1', 'orders', 0);
  assert.equal(limiter.consume('ip:1', 'orders', 0), false);
  // capacity/rate = 2 с до полного восстановления.
  for (let i = 0; i < 20; i++) {
    assert.equal(limiter.consume('ip:1', 'orders', 3000 + i), true, `запрос ${i} после паузы`);
  }
});
