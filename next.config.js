/** @type {import('next').NextConfig} */

// CSP: 'unsafe-inline'/'unsafe-eval' в script-src нужны самому Next.js
// (инлайн-бутстрап RSC, dev-HMR); кошельки-расширения браузера живут вне CSP страницы.
// WebSocket-хосты перечислены явно (никакого wildcard wss: — канал эксфильтрации).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  'connect-src ' +
    "'self' https://perp-api.phoenix.trade wss://perp-api.phoenix.trade " +
    'https://*.helius-rpc.com wss://*.helius-rpc.com https://api.mainnet-beta.solana.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // HSTS только в production: локально http, а браузер запомнит https-форс надолго.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

module.exports = {
  output: 'standalone', // Docker-образ (server.js)
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
