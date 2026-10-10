'use client';

import React, { useCallback, useEffect, useState } from 'react';
import ConfirmButton from './ConfirmButton';
import { BASE58_SIG } from './PayoutRowActions';
import { shortWallet, usd } from '@/lib/display';

const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta';

interface PurchaseRow {
  id: string;
  amountUsdc: string;
  createdAt: string;
  walletAddress: string;
  planType: string;
  accountSize: string;
  account: { id: string; status: string; phase: string; openPositions: number } | null;
}

/**
 * Раздел «Recent purchases»: последние 20 PAID-покупок и ручной возврат.
 * По /refunds админ переводит USDC вручную и вводит подпись транзакции
 * (base58, 64–88); счёт с открытыми позициями вернуть нельзя (API ответит 409).
 */
export default function RefundControl({ disabled = false }: { disabled?: boolean }) {
  const [purchases, setPurchases] = useState<PurchaseRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sig, setSig] = useState('');
  const [reason, setReason] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/purchases');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Admin API error (${res.status})`);
      }
      setPurchases((await res.json()).purchases ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load purchases');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refund = useCallback(
    async (purchaseId: string) => {
      if (busy) return;
      setBusy(true);
      setRowErrors((prev) => ({ ...prev, [purchaseId]: '' }));
      try {
        const res = await fetch('/api/admin/refunds', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ purchaseId, txSignature: sig.trim(), reason: reason.trim() || undefined }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setOpenId(null);
        setSig('');
        setReason('');
        await load();
      } catch (e: any) {
        setRowErrors((prev) => ({ ...prev, [purchaseId]: e.message || 'Request failed' }));
      } finally {
        setBusy(false);
      }
    },
    [busy, sig, reason, load],
  );

  const rows = purchases ?? [];
  const trimmed = sig.trim();
  const sigValid = BASE58_SIG.test(trimmed);

  return (
    <section className="u2-section">
      <div className="panel-heading">
        <h2>Recent purchases</h2>
        <span>{rows.length} PAID</span>
      </div>
      {error ? (
        <p className="text-gray-400">{error}</p>
      ) : (
        <div className="u2-table-wrap">
          <table className="u2-table">
            <thead>
              <tr>
                <th>Purchase</th>
                <th>Wallet</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Account</th>
                <th>Paid at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((p) => {
                  const open = openId === p.id;
                  const blocked = (p.account?.openPositions ?? 0) > 0;
                  return (
                    <tr key={p.id}>
                      <td>#{p.id.slice(0, 8)}</td>
                      <td title={p.walletAddress}>{shortWallet(p.walletAddress)}</td>
                      <td>
                        {p.planType} · {usd(p.accountSize)}
                      </td>
                      <td>{usd(p.amountUsdc)}</td>
                      <td>
                        {p.account ? (
                          <>
                            <span className={p.account.status === 'ACTIVE' ? 'text-profit' : 'text-loss'}>
                              {p.account.status}
                            </span>
                            {blocked ? <span className="text-amber-300"> · {p.account.openPositions} open</span> : null}
                          </>
                        ) : (
                          <span className="text-gray-500">no account</span>
                        )}
                      </td>
                      <td>{new Date(p.createdAt).toLocaleString()}</td>
                      <td className="k1-cell">
                        <div className="k1-actions">
                          <button
                            type="button"
                            className="k1-btn"
                            disabled={disabled || busy}
                            aria-expanded={open}
                            onClick={() => {
                              setOpenId(open ? null : p.id);
                              setSig('');
                              setReason('');
                              setRowErrors((prev) => ({ ...prev, [p.id]: '' }));
                            }}
                          >
                            {open ? 'Close refund' : 'Refund…'}
                          </button>
                          {open && (
                            <div className="k1-paid-form">
                              <input
                                value={sig}
                                onChange={(e) => setSig(e.target.value)}
                                placeholder="Refund transaction signature (base58)"
                                spellCheck={false}
                                autoComplete="off"
                                aria-label="Refund transaction signature"
                              />
                              <input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Reason (optional)"
                                autoComplete="off"
                                aria-label="Refund reason"
                              />
                              <ConfirmButton
                                label="Refund"
                                className="k1-btn k1-btn-danger"
                                disabled={disabled || busy || !sigValid}
                                onConfirm={() => void refund(p.id)}
                              />
                              {sigValid ? (
                                <a
                                  className="k1-sig-link"
                                  href={`https://explorer.solana.com/tx/${trimmed}${
                                    CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`
                                  }`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View on explorer
                                </a>
                              ) : trimmed ? (
                                <span className="k1-sig-hint">Signature must be base58, 64–88 characters</span>
                              ) : (
                                <span className="k1-sig-hint">
                                  Send USDC back to the trader manually, then paste the transaction signature
                                </span>
                              )}
                            </div>
                          )}
                          {rowErrors[p.id] ? <div className="k1-error">{rowErrors[p.id]}</div> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="u2-empty-cell">
                    No paid purchases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
