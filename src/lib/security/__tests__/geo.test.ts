import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryFromHeaders, isGeoBlocked, parseBlockedCountries } from '../geo';

test('parseBlockedCountries: дефолт, переопределение, мусор отбрасывается', () => {
  assert.deepEqual(
    [...parseBlockedCountries(undefined)].sort(),
    ['BY', 'CU', 'IR', 'KP', 'RU', 'SY', 'US'],
  );
  assert.deepEqual([...parseBlockedCountries('de, fr')].sort(), ['DE', 'FR']);
  // Парсер чисто синтаксический: 'xx' — валидный alpha-2 (нормализуется в XX и безвреден,
  // потому что countryFromHeaders XX не возвращает); '1a' и 'RUS' отбрасываются.
  assert.deepEqual([...parseBlockedCountries('xx, 1a, RUS')], ['XX']);
  assert.deepEqual([...parseBlockedCountries('RUS, ,')], []);
  assert.deepEqual([...parseBlockedCountries('')], []);
});

test('countryFromHeaders: vercel приоритетнее cf, XX/T1/мусор = null', () => {
  const pick = (headers: Record<string, string>) =>
    countryFromHeaders((name) => headers[name] ?? null);
  assert.equal(pick({ 'x-vercel-ip-country': 'US' }), 'US');
  assert.equal(pick({ 'cf-ipcountry': 'de' }), 'DE');
  assert.equal(pick({ 'x-vercel-ip-country': 'us', 'cf-ipcountry': 'FR' }), 'US');
  assert.equal(pick({ 'cf-ipcountry': 'XX' }), null, 'XX = страна неизвестна');
  assert.equal(pick({ 'cf-ipcountry': 'T1' }), null, 'T1 = Tor');
  assert.equal(pick({ 'cf-ipcountry': 'Russian Federation' }), null);
  assert.equal(pick({}), null);
});

test('isGeoBlocked: страна из списка блокируется, /api/* и страницы одинаково', () => {
  const blocked = parseBlockedCountries(null);
  assert.equal(isGeoBlocked('/terminal', 'US', blocked), true);
  assert.equal(isGeoBlocked('/', 'RU', blocked), true);
  assert.equal(isGeoBlocked('/api/orders', 'IR', blocked), true);
  assert.equal(isGeoBlocked('/api/auth/nonce', 'KP', blocked), true);
});

test('isGeoBlocked: /api/phoenix и /blocked исключены (включая подпути)', () => {
  const blocked = parseBlockedCountries(null);
  assert.equal(isGeoBlocked('/api/phoenix', 'US', blocked), false);
  assert.equal(isGeoBlocked('/api/phoenix/candles', 'CU', blocked), false);
  assert.equal(isGeoBlocked('/blocked', 'SY', blocked), false);
  // Префикс без слэша не является исключением.
  assert.equal(isGeoBlocked('/api/phoenix-internal', 'US', blocked), true);
});

test('isGeoBlocked: незаблокированная страна и страна null проходят', () => {
  const blocked = parseBlockedCountries(null);
  assert.equal(isGeoBlocked('/terminal', 'DE', blocked), false);
  assert.equal(isGeoBlocked('/api/orders', null, blocked), false, 'страна не определена');
});

test('isGeoBlocked: кастомный список из env', () => {
  const blocked = parseBlockedCountries('fr');
  assert.equal(isGeoBlocked('/terminal', 'FR', blocked), true);
  assert.equal(isGeoBlocked('/terminal', 'US', blocked), false, 'US больше не в списке');
});
