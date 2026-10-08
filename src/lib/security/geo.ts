/**
 * Гео-блок: чистые функции выбора страны клиента и решения о блокировке.
 * Регионы (Крым и т.п.) по этим заголовкам не определяются — блокируется только страна.
 */

export const DEFAULT_BLOCKED_COUNTRIES = 'US,CU,IR,KP,SY,RU,BY';

// Cloudflare отдаёт XX для неизвестной страны и T1 для Tor — это не страны, блокировать по ним нельзя.
const NON_COUNTRY_CODES = new Set(['XX', 'T1']);

/** CSV кодов ISO-3166 alpha-2 из env → Set в верхнем регистре. Неверные коды отбрасываются. */
export function parseBlockedCountries(raw: string | null | undefined): Set<string> {
  const list = (raw ?? DEFAULT_BLOCKED_COUNTRIES)
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return new Set(list);
}

/**
 * Страна из заголовков платформы: x-vercel-ip-country (Vercel) приоритетнее cf-ipcountry (Cloudflare).
 * null = страна не определена (не блокируем).
 */
export function countryFromHeaders(get: (name: string) => string | null): string | null {
  for (const name of ['x-vercel-ip-country', 'cf-ipcountry']) {
    const value = get(name)?.trim().toUpperCase() ?? '';
    if (/^[A-Z]{2}$/.test(value) && !NON_COUNTRY_CODES.has(value)) return value;
  }
  return null;
}

// Публичные рыночные данные и сама заглушка доступны из любой страны.
const GEO_EXEMPT_PATHS = ['/api/phoenix', '/blocked'];

/** Блокировать ли путь для страны. Неизвестная страна (null) не блокируется. */
export function isGeoBlocked(
  pathname: string,
  country: string | null,
  blockedCountries: Set<string>,
): boolean {
  if (!country) return false;
  const exempt = GEO_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return !exempt && blockedCountries.has(country);
}
