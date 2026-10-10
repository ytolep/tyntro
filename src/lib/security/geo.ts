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
 * Единственный доверенный заголовок страны. Чужие (клиентские) заголовки не читаются:
 * на своём сервере x-vercel-ip-country может прислать любой клиент (см. deploy/Caddyfile).
 * GEO_COUNTRY_HEADER > VERCEL=1 (платформа Vercel сама ставит x-vercel-ip-country)
 * > cf-ipcountry (Cloudflare перед сервером).
 */
export function resolveTrustedCountryHeader(env: Record<string, string | undefined>): string {
  const explicit = env.GEO_COUNTRY_HEADER?.trim().toLowerCase();
  if (explicit) return explicit;
  return env.VERCEL === '1' ? 'x-vercel-ip-country' : 'cf-ipcountry';
}

// Фиксируется на старте процесса (как BLOCKED_COUNTRIES в proxy); смена env требует рестарта.
export const trustedCountryHeader = resolveTrustedCountryHeader(process.env);

/**
 * Страна из единственного доверенного заголовка (trustedCountryHeader).
 * null = страна не определена (не блокируем).
 */
export function countryFromHeaders(get: (name: string) => string | null): string | null {
  const value = get(trustedCountryHeader)?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(value) && !NON_COUNTRY_CODES.has(value) ? value : null;
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
