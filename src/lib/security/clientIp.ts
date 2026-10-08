/**
 * IP клиента из доверенных заголовков (docs/REVIEW.md M2).
 * Порядок: заголовок платформы из env TRUSTED_IP_HEADER (cf-connecting-ip,
 * x-real-ip), затем x-forwarded-for — значение, добавленное самым дальним
 * доверенным прокси (TRUSTED_PROXY_COUNT от конца; 1 = последний элемент XFF).
 * Нет ни того, ни другого → 'unknown' (один бакет лимита на процесс).
 * ponytail: без знания адресов прокси XFF-значения принципиально спуфуемы прямым
 * клиентом — приемлемо для rate-limit; учет proxy-адресов, когда понадобится.
 */
export function clientIp(
  get: (name: string) => string | null,
  opts: { trustedIpHeader?: string | null; trustedProxyCount?: number } = {},
): string {
  const header = opts.trustedIpHeader?.trim();
  if (header) {
    const ip = get(header)?.trim();
    if (ip) return ip;
  }

  const count = Number.isInteger(opts.trustedProxyCount) && (opts.trustedProxyCount as number) > 0
    ? (opts.trustedProxyCount as number)
    : 1;
  const hops = (get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length) {
    // Счётчик прокси больше длины цепочки → левый элемент (допущение: сам клиент).
    return hops[Math.max(0, hops.length - count)];
  }
  return 'unknown';
}
