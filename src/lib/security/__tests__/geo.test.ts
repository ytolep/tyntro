import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countryFromHeaders,
  isGeoBlocked,
  parseBlockedCountries,
  resolveTrustedCountryHeader,
} from '../geo';

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

test('resolveTrustedCountryHeader: GEO_COUNTRY_HEADER > VERCEL=1 > cf-ipcountry', () => {
  assert.equal(resolveTrustedCountryHeader({ GEO_COUNTRY_HEADER: 'cf-ipcountry' }), 'cf-ipcountry');
  assert.equal(resolveTrustedCountryHeader({ GEO_COUNTRY_HEADER: ' X-Country ' }), 'x-country');
  // Пустая/пробельная переменная — как не заданная.
  assert.equal(resolveTrustedCountryHeader({ GEO_COUNTRY_HEADER: ' ', VERCEL: '1' }), 'x-vercel-ip-country');
  assert.equal(resolveTrustedCountryHeader({ VERCEL: '1' }), 'x-vercel-ip-country');
  assert.equal(resolveTrustedCountryHeader({}), 'cf-ipcountry');
});

test('countryFromHeaders: только доверенный заголовок (в тестах без env — cf-ipcountry)', () => {
  const pick = (headers: Record<string, string>) =>
    countryFromHeaders((name) => headers[name] ?? null);
  assert.equal(pick({ 'cf-ipcountry': 'de' }), 'DE');
  // Чужой заголовок не читается — на своём сервере его шлёт сам клиент.
  assert.equal(pick({ 'x-vercel-ip-country': 'US' }), null, 'vercel-заголовок игнорируется');
  assert.equal(pick({ 'x-vercel-ip-country': 'US', 'cf-ipcountry': 'FR' }), 'FR');
  assert.equal(pick({ 'cf-ipcountry': 'XX' }), null, 'XX = страна неизвестна');
  assert.equal(pick({ 'cf-ipcountry': 'T1' }), null, 'T1 = Tor');
  assert.equal(pick({ 'cf-ipcountry': 'Russian Federation' }), null);
  assert.equal(pick({}), null, 'без заголовка страна неизвестна');
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
