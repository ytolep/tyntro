'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import SignInRequired from '@/components/SignInRequired';

interface FundedAccountRow {
  id: string;
  planType: string;
  status: string;
  phase: string;
  accountSize: string;
  equity: string;
  availableUsd: string;
  profitSplitPct: number;
  openPositions: number;
  canRequest: boolean;
}

interface PayoutRow {
  id: string;
  accountId: string;
  amountUsd: string;
  status: string;
  txSignature: string | null;
  createdAt: string;
}

interface Overview {
  walletAddress: string;
  accounts: FundedAccountRow[];
  payouts: PayoutRow[];
}

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'text-amber-300',
  APPROVED: 'text-profit',
  REJECTED: 'text-red-400',
  PAID: 'text-profit',
};

export default function ProfilePage() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/payouts')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => json && setData(json))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const requestPayout = async (account: FundedAccountRow) => {
    const amount = (amounts[account.id] ?? '').trim();
    setSendingId(account.id);
    setMessage((m) => ({ ...m, [account.id]: '' }));
    try {
      const res = await fetch('/api/payouts/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: account.id, amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((m) => ({ ...m, [account.id]: body.error ?? 'Request failed' }));
      } else {
        setMessage((m) => ({ ...m, [account.id]: 'Payout requested' }));
        setAmounts((a) => ({ ...a, [account.id]: '' }));
        load();
      }
    } catch {
      setMessage((m) => ({ ...m, [account.id]: 'Network error' }));
    } finally {
      setSendingId(null);
    }
  };

  // Аноним → единое состояние «нужен вход» (аудит A4), не ошибка с Retry.
  if (user === null) {
    return (
      <SignInRequired
        title="Sign in to view your payouts"
        text="Connect your Solana wallet to see your funded accounts and payout history."
      />
    );
  }

  if (loading) {
    return (
      <div className="site-container dashboard-page">
        <span className="eyebrow">YOUR WORKSPACE / PAYOUTS</span>
        <h1 className="text-4xl mt-5">Loading your payouts…</h1>
      </div>
    );
  }

  // Вошедший пользователь, но ответа нет: сетевая ошибка — Retry уместен.
  if (!data) {
    return (
      <div className="site-container dashboard-page">
        <span className="eyebrow">YOUR WORKSPACE / PAYOUTS</span>
        <h1 className="text-4xl mt-5">Payouts unavailable.</h1>
        <p className="text-gray-400 mt-4 max-w-xl">Could not load your funded accounts and payouts.</p>
        <div className="flex gap-4 mt-6">
          <button className="button-secondary" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const wallet = data.walletAddress;
  const shortWallet = wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;

  return (
    <div className="site-container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE / PAYOUTS</span>
          <h1>Your payouts.</h1>
          <p>
            {shortWallet} · funded accounts, available profit and payout history
          </p>
        </div>
        <Link className="text-button" href="/funded">
          Funded stage <ArrowUpRight size={16} />
        </Link>
      </div>

      {data.accounts.length === 0 ? (
        <div className="u2-empty">
          <span className="eyebrow">NO FUNDED ACCOUNTS YET</span>
          <h2>Payouts start at the funded stage.</h2>
          <p>
            Payouts are available on funded accounts (phase FUNDED_SIM) after your challenge is passed
            and approved by an administrator.
          </p>
          <Link className="button-primary" href="/funded">
            Funded stage <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="u2-cards">
          {data.accounts.map((account) => (
            <article key={account.id} className="u2-card">
              <div className="u2-card-head">
                <span className="eyebrow">FUNDED · {account.planType} PLAN</span>
                <b>{account.status}</b>
              </div>

              <strong>${account.accountSize} capital</strong>

              <dl>
                <div>
                  <dt>Equity</dt>
                  <dd>${account.equity}</dd>
                </div>
                <div>
                  <dt>Open positions</dt>
                  <dd>{account.openPositions}</dd>
                </div>
                <div>
                  <dt>Profit split</dt>
                  <dd>{account.profitSplitPct}%</dd>
                </div>
                <div>
                  <dt>Available for payout</dt>
                  <dd>${account.availableUsd} USD</dd>
                </div>
              </dl>

              <div className="u2-payout-form">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount USD"
                  value={amounts[account.id] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [account.id]: e.target.value }))}
                  disabled={!account.canRequest || sendingId === account.id}
                />
                <button
                  className="button-primary"
                  onClick={() => requestPayout(account)}
                  disabled={!account.canRequest || sendingId === account.id}
                >
                  {sendingId === account.id ? 'Sending…' : 'Request payout'}
                </button>
              </div>
              <p
                className={`text-[11px] mt-2 ${
                  message[account.id]?.startsWith('Payout requested') ? 'text-profit' : 'text-red-400'
                }`}
              >
                {message[account.id] ??
                  (account.canRequest
                    ? ''
                    : account.openPositions > 0
                      ? 'Close all open positions to request a payout.'
                      : 'No withdrawable profit yet. Available = equity − account size, times your split.')}
              </p>
            </article>
          ))}
        </div>
      )}

      <section className="u2-section">
        <div className="panel-heading">
          <h2>Payout history</h2>
          <span>{data.payouts.length} REQUESTS</span>
        </div>
        <div className="u2-table-wrap">
          <table className="u2-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount USD</th>
                <th>Status</th>
                <th>Tx signature</th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.length > 0 ? (
                data.payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{new Date(payout.createdAt).toLocaleString()}</td>
                    <td>${payout.amountUsd}</td>
                    <td className={STATUS_STYLES[payout.status] ?? undefined}>{payout.status}</td>
                    <td>{payout.txSignature ? `${payout.txSignature.slice(0, 16)}…` : '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="u2-empty-cell">
                    No payout requests yet.
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
