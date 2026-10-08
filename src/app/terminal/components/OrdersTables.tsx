'use client';
import React, { useState } from 'react';
import { Clock, FileText } from 'lucide-react';
import type { Market } from '@/lib/marketData/types';
import PositionsTable from './PositionsTable';
import { toNum, type FillRow, type OrderRow, type PositionRow } from '../types';

// M5: вкладки Funding History нет, пока движок учёта не пишет события фандинга.
type TabId = 'positions' | 'openOrders' | 'tradeHistory' | 'orderHistory';

interface OrdersTablesProps {
  positions: PositionRow[];
  openOrders: OrderRow[];
  fills: FillRow[];
  orders: OrderRow[];
  markets: Market[];
  selectedSymbol: string;
  currentMarkPrice: number;
  onClosePosition: (positionId: string, symbol: string) => void;
  onCancelOrder: (orderId: string) => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'openOrders', label: 'Open Orders' },
  { id: 'tradeHistory', label: 'Trade History' },
  { id: 'orderHistory', label: 'Order History' },
];

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
      {icon}
      <span>{message}</span>
    </div>
  );
}

function SideBadge({ side }: { side: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
      side === 'LONG' ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]' : 'bg-[#ef8390]/10 text-[#ef8390]'
    }`}>
      {side}
    </span>
  );
}

export default function OrdersTables({
  positions,
  openOrders,
  fills,
  orders,
  markets,
  selectedSymbol,
  currentMarkPrice,
  onClosePosition,
  onCancelOrder,
}: OrdersTablesProps) {
  const [activeTab, setActiveTab] = useState<TabId>('positions');

  const counts: Record<TabId, number> = {
    positions: positions.length,
    openOrders: openOrders.length,
    tradeHistory: fills.length,
    orderHistory: orders.length,
  };

  const marketFor = (symbol: string) => markets.find((m) => m.symbol === symbol);
  const fmtPrice = (v: number | string, symbol: string) =>
    toNum(v).toLocaleString('en-US', { maximumFractionDigits: marketFor(symbol)?.priceDecimals ?? 2 });
  const fmtQty = (v: number | string, symbol: string) => {
    const market = marketFor(symbol);
    const qty = toNum(v).toLocaleString('en-US', { maximumFractionDigits: market?.quantityDecimals ?? 6 });
    return market ? `${qty} ${market.baseAsset}` : qty;
  };

  return (
    <div className="bg-[#101015] border-t border-[#25252e] terminal-activity p-4 m-2 rounded-lg font-mono">
      <div className="flex items-center justify-between border-b border-[#25252e] pb-3 mb-4">
        {/* R3: одна строка с горизонтальной прокруткой (стили в блоке U4 globals.css) */}
        <div className="terminal-tabs flex items-center space-x-6 text-xs font-bold text-gray-400">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 -mb-3 border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-[#8ff0cc] text-white' : 'border-transparent hover:text-white'
              }`}
            >
              {tab.label} ({counts[tab.id]})
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: POSITIONS */}
      {activeTab === 'positions' && (
        <PositionsTable
          positions={positions}
          markets={markets}
          selectedSymbol={selectedSymbol}
          currentMarkPrice={currentMarkPrice}
          onClose={onClosePosition}
        />
      )}

      {/* TAB 2: OPEN ORDERS (PENDING LIMIT ORDERS) */}
      {activeTab === 'openOrders' && (
        <div>
          {openOrders.length === 0 ? (
            <EmptyState icon={<FileText className="w-8 h-8 text-gray-600" />} message="No active limit orders" />
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
                  {openOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#19191f]/50">
                      <td className="py-3 px-4 text-gray-400">{new Date(ord.createdAt).toLocaleTimeString()}</td>
                      <td className="py-3 px-4 font-bold text-white">{ord.symbol}</td>
                      <td className="py-3 px-4 text-gray-300">{ord.type}</td>
                      <td className="py-3 px-4"><SideBadge side={ord.side} /></td>
                      <td className="py-3 px-4 font-bold">${fmtPrice(ord.price, ord.symbol)}</td>
                      <td className="py-3 px-4">{fmtQty(ord.size, ord.symbol)}</td>
                      <td className="py-3 px-4 text-cyan-400 font-bold">{ord.status}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onCancelOrder(ord.id)}
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
          {fills.length === 0 ? (
            <EmptyState icon={<Clock className="w-8 h-8 text-gray-600" />} message="No trade history available" />
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
                  {fills.map((fill) => {
                    const realizedPnl = toNum(fill.realizedPnL);
                    const fee = toNum(fill.fee);
                    return (
                      <tr key={fill.id} className="hover:bg-[#19191f]/50">
                        <td className="py-3 px-4 text-gray-400">{new Date(fill.createdAt).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-white">{fill.symbol}</td>
                        <td className="py-3 px-4"><SideBadge side={fill.side} /></td>
                        <td className="py-3 px-4 font-bold">${fmtPrice(fill.price, fill.symbol)}</td>
                        <td className="py-3 px-4">{fmtQty(fill.quantity, fill.symbol)}</td>
                        <td className="py-3 px-4 text-gray-400">${fee.toFixed(2)}</td>
                        <td className={`py-3 px-4 font-bold ${realizedPnl >= 0 ? 'text-[#8ff0cc]' : 'text-[#ef8390]'}`}>
                          {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}
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

      {/* TAB 4: ORDER HISTORY */}
      {activeTab === 'orderHistory' && (
        <div>
          {orders.length === 0 ? (
            <EmptyState icon={<FileText className="w-8 h-8 text-gray-600" />} message="No order history recorded" />
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
                  {orders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#19191f]/50">
                      <td className="py-3 px-4 text-gray-400">{new Date(ord.createdAt).toLocaleString()}</td>
                      <td className="py-3 px-4 font-bold text-white">{ord.symbol}</td>
                      <td className="py-3 px-4 text-gray-300">{ord.type}</td>
                      <td className="py-3 px-4"><SideBadge side={ord.side} /></td>
                      <td className="py-3 px-4 font-bold">${fmtPrice(ord.price, ord.symbol)}</td>
                      <td className="py-3 px-4">{fmtQty(ord.size, ord.symbol)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ord.status === 'FILLED'
                            ? 'bg-[#8ff0cc]/10 text-[#8ff0cc]'
                            : ord.status === 'CANCELLED'
                              ? 'bg-[#ef8390]/10 text-[#ef8390]'
                              : 'bg-cyan-950/40 text-cyan-400'
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

    </div>
  );
}
