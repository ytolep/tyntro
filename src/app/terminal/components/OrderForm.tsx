'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import type { Market } from '@/lib/marketData/types';
import type { OrderIntent } from '../types';

interface OrderFormProps {
  selectedMarket: Market;
  currentMarkPrice: number;
  bookMidPrice: number;
  /** M4: доступная маржа = equity − Σ margin открытых позиций; null — счёта нет. */
  availableMargin: number | null;
  canTrade: boolean;
  /** A3: API счёта уже ответил (даже если счёта нет — это «нет счёта», не загрузка). */
  accountLoaded: boolean;
  accountStatus: string | null;
  marketsError: string | null;
  hasSnapshot: boolean;
  executing: boolean;
  onSubmit: (order: OrderIntent) => void;
}

type MainAction = { label: string; tone: 'neutral' | 'primary'; disabled: boolean; href?: string; needsSignIn?: boolean };

export default function OrderForm({
  selectedMarket,
  currentMarkPrice,
  bookMidPrice,
  availableMargin,
  canTrade,
  accountLoaded,
  accountStatus,
  marketsError,
  hasSnapshot,
  executing,
  onSubmit,
}: OrderFormProps) {
  const { user, signIn, signingIn } = useAuth();
  const [orderMode, setOrderMode] = useState<'Market' | 'Limit'>('Limit');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [limitPriceEdited, setLimitPriceEdited] = useState<boolean>(false);
  const [sizeUsd, setSizeUsd] = useState<number>(2000);
  const [leverage, setLeverage] = useState<number>(3);

  // M3: без свежей цены форма заблокирована, расчётные поля — прочерк.
  const hasPrice = hasSnapshot && currentMarkPrice > 0;

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
  // Потолок размера — то, что пропустит checkMargin на сервере: size/плечо + комиссия ≤ доступной марже.
  // Без счёта торговать нельзя, ползунок остаётся демонстрационным до $50k.
  const maxSizeUsd = availableMargin !== null
    ? Math.max(0, Math.floor((availableMargin * leverage) / (1 + leverage * (takerFee ?? 0))))
    : 50000;
  const overMax = availableMargin !== null && sizeUsd > maxSizeUsd;
  // M4: быстрые кнопки — доля потолка с текущим плечом; без счёта скрыты.
  const sizeQuickButtons = availableMargin !== null && availableMargin > 0
    ? ([25, 50, 75, 100] as const).map((p) => ({
        pct: p,
        usd: Math.floor((maxSizeUsd * p) / 100),
      }))
    : [];

  // A3: главная кнопка отражает состояние входа и счёта; текст всегда короткий.
  // null — обычная торговая кнопка ниже.
  let mainAction: MainAction | null = null;
  if (user === undefined) mainAction = { label: 'Loading…', tone: 'neutral', disabled: true };
  else if (user === null) mainAction = { label: signingIn ? 'Check your wallet…' : 'Connect wallet', tone: 'primary', disabled: signingIn, needsSignIn: true };
  else if (!accountLoaded) mainAction = { label: 'Loading account…', tone: 'neutral', disabled: true };
  else if (accountStatus === null) mainAction = { label: 'Get a challenge', tone: 'primary', disabled: false, href: '/challenges' };
  else if (accountStatus === 'PASSED') mainAction = { label: 'Challenge passed', tone: 'neutral', disabled: true };
  else if (accountStatus === 'FAILED') mainAction = { label: 'Challenge failed', tone: 'neutral', disabled: true };

  const tradeDisabled = executing || !canTrade || !hasPrice || selectedMarket.type === 'spot' || selectedMarket.status !== 'active' || !(sizeUsd > 0) || overMax;
  const tradeLabel = marketsError
    ? 'Market list unavailable'
    : selectedMarket.status !== 'active'
      ? `Market ${selectedMarket.status}`
      : !canTrade
        ? 'Trading unavailable'
        : selectedMarket.type === 'spot'
          ? 'Spot: data only'
          : !hasPrice
            ? 'Waiting for market price'
            : overMax
              ? `Max size $${maxSizeUsd.toLocaleString('en-US')} at ${leverage}×`
              : `Simulate ${orderMode} ${side === 'LONG' ? 'Long' : 'Short'}`;

  const ctaClass = (tone: 'neutral' | 'primary' | 'side') =>
    `w-full py-3.5 rounded-xl font-extrabold text-sm transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 active:scale-95 ${
      tone === 'neutral'
        ? 'bg-[#34323f] text-white'
        : tone === 'primary'
          ? 'bg-[#b7a0ff] text-[#151021] hover:opacity-90'
          : side === 'LONG'
            ? 'bg-[#8ff0cc] text-black hover:opacity-90'
            : 'bg-[#ef8390] text-white hover:opacity-90'
    }`;

  return (
    <div className="terminal-order bg-[#101015] border border-[#25252e] rounded-lg p-4 flex flex-col justify-between font-mono text-xs h-full min-h-[490px]">
      <div>
        {/* Market / Limit Tabs */}
        <div className="grid grid-cols-2 gap-1 bg-[#19191f] p-1 rounded-lg border border-[#292930] mb-4 text-center">
          {(['Market', 'Limit'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setOrderMode(mode)}
              disabled={!hasPrice}
              className={`py-1.5 rounded font-bold transition-colors disabled:opacity-50 ${
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
            disabled={!hasPrice}
            className={`py-3 rounded-lg font-extrabold text-xs transition-all disabled:opacity-50 ${
              side === 'LONG'
                ? 'bg-[#8ff0cc] text-black shadow-lg shadow-[#8ff0cc]/20'
                : 'bg-[#19191f] text-gray-400 border border-[#292930] hover:text-white'
            }`}
          >
            Long/Buy
          </button>
          <button
            onClick={() => setSide('SHORT')}
            disabled={!hasPrice}
            className={`py-3 rounded-lg font-extrabold text-xs transition-all disabled:opacity-50 ${
              side === 'SHORT'
                ? 'bg-[#ef8390] text-white shadow-lg shadow-[#ef8390]/20'
                : 'bg-[#19191f] text-gray-400 border border-[#292930] hover:text-white'
            }`}
          >
            Short/Sell
          </button>
        </div>

        {/* Available margin (M4) */}
        <div className="flex justify-between text-gray-400 mb-4 text-[11px]">
          <span>Available to Trade</span>
          <span className="text-white font-bold">
            {availableMargin !== null ? `$${availableMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
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
                value={hasPrice ? limitPrice : ''}
                placeholder="—"
                disabled={!hasPrice}
                onChange={(e) => { setLimitPriceEdited(true); setLimitPrice(Number(e.target.value)); }}
                className="w-full bg-transparent text-white font-bold focus:outline-none disabled:opacity-50"
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
              disabled={!hasPrice}
              onChange={(e) => setSizeUsd(Number(e.target.value))}
              className="w-full bg-transparent text-white font-bold focus:outline-none disabled:opacity-50"
            />
            <span className="text-gray-400 text-[10px]">USDC</span>
          </div>

          {/* Size Slider */}
          <div className="pt-2 space-y-1">
            <input
              type="range"
              min="0"
              max={maxSizeUsd}
              step="500"
              value={Math.min(sizeUsd, maxSizeUsd)}
              disabled={!hasPrice}
              onChange={(e) => setSizeUsd(Number(e.target.value))}
              className="w-full accent-[#8ff0cc] cursor-pointer disabled:opacity-50"
            />
            {sizeQuickButtons.length > 0 && (
              <div className="flex justify-between text-[10px] text-gray-500">
                {sizeQuickButtons.map(({ pct, usd }) => (
                  <button key={pct} onClick={() => setSizeUsd(usd)} disabled={!hasPrice} className="disabled:opacity-50">
                    <span className={pct === 100 ? 'text-[#8ff0cc] font-bold' : ''}>
                      {pct === 100 ? 'MAX' : `${pct}%`}
                    </span>
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
            disabled={!hasPrice}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full accent-[#8ff0cc] cursor-pointer disabled:opacity-50"
          />
        </div>
      </div>

      {/* Action Button & Breakdown */}
      <div className="space-y-4">
        {mainAction?.href ? (
          <Link href={mainAction.href} className={ctaClass(mainAction.tone)}>
            <span>{mainAction.label}</span>
          </Link>
        ) : (
          <button
            onClick={mainAction?.needsSignIn ? () => void signIn() : () => onSubmit({ side, orderMode, limitPrice, sizeUsd, leverage })}
            disabled={mainAction ? mainAction.disabled : tradeDisabled}
            className={ctaClass(mainAction ? mainAction.tone : 'side')}
          >
            {!mainAction && executing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span>{mainAction ? mainAction.label : tradeLabel}</span>
            )}
          </button>
        )}

        {/* Breakdown box: без цены расчётные поля — прочерк, без $0.00 (M3) */}
        <div className="bg-[#19191f] p-3 rounded-lg border border-[#292930] space-y-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-gray-400">Quantity ({selectedMarket.baseAsset})</span>
            <span className={mark > 0 && qty > 0 ? 'text-white font-bold' : 'text-gray-500'}>
              {mark > 0 && qty > 0
                ? `${qty.toLocaleString('en-US', { maximumFractionDigits: qtyDigits })} ${selectedMarket.baseAsset}`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Est. Liquidation Price</span>
            {hasPrice && estLiqPrice > 0 ? (
              <span className="text-[#ef8390] font-bold">${estLiqPrice.toFixed(2)}</span>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </div>
          {orderMode === 'Limit' && (
            <div className="flex justify-between">
              <span className="text-gray-400">Limit Price</span>
              <span className={hasPrice && limitPrice > 0 ? 'text-white' : 'text-gray-500'}>
                {hasPrice && limitPrice > 0 ? `$${limitPrice.toFixed(2)}` : '—'}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Order Value</span>
            <span className={notional > 0 ? 'text-white' : 'text-gray-500'}>
              {notional > 0 ? `$${notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Margin Required</span>
            <span className={marginRequired > 0 ? 'text-gray-200' : 'text-gray-500'}>
              {marginRequired > 0 ? `$${marginRequired.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between border-t border-[#292930] pt-1">
            <span className="text-gray-400">Fee (taker)</span>
            {takerFee === null ? (
              <span className="text-gray-500">by market</span>
            ) : notional > 0 && feeEst !== null ? (
              <span className="text-gray-300">${feeEst.toFixed(2)} · {(takerFee * 100).toFixed(4)}%</span>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
