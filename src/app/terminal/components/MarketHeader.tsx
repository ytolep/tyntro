'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useMarketData } from '@/lib/marketData/MarketDataStore';
import type { ConnectionStatus, Market, NormalizedOrderBook } from '@/lib/marketData/types';

interface MarketHeaderProps {
  selectedMarket: Market;
  markets: Market[];
  marketsLoading: boolean;
  marketsError: string | null;
  connectionStatus: ConnectionStatus;
  currentMarkPrice: number;
  orderBook: NormalizedOrderBook | null;
  onSelectMarket: (symbol: string) => void;
}

export default function MarketHeader({
  selectedMarket,
  markets,
  marketsLoading,
  marketsError,
  connectionStatus,
  currentMarkPrice,
  orderBook,
  onSelectMarket,
}: MarketHeaderProps) {
  // Ticker — из того же MarketDataProvider, страницу терминала не трогаем.
  const { ticker } = useMarketData();
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

  // M2: показываем только то, что реально есть — Mark и спред из стакана.
  // Недоступных полей нет вовсе, цвет — только у чисел, у прочерков нет.
  const spreadLabel = !orderBook
    ? null
    : orderBook.spreadPct > 0
      ? `${orderBook.spreadPct.toFixed(3)}%`
      : orderBook.spread > 0
        ? `$${orderBook.spread.toFixed(priceDigits)}`
        : null;

  const compactNumber = (value: number) =>
    value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  const price = (value: number) =>
    value.toLocaleString('en-US', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits });

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

        {/* Header Stats Bar: только доступные поля (M2) */}
        <div className="terminal-market-stats flex items-center space-x-6 text-gray-400">
          <div>
            <span className="text-gray-500 text-[10px] block">{selectedMarket.type === 'perp' ? 'Mark' : 'Book midpoint'}</span>
            <span className={`font-bold ${currentMarkPrice > 0 ? 'text-white' : 'text-gray-500'}`}>
              {currentMarkPrice > 0 ? `$${currentMarkPrice.toLocaleString('en-US', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}` : '—'}
            </span>
          </div>

          <div>
            <span className="text-gray-500 text-[10px] block">Spread</span>
            <span className={`font-bold ${spreadLabel ? 'text-white' : 'text-gray-500'}`}>
              {spreadLabel ?? '—'}
            </span>
          </div>

          {/* WS-поток: честные поля канала market — каждое только при наличии значения */}
          {ticker?.indexPrice != null && (
            <div>
              <span className="text-gray-500 text-[10px] block">Index</span>
              <span className="font-bold text-white">${price(ticker.indexPrice)}</span>
            </div>
          )}
          {ticker?.change24h != null && (
            <div>
              <span className="text-gray-500 text-[10px] block">24h Change</span>
              <span className={`font-bold ${ticker.change24h > 0 ? 'text-[#8ff0cc]' : ticker.change24h < 0 ? 'text-[#ef8390]' : 'text-white'}`}>
                {ticker.change24h >= 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
              </span>
            </div>
          )}
          {ticker?.volume24h != null && (
            <div>
              <span className="text-gray-500 text-[10px] block">24h Volume</span>
              <span className="font-bold text-white">${compactNumber(ticker.volume24h)}</span>
            </div>
          )}
          {ticker?.openInterest != null && (
            <div>
              <span className="text-gray-500 text-[10px] block">Open Interest</span>
              <span className="font-bold text-white">{compactNumber(ticker.openInterest)}</span>
            </div>
          )}
          {ticker?.fundingRate != null && (
            <div>
              <span className="text-gray-500 text-[10px] block">Funding</span>
              <span className={`font-bold ${ticker.fundingRate > 0 ? 'text-[#8ff0cc]' : ticker.fundingRate < 0 ? 'text-[#ef8390]' : 'text-white'}`}>
                {(ticker.fundingRate * 100).toFixed(4)}%
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
