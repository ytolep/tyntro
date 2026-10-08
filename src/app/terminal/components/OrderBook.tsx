'use client';
import { AlertTriangle, ChevronDown, Sliders } from 'lucide-react';
import type { Market, MarketSnapshot, NormalizedOrderBook } from '@/lib/marketData/types';

interface OrderBookProps {
  selectedMarket: Market;
  orderBook: NormalizedOrderBook | null;
  snapshot: MarketSnapshot | null;
  currentMarkPrice: number;
}

export default function OrderBook({ selectedMarket, orderBook, snapshot, currentMarkPrice }: OrderBookProps) {
  const priceDigits = selectedMarket.priceDecimals || 2;
  const qtyDigits = selectedMarket.quantityDecimals || 4;

  return (
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
                  <span className="text-[#ef8390] font-bold z-10">${row.price.toFixed(priceDigits)}</span>
                  <span className="text-right text-gray-300 z-10">{row.size.toLocaleString(undefined, { maximumFractionDigits: qtyDigits })}</span>
                  <span className="text-right text-gray-400 z-10">{(row.total || row.size).toLocaleString(undefined, { maximumFractionDigits: qtyDigits })}</span>
                </div>
              ))}
            </div>

            {/* SPREAD BAR IN MIDDLE */}
            <div className="my-3 py-2 px-2 bg-[#19191f] border border-[#292930] rounded flex justify-between items-center text-xs">
              <span className="font-extrabold text-white">
                ${(orderBook.midPrice || currentMarkPrice).toLocaleString('en-US', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}
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
                  <span className="text-[#8ff0cc] font-bold z-10">${row.price.toFixed(priceDigits)}</span>
                  <span className="text-right text-gray-300 z-10">{row.size.toLocaleString(undefined, { maximumFractionDigits: qtyDigits })}</span>
                  <span className="text-right text-gray-400 z-10">{(row.total || row.size).toLocaleString(undefined, { maximumFractionDigits: qtyDigits })}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
