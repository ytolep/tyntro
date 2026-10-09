import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE58_SIG } from '../PayoutRowActions';

// Граница валидации подписи Solana в админке: base58 без 0/O/I/l, длина 64–88.
const sig = (c: string, n: number) => c.repeat(n);
const real = '5Kb8kQ7zXwYvN2mRtP9eJdTUfLhGy4sA1WCxvB6nM3oZpQrE7dFjHkSa2GvN9wKxT4mBqYpRcD';

test('base58 signature: принимает валидные 64–88', () => {
  assert.ok(BASE58_SIG.test(real));
  assert.ok(BASE58_SIG.test(sig('2', 64)));
  assert.ok(BASE58_SIG.test(sig('z', 88)));
});

test('base58 signature: отклоняет короткие, длинные и не-base58', () => {
  assert.ok(!BASE58_SIG.test(sig('2', 63)));
  assert.ok(!BASE58_SIG.test(sig('2', 89)));
  assert.ok(!BASE58_SIG.test(sig('0', 64))); // запрещённый алфавит
  assert.ok(!BASE58_SIG.test(sig('O', 64)));
  assert.ok(!BASE58_SIG.test(sig('l', 64)));
  assert.ok(!BASE58_SIG.test(sig('I', 64)));
  assert.ok(!BASE58_SIG.test('')); // пустая подпись не проходит
});
