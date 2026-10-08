'use client';

import React from 'react';
import { Trophy, Award, TrendingUp, ShieldCheck } from 'lucide-react';

const MOCK_LEADERBOARD = [
  { rank: 1, name: 'SatoshiQuant', wallet: '8xPL...12mA', size: 100000, pnlPct: 18.4, score: 96, winRate: 78, badge: 'Apex Master' },
  { rank: 2, name: 'AlphaTrader_01', wallet: '7xKX...9q2W', size: 10000, pnlPct: 8.42, score: 88, winRate: 72, badge: 'Risk Guardian' },
  { rank: 3, name: 'SolanaWhale', wallet: '3n9F...8k1L', size: 50000, pnlPct: 12.8, score: 86, winRate: 69, badge: 'Consistency King' },
  { rank: 4, name: 'HyperionTrade', wallet: '9m2P...4q0Z', size: 25000, pnlPct: 10.5, score: 84, winRate: 67, badge: 'Core Trader' },
  { rank: 5, name: 'NexusProp', wallet: '5v1A...9t3E', size: 100000, pnlPct: 14.1, score: 82, winRate: 65, badge: 'Funded Elite' },
];

export default function LeaderboardPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-6">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-profit" /> Global Trader Leaderboard
          </h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Top performing traders evaluated by Trader Score, Risk Consistency, and Net PnL.
          </p>
        </div>
        <div className="text-right text-xs">
          <span className="text-gray-400 block">UPDATED</span>
          <span className="text-profit font-bold">REAL-TIME UTC</span>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-surface-border">
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
                <th className="py-3 px-4 text-right">BADGE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-gray-200">
              {MOCK_LEADERBOARD.map((trader) => (
                <tr key={trader.rank} className={trader.rank === 2 ? 'bg-profit/5' : ''}>
                  <td className="py-3.5 px-4 font-bold">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      trader.rank === 1 ? 'bg-amber-400 text-black font-extrabold' :
                      trader.rank === 2 ? 'bg-profit text-black font-extrabold' :
                      trader.rank === 3 ? 'bg-cyanAccent text-black font-extrabold' : 'text-gray-400'
                    }`}>
                      #{trader.rank}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-white">{trader.name}</div>
                    <div className="text-[10px] text-gray-500">{trader.wallet}</div>
                  </td>
                  <td className="py-3.5 px-4 font-bold">${trader.size.toLocaleString()}</td>
                  <td className="py-3.5 px-4 font-bold text-profit">+{trader.pnlPct}%</td>
                  <td className="py-3.5 px-4 font-bold text-white">{trader.score} / 100</td>
                  <td className="py-3.5 px-4 text-gray-300">{trader.winRate}%</td>
                  <td className="py-3.5 px-4 text-right">
                    <span className="bg-[#19191f] border border-[#34323f] text-gray-200 px-2.5 py-1 rounded text-[10px] font-bold">
                      {trader.badge}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
