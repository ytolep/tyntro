import { NextRequest, NextResponse } from 'next/server';
import { countryFromHeaders, isGeoBlocked, parseBlockedCountries } from '@/lib/security/geo';
import { RateLimiter } from '@/lib/security/rateLimit';

// Список стран фиксируется на старте процесса; смена env требует рестарта.
const blockedCountries = parseBlockedCountries(process.env.BLOCKED_COUNTRIES);

// ponytail: in-memory лимиты — считаются в рамках одного процесса, см. src/lib/security/rateLimit.ts.
const limiter = new RateLimiter({
  orders: { ratePerSec: 10, capacity: 20 },
  auth: { ratePerSec: 5, capacity: 5 },
});

// 'props_session' = SESSION_COOKIE из src/lib/auth/session.ts.
// Модуль сессий не импортируем: он тянет Prisma, которая недоступна в edge-runtime.
const SESSION_COOKIE = 'props_session';

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Гео-блок: /api/phoenix (публичные рыночные данные) и /blocked исключены.
  const country = countryFromHeaders((name) => req.headers.get(name));
  if (isGeoBlocked(pathname, country, blockedCountries)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unavailable in your region' }, { status: 451 });
    }
    return NextResponse.redirect(new URL('/blocked', req.url));
  }

  const limitName =
    pathname === '/api/orders' && req.method === 'POST'
      ? 'orders'
      : pathname.startsWith('/api/auth/')
        ? 'auth'
        : null;
  if (limitName) {
    const session = req.cookies.get(SESSION_COOKIE)?.value;
    const key = `${limitName}:${session ?? clientKey(req)}`;
    if (!limiter.consume(key, limitName, Date.now())) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '1' } },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  // Всё, кроме статики Next.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
