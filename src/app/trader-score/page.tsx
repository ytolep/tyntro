'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';

// Волна 0: страница-заглушка. Прототип показывал Trader Score из вымышленных чисел,
// что нарушает §5 плана («в интерфейсе нет вымышленных чисел»). Волна 2 (агент H)
// подключит src/lib/core/score.ts к реальным сделкам и снапшотам equity.
export default function TraderScorePage() {
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
        <span>Loading account...</span>
      </div>
    );
  }

  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;
  const { account } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 text-xs font-bold text-profit bg-profit/10 px-3 py-1 rounded border border-profit/20 mb-2">
            <Sparkles className="w-4 h-4" />
            <span>0 – 100 INSTITUTIONAL SCORE</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Trader Score & Capital Scaling</h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            &quot;You don&apos;t buy bigger capital. You earn it.&quot; Build your score to unlock funded allocations up to $100K.
          </p>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-surface-border text-center">
        <span className="text-gray-400 font-mono text-sm">
          Trader Score is computed from your closed trades and will appear here in a future update.
        </span>
        <div className="text-[10px] text-gray-500 font-sans mt-2">
          Account status: {account.status}
        </div>
      </div>
    </div>
  );
}
