import type { MetadataRoute } from 'next';

// Домен как в src/lib/auth/siws.ts: APP_DOMAIN, иначе первый из APP_DOMAINS (CSV);
// без них — http://localhost:3000 (фолбэк для dev/тестов).
const domain = (
  process.env.APP_DOMAIN ||
  process.env.APP_DOMAINS?.split(',')[0] ||
  ''
)
  .trim()
  .toLowerCase();
const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain);
const SITE_URL = domain
  ? `${isLocal ? 'http' : 'https'}://${domain}`
  : 'http://localhost:3000';

// Публичные страницы продукта.
const PUBLIC_PATHS = [
  '/',
  '/challenges',
  '/terminal',
  '/leaderboard',
  '/rules',
  '/faq',
  '/terms',
  '/privacy',
  '/refunds',
  '/transparency',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: `${SITE_URL}${path}` }));
}
