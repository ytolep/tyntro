'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { 
  TrendingUp, 
  TrendingDown, 
  ShieldAlert, 
  Zap, 
  Check, 
  AlertTriangle, 
  X,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Info,
  ChevronDown,
  Sliders,
  Crosshair,
  Pencil,
  Type,
  Maximize2,
  Settings,
  HelpCircle,
  Clock,
  ArrowUpDown,
  Lock,
  Trash2,
  FileText,
  Search
} from 'lucide-react';
import { useMarketData } from '@/lib/marketData/MarketDataStore';

// Dynamically import TradingViewChart with SSR disabled
const TradingViewChart = dynamic(() => import('@/components/TradingViewChart'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[490px] bg-[#09090d] flex items-center justify-center text-xs text-gray-400 font-mono space-x-2 border border-[#25252e]">
      <Loader2 className="w-4 h-4 animate-spin text-[#8ff0cc]" />
      <span>Loading Phoenix chart...</span>
    </div>
  ),
});

export default function TerminalPage() {
  const {
    selectedMarket,
    snapshot,
    markets,
    marketsError,
    marketsLoading,
    orderBook,
    ticker,
    connectionStatus,
    selectMarket,
  } = useMarketData();

  const selectedSymbol = selectedMarket.symbol;
  const [timeframe, setTimeframe] = useState<string>('5m');
  const [orderMode, setOrderMode] = useState<'Market' | 'Limit'>('Limit');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  
  // Market Dropdown Menu State
  const [showSymbolDropdown, setShowSymbolDropdown] = useState<boolean>(false);
  const [marketSearch, setMarketSearch] = useState<string>('');

  // Order inputs
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [sizeUsd, setSizeUsd] = useState<number>(2000);
  const [leverage, setLeverage] = useState<number>(3);
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  const [tpSl, setTpSl] = useState<boolean>(false);

  // Bottom Tabs State
  const [activeTab, setActiveTab] = useState<'positions' | 'openOrders' | 'tradeHistory' | 'orderHistory' | 'fundingHistory'>('positions');

  // Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Account Data
  const [accountData, setAccountData] = useState<any>(null);
  const [loadingAccount, setLoadingAccount] = useState<boolean>(true);
  const [executing, setExecuting] = useState<boolean>(false);

  const currentMarkPrice = snapshot?.referencePrice ?? 0;
  const bookMidPrice = snapshot?.orderBook.midPrice ?? 0;
  const [limitPriceEdited, setLimitPriceEdited] = useState(false);

  useEffect(() => { setLimitPrice(0); setLimitPriceEdited(false); }, [selectedSymbol]);
  useEffect(() => {
    if (!limitPriceEdited && currentMarkPrice > 0) setLimitPrice(currentMarkPrice);
  }, [selectedSymbol, currentMarkPrice, limitPriceEdited]);

  // Load account data
  const loadAccount = async () => {
    try {
      const res = await fetch(activeAccountUrl());
      const json = await res.json();
      if (json.account) {
        setAccountData(json);
        localStorage.setItem('activeAccountId', json.account.id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAccount(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, []);

  // Periodic Trigger Check for Pending Limit Orders
  useEffect(() => {
    if (!accountData?.execution?.canTrade) return;
    const checkLimitOrders = async () => {
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          accountId: accountData?.account?.id,
            action: 'CHECK_LIMIT_ORDERS',
            symbol: selectedSymbol,
          }),
        });
        const json = await res.json();
        if (json.triggeredCount > 0) {
          showToast(`Limit Order Triggered & Position Blended!`, 'success');
          await loadAccount();
        }
      } catch (e) {
        // silent check
      }
    };

    const interval = setInterval(checkLimitOrders, 3000);
    return () => clearInterval(interval);
  }, [selectedSymbol, accountData?.account?.id, accountData?.execution?.canTrade]);

  // Handle Order Submit
  const handlePlaceOrder = async () => {
    setExecuting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: accountData?.account?.id,
          action: 'OPEN_POSITION',
          symbol: selectedSymbol,
          side,
          orderMode,
          limitPrice,
          sizeUsd,
          leverage,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to place order');

      if (json.status === 'PENDING_LIMIT_ORDER') {
        showToast(json.message || `Limit order placed at $${limitPrice}`, 'info');
      } else {
        showToast(json.message || `Position blended for ${selectedSymbol}`, 'success');
      }

      await loadAccount();
    } catch (err: any) {
      showToast(err.message || 'Order execution failed', 'error');
    } finally {
      setExecuting(false);
    }
  };

  // Cancel Pending Limit Order
  const handleCancelOrder = async (orderId: string) => {
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: accountData?.account?.id,
          action: 'CANCEL_ORDER',
          orderId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to cancel order');

      showToast('Limit Order Cancelled', 'info');
      await loadAccount();
    } catch (err: any) {
      showToast(err.message || 'Cancel failed', 'error');
    }
  };

  // Close position
  const handleClosePosition = async (positionId: string, symbol: string) => {
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: accountData?.account?.id,
          action: 'CLOSE_POSITION',
          positionId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to close position');

      showToast(`Position Closed for ${symbol}. Realized PnL: $${json.realizedPnL.toFixed(2)}`, json.realizedPnL >= 0 ? 'success' : 'error');
      await loadAccount();
    } catch (err: any) {
      showToast(err.message || 'Close position failed', 'error');
    }
  };

  // Calculations for Order Breakdown
  const estLiqPrice =
    side === 'LONG'
      ? (orderMode === 'Limit' ? limitPrice : currentMarkPrice) * (1 - 0.85 / leverage)
      : (orderMode === 'Limit' ? limitPrice : currentMarkPrice) * (1 + 0.85 / leverage);
  const marginRequired = sizeUsd / leverage;
  const estFee = sizeUsd * 0.00035;

  // Filtered Lists for Bottom Tabs
  const openPositions = accountData?.account?.positions || [];
  const openOrders = (accountData?.account?.orders || []).filter((o: any) => o.status === 'OPEN');
  const fillsHistory = accountData?.account?.fills || [];
  const orderHistory = accountData?.account?.orders || [];
  
  // Funding is unavailable until the accounting engine records actual events.
  const fundingHistory: { id: string; time: string; symbol: string; size: number; rate: string; payment: number }[] = [];

  const filteredMarkets = useMemo(() => {
    return markets.filter((m) =>
      m.symbol.toLowerCase().includes(marketSearch.toLowerCase()) ||
      m.baseAsset.toLowerCase().includes(marketSearch.toLowerCase()) ||
      m.name?.toLowerCase().includes(marketSearch.toLowerCase())
    );
  }, [markets, marketSearch]);

  if (accountData && accountData.execution?.provider !== 'SIMULATOR') return <FundedWorkspace/>;

  return (
    <div className="trading-terminal min-h-screen bg-[#09090d] text-gray-200 font-mono flex flex-col justify-between selection:bg-[#8ff0cc] selection:text-black">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-16 right-6 z-50 p-4 rounded-xl border font-mono text-xs flex items-center space-x-3 shadow-2xl animate-in slide-in-from-top-4 ${
          toast.type === 'success' ? 'bg-[#0A1F18] border-[#8ff0cc] text-[#8ff0cc]' :
          toast.type === 'error' ? 'bg-[#2A0F12] border-[#ef8390] text-[#ef8390]' :
          'bg-[#101015] border-cyan-400 text-cyan-400'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
          <span className="font-bold">{toast.message}</span>
        </div>
      )}

      {accountData?.execution && <AccountModeNotice execution={accountData.execution}/>}
      <div className="terminal-title"><span className="eyebrow">THE TRADING DESK</span><span>Real market data <i/> Simulated execution</span></div>
      {/* TOP PHOENIX HEADER BANNER */}
      <div className="bg-[#101015] border-b border-[#25252e] px-4 py-2 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="terminal-market-summary flex items-center space-x-6">
          {/* Phoenix Symbol Selector Dropdown */}
          <div className="relative border-r border-[#25252e] pr-6">
            <button
              onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
              className="flex items-center space-x-2 bg-[#19191f] hover:bg-[#292930] px-3 py-1.5 rounded-lg border border-[#292930] transition-colors"
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#ef8390] to-[#8ff0cc] flex items-center justify-center text-white text-[10px] font-black">
                {selectedMarket.baseAsset.charAt(0)}
              </div>
              <span className="text-sm font-extrabold text-white tracking-wide">{selectedMarket.symbol}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                selectedMarket.type === 'spot' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'bg-purple-950 text-purple-400 border border-purple-800'
              }`}>
                {selectedMarket.type}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {/* Dropdown Menu for All Phoenix Markets */}
            {showSymbolDropdown && (
              <div className="absolute top-11 left-0 z-50 w-72 bg-[#101015] border border-[#25252e] rounded-xl shadow-2xl p-2 space-y-2 font-mono text-xs">
                <div className="flex items-center bg-[#19191f] px-2.5 py-1.5 rounded-lg border border-[#292930]">
                  <Search className="w-3.5 h-3.5 text-gray-500 mr-2" />
                  <input
                    type="text"
                    placeholder="Search Phoenix Market..."
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    className="w-full bg-transparent text-white focus:outline-none text-xs"
                  />
                </div>

                <div className="px-2 py-2 text-[10px] text-gray-400" role="status">{marketsLoading ? 'Loading Phoenix markets…' : marketsError || `Phoenix Trade · ${markets.length} markets`}</div>
                {!marketsLoading && !marketsError && !filteredMarkets.length && <p className="p-2 text-gray-400">No matching markets</p>}
                <div className="max-h-60 overflow-y-auto space-y-1 no-scrollbar">
                  {filteredMarkets.map((market) => {
                    const isSelected = selectedMarket.symbol === market.symbol;
                    return (
                      <button
                        key={market.symbol}
                        onClick={() => {
                          selectMarket(market.symbol);
                          setShowSymbolDropdown(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                          isSelected ? 'bg-[#19191f] text-white border border-[#8ff0cc]/30' : 'hover:bg-[#19191f] text-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-bold">{market.symbol}<small className="block font-normal text-gray-400">{market.name}{market.status !== 'active' ? ` · ${market.status}` : ''}</small></span>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          market.type === 'spot' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'bg-purple-950 text-purple-400 border border-purple-800'
                        }`}>
                          {market.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Header Stats Bar */}
          <div className="terminal-market-stats flex items-center space-x-6 text-gray-400">
            <div>
              <span className="text-gray-500 text-[10px] block">{selectedMarket.type === 'perp' ? 'Mark' : 'Book midpoint'}</span>
              <span className="text-white font-bold">
                {currentMarkPrice > 0 ? `$${currentMarkPrice.toLocaleString('en-US', { minimumFractionDigits: selectedMarket.priceDecimals || 2, maximumFractionDigits: selectedMarket.priceDecimals || 2 })}` : 'N/A'}
              </span>
            </div>

            {selectedMarket.type === 'perp' && (
              <div>
                <span className="text-gray-500 text-[10px] block">Index Price</span>
                <span className="text-white font-bold">
                  {ticker?.indexPrice ? `$${ticker.indexPrice.toLocaleString('en-US', { minimumFractionDigits: selectedMarket.priceDecimals || 2, maximumFractionDigits: selectedMarket.priceDecimals || 2 })}` : 'N/A'}
                </span>
              </div>
            )}

            <div>
              <span className="text-gray-500 text-[10px] block">24h Change</span>
              <span className={`font-bold ${(ticker?.change24h ?? 0) >= 0 ? 'text-[#8ff0cc]' : 'text-[#ef8390]'}`}>
                {ticker?.change24h !== null && ticker?.change24h !== undefined
                  ? `${ticker.change24h >= 0 ? '+' : ''}${ticker.change24h.toFixed(2)}%`
                  : 'N/A'}
              </span>
            </div>

            <div className="hidden xl:block">
              <span className="text-gray-500 text-[10px] block">24h Volume</span>
              <span className="text-gray-200 font-bold">
                {ticker?.volume24h ? `$${(ticker.volume24h / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K` : 'N/A'}
              </span>
            </div>

            {selectedMarket.type === 'perp' && (
              <div className="hidden xl:block">
                <span className="text-gray-500 text-[10px] block">Open Interest</span>
                <span className="text-gray-200 font-bold">
                  {ticker?.openInterest ? `$${(ticker.openInterest / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K` : 'N/A'}
                </span>
              </div>
            )}

            {selectedMarket.type === 'perp' && (
              <div className="hidden 2xl:block">
                <span className="text-gray-500 text-[10px] block">1h Funding</span>
                <span className="text-[#8ff0cc] font-bold">
                  {ticker?.fundingRate !== null && ticker?.fundingRate !== undefined ? `${(ticker.fundingRate * 100).toFixed(4)}%` : 'N/A'}
                  {ticker?.fundingTimeLeft && <span className="text-gray-500 font-normal ml-1">{ticker.fundingTimeLeft}</span>}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Info / Connection Status */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-[#19191f] px-3 py-1 rounded-md border border-[#292930]">
            <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#8ff0cc] animate-pulse' : 'bg-amber-500'}`} />
            <span className="text-gray-200 font-bold text-[11px]">
              {selectedMarket.type === 'spot' ? 'Phoenix Spot' : 'Phoenix Perps'} ({connectionStatus})
            </span>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT: TRADINGVIEW CHART (LEFT) + ORDERBOOK (MIDDLE) + ORDER FORM (RIGHT) */}
      <div className="terminal-grid">
        {/* LEFT COLUMN: TRADINGVIEW CHART (7 COLS - FULL HEIGHT EXPANDED) */}
        <div className="terminal-chart bg-[#101015] border border-[#25252e] rounded-lg overflow-hidden flex flex-col h-full min-h-[490px]">
          <div className="w-full h-full min-h-[490px] flex-grow">
            <TradingViewChart key={selectedSymbol} symbol={selectedSymbol} timeframe={timeframe} />
          </div>
        </div>

        {/* MIDDLE COLUMN: PHOENIX LIVE ORDERBOOK (2 COLS) */}
        <div className="terminal-book bg-[#101015] border border-[#25252e] rounded-lg p-3 flex flex-col justify-between font-mono text-xs h-full min-h-[490px]">
          <div>
            {/* Orderbook Header Selector */}
            <div className="flex justify-between items-center text-gray-400 mb-3 pb-2 border-b border-[#25252e]">
              <div className="flex items-center space-x-1">
                <span className="text-white font-bold">L2</span>
                <ChevronDown className="w-3 h-3" />
              </div>
              <span className="font-bold text-gray-300">{selectedMarket.quoteAsset}</span>
              <Sliders className="w-3.5 h-3.5 text-gray-500" />
            </div>

            <div className="mb-3 text-[10px] text-gray-400 space-y-1">
              <div>{selectedMarket.type === 'perp' ? 'Phoenix Perps · live L2' : 'Phoenix Spot · on-chain L2'}</div>
              <div>{snapshot ? `Source slot ${snapshot.slot.toLocaleString()} · refreshed every 2.5s` : 'Waiting for verified source data'}</div>
            </div>
            {/* Table Column Headers */}
            <div className="grid grid-cols-3 text-[10px] text-gray-500 mb-2">
              <span>Price {selectedMarket.quoteAsset}</span>
              <span className="text-right">Size ({selectedMarket.baseAsset})</span>
              <span className="text-right">Total</span>
            </div>

            {/* ASKS & BIDS / ORDERBOOK STATE */}
            {!orderBook || (orderBook.asks.length === 0 && orderBook.bids.length === 0) ? (
              <div className="py-20 flex flex-col items-center justify-center text-gray-500 font-mono text-center space-y-2">
                <AlertTriangle className="w-6 h-6 text-amber-500 mb-1 animate-pulse" />
                <span className="text-xs font-bold text-gray-300">Order book unavailable</span>
                <span className="text-[10px] text-gray-500">Source unavailable, stale, or empty</span>
              </div>
            ) : (
              <>
                {/* ASKS (RED ROWS ON TOP) */}
                <div className="space-y-1">
                  {[...orderBook.asks].slice(0, 7).reverse().map((row, idx) => (
                    <div key={idx} className="grid grid-cols-3 text-[11px] relative items-center hover:bg-[#ef8390]/10 py-0.5">
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-[#ef8390]/15 pointer-events-none"
                        style={{ width: `${row.depthPct || 0}%` }}
                      />
                      <span className="text-[#ef8390] font-bold z-10">${row.price.toFixed(selectedMarket.priceDecimals || 2)}</span>
                      <span className="text-right text-gray-300 z-10">{row.size.toLocaleString(undefined, { maximumFractionDigits: selectedMarket.quantityDecimals || 4 })}</span>
                      <span className="text-right text-gray-400 z-10">{(row.total || row.size).toLocaleString(undefined, { maximumFractionDigits: selectedMarket.quantityDecimals || 4 })}</span>
                    </div>
                  ))}
                </div>

                {/* SPREAD BAR IN MIDDLE */}
                <div className="my-3 py-2 px-2 bg-[#19191f] border border-[#292930] rounded flex justify-between items-center text-xs">
                  <span className="font-extrabold text-white">
                    ${(orderBook.midPrice || currentMarkPrice).toLocaleString('en-US', { minimumFractionDigits: selectedMarket.priceDecimals ?? 2, maximumFractionDigits: selectedMarket.priceDecimals ?? 2 })}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    Spread <strong className="text-gray-200">{orderBook.spreadPct > 0 ? `${orderBook.spreadPct.toFixed(3)}%` : '$' + orderBook.spread}</strong>
                  </span>
                </div>

                {/* BIDS (GREEN ROWS BELOW) */}
                <div className="space-y-1">
                  {orderBook.bids.slice(0, 7).map((row, idx) => (
                    <div key={idx} className="grid grid-cols-3 text-[11px] relative items-center hover:bg-[#8ff0cc]/10 py-0.5">
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-[#8ff0cc]/15 pointer-events-none"
                        style={{ width: `${row.depthPct || 0}%` }}
                      />
                      <span className="text-[#8ff0cc] font-bold z-10">${row.price.toFixed(selectedMarket.priceDecimals || 2)}</span>
                      <span className="text-right text-gray-300 z-10">{row.size.toLocaleString(undefined, { maximumFractionDigits: selectedMarket.quantityDecimals || 4 })}</span>
                      <span className="text-right text-gray-400 z-10">{(row.total || row.size).toLocaleString(undefined, { maximumFractionDigits: selectedMarket.quantityDecimals || 4 })}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: PHOENIX ORDER ENTRY PANEL (3 COLS) */}
        <div className="terminal-order bg-[#101015] border border-[#25252e] rounded-lg p-4 flex flex-col justify-between font-mono text-xs h-full min-h-[490px]">
          <div>
            {/* Market / Limit / Advanced Tabs */}
            <div className="grid grid-cols-2 gap-1 bg-[#19191f] p-1 rounded-lg border border-[#292930] mb-4 text-center">
              {(['Market', 'Limit'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setOrderMode(mode)}
                  className={`py-1.5 rounded font-bold transition-colors ${
                    orderMode === mode ? 'bg-[#34323f] text-white border border-[#8ff0cc]/30' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Long/Buy vs Short/Sell Large Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={() => setSide('LONG')}
                className={`py-3 rounded-lg font-extrabold text-xs transition-all ${
                  side === 'LONG'
                    ? 'bg-[#8ff0cc] text-black shadow-lg shadow-[#8ff0cc]/20'
                    : 'bg-[#19191f] text-gray-400 border border-[#292930] hover:text-white'
                }`}
              >
                Long/Buy
              </button>
              <button
                onClick={() => setSide('SHORT')}
                className={`py-3 rounded-lg font-extrabold text-xs transition-all ${
                  side === 'SHORT'
                    ? 'bg-[#ef8390] text-white shadow-lg shadow-[#ef8390]/20'
                    : 'bg-[#19191f] text-gray-400 border border-[#292930] hover:text-white'
                }`}
              >
                Short/Sell
              </button>
            </div>

            {/* Available Capital */}
            <div className="flex justify-between text-gray-400 mb-4 text-[11px]">
              <span>Available to Trade</span>
              <span className="text-white font-bold">
                ${accountData?.account?.currentEquity ? accountData.account.currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
              </span>
            </div>

            {/* Limit Price Input */}
            {orderMode === 'Limit' && (
              <div className="space-y-1 mb-4">
                <div className="flex justify-between text-gray-400 text-[11px]">
                  <span>Limit Price</span>
                  <button onClick={() => { setLimitPriceEdited(true); setLimitPrice(bookMidPrice); }} disabled={!bookMidPrice} className="text-[#8ff0cc] font-bold disabled:opacity-40">MID</button>
                </div>
                <div className="flex items-center bg-[#19191f] border border-[#292930] rounded-lg px-3 py-2">
                  <span className="text-gray-500 mr-2">$</span>
                  <input
                    type="number"
                    value={limitPrice}
                    onChange={(e) => { setLimitPriceEdited(true); setLimitPrice(Number(e.target.value)); }}
                    className="w-full bg-transparent text-white font-bold focus:outline-none"
                  />
                  <span className="text-gray-400 text-[10px]">USDC</span>
                </div>
              </div>
            )}

            {/* Order Size Input */}
            <div className="space-y-1 mb-4">
              <div className="flex justify-between text-gray-400 text-[11px]">
                <span>Order Size</span>
                <span className="text-white font-bold">${sizeUsd.toLocaleString()}</span>
              </div>
              <div className="flex items-center bg-[#19191f] border border-[#292930] rounded-lg px-3 py-2">
                <input
                  type="number"
                  value={sizeUsd}
                  onChange={(e) => setSizeUsd(Number(e.target.value))}
                  className="w-full bg-transparent text-white font-bold focus:outline-none"
                />
                <span className="text-gray-400 text-[10px]">USDC</span>
              </div>

              {/* Size Slider */}
              <div className="pt-2 space-y-1">
                <input
                  type="range"
                  min="500"
                  max="50000"
                  step="500"
                  value={sizeUsd}
                  onChange={(e) => setSizeUsd(Number(e.target.value))}
                  className="w-full accent-[#8ff0cc] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <button onClick={() => setSizeUsd(2500)}>25%</button>
                  <button onClick={() => setSizeUsd(5000)}>50%</button>
                  <button onClick={() => setSizeUsd(7500)}>75%</button>
                  <button onClick={() => setSizeUsd(10000)} className="text-[#8ff0cc] font-bold">MAX</button>
                </div>
              </div>
            </div>

            {/* Leverage selector */}
            <div className="space-y-1 mb-5">
              <div className="flex justify-between text-gray-400 text-[11px]">
                <span>Order Leverage</span>
                <span className="text-[#8ff0cc] font-bold">{leverage}×</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full accent-[#8ff0cc] cursor-pointer"
              />
            </div>

            {/* Checkboxes */}
            <div className="space-y-2 mb-6 text-[11px] text-gray-300">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  disabled
                  checked={reduceOnly}
                  onChange={(e) => setReduceOnly(e.target.checked)}
                  className="rounded border-[#292930] bg-[#19191f] text-[#8ff0cc] focus:ring-0"
                />
                <span>Reduce Only · coming later</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  disabled
                  checked={tpSl}
                  onChange={(e) => setTpSl(e.target.checked)}
                  className="rounded border-[#292930] bg-[#19191f] text-[#8ff0cc] focus:ring-0"
                />
                <span>Take Profit / Stop Loss · coming later</span>
              </label>
            </div>
          </div>

          {/* Action Button & Breakdown */}
          <div className="space-y-4">
            <button
              onClick={handlePlaceOrder}
              disabled={executing || !accountData?.execution?.canTrade || !snapshot || selectedMarket.type === 'spot' || selectedMarket.status !== 'active'}
              className={`w-full py-3.5 rounded-xl font-extrabold text-sm transition-all shadow-lg flex items-center justify-center space-x-2 ${
                side === 'LONG'
                  ? 'bg-[#8ff0cc] text-black hover:opacity-90 shadow-[#8ff0cc]/20'
                  : 'bg-[#ef8390] text-white hover:opacity-90 shadow-[#ef8390]/20'
              } disabled:opacity-50 active:scale-95`}
            >
              {executing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span>{marketsError ? 'Phoenix market list unavailable' : selectedMarket.status && selectedMarket.status !== 'active' ? `Market ${selectedMarket.status}` : !accountData?.execution?.canTrade ? 'Challenge trading unavailable' : selectedMarket.type === 'spot' ? 'Spot: market data only' : !snapshot ? 'Waiting for fresh market data' : <>Simulate {orderMode === 'Limit' ? 'Limit' : 'Market'} {side} Order</>}</span>
              )}
            </button>

            {/* Breakdown box */}
            <div className="bg-[#19191f] p-3 rounded-lg border border-[#292930] space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-gray-400">Est. Liquidation Price</span>
                <span className="text-[#ef8390] font-bold">${estLiqPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Limit Price</span>
                <span className="text-white">${limitPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Order Value</span>
                <span className="text-white">${sizeUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Margin Required</span>
                <span className="text-gray-200">${marginRequired.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-[#292930] pt-1">
                <span className="text-gray-400">Fees (0.035%)</span>
                <span className="text-gray-300">${estFee.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM TRADER ACTIVITY & POSITIONS PANEL (5 FULLY POPULATED TABS) */}
      <div className="bg-[#101015] border-t border-[#25252e] terminal-activity p-4 m-2 rounded-lg font-mono">
        <div className="flex items-center justify-between border-b border-[#25252e] pb-3 mb-4">
          <div className="flex items-center space-x-6 text-xs font-bold text-gray-400">
            <button
              onClick={() => setActiveTab('positions')}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === 'positions' ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              Positions ({openPositions.length})
            </button>
            <button
              onClick={() => setActiveTab('openOrders')}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === 'openOrders' ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              Open Orders ({openOrders.length})
            </button>
            <button
              onClick={() => setActiveTab('tradeHistory')}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === 'tradeHistory' ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              Trade History ({fillsHistory.length})
            </button>
            <button
              onClick={() => setActiveTab('orderHistory')}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === 'orderHistory' ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              Order History ({orderHistory.length})
            </button>
            <button
              onClick={() => setActiveTab('fundingHistory')}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === 'fundingHistory' ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              Funding History ({fundingHistory.length})
            </button>
          </div>

          <div className="flex items-center space-x-3 text-xs text-gray-400">
            <span className="bg-[#19191f] px-2.5 py-1 rounded border border-[#292930]">Market: All</span>
            <span className="bg-[#19191f] px-2.5 py-1 rounded border border-[#292930]">Side: Both</span>
          </div>
        </div>

        {/* TAB 1: POSITIONS (BLENDED AGGREGATED POSITIONS) */}
        {activeTab === 'positions' && (
          <div>
            {openPositions.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
                <X className="w-8 h-8 text-gray-600" />
                <span>No open positions</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#25252e] text-gray-500">
                      <th className="py-2.5 px-4">SYMBOL</th>
                      <th className="py-2.5 px-4">SIDE</th>
                      <th className="py-2.5 px-4">SIZE</th>
                      <th className="py-2.5 px-4">AVG ENTRY PRICE</th>
                      <th className="py-2.5 px-4">MARK PRICE</th>
                      <th className="py-2.5 px-4">EST. LIQ PRICE</th>
                      <th className="py-2.5 px-4">UNREALIZED PnL</th>
                      <th className="py-2.5 px-4 text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#25252e] text-gray-200">
                    {openPositions.map((pos: any) => {
                      const liveMark = pos.symbol === selectedSymbol && currentMarkPrice > 0 ? currentMarkPrice : pos.currentMarkPrice;
                      const priceRatio = (liveMark - pos.entryPrice) / pos.entryPrice;
                      const pnlFactor = pos.side === 'LONG' ? priceRatio : -priceRatio;
                      const liveUnrealized = pos.quantity * pnlFactor * pos.leverage;

                      return (
                        <tr key={pos.id} className="hover:bg-[#19191f]/50">
                          <td className="py-3 px-4 font-bold text-white">{pos.symbol}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pos.side === 'LONG' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc] border border-[#8ff0cc]/30' : 'bg-[#ef8390]/10 text-[#ef8390] border border-[#ef8390]/30'
                            }`}>
                              {pos.side} {pos.leverage}×
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold">${pos.quantity.toLocaleString()}</td>
                          <td className="py-3 px-4 text-[#8ff0cc] font-bold">${pos.entryPrice.toFixed(pos.entryPrice < 1 ? 4 : 2)}</td>
                          <td className="py-3 px-4 font-bold text-white">${liveMark.toLocaleString()}</td>
                          <td className="py-3 px-4 text-[#ef8390] font-bold">${pos.liquidationPrice.toFixed(2)}</td>
                          <td className={`py-3 px-4 font-bold ${liveUnrealized >= 0 ? 'text-[#8ff0cc]' : 'text-[#ef8390]'}`}>
                            {liveUnrealized >= 0 ? '+' : ''}${liveUnrealized.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleClosePosition(pos.id, pos.symbol)}
                              className="px-3 py-1 bg-[#ef8390]/10 hover:bg-[#ef8390]/20 border border-[#ef8390]/30 text-[#ef8390] font-bold rounded text-[11px] transition-colors"
                            >
                              Market Close
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: OPEN ORDERS (PENDING LIMIT ORDERS) */}
        {activeTab === 'openOrders' && (
          <div>
            {openOrders.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
                <FileText className="w-8 h-8 text-gray-600" />
                <span>No active limit orders</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#25252e] text-gray-500">
                      <th className="py-2.5 px-4">TIME</th>
                      <th className="py-2.5 px-4">SYMBOL</th>
                      <th className="py-2.5 px-4">TYPE</th>
                      <th className="py-2.5 px-4">SIDE</th>
                      <th className="py-2.5 px-4">LIMIT PRICE</th>
                      <th className="py-2.5 px-4">SIZE</th>
                      <th className="py-2.5 px-4">STATUS</th>
                      <th className="py-2.5 px-4 text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#25252e] text-gray-200">
                    {openOrders.map((ord: any) => (
                      <tr key={ord.id} className="hover:bg-[#19191f]/50">
                        <td className="py-3 px-4 text-gray-400">{new Date(ord.createdAt).toLocaleTimeString()}</td>
                        <td className="py-3 px-4 font-bold text-white">{ord.symbol}</td>
                        <td className="py-3 px-4 text-gray-300">{ord.type}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ord.side === 'LONG' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]' : 'bg-[#ef8390]/10 text-[#ef8390]'
                          }`}>
                            {ord.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold">${ord.price.toLocaleString()}</td>
                        <td className="py-3 px-4">${ord.size.toLocaleString()}</td>
                        <td className="py-3 px-4 text-cyan-400 font-bold">{ord.status}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleCancelOrder(ord.id)}
                            className="px-3 py-1 bg-[#ef8390]/10 hover:bg-[#ef8390]/20 border border-[#ef8390]/30 text-[#ef8390] font-bold rounded text-[11px]"
                          >
                            Cancel Order
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TRADE HISTORY (FILLS) */}
        {activeTab === 'tradeHistory' && (
          <div>
            {fillsHistory.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
                <Clock className="w-8 h-8 text-gray-600" />
                <span>No trade history available</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#25252e] text-gray-500">
                      <th className="py-2.5 px-4">DATE / TIME</th>
                      <th className="py-2.5 px-4">SYMBOL</th>
                      <th className="py-2.5 px-4">SIDE</th>
                      <th className="py-2.5 px-4">EXECUTION PRICE</th>
                      <th className="py-2.5 px-4">QUANTITY</th>
                      <th className="py-2.5 px-4">FEE</th>
                      <th className="py-2.5 px-4">REALIZED PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#25252e] text-gray-200">
                    {fillsHistory.map((fill: any) => (
                      <tr key={fill.id} className="hover:bg-[#19191f]/50">
                        <td className="py-3 px-4 text-gray-400">{new Date(fill.createdAt || Date.now()).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-white">{fill.symbol}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            fill.side === 'LONG' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]' : 'bg-[#ef8390]/10 text-[#ef8390]'
                          }`}>
                            {fill.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold">${fill.price.toLocaleString()}</td>
                        <td className="py-3 px-4">${fill.quantity.toLocaleString()}</td>
                        <td className="py-3 px-4 text-gray-400">${fill.fee ? fill.fee.toFixed(2) : '0.70'}</td>
                        <td className={`py-3 px-4 font-bold ${fill.realizedPnL >= 0 ? 'text-[#8ff0cc]' : 'text-[#ef8390]'}`}>
                          {fill.realizedPnL >= 0 ? '+' : ''}${fill.realizedPnL ? fill.realizedPnL.toFixed(2) : '0.00'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ORDER HISTORY */}
        {activeTab === 'orderHistory' && (
          <div>
            {orderHistory.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
                <FileText className="w-8 h-8 text-gray-600" />
                <span>No order history recorded</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#25252e] text-gray-500">
                      <th className="py-2.5 px-4">DATE / TIME</th>
                      <th className="py-2.5 px-4">SYMBOL</th>
                      <th className="py-2.5 px-4">TYPE</th>
                      <th className="py-2.5 px-4">SIDE</th>
                      <th className="py-2.5 px-4">PRICE</th>
                      <th className="py-2.5 px-4">SIZE</th>
                      <th className="py-2.5 px-4">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#25252e] text-gray-200">
                    {orderHistory.map((ord: any) => (
                      <tr key={ord.id} className="hover:bg-[#19191f]/50">
                        <td className="py-3 px-4 text-gray-400">{new Date(ord.createdAt).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-white">{ord.symbol}</td>
                        <td className="py-3 px-4 text-gray-300">{ord.type}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ord.side === 'LONG' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]' : 'bg-[#ef8390]/10 text-[#ef8390]'
                          }`}>
                            {ord.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold">${ord.price.toLocaleString()}</td>
                        <td className="py-3 px-4">${ord.size.toLocaleString()}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ord.status === 'FILLED' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]' : ord.status === 'CANCELLED' ? 'bg-[#ef8390]/10 text-[#ef8390]' : 'bg-cyan-950/40 text-cyan-400'
                          }`}>
                            {ord.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: FUNDING HISTORY */}
        {activeTab === 'fundingHistory' && (
          <div>
            {fundingHistory.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
                <Clock className="w-8 h-8 text-gray-600" />
                <span>Funding accounting is not available yet</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#25252e] text-gray-500">
                      <th className="py-2.5 px-4">TIME</th>
                      <th className="py-2.5 px-4">SYMBOL</th>
                      <th className="py-2.5 px-4">POSITION SIZE</th>
                      <th className="py-2.5 px-4">1H FUNDING RATE</th>
                      <th className="py-2.5 px-4">PAYMENT (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#25252e] text-gray-200">
                    {fundingHistory.map((fund: any) => (
                      <tr key={fund.id} className="hover:bg-[#19191f]/50">
                        <td className="py-3 px-4 text-gray-400">{fund.time}</td>
                        <td className="py-3 px-4 font-bold text-white">{fund.symbol}</td>
                        <td className="py-3 px-4">${fund.size.toLocaleString()}</td>
                        <td className="py-3 px-4 text-gray-300">{fund.rate}</td>
                        <td className="py-3 px-4 font-bold text-[#8ff0cc]">-${fund.payment.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER BAR MATCHING PHOENIX */}
      <footer className="bg-[#09090d] border-t border-[#25252e] px-6 py-3 flex items-center justify-between text-[11px] text-gray-500 font-mono">
        <div>PROJECT Prop Trading Engine • Powered by TradingView & Phoenix DEX Architecture</div>
        <div className="flex space-x-6">
          <a href="#" className="hover:text-gray-300">Terms</a>
          <a href="#" className="hover:text-gray-300">Privacy</a>
          <a href="#" className="hover:text-gray-300">Docs</a>
        </div>
      </footer>
    </div>
  );
}
