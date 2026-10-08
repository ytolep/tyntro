'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Settings, RefreshCw, ShieldCheck, Clock } from 'lucide-react';
import { num, usd } from '@/lib/display';

// Реальные метрики и очереди из /api/admin/metrics и /api/admin/queue (роль ADMIN).
export default function AdminPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [mRes, qRes] = await Promise.all([fetch('/api/admin/metrics'), fetch('/api/admin/queue')]);
      if (!mRes.ok || !qRes.ok) {
        const body = await mRes.json().catch(() => ({}));
        throw new Error(body.error || `Admin API error (${mRes.status})`);
      }
      setMetrics(await mRes.json());
      setQueue(await qRes.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-gray-400">
        <RefreshCw className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
        <span>Loading platform metrics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-6">
        <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border">
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-profit" /> Platform Admin
          </h1>
        </div>
        <div className="p-6 bg-[#19191f] border border-surface-border text-sm text-gray-300 rounded-xl">
          {error}
          <div className="mt-3">
            <button
              onClick={() => void load()}
              className="py-2 px-4 bg-[#232329] hover:bg-[#292930] border border-surface-border text-white font-bold text-xs rounded-lg"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const m = metrics;
  const fundedQueue: any[] = queue?.fundedQueue ?? [];
  const payoutQueue: any[] = queue?.payoutQueue ?? [];

  const cards = [
    { label: 'EVALUATIONS BOUGHT', value: String(m.purchases), accent: 'text-white' },
    { label: 'REVENUE (USDC)', value: usd(num(m.revenueUsdc)), accent: 'text-profit' },
    { label: 'ACTIVE ACCOUNTS', value: String(m.activeAccounts), accent: 'text-white' },
    {
      label: 'PASS RATE (PASSED / DECIDED)',
      value: m.passRatePct === null ? '—' : `${m.passRatePct.toFixed(1)}%`,
      accent: 'text-cyanAccent',
    },
    { label: 'FUNDED ACCOUNTS', value: String(m.fundedAccounts), accent: 'text-white' },
    {
      label: 'PAYOUTS PAID',
      value: `${m.payoutsPaid.count} · ${usd(num(m.payoutsPaid.totalUsd))}`,
      accent: 'text-white',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-profit" /> Platform Admin
          </h1>
          <p className="text-xs text-gray-400 font-sans mt-1">
            Live platform metrics and approval queues, computed from the database.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-profit bg-profit/10 px-3 py-1 rounded border border-profit/20">
            ADMIN ACCESS
          </span>
          <button
            aria-label="Refresh admin data"
            onClick={() => void load()}
            className="p-2 bg-[#19191f] border border-surface-border rounded-lg text-gray-300 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {cards.map((card) => (
          <div key={card.label} className="glass-panel p-4 rounded-xl border border-surface-border">
            <span className="text-gray-400 block">{card.label}</span>
            <span className={`text-2xl font-bold mt-1 block ${card.accent}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* FUNDED APPROVAL QUEUE */}
      <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-profit" /> Funded Approval Queue
          <span className="text-xs text-gray-400 font-sans">— accounts passed, awaiting decision ({fundedQueue.length})</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-surface-border text-gray-400">
                <th className="py-3 px-4">ACCOUNT</th>
                <th className="py-3 px-4">WALLET</th>
                <th className="py-3 px-4">PLAN</th>
                <th className="py-3 px-4">SIZE</th>
                <th className="py-3 px-4">TRADES</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4">UPDATED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-gray-200">
              {fundedQueue.length > 0 ? (
                fundedQueue.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3.5 px-4 font-bold text-white">#{a.id.slice(0, 8)}</td>
                    <td className="py-3.5 px-4 text-gray-300">{a.user?.walletAddress}</td>
                    <td className="py-3.5 px-4">{a.challenge?.planType}</td>
                    <td className="py-3.5 px-4 font-bold">{usd(num(a.accountSize))}</td>
                    <td className="py-3.5 px-4">{a.totalTrades}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-profit font-bold">{a.status}</span>
                      <span className="text-gray-500"> / {a.phase}</span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-400">{new Date(a.updatedAt).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-500">
                    No passed accounts awaiting a funded decision.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PAYOUT QUEUE */}
      <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyanAccent" /> Payout Queue
          <span className="text-xs text-gray-400 font-sans">
            — requested and approved payouts ({payoutQueue.length})
          </span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-surface-border text-gray-400">
                <th className="py-3 px-4">PAYOUT</th>
                <th className="py-3 px-4">WALLET</th>
                <th className="py-3 px-4">ACCOUNT</th>
                <th className="py-3 px-4">AMOUNT</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4">REQUESTED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-gray-200">
              {payoutQueue.length > 0 ? (
                payoutQueue.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3.5 px-4 font-bold text-white">#{p.id.slice(0, 8)}</td>
                    <td className="py-3.5 px-4 text-gray-300">{p.account?.user?.walletAddress}</td>
                    <td className="py-3.5 px-4">
                      #{p.account?.id.slice(0, 8)} · {p.account?.challenge?.planType}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{usd(num(p.amountUsd))}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === 'APPROVED' ? 'bg-profit/10 text-profit' : 'bg-cyanAccent/10 text-cyanAccent'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-400">{new Date(p.timestamp).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    No payout requests pending.
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
