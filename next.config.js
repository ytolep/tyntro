/** @type {import('next').NextConfig} */

// CSP: 'unsafe-inline'/'unsafe-eval' в script-src нужны самому Next.js
// (инлайн-бутстрап RSC, dev-HMR); кошельки-расширения браузера живут вне CSP страницы.
// wss: — WebSocket-подписки Phoenix и RPC.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  'connect-src ' +
    "'self' https://perp-api.phoenix.trade wss: https://*.helius-rpc.com https://api.mainnet-beta.solana.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
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
