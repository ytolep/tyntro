'use client';

import React, { useCallback, useEffect, useState } from 'react';
import ConfirmButton from './ConfirmButton';

/**
 * Q2: ручной KYC в очереди выплат. Загружает kycStatus по кошельку из
 * GET /api/admin/kyc?wallet=, решение уходит в POST /api/admin/kyc {userId, status}.
 * Выплата не может стать APPROVED/PAID, пока здесь не VERIFIED (409 KYC_REQUIRED).
 */
const STATUS_CLASS: Record<string, string> = {
  VERIFIED: 'text-profit',
  REJECTED: 'text-loss',
  NONE: 'text-amber-300',
};

export default function KycControl({
  wallet,
  disabled = false,
  onChanged,
}: {
  wallet: string | null | undefined;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [user, setUser] = useState<{ userId: string; kycStatus: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/admin/kyc?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) throw new Error(`KYC lookup failed (${res.status})`);
      setUser(await res.json());
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load KYC status');
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (status: 'VERIFIED' | 'REJECTED') => {
      if (!user) return;
      setBusy(true);
      setError('');
      try {
        const res = await fetch('/api/admin/kyc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: user.userId, status }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        await load();
        onChanged();
      } catch (e: any) {
        setError(e.message || 'Request failed');
      } finally {
        setBusy(false);
      }
    },
    [user, load, onChanged],
  );

  if (!wallet) return <span className="text-gray-500">—</span>;
  if (!user) return <span className="text-gray-500">{error || '…'}</span>;

  return (
    <div className="k1-actions">
      <span className={STATUS_CLASS[user.kycStatus] ?? 'text-amber-300'}>{user.kycStatus}</span>
      {user.kycStatus !== 'VERIFIED' && (
        <ConfirmButton
          label="Verify"
          className="k1-btn k1-btn-primary"
          disabled={disabled || busy}
          onConfirm={() => void decide('VERIFIED')}
        />
      )}
      {user.kycStatus !== 'REJECTED' && (
        <ConfirmButton
          label="Reject KYC"
          className="k1-btn k1-btn-danger"
          disabled={disabled || busy}
          onConfirm={() => void decide('REJECTED')}
        />
      )}
      {error ? <div className="k1-error">{error}</div> : null}
    </div>
  );
}
