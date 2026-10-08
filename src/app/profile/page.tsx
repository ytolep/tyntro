'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Wallet } from 'lucide-react';

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

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-gray-400">
        <RefreshCw className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
        <span>Loading Profile & Payouts...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono space-y-4">
        <p className="text-gray-400">Sign in to view your funded accounts and payouts.</p>
        <Link className="button-primary" href="/">Back to home</Link>
      </div>
    );
  }

  const wallet = data.walletAddress;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-mono space-y-8">
      {/* Header */}
      <div className="bg-[#101015] p-6 rounded-2xl border border-surface-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand-600 to-profit text-black font-extrabold flex items-center justify-center text-xl">
            P
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white">Trader Profile</h1>
            <div className="text-xs text-gray-400 font-mono mt-0.5 flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-profit" />
              <span>{wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet}</span>
            </div>
          </div>
        </div>
      </div>

      {data.accounts.length === 0 ? (
        <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-3">
          <h3 className="text-base font-bold text-white uppercase tracking-wider">No funded accounts yet</h3>
          <p className="text-sm text-gray-400">
            Payouts are available on funded accounts (phase FUNDED_SIM) after your challenge is passed and approved by an administrator.
          </p>
          <Link className="button-primary inline-block" href="/funded">Funded stage →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.accounts.map((account) => (
            <div key={account.id} className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
              <h3 className="text-base font-bold text-white uppercase tracking-wider border-b border-surface-border pb-3">
                Funded Account · {account.planType} Plan
              </h3>

              <div className="bg-[#101015] p-4 rounded-xl border border-surface-border space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-profit font-bold">FUNDED_SIM · {account.status}</span>
                  <span className="text-gray-400">Split: {account.profitSplitPct}%</span>
                </div>
                <div className="text-xl font-extrabold text-white">${account.accountSize} Capital</div>
                <div className="flex justify-between text-xs text-gray-400 pt-2 border-t border-surface-border/60">
                  <span>Equity: ${account.equity}</span>
                  <span>Open positions: {account.openPositions}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">AVAILABLE FOR PAYOUT</span>
                  <span className="text-profit font-bold">${account.availableUsd} USD</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount USD"
                    value={amounts[account.id] ?? ''}
                    onChange={(e) => setAmounts((a) => ({ ...a, [account.id]: e.target.value }))}
                    disabled={!account.canRequest || sendingId === account.id}
                    className="w-full bg-[#101015] border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
                  />
                  <button
                    onClick={() => requestPayout(account)}
                    disabled={!account.canRequest || sendingId === account.id}
                    className="whitespace-nowrap px-4 py-3 bg-gradient-to-r from-brand-600 to-profit text-black font-extrabold rounded-xl text-xs transition-all hover:opacity-90 disabled:opacity-50"
                  >
                    Request payout
                  </button>
                </div>
                <p className={`text-xs ${message[account.id]?.startsWith('Payout requested') ? 'text-profit' : 'text-red-400'}`}>
                  {message[account.id] ??
                    (account.canRequest
                      ? ''
                      : account.openPositions > 0
                        ? 'Close all open positions to request a payout.'
                        : 'No withdrawable profit yet. Available = equity − account size, times your split.')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      <div className="glass-panel p-6 rounded-2xl border border-surface-border space-y-4">
        <h3 className="text-base font-bold text-white uppercase tracking-wider border-b border-surface-border pb-3">
          Payout History
        </h3>
        {data.payouts.length === 0 ? (
          <p className="text-sm text-gray-400">No payout requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left border-b border-surface-border">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Amount USD</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Tx signature</th>
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((payout) => (
                  <tr key={payout.id} className="border-b border-surface-border/40">
                    <td className="py-2 pr-4 text-gray-400">{new Date(payout.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-white font-bold">${payout.amountUsd}</td>
                    <td className={`py-2 pr-4 font-bold ${STATUS_STYLES[payout.status] ?? 'text-gray-300'}`}>{payout.status}</td>
                    <td className="py-2 text-gray-400">
                      {payout.txSignature ? `${payout.txSignature.slice(0, 16)}…` : '—'}
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
