'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { activeAccountUrl } from '@/lib/activeAccount';

type FundedStage =
  | { kind: 'loading' }
  | { kind: 'no-account' }
  | { kind: 'challenge'; status: string }
  | { kind: 'passed'; requested: boolean }
  | { kind: 'funded' };

export default function FundedPage() {
  const [stage, setStage] = useState<FundedStage>({ kind: 'loading' });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(activeAccountUrl()).then((r) => r.json()).catch(() => null),
      fetch('/api/payouts').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([active, payouts]) => {
      if (!alive) return;
      const account = active?.account;
      const fundRequested = new Set<string>((payouts?.fundRequestAccountIds ?? []) as string[]);
      if (payouts?.accounts?.length > 0 || account?.phase === 'FUNDED_SIM') {
        setStage({ kind: 'funded' });
      } else if (account) {
        setAccountId(account.id);
        if (account.status === 'PASSED') setStage({ kind: 'passed', requested: fundRequested.has(account.id) });
        else if (account.status === 'FAILED') setStage({ kind: 'challenge', status: 'FAILED' });
        else setStage({ kind: 'challenge', status: account.status });
      } else {
        setStage({ kind: 'no-account' });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const requestFunded = async () => {
    if (!accountId) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/funded/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Request failed');
      } else {
        setStage({ kind: 'passed', requested: true });
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  const stageText =
    stage.kind === 'funded'
      ? 'Funded account active · simulated execution (FUNDED_SIM)'
      : stage.kind === 'passed'
        ? stage.requested
          ? 'Challenge passed · funded review requested, awaiting admin decision'
          : 'Challenge passed · ready to request funded review'
        : stage.kind === 'challenge'
          ? `Challenge ${stage.status.toLowerCase()} · virtual capital`
          : 'Choose a challenge to begin.';

  return (
    <main className="site-container dashboard-page">
      <span className="eyebrow">CHALLENGE → REVIEW → FUNDED</span>
      <h1 className="text-4xl mt-5">Your path to funded.</h1>
      <p className="text-gray-400 mt-5 max-w-2xl">
        Prove your discipline with virtual capital. After passing and admin approval, a separate funded
        account opens with simulated execution: you keep your profit split, payouts are paid in USDC.
      </p>

      <div className="account-mode-notice mt-8">
        <div>
          <span className="eyebrow">CURRENT STAGE</span>
          <p>{stage.kind === 'loading' ? 'Loading account…' : stageText}</p>
        </div>
      </div>

      {stage.kind === 'passed' && !stage.requested && (
        <div className="flex flex-col gap-2 mt-6 max-w-md">
          <button className="button-primary" onClick={requestFunded} disabled={sending}>
            {sending ? 'Sending…' : 'Запросить funded'}
          </button>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
      )}
      {stage.kind === 'passed' && stage.requested && (
        <p className="text-profit mt-6">Request sent. An administrator will review your account.</p>
      )}
      {stage.kind === 'funded' && (
        <div className="flex flex-wrap gap-4 mt-6">
          <Link className="button-primary" href="/profile">
            Payouts & profit split →
          </Link>
          <Link className="button-secondary" href="/terminal">
            Trade on the funded account
          </Link>
        </div>
      )}

      <div className="journey-grid">
        <article>
          <div className="journey-top"><span>01 / CHALLENGE</span></div>
          <h3>Virtual funds. Live markets.</h3>
          <p>Phoenix prices and order books power the evaluation. Orders execute in our simulator; the platform tracks the challenge rules.</p>
        </article>
        <article>
          <div className="journey-top"><span>02 / REVIEW</span></div>
          <h3>Passing is a milestone.</h3>
          <p>Request funded review after passing. An administrator approves or rejects it; passing never automatically starts the funded stage.</p>
        </article>
        <article>
          <div className="journey-top"><span>03 / FUNDED</span></div>
          <h3>Funded account with simulated execution.</h3>
          <p>After approval you get a new funded account (FUNDED_SIM) with the same rules and size. Your profit split is withdrawable in USDC; real Phoenix capital comes later.</p>
        </article>
      </div>

      <div className="flex flex-wrap gap-4 mt-8">
        <Link className="button-secondary" href={stage.kind === 'no-account' ? '/challenges' : '/dashboard'}>
          {stage.kind === 'no-account' ? 'Choose a challenge' : 'Back to account'}
        </Link>
      </div>
    </main>
  );
}
