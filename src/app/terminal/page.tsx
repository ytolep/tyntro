'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { activeAccountUrl } from '@/lib/activeAccount';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';
import { BRAND_NAME } from '@/lib/brand';
import { useMarketData } from '@/lib/marketData/MarketDataStore';
import MarketHeader from './components/MarketHeader';
import ChartPanel from './components/ChartPanel';
import OrderBook from './components/OrderBook';
import OrderForm from './components/OrderForm';
import OrdersTables from './components/OrdersTables';
import { numOrNull, toNum, type AccountPayload, type FillRow, type OrderIntent, type OrderRow, type PositionRow } from './types';

// Execution (limit-order fills, revaluation, liquidations) lives on the server
// worker — the browser never triggers CHECK_LIMIT_ORDERS anymore. The client
// only submits commands and refreshes its read model.
const ACCOUNT_REFRESH_MS = 5000;

type Toast = { message: string; type: 'success' | 'error' | 'info' } | null;
type MobileTab = 'chart' | 'book' | 'trade';

async function postOrdersApi(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, json };
}

function orderApiError(status: number, json: Record<string, unknown>, fallback: string): string {
  if (status === 401) return 'Sign in to place orders';
  if (status === 503 || json.code === 'NOT_IMPLEMENTED')
    return 'Order execution is not implemented on the server yet — simulated fills arrive with the execution service.';
  return typeof json.error === 'string' ? json.error : fallback;
}

