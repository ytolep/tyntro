'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';

import React, { useEffect, useState } from 'react';
import { Wallet, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight } from 'lucide-react';

export default function ProfilePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [payoutRequested, setPayoutRequested] = useState<boolean>(false);

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
        <span>Loading Profile & Funded Accounts...</span>
      </div>
    );
  }

  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace/>;
  const { account } = data;
  const earnedProfit = Math.max(0, account.currentEquity - account.accountSize);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      <AccountModeNotice execution={data.execution}/>
      {/* Profile Header */}
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand-600 to-profit text-black font-extrabold flex items-center justify-center text-xl">
            A
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white">AlphaTrader_01</h1>
            <div className="text-xs text-gray-400 font-mono mt-0.5 flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-profit" />
              <span>7xKX...9q2W</span>
            </div>
          </div>
        </div>

        <div className="flex space-x-3 text-xs">
          <div className="bg-[#19191f] p-3 rounded-xl border border-surface-border">
            <span className="text-gray-400 block text-[10px]">VERIFICATION</span>
            <span className="text-profit font-bold">NOT VERIFIED</span>
          </div>
        </div>
      </div>

      {/* Active Accounts & Payout Request */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
          <h3 className="text-base font-bold text-white uppercase tracking-wider border-b border-surface-border pb-3">
            Active Evaluation Accounts
          </h3>

          <div className="bg-[#101015] p-4 rounded-xl border border-surface-border space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-profit font-bold">{account.challenge?.planType} PLAN</span>
              <span className="bg-profit/10 text-profit px-2 py-0.5 rounded font-bold">{account.status}</span>
            </div>
            <div className="text-xl font-extrabold text-white">${account.accountSize.toLocaleString()} Capital</div>
            <div className="flex justify-between text-xs text-gray-400 pt-2 border-t border-surface-border/60">
              <span>Equity: ${account.currentEquity.toLocaleString()}</span>
              <span>Static DD: ${account.staticMaxDdFloor.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
          <h3 className="text-base font-bold text-white uppercase tracking-wider border-b border-surface-border pb-3">
            Funded Payout Requests
          </h3>

          <div className="bg-[#101015] p-4 rounded-xl border border-surface-border space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">VIRTUAL CHALLENGE PROFIT</span>
              <span className="text-profit font-bold">${earnedProfit.toFixed(2)} USD</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">WITHDRAWABLE PROFIT</span>
              <span className="text-white font-bold">$0.00 USD</span>
            </div>

            <button
              disabled
              className="w-full py-3 bg-gradient-to-r from-brand-600 to-profit text-black font-extrabold rounded-xl text-xs transition-all hover:opacity-90 disabled:opacity-50 mt-2"
            >
              Payouts require an activated funded account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
