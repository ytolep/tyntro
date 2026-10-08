'use client';
import { X } from 'lucide-react';
import type { Market } from '@/lib/marketData/types';
import { toNum, type PositionRow } from '../types';

interface PositionsTableProps {
  positions: PositionRow[];
  markets: Market[];
  selectedSymbol: string;
  currentMarkPrice: number;
  onClose: (positionId: string, symbol: string) => void;
}

export default function PositionsTable({ positions, markets, selectedSymbol, currentMarkPrice, onClose }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center space-y-2">
        <X className="w-8 h-8 text-gray-600" />
        <span>No open positions</span>
      </div>
    );
  }

  return (
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
          {positions.map((pos) => {
            const market = markets.find((m) => m.symbol === pos.symbol);
            const qty = toNum(pos.quantity);
            const entry = toNum(pos.entryPrice);
            const liveMark = pos.symbol === selectedSymbol && currentMarkPrice > 0 ? currentMarkPrice : toNum(pos.currentMarkPrice);
            // Unrealized PnL = quantity × (mark − entry) × side sign.
            // Leverage defines margin only — it never scales PnL.
            const liveUnrealized = qty * (liveMark - entry) * (pos.side === 'LONG' ? 1 : -1);
            const priceDigits = market?.priceDecimals ?? 2;
            const qtyDigits = market?.quantityDecimals ?? 6;

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
                <td className="py-3 px-4 font-bold">
                  {qty.toLocaleString('en-US', { maximumFractionDigits: qtyDigits })}{market ? ` ${market.baseAsset}` : ''}
                </td>
                <td className="py-3 px-4 text-[#8ff0cc] font-bold">${entry.toLocaleString('en-US', { minimumFractionDigits: entry < 1 ? 4 : 2, maximumFractionDigits: priceDigits })}</td>
                <td className="py-3 px-4 font-bold text-white">${liveMark.toLocaleString('en-US', { maximumFractionDigits: priceDigits })}</td>
                <td className="py-3 px-4 text-[#ef8390] font-bold">${toNum(pos.liquidationPrice).toFixed(2)}</td>
                <td className={`py-3 px-4 font-bold ${liveUnrealized >= 0 ? 'text-[#8ff0cc]' : 'text-[#ef8390]'}`}>
                  {liveUnrealized >= 0 ? '+' : ''}${liveUnrealized.toFixed(2)}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => onClose(pos.id, pos.symbol)}
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
  );
}