export default function TerminalPage() {
  const {
    selectedMarket,
    snapshot,
    markets,
    marketsError,
    marketsLoading,
    orderBook,
    connectionStatus,
    selectMarket,
  } = useMarketData();

  const selectedSymbol = selectedMarket.symbol;
  const currentMarkPrice = snapshot?.referencePrice ?? 0;
  const bookMidPrice = snapshot?.orderBook.midPrice ?? 0;

  const [toast, setToast] = useState<Toast>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const [accountData, setAccountData] = useState<AccountPayload | null>(null);
  const [executing, setExecuting] = useState<boolean>(false);
  // R1: на узких экранах панели переключаются вкладками, по умолчанию Trade.
  const [mobileTab, setMobileTab] = useState<MobileTab>('trade');

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch(activeAccountUrl());
      // A3: 404 — вошёл, но счетов нет. Фиксируем «нет счёта», а не молчим,
      // чтобы кнопка формы могла предложить челлендж вместо вечного «unavailable».
      if (res.status === 404) { setAccountData({ account: null }); return; }
      const json = await res.json();
      if (json.account) {
        setAccountData(json);
        localStorage.setItem('activeAccountId', json.account.id);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadAccount();
    // Refresh the read model so server-side fills (limit orders, risk ticks)
    // show up without any browser-side execution trigger.
    const interval = setInterval(loadAccount, ACCOUNT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadAccount]);

  // Handle Order Submit
  const handlePlaceOrder = async (order: OrderIntent) => {
    setExecuting(true);
    try {
      const { ok, status, json } = await postOrdersApi({
        accountId: accountData?.account?.id,
        action: 'OPEN_POSITION',
        symbol: selectedSymbol,
        side: order.side,
        orderMode: order.orderMode,
        limitPrice: order.limitPrice,
        sizeUsd: order.sizeUsd,
        leverage: order.leverage,
        idempotencyKey: crypto.randomUUID(),
      });

      if (!ok) throw new Error(orderApiError(status, json, 'Failed to place order'));

      if (json.status === 'PENDING_LIMIT_ORDER') {
        showToast(typeof json.message === 'string' ? json.message : `Limit order placed at $${order.limitPrice}`, 'info');
      } else {
        showToast(typeof json.message === 'string' ? json.message : `Position blended for ${selectedSymbol}`, 'success');
      }

      await loadAccount();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Order execution failed', 'error');
    } finally {
      setExecuting(false);
    }
  };

  // Cancel Pending Limit Order
  const handleCancelOrder = async (orderId: string) => {
    try {
      const { ok, status, json } = await postOrdersApi({
        accountId: accountData?.account?.id,
        action: 'CANCEL_ORDER',
        orderId,
      });
      if (!ok) throw new Error(orderApiError(status, json, 'Failed to cancel order'));

      showToast('Limit Order Cancelled', 'info');
      await loadAccount();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cancel failed', 'error');
    }
  };

  // Close position
  const handleClosePosition = async (positionId: string, symbol: string) => {
    try {
      const { ok, status, json } = await postOrdersApi({
        accountId: accountData?.account?.id,
        action: 'CLOSE_POSITION',
        positionId,
      });
      if (!ok) throw new Error(orderApiError(status, json, 'Failed to close position'));

      const realizedPnL = numOrNull(json.realizedPnL as string | number | undefined) ?? 0;
      showToast(
        `Position Closed for ${symbol}. Realized PnL: $${toNum(realizedPnL).toFixed(2)}`,
        realizedPnL >= 0 ? 'success' : 'error',
      );
      await loadAccount();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Close position failed', 'error');
    }
  };

  const account = accountData?.account ?? null;
  const openPositions: PositionRow[] = account?.positions ?? [];
  const openOrders: OrderRow[] = (account?.orders ?? []).filter((o) => o.status === 'OPEN');
  const fillsHistory: FillRow[] = account?.fills ?? [];
  const orderHistory: OrderRow[] = account?.orders ?? [];

  // M4: доступная маржа = equity − Σ margin открытых позиций (margin = notional/leverage
  // на момент открытия, хранится в БД). Без счёта — null, кнопки размера скрыты.
  const equity = numOrNull(account?.currentEquity);
  const usedMargin = openPositions.reduce((sum, p) => sum + toNum(p.margin), 0);
  const availableMargin = equity !== null ? Math.max(0, equity - usedMargin) : null;

  if (accountData && accountData.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;

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

      {accountData?.execution && <AccountModeNotice execution={accountData.execution} />}
      <div className="terminal-title"><span className="eyebrow">THE TRADING DESK</span><span>Real market data <i /> Simulated execution</span></div>

      <MarketHeader
        selectedMarket={selectedMarket}
        markets={markets}
        marketsLoading={marketsLoading}
        marketsError={marketsError}
        connectionStatus={connectionStatus}
        currentMarkPrice={currentMarkPrice}
        orderBook={orderBook}
        onSelectMarket={selectMarket}
      />

      {/* R1: мобильный переключатель панелей — виден только < 900px, десктоп не меняется */}
      <div className="terminal-mobile-tabs" role="tablist" aria-label="Terminal panels">
        <button role="tab" aria-selected={mobileTab === 'chart'} onClick={() => setMobileTab('chart')}>Chart</button>
        <button role="tab" aria-selected={mobileTab === 'book'} onClick={() => setMobileTab('book')}>Order book</button>
        <button role="tab" aria-selected={mobileTab === 'trade'} onClick={() => setMobileTab('trade')}>Trade</button>
      </div>

      {/* MAIN LAYOUT: CHART (LEFT) + ORDERBOOK (MIDDLE) + ORDER FORM (RIGHT) */}
      <div className="terminal-grid" data-mobile={mobileTab}>
        <ChartPanel symbol={selectedSymbol} />
        <OrderBook
          selectedMarket={selectedMarket}
          orderBook={orderBook}
          snapshot={snapshot}
          currentMarkPrice={currentMarkPrice}
        />
        <OrderForm
          selectedMarket={selectedMarket}
          currentMarkPrice={currentMarkPrice}
          bookMidPrice={bookMidPrice}
          availableMargin={availableMargin}
          canTrade={Boolean(accountData?.execution?.canTrade)}
          accountLoaded={accountData !== null}
          accountStatus={account?.status ?? null}
          marketsError={marketsError}
          hasSnapshot={Boolean(snapshot)}
          executing={executing}
          onSubmit={handlePlaceOrder}
        />
      </div>

      <OrdersTables
        positions={openPositions}
        openOrders={openOrders}
        fills={fillsHistory}
        orders={orderHistory}
        markets={markets}
        selectedSymbol={selectedSymbol}
        currentMarkPrice={currentMarkPrice}
        onClosePosition={handleClosePosition}
        onCancelOrder={handleCancelOrder}
      />

      {/* N4/R4: реальные ссылки на страницы правил, бренд из BRAND_NAME, компактный футер */}
      <footer className="terminal-footer bg-[#09090d] border-t border-[#25252e] px-6 py-3 flex items-center justify-between text-[11px] text-gray-500 font-mono">
        <span>{BRAND_NAME} · Simulated prop trading</span>
        <nav className="flex space-x-6">
          <Link href="/rules" className="hover:text-gray-300">Rules</Link>
          <Link href="/terms" className="hover:text-gray-300">Terms</Link>
          <Link href="/privacy" className="hover:text-gray-300">Privacy</Link>
          <Link href="/faq" className="hover:text-gray-300">FAQ</Link>
        </nav>
      </footer>
    </div>
  );
}
