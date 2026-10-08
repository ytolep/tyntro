'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Market, MarketSnapshot, ConnectionStatus, isFreshSnapshot } from './types';
import { PhoenixSpotAdapter } from './adapters/PhoenixSpotAdapter';
import { PhoenixPerpAdapter } from './adapters/PhoenixPerpAdapter';
import { pollMarket } from './pollMarket';
import { DEFAULT_MARKET } from './markets';

function useMarketDataState() {
  const [selectedMarket, setSelectedMarket] = useState<Market>(DEFAULT_MARKET);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [now, setNow] = useState(Date.now());
  const selectMarket = useCallback((symbol: string) => {
    const market = markets.find(m => m.symbol === symbol);
    if (market) { setSnapshot(null); setSelectedMarket(market); setConnectionStatus('connecting'); }
  }, [markets]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const res = await fetch('/api/phoenix?action=markets', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!res.ok) throw new Error('Catalogue unavailable');
        const list: Market[] = await res.json();
        if (!Array.isArray(list) || !list.length) throw new Error('Empty catalogue');
        if (stopped) return;
        setMarkets(list); setMarketsError(null);
        setSelectedMarket(previous => { const next = list.find(m => m.symbol === previous.symbol) || list.find(m => m.symbol === 'SOL-PERP') || list[0]; return JSON.stringify(previous) === JSON.stringify(next) ? previous : next; });
      } catch { if (!stopped) { setMarkets([]); setMarketsError('Phoenix market list unavailable. Retrying…'); } } // M1: снапшот не стираем — он живёт, пока свеж по isFreshSnapshot
      finally { if (!stopped) { setMarketsLoading(false); timer = setTimeout(refresh, 30000); } }
    };
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    setSnapshot(null);
    if (!markets.length) { setConnectionStatus('disconnected'); return; }
    const adapter = selectedMarket.type === 'spot' ? new PhoenixSpotAdapter(selectedMarket) : new PhoenixPerpAdapter(selectedMarket);
    return pollMarket(selectedMarket.symbol, signal => adapter.fetchSnapshot(signal), setSnapshot, setConnectionStatus);
  }, [selectedMarket, markets.length]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const fresh = snapshot && isFreshSnapshot(snapshot, selectedMarket.symbol, Math.max(now, Date.now())) ? snapshot : null;
  return { selectedMarket: fresh?.market ?? selectedMarket, markets, marketsError, marketsLoading,
    snapshot: fresh, orderBook: fresh?.orderBook ?? null, ticker: fresh?.ticker ?? null,
    connectionStatus: snapshot && !fresh ? 'error' as ConnectionStatus : connectionStatus,
    selectMarket, useMockData: false };
}
const MarketDataContext = createContext<ReturnType<typeof useMarketDataState> | null>(null);
export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const value = useMarketDataState();
  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
}
export function useMarketData() {
  const context = useContext(MarketDataContext);
  if (!context) throw new Error('MarketDataProvider is required');
  return context;
}
