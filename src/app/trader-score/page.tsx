'use client';

import { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';

// Trader Score активного счёта из /api/trader-score: реальный computeTraderScore
// по сделкам и equity этого счёта. score === null → недостаточно данных (< 5 сделок).
export default function TraderScorePage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const id = localStorage.getItem('activeAccountId');
    const url = `/api/trader-score${id ? `?accountId=${encodeURIComponent(id)}` : ''}`;
    fetch(url)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load trader score');
        setData(json);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-gray-400">
        <RefreshCw className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
        <span>Computing your trader score...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
        <ScoreHeader />
        <div className="glass-panel p-6 rounded-2xl border border-surface-border text-center">
          <span className="text-gray-400 font-mono text-sm">
            {error || 'No evaluation account found. Choose a challenge to begin.'}
          </span>
        </div>
      </div>
    );
  }

  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;

  if (!data.score) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
        <ScoreHeader />
        <div className="glass-panel p-8 rounded-2xl border border-surface-border text-center space-y-3">
          <Sparkles className="w-6 h-6 text-profit mx-auto" />
          <div className="text-white font-bold text-sm">Not enough data yet</div>
          <span className="text-gray-400 font-mono text-xs block">
            Trader Score requires at least 5 closed trades — this account has {data.tradeCount ?? 0}.
          </span>
          <div className="text-[10px] text-gray-500 font-sans">Account status: {data.status}</div>
        </div>
      </div>
    );
  }

  const s = data.score;
  const components = [
    { label: 'Risk Management', weight: '30%', value: s.riskManagementScore },
    { label: 'Sharpe Ratio', weight: '25%', value: s.sharpeScore },
    { label: 'Consistency', weight: '20%', value: s.consistencyScore },
    { label: 'Profit Factor', weight: '15%', value: s.profitFactorScore },
    { label: 'Edge (Win Rate)', weight: '10%', value: s.edgeScore },
  ];
  const stats = [
    { label: 'TRADES', value: String(s.stats.tradeCount) },
    { label: 'WIN RATE', value: `${s.stats.winRatePct.toFixed(1)}%` },
    { label: 'PROFIT FACTOR', value: s.stats.profitFactor.toFixed(2) },
    { label: 'SHARPE (DAILY)', value: s.stats.sharpeRatio.toFixed(2) },
    { label: 'MAX DRAWDOWN', value: `${s.stats.maxDrawdownPct.toFixed(2)}%` },
    { label: 'CONSISTENCY', value: `${s.stats.consistencyPct.toFixed(1)}%` },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      <ScoreHeader />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* TOTAL */}
        <div className="glass-panel p-6 rounded-2xl border border-surface-border text-center flex flex-col justify-center">
          <span className="text-gray-400 text-xs">TOTAL TRADER SCORE</span>
          <span className="text-6xl font-extrabold text-white mt-2">{s.totalScore}</span>
          <span
            className={`inline-block mt-3 text-xs font-bold px-3 py-1 rounded border self-center ${
              s.tier === 'APEX_MASTER'
                ? 'bg-amber-400/10 text-amber-400 border-amber-400/30'
                : s.tier === 'ELITE'
                  ? 'bg-profit/10 text-profit border-profit/30'
                  : s.tier === 'PRO'
                    ? 'bg-cyanAccent/10 text-cyanAccent border-cyanAccent/30'
                    : 'bg-[#19191f] text-gray-300 border-surface-border'
            }`}
          >
            {s.tier}
          </span>
          <div className="text-[10px] text-gray-500 font-sans mt-3">
            Account status: {data.status} · {data.tradeCount} trades
          </div>
        </div>

        {/* COMPONENTS */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl border border-surface-border space-y-5">
          {components.map((c) => (
            <div key={c.label}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-gray-300 font-bold">
                  {c.label} <span className="text-gray-500 font-normal">· weight {c.weight}</span>
                </span>
                <span className="text-white font-bold">{c.value} / 100</span>
              </div>
              <div className="h-2 bg-[#19191f] rounded-full overflow-hidden border border-surface-border">
                <div
                  className="h-full bg-gradient-to-r from-brand-600 to-profit rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, c.value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RAW STATS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
        {stats.map((st) => (
          <div key={st.label} className="glass-panel p-4 rounded-xl border border-surface-border">
            <span className="text-gray-400 block">{st.label}</span>
            <span className="text-lg font-bold text-white mt-1 block">{st.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreHeader() {
  return (
    <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="inline-flex items-center space-x-2 text-xs font-bold text-profit bg-profit/10 px-3 py-1 rounded border border-profit/20 mb-2">
          <Sparkles className="w-4 h-4" />
          <span>0 – 100 INSTITUTIONAL SCORE</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white">Trader Score & Capital Scaling</h1>
        <p className="text-xs text-gray-400 font-sans mt-1">
          &quot;You don&apos;t buy bigger capital. You earn it.&quot; Score is computed from your closed trades
          and equity curve.
        </p>
      </div>
    </div>
  );
}
