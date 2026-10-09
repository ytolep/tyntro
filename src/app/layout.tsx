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

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Crypto prop trading on Solana`,
  description:
    'Prove your edge. Earn your capital. Trade crypto evaluations with static drawdown protection, build your Trader Score, and scale up to $100K.',
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
