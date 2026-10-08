import type { Metadata } from 'next';
import './globals.css';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { SolanaWalletContextProvider } from '@/components/SolanaWalletContextProvider';
import { MarketDataProvider } from '@/lib/marketData/MarketDataStore';

export const metadata: Metadata = {
  title: 'PROJECT | Crypto Prop Trading Evaluation Platform',
  description: 'Prove your edge. Earn your capital. Trade crypto evaluations with static drawdown protection, build your Trader Score, and scale up to $100K.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-white min-h-screen flex flex-col antialiased">
        <SolanaWalletContextProvider>
          <MarketDataProvider>
            <Navigation />
            <main className="flex-1">{children}</main>
            <Footer />
          </MarketDataProvider>
        </SolanaWalletContextProvider>
      </body>
    </html>
  );
}
