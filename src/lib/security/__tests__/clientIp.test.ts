import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../clientIp';

// M2 (docs/REVIEW.md): IP только из доверенных источников, клиент не может
// спуфить своё значение, дописав его в начало x-forwarded-for.

const pick = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

test('TRUSTED_IP_HEADER: заголовок платформы приоритетнее XFF', () => {
  assert.equal(
    clientIp(pick({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }), { trustedIpHeader: 'cf-connecting-ip' }),
    '1.1.1.1',
  );
  // Заголовок задан в env, но отсутствует в запросе → просадка в XFF.
  assert.equal(
    clientIp(pick({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }), { trustedIpHeader: 'cf-connecting-ip' }),
    '203.0.113.7',
  );
});

test('XFF без env: один доверенный прокси → последний элемент (спуф начала не помогает)', () => {
  assert.equal(clientIp(pick({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })), '203.0.113.7');
  assert.equal(clientIp(pick({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
});

test('TRUSTED_PROXY_COUNT=2 → второй с конца XFF', () => {
  assert.equal(
    clientIp(pick({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' }), { trustedProxyCount: 2 }),
    '10.0.0.1',
  );
});

test('счётчик больше цепочки → левый элемент; мусорные env-значения → дефолт 1', () => {
  assert.equal(clientIp(pick({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }), { trustedProxyCount: 5 }), '9.9.9.9');
  assert.equal(clientIp(pick({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }), { trustedProxyCount: Number('') }), '8.8.8.8');
});

test('нет ни одного доверенного заголовка → unknown (один бакет на процесс)', () => {
  assert.equal(clientIp(pick({})), 'unknown');
});
