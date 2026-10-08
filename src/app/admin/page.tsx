'use client';

import React, { useState } from 'react';
import { Settings, RefreshCw, Clock, AlertTriangle, Shield, CheckCircle2 } from 'lucide-react';

export default function AdminPage() {
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>('');

  const triggerReset = async (action: string) => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/reset-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, accountId: localStorage.getItem('activeAccountId') }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Action failed');
      setMsg(`Action executed successfully: ${action}`);
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-profit" /> Platform Admin & Risk Engine Controls
          </h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Simulate 00:00 UTC day resets, inspect risk review queues, and manage evaluation parameters.
          </p>
        </div>
        <span className="text-xs font-bold text-profit bg-profit/10 px-3 py-1 rounded border border-profit/20">
          ADMIN ACCESS
        </span>
      </div>

      {msg && (
        <div className="p-4 bg-[#19191f] border border-surface-border text-xs text-profit rounded-xl">
          {msg}
        </div>
      )}

      {/* METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <div className="glass-panel p-4 rounded-xl border border-surface-border">
          <span className="text-gray-400 block">TOTAL EVALUATIONS BOUGHT</span>
          <span className="text-2xl font-bold text-white mt-1 block">142</span>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-surface-border">
          <span className="text-gray-400 block">ACTIVE ACCOUNTS</span>
          <span className="text-2xl font-bold text-profit mt-1 block">98</span>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-surface-border">
          <span className="text-gray-400 block">EVALUATION PASS RATE</span>
          <span className="text-2xl font-bold text-cyanAccent mt-1 block">14.2%</span>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-surface-border">
          <span className="text-gray-400 block">FUNDED CAPITAL ALLOCATED</span>
          <span className="text-2xl font-bold text-white mt-1 block">$1,450,000</span>
        </div>
      </div>

      {/* SIMULATION CONTROLS */}
      <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-profit" /> Risk Engine Simulator Controls
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#101015] p-5 rounded-xl border border-surface-border space-y-3">
            <h4 className="font-bold text-white text-sm">Simulate 00:00 UTC Day Reset</h4>
            <p className="text-xs text-gray-400 font-sans">
              Updates day-start equity to current equity snapshot, increments trading day count, and recalculates daily DD floor.
            </p>
            <button
              onClick={() => triggerReset('TRIGGER_UTC_RESET')}
              disabled={loading}
              className="py-2.5 px-4 bg-gradient-to-r from-brand-600 to-profit text-black font-bold text-xs rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Trigger 00:00 UTC Reset'}
            </button>
          </div>

          <div className="bg-[#101015] p-5 rounded-xl border border-surface-border space-y-3">
            <h4 className="font-bold text-white text-sm">Reset Demo Account</h4>
            <p className="text-xs text-gray-400 font-sans">
              Restores active demo account to initial $10,000 state and closes open positions.
            </p>
            <button
              onClick={() => triggerReset('RESET_DEMO_ACCOUNT')}
              disabled={loading}
              className="py-2.5 px-4 bg-[#19191f] hover:bg-[#292930] border border-surface-border text-white font-bold text-xs rounded-lg transition-all disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Reset Demo Account to $10K'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
