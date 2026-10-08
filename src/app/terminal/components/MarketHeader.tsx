'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { ConnectionStatus, Market, NormalizedTicker } from '@/lib/marketData/types';

interface MarketHeaderProps {
  selectedMarket: Market;
  markets: Market[];
  marketsLoading: boolean;
  marketsError: string | null;
  ticker: NormalizedTicker | null;
  connectionStatus: ConnectionStatus;
  currentMarkPrice: number;
  onSelectMarket: (symbol: string) => void;
}

export default function MarketHeader({
  selectedMarket,
  markets,
  marketsLoading,
  marketsError,
  ticker,
  connectionStatus,
  currentMarkPrice,
  onSelectMarket,
}: MarketHeaderProps) {
  const [showSymbolDropdown, setShowSymbolDropdown] = useState<boolean>(false);
  const [marketSearch, setMarketSearch] = useState<string>('');

  const filteredMarkets = useMemo(() => {
    return markets.filter((m) =>
      m.symbol.toLowerCase().includes(marketSearch.toLowerCase()) ||
      m.baseAsset.toLowerCase().includes(marketSearch.toLowerCase()) ||
      m.name?.toLowerCase().includes(marketSearch.toLowerCase())
    );
  }, [markets, marketSearch]);

  const priceDigits = selectedMarket.priceDecimals || 2;

  return (
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
                        onSelectMarket(market.symbol);
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
              {currentMarkPrice > 0 ? `$${currentMarkPrice.toLocaleString('en-US', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}` : 'N/A'}
            </span>
          </div>

          {selectedMarket.type === 'perp' && (
            <div>
              <span className="text-gray-500 text-[10px] block">Index Price</span>
              <span className="text-white font-bold">
                {ticker?.indexPrice ? `$${ticker.indexPrice.toLocaleString('en-US', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}` : 'N/A'}
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
  );
}
