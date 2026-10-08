'use client';

import React, { useEffect, useState } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';
import { num } from '@/lib/display';

// Публичный лидерборд из /api/leaderboard: топ счетов с реальным Trader Score,
// кошельки укорочены на сервере. Никаких мок-массивов.
export default function LeaderboardPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load leaderboard');
        setEntries(json.entries ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-6">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-profit" /> Global Trader Leaderboard
          </h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Top accounts ranked by Trader Score, computed from executed trades and equity. Accounts with fewer
            than 5 trades are not ranked.
          </p>
        </div>
        <div className="text-right text-xs">
          <span className="text-gray-400 block">SOURCE</span>
          <span className="text-profit font-bold">LIVE DATA</span>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-surface-border">
        {loading ? (
          <div className="py-16 text-center text-gray-400">
            <RefreshCw className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
            <span className="text-xs">Loading leaderboard...</span>
          </div>
        ) : error ? (
          <div className="py-16 text-center text-xs text-gray-400">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-xs text-gray-500">
            No ranked traders yet. Complete at least 5 trades on an evaluation account to appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-border text-gray-400">
                  <th className="py-3 px-4">RANK</th>
                  <th className="py-3 px-4">TRADER</th>
                  <th className="py-3 px-4">ACCOUNT SIZE</th>
                  <th className="py-3 px-4">NET PnL</th>
                  <th className="py-3 px-4">TRADER SCORE</th>
                  <th className="py-3 px-4">WIN RATE</th>
                  <th className="py-3 px-4">TRADES</th>
                  <th className="py-3 px-4 text-right">TIER</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50 text-gray-200">
                {entries.map((t) => (
                  <tr key={t.rank} className={t.rank <= 3 ? 'bg-profit/5' : ''}>
                    <td className="py-3.5 px-4 font-bold">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                          t.rank === 1
                            ? 'bg-amber-400 text-black font-extrabold'
                            : t.rank === 2
                              ? 'bg-profit text-black font-extrabold'
                              : t.rank === 3
                                ? 'bg-cyanAccent text-black font-extrabold'
                                : 'text-gray-400'
                        }`}
                      >
                        #{t.rank}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{t.wallet}</td>
                    <td className="py-3.5 px-4 font-bold">
                      {num(t.accountSize).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </td>
                    <td
                      className={`py-3.5 px-4 font-bold ${
                        t.pnlPct === null ? 'text-gray-500' : t.pnlPct >= 0 ? 'text-profit' : 'text-loss'
                      }`}
                    >
                      {t.pnlPct === null ? '—' : `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{t.score} / 100</td>
                    <td className="py-3.5 px-4 text-gray-300">{t.winRatePct.toFixed(1)}%</td>
                    <td className="py-3.5 px-4 text-gray-300">{t.trades}</td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="bg-[#19191f] border border-[#34323f] text-gray-200 px-2.5 py-1 rounded text-[10px] font-bold">
                        {t.tier}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
