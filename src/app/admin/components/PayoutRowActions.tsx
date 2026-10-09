'use client';

import React, { useState } from 'react';
import ConfirmButton from './ConfirmButton';

/** Подпись транзакции Solana: base58 (без 0, O, I, l), 64–88 символов. */
export const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta';

/**
 * Approve / Reject / Mark paid для выплаты.
 * Mark paid раскрывает поле подписи транзакции (base58, 64–88) со ссылкой
 * на explorer с кластером из NEXT_PUBLIC_SOLANA_CLUSTER; решение уходит
 * в /api/admin/payouts/decide одним запросом.
 */
export default function PayoutRowActions({
  status,
  disabled,
  onDecide,
}: {
  status: string;
  disabled: boolean;
  onDecide: (approve: boolean, txSignature?: string) => void;
}) {
  const [paidOpen, setPaidOpen] = useState(false);
  const [sig, setSig] = useState('');
  const trimmed = sig.trim();
  const sigValid = BASE58_SIG.test(trimmed);

  return (
    <div className="k1-actions">
      {status === 'REQUESTED' && (
        <ConfirmButton
          label="Approve"
          className="k1-btn k1-btn-primary"
          disabled={disabled}
          onConfirm={() => onDecide(true)}
        />
      )}
      <ConfirmButton label="Reject" className="k1-btn k1-btn-danger" disabled={disabled} onConfirm={() => onDecide(false)} />
      <button
        type="button"
        className="k1-btn"
        disabled={disabled}
        aria-expanded={paidOpen}
        onClick={() => setPaidOpen((v) => !v)}
      >
        {paidOpen ? 'Close mark paid' : 'Mark paid…'}
      </button>
      {paidOpen && (
        <div className="k1-paid-form">
          <input
            value={sig}
            onChange={(e) => setSig(e.target.value)}
            placeholder="Transaction signature (base58)"
            spellCheck={false}
            autoComplete="off"
            aria-label="Transaction signature"
          />
          <ConfirmButton
            label="Mark paid"
            className="k1-btn k1-btn-primary"
            disabled={disabled || !sigValid}
            onConfirm={() => onDecide(true, trimmed)}
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
            <span className="k1-sig-hint">Send USDC manually, then paste the transaction signature</span>
          )}
        </div>
      )}
    </div>
  );
}
