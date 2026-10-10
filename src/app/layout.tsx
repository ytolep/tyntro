import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { SolanaWalletContextProvider } from '@/components/SolanaWalletContextProvider';
import { MarketDataProvider } from '@/lib/marketData/MarketDataStore';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { BRAND_NAME } from '@/lib/brand';

// DM Sans (latin, variable, OFL) лежит в репо: сборка не ходит в fonts.googleapis.com
// (из docker он бывает недоступен), шрифт отдаётся с /_next/static/media, CSP font-src 'self' достаточна.
// Моноширинные подписи (eyebrow и т.п.) используют системный стек ui-monospace — веб-шрифт не нужен.
const dmSans = localFont({
  src: './fonts/DMSans-latin.woff2',
  weight: '100 1000',
  display: 'swap',
  variable: '--font-dm-sans',
});

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

const TITLE = `${BRAND_NAME} — Crypto prop trading on Solana`;
const DESCRIPTION =
  'Prove your edge. Earn your capital. Trade crypto evaluations with static drawdown protection, build your Trader Score, and scale up to $100K.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: BRAND_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${dmSans.variable}`}>
      <body className="bg-background text-white min-h-screen flex flex-col antialiased">
        <SolanaWalletContextProvider>
          <AuthProvider>
          <MarketDataProvider>
            <Navigation />
            <main className="flex-1">{children}</main>
            <Footer />
          </MarketDataProvider>
          </AuthProvider>
        </SolanaWalletContextProvider>
      </body>
    </html>
  );
}
