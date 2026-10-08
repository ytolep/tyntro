'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import { num, usd } from '@/lib/display';
import { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Clock,
  Activity,
  RefreshCw
} from 'lucide-react';

// Данные из /api/accounts/active: riskEval может быть null, пока движок риска
// не вернул оценку — тогда показываем пустые значения вместо краха страницы.
export default function RiskPage() {
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
        <span>Evaluating Risk Engine Contracts...</span>
      </div>
    );
  }

  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace/>;
  const { account, riskEval } = data;
  const maxDdPct = account.challenge?.maxDdPct;
  const dailyDdPct = account.challenge?.dailyDdPct;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      {/* Risk Engine Banner */}
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 text-xs font-bold text-profit bg-profit/10 px-3 py-1 rounded border border-profit/20 mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span>V1 INSTITUTIONAL RISK ENGINE</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Risk Engine Analytics</h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Real-time evaluation of static drawdown floors, daily 00:00 UTC limits, and exposure limits.
          </p>
        </div>

        <div className="flex items-center space-x-4">
          <div className="bg-[#19191f] p-3 rounded-xl border border-surface-border text-right">
            <span className="text-[10px] text-gray-400 block">CURRENT RISK LEVEL</span>
            <span className={`text-base font-extrabold uppercase ${riskEval?.riskLevel === 'FAILED' ? 'text-loss' : 'text-profit'}`}>
              {riskEval?.riskLevel ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* STATIC VS DAILY DRAWDOWN ANALYTICS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Static Max Drawdown Panel */}
        <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
          <div className="flex justify-between items-center border-b border-surface-border pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-profit" /> Static Max Drawdown Floor
            </h3>
            <span className="text-xs font-bold text-profit bg-profit/10 px-2.5 py-0.5 rounded">FIXED FLOOR</span>
          </div>

          <p className="text-xs text-gray-400 font-sans leading-relaxed">
            Your maximum drawdown floor is anchored strictly to your initial account size ({usd(num(account.accountSize))}) and <strong>NEVER moves upwards</strong> with open or realized profits.
          </p>

          <div className="bg-[#101015] p-4 rounded-xl border border-surface-border space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">INITIAL ACCOUNT CAPITAL</span>
              <span className="font-bold text-white">{usd(num(account.accountSize))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">CURRENT EQUITY</span>
              <span className="font-bold text-white">{usd(num(account.currentEquity))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">STATIC HARD FAILURE FLOOR</span>
              <span className="font-bold text-profit">
                {riskEval ? `${usd(num(riskEval.staticFloor))} (${maxDdPct}% Max DD)` : '—'}
              </span>
            </div>
            <div className="flex justify-between border-t border-surface-border/60 pt-2">
              <span className="text-gray-400">SAFETY CUSHION DISTANCE</span>
              <span className="font-bold text-profit">
                {riskEval ? `+${riskEval.staticDdDistancePct.toFixed(2)}% Safe` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Daily Drawdown Reset Panel */}
        <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
          <div className="flex justify-between items-center border-b border-surface-border pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-cyanAccent" /> Daily Drawdown (00:00 UTC Reset)
            </h3>
            <span className="text-xs font-bold text-cyanAccent bg-cyanAccent/10 px-2.5 py-0.5 rounded">
              {dailyDdPct ?? '—'}% DAILY LIMIT
            </span>
          </div>

          <p className="text-xs text-gray-400 font-sans leading-relaxed">
            Daily drawdown resets every day at 00:00 UTC based on equity at that exact timestamp. Includes realized PnL, unrealized open PnL, fees, and funding.
          </p>

          <div className="bg-[#101015] p-4 rounded-xl border border-surface-border space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">DAY-START EQUITY (00:00 UTC)</span>
              <span className="font-bold text-white">{usd(num(account.dayStartEquity))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">TODAY&apos;S DAILY FAILURE FLOOR</span>
              <span className="font-bold text-cyanAccent">
                {riskEval ? usd(num(riskEval.dailyFloor)) : '—'}
              </span>
            </div>
            <div className="flex justify-between border-t border-surface-border/60 pt-2">
              <span className="text-gray-400">DAILY LOSS BUFFER</span>
              <span className="font-bold text-cyanAccent">
                {riskEval ? `+${riskEval.dailyDdDistancePct.toFixed(2)}% Remaining` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RISK EVENT AUDIT LOG TABLE */}
      <div className="glass-panel p-6 rounded-2xl border border-surface-border">
        <h3 className="text-base font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-profit" /> Risk Audit Event Log
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-surface-border text-gray-400">
                <th className="py-3 px-4">TIMESTAMP</th>
                <th className="py-3 px-4">LEVEL</th>
                <th className="py-3 px-4">RULE NAME</th>
                <th className="py-3 px-4">DESCRIPTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-gray-200">
              {account.riskEvents && account.riskEvents.length > 0 ? (
                account.riskEvents.map((evt: any) => (
                  <tr key={evt.id}>
                    <td className="py-3 px-4 text-gray-400">
                      {new Date(evt.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-bold">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        evt.level === 'SAFE' ? 'bg-profit/10 text-profit' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {evt.level}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-white">{evt.ruleName}</td>
                    <td className="py-3 px-4 text-gray-300">{evt.description}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    No risk violations recorded. Risk status is HEALTHY.
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
