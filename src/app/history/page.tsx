'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import { num, usd } from '@/lib/display';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';

export default function HistoryPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch(activeAccountUrl())
      .then((res) => res.json())
      .then((json) => {
        if (json.account) setData(json);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-gray-400">
        <RefreshCw className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
        <span>Loading Execution History...</span>
      </div>
    );
  }

  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace/>;
  const { account } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-6">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Clock className="w-6 h-6 text-profit" /> Trade Execution History
          </h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Complete audit trail of all executed orders, fills, fees, and realized PnL.
          </p>
        </div>
        <div className="text-right text-xs">
          <span className="text-gray-400 block">TOTAL EXECUTED TRADES</span>
          <span className="text-lg font-bold text-white">{account.totalTrades || 0}</span>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-surface-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-surface-border text-gray-400">
                <th className="py-3 px-4">TIMESTAMP</th>
                <th className="py-3 px-4">SYMBOL</th>
                <th className="py-3 px-4">SIDE</th>
                <th className="py-3 px-4">TYPE</th>
                <th className="py-3 px-4">PRICE</th>
                <th className="py-3 px-4">NOTIONAL SIZE</th>
                <th className="py-3 px-4">LEVERAGE</th>
                <th className="py-3 px-4">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-gray-200">
              {account.orders && account.orders.length > 0 ? (
                account.orders.map((ord: any) => (
                  <tr key={ord.id}>
                    <td className="py-3.5 px-4 text-gray-400">
                      {new Date(ord.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{ord.symbol}</td>
                    <td className="py-3.5 px-4 font-bold">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        ord.side === 'LONG' ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss'
                      }`}>
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-300">{ord.type}</td>
                    <td className="py-3.5 px-4 font-bold">{usd(num(ord.price))}</td>
                    <td className="py-3.5 px-4">{usd(num(ord.size))}</td>
                    <td className="py-3.5 px-4 text-cyanAccent font-bold">{num(ord.leverage)}×</td>
                    <td className="py-3.5 px-4">
                      <span className="text-profit font-bold">{ord.status}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">
                    No orders recorded yet. Trade in the terminal to view execution history.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
