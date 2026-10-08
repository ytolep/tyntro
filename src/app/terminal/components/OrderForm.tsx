'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Market } from '@/lib/marketData/types';
import type { OrderIntent } from '../types';

interface OrderFormProps {
  selectedMarket: Market;
  currentMarkPrice: number;
  bookMidPrice: number;
  equity: number | null;
  canTrade: boolean;
  marketsError: string | null;
  hasSnapshot: boolean;
  executing: boolean;
  onSubmit: (order: OrderIntent) => void;
}

export default function OrderForm({
  selectedMarket,
  currentMarkPrice,
  bookMidPrice,
  equity,
  canTrade,
  marketsError,
  hasSnapshot,
  executing,
  onSubmit,
}: OrderFormProps) {
  const [orderMode, setOrderMode] = useState<'Market' | 'Limit'>('Limit');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [limitPriceEdited, setLimitPriceEdited] = useState<boolean>(false);
  const [sizeUsd, setSizeUsd] = useState<number>(2000);
  const [leverage, setLeverage] = useState<number>(3);
  const [reduceOnly] = useState<boolean>(false);
  const [tpSl] = useState<boolean>(false);

  useEffect(() => { setLimitPrice(0); setLimitPriceEdited(false); }, [selectedMarket.symbol]);
  useEffect(() => {
    if (!limitPriceEdited && currentMarkPrice > 0) setLimitPrice(currentMarkPrice);
  }, [selectedMarket.symbol, currentMarkPrice, limitPriceEdited]);

  // Fee comes from the market catalogue when it exposes takerFee; otherwise we
  // do not invent a rate and say so. Read defensively so the estimate turns on
  // automatically once the catalogue carries the field.
  const takerFee = (selectedMarket as Market & { takerFee?: number }).takerFee ?? null;

  const mark = currentMarkPrice;
  // Size is entered in USD; quantity in the base asset is derived from the mark
  // price and rounded DOWN to the market lot size. The server re-derives the
  // authoritative quantity at fill time.
  const lot = selectedMarket.lotSize ?? 0;
  const rawQty = mark > 0 ? sizeUsd / mark : 0;
  const qty = lot > 0 ? Math.floor(rawQty / lot) * lot : rawQty;
  const notional = qty * mark;
  // Leverage defines margin only; it never scales PnL.
  const marginRequired = leverage > 0 ? notional / leverage : 0;
  const feeEst = takerFee !== null ? notional * takerFee : null;

  const entryPrice = orderMode === 'Limit' ? limitPrice : mark;
  const estLiqPrice = leverage > 0
    ? side === 'LONG'
      ? entryPrice * (1 - 0.85 / leverage)
      : entryPrice * (1 + 0.85 / leverage)
    : 0;

  const qtyDigits = selectedMarket.quantityDecimals ?? 6;
  const sizeQuickButtons = equity !== null && equity > 0
    ? ([25, 50, 75, 100] as const).map((p) => ({
        pct: p,
        usd: Math.max(0, Math.floor((equity * p) / 100)),
      }))
    : [];

  return (
    <div className="terminal-order bg-[#101015] border border-[#25252e] rounded-lg p-4 flex flex-col justify-between font-mono text-xs h-full min-h-[490px]">
      <div>
        {/* Market / Limit Tabs */}
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
            {equity !== null ? `$${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
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

        {/* Order Size Input (USD notional) */}
        <div className="space-y-1 mb-4">
          <div className="flex justify-between text-gray-400 text-[11px]">
            <span>Order Size (USD)</span>
            <span className="text-white font-bold">${sizeUsd.toLocaleString()}</span>
          </div>
          <div className="flex items-center bg-[#19191f] border border-[#292930] rounded-lg px-3 py-2">
            <input
              type="number"
              min="0"
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
              value={Math.min(Math.max(sizeUsd, 500), 50000)}
              onChange={(e) => setSizeUsd(Number(e.target.value))}
              className="w-full accent-[#8ff0cc] cursor-pointer"
            />
            {sizeQuickButtons.length > 0 && (
              <div className="flex justify-between text-[10px] text-gray-500">
                {sizeQuickButtons.map(({ pct, usd }) => (
                  <button key={pct} onClick={() => setSizeUsd(usd)} className={pct === 100 ? 'text-[#8ff0cc] font-bold' : ''}>
                    {pct === 100 ? 'MAX' : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
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
              readOnly
              className="rounded border-[#292930] bg-[#19191f] text-[#8ff0cc] focus:ring-0"
            />
            <span>Reduce Only · coming later</span>
          </label>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              disabled
              checked={tpSl}
              readOnly
              className="rounded border-[#292930] bg-[#19191f] text-[#8ff0cc] focus:ring-0"
            />
            <span>Take Profit / Stop Loss · coming later</span>
          </label>
        </div>
      </div>

      {/* Action Button & Breakdown */}
      <div className="space-y-4">
        <button
          onClick={() => onSubmit({ side, orderMode, limitPrice, sizeUsd, leverage })}
          disabled={executing || !canTrade || !hasSnapshot || selectedMarket.type === 'spot' || selectedMarket.status !== 'active' || !(sizeUsd > 0)}
          className={`w-full py-3.5 rounded-xl font-extrabold text-sm transition-all shadow-lg flex items-center justify-center space-x-2 ${
            side === 'LONG'
              ? 'bg-[#8ff0cc] text-black hover:opacity-90 shadow-[#8ff0cc]/20'
              : 'bg-[#ef8390] text-white hover:opacity-90 shadow-[#ef8390]/20'
          } disabled:opacity-50 active:scale-95`}
        >
          {executing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <span>{marketsError ? 'Phoenix market list unavailable' : selectedMarket.status && selectedMarket.status !== 'active' ? `Market ${selectedMarket.status}` : !canTrade ? 'Challenge trading unavailable' : selectedMarket.type === 'spot' ? 'Spot: market data only' : !hasSnapshot ? 'Waiting for fresh market data' : <>Simulate {orderMode === 'Limit' ? 'Limit' : 'Market'} {side} Order</>}</span>
          )}
        </button>

        {/* Breakdown box */}
        <div className="bg-[#19191f] p-3 rounded-lg border border-[#292930] space-y-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-gray-400">Quantity ({selectedMarket.baseAsset})</span>
            <span className="text-white font-bold">
              {mark > 0 && qty > 0
                ? `${qty.toLocaleString('en-US', { maximumFractionDigits: qtyDigits })} ${selectedMarket.baseAsset}`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Est. Liquidation Price</span>
            <span className="text-[#ef8390] font-bold">${estLiqPrice.toFixed(2)}</span>
          </div>
          {orderMode === 'Limit' && (
            <div className="flex justify-between">
              <span className="text-gray-400">Limit Price</span>
              <span className="text-white">${limitPrice.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Order Value</span>
            <span className="text-white">${notional > 0 ? notional.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Margin Required</span>
            <span className="text-gray-200">${marginRequired > 0 ? marginRequired.toFixed(2) : '—'}</span>
          </div>
          <div className="flex justify-between border-t border-[#292930] pt-1">
            <span className="text-gray-400">Fee (taker)</span>
            {takerFee !== null && feeEst !== null ? (
              <span className="text-gray-300">${feeEst.toFixed(2)} · {(takerFee * 100).toFixed(4)}%</span>
            ) : (
              <span className="text-gray-500">by market</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
