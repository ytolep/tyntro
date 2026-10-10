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

// Приватные зоны (кабинет, оплата, админка, API) в индекс не отдаём.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/api',
          '/dashboard',
          '/history',
          '/profile',
          '/funded',
          '/risk',
          '/trader-score',
          '/checkout',
          '/blocked',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
