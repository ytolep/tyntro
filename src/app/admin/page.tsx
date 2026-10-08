'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { num, usd } from '@/lib/display';
import { useAuth } from '@/lib/auth/AuthContext';
import SignInRequired from '@/components/SignInRequired';
import { BRAND_NAME } from '@/lib/brand';

// Реальные метрики и очереди из /api/admin/metrics и /api/admin/queue (роль ADMIN).
// Сам /admin скрыт layout'ом (404 не-админам); здесь тот же визуальный эталон, что и dashboard.
export default function AdminPage() {
  const { user } = useAuth();
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

  if (user === null) {
    return (
      <SignInRequired
        title="Sign in to view the admin console"
        text="Admin metrics and approval queues are available to administrator accounts only."
      />
    );
  }

  if (loading) {
    return (
      <div className="site-container dashboard-page">
        <span className="eyebrow">{BRAND_NAME} / ADMIN</span>
        <h1 className="text-4xl mt-5">Loading platform metrics…</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div className="site-container dashboard-page">
        <span className="eyebrow">{BRAND_NAME} / ADMIN</span>
        <h1 className="text-4xl mt-5">Metrics unavailable.</h1>
        <p className="text-gray-400 mt-4 max-w-xl">{error}</p>
        <div className="flex gap-4 mt-6">
          <button className="button-secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const m = metrics;
  const fundedQueue: any[] = queue?.fundedQueue ?? [];
  const payoutQueue: any[] = queue?.payoutQueue ?? [];

  const cards = [
    { label: 'EVALUATIONS BOUGHT', value: String(m.purchases), note: '', accent: '' },
    { label: 'REVENUE', value: usd(num(m.revenueUsdc)), note: 'USDC collected', accent: 'text-profit' },
    { label: 'ACTIVE ACCOUNTS', value: String(m.activeAccounts), note: '', accent: '' },
    {
      label: 'PASS RATE',
      value: m.passRatePct === null ? '—' : `${m.passRatePct.toFixed(1)}%`,
      note: 'passed / decided',
      accent: '',
    },
    { label: 'FUNDED ACCOUNTS', value: String(m.fundedAccounts), note: 'FUNDED_SIM phase', accent: '' },
    {
      label: 'PAYOUTS PAID',
      value: `${m.payoutsPaid.count} · ${usd(num(m.payoutsPaid.totalUsd))}`,
      note: 'count · total USD',
      accent: '',
    },
  ];

  return (
    <div className="site-container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{BRAND_NAME} / ADMIN</span>
          <h1>Platform overview.</h1>
          <p>Live platform metrics and approval queues, computed from the database.</p>
        </div>
        <button className="button-secondary" onClick={() => void load()} aria-label="Refresh admin data">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="u2-stats">
        {cards.map((card) => (
          <div key={card.label}>
            <span className="eyebrow">{card.label}</span>
            <strong className={card.accent || undefined}>{card.value}</strong>
            {card.note ? <small>{card.note}</small> : null}
          </div>
        ))}
      </div>

      <section className="u2-section">
        <div className="panel-heading">
          <h2>Funded approval queue</h2>
          <span>{fundedQueue.length} ACCOUNTS</span>
        </div>
        <div className="u2-table-wrap">
          <table className="u2-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Wallet</th>
                <th>Plan</th>
                <th>Size</th>
                <th>Trades</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {fundedQueue.length > 0 ? (
                fundedQueue.map((a) => (
                  <tr key={a.id}>
                    <td>#{a.id.slice(0, 8)}</td>
                    <td>{a.user?.walletAddress}</td>
                    <td>{a.challenge?.planType}</td>
                    <td>{usd(num(a.accountSize))}</td>
                    <td>{a.totalTrades}</td>
                    <td>
                      <span className="text-profit">{a.status}</span>
                      <span className="text-gray-500"> / {a.phase}</span>
                    </td>
                    <td>{new Date(a.updatedAt).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="u2-empty-cell">
                    No passed accounts awaiting a funded decision.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="u2-section">
        <div className="panel-heading">
          <h2>Payout queue</h2>
          <span>{payoutQueue.length} PAYOUTS</span>
        </div>
        <div className="u2-table-wrap">
          <table className="u2-table">
            <thead>
              <tr>
                <th>Payout</th>
                <th>Wallet</th>
                <th>Account</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {payoutQueue.length > 0 ? (
                payoutQueue.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.id.slice(0, 8)}</td>
                    <td>{p.account?.user?.walletAddress}</td>
                    <td>
                      #{p.account?.id.slice(0, 8)} · {p.account?.challenge?.planType}
                    </td>
                    <td>{usd(num(p.amountUsd))}</td>
                    <td
                      className={
                        p.status === 'APPROVED' || p.status === 'PAID'
                          ? 'text-profit'
                          : p.status === 'REJECTED'
                            ? 'text-loss'
                            : 'text-amber-300'
                      }
                    >
                      {p.status}
                    </td>
                    <td>{new Date(p.timestamp).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="u2-empty-cell">
                    No payout requests pending.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
