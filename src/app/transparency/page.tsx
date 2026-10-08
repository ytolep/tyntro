'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type { TransparencyReport } from '@/lib/transparency/report';
import { BRAND_NAME } from '@/lib/brand';

// Пункт T4: публичная страница прозрачности. Все числа — из /api/transparency,
// вымышленных значений нет: null и незагруженное → прочерк с пояснением.

const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta';

const explorerUrl = (wallet: string) =>
  CLUSTER === 'mainnet-beta'
    ? `https://explorer.solana.com/address/${wallet}`
    : `https://explorer.solana.com/address/${wallet}?cluster=${CLUSTER}`;

const count = (n: number) => n.toLocaleString('en-US');
const usd = (s: string) =>
  `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export default function TransparencyPage() {
  const [report, setReport] = useState<TransparencyReport | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch('/api/transparency');
      if (!res.ok) throw new Error(String(res.status));
      setReport((await res.json()) as TransparencyReport);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const r = report;
  const dash = <span aria-label="No data yet">—</span>;

  return (
    <div className="site-container challenge-page">
      <div className="section-heading">
        <span className="eyebrow">TRANSPARENCY</span>
        <h1>Proof, not<br /><span>promises.</span></h1>
      </div>
      <p className="text-sm text-gray-400 mt-5 max-w-xl">
        Every number on this page comes from the same books that run {BRAND_NAME} — nothing hand-picked, nothing rounded in our favor. Updated at most a minute ago.
      </p>

      {failed && !r ? (
        <div className="flex items-center gap-4 mt-8">
          <span className="text-sm text-gray-400">Could not load the latest numbers.</span>
          <button className="button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Retry</button>
        </div>
      ) : null}

      <div className="metrics-strip mt-10">
        <div>
          <span>Challenges sold</span>
          <strong>{r ? count(r.challengesSold) : dash}</strong>
          <small className="block text-[10px] text-gray-500 mt-3">Paid evaluations on the platform</small>
        </div>
        <div>
          <span>Trader pass rate</span>
          <strong>{r && r.passRate !== null ? pct(r.passRate) : dash}</strong>
          <small className="block text-[10px] text-gray-500 mt-3">
            {r && r.passRate !== null ? 'PASSED / (PASSED + FAILED), decided evaluations' : 'Not enough data yet — shown once 20 evaluations are decided'}
          </small>
        </div>
        <div>
          <span>Paid to traders</span>
          <strong>{r ? usd(r.payoutsPaidUsd) : dash}</strong>
          <small className="block text-[10px] text-gray-500 mt-3">{r ? `${count(r.payoutsCount)} completed payout${r.payoutsCount === 1 ? '' : 's'} in USDC` : 'Completed payouts in USDC'}</small>
        </div>
        <div>
          <span>Funded accounts</span>
          <strong>{r ? count(r.fundedAccounts) : dash}</strong>
          <small className="block text-[10px] text-gray-500 mt-3">Accounts trading in the funded stage</small>
        </div>
      </div>

      <section className="mt-16">
        <span className="eyebrow">TREASURY WALLET</span>
        <h2 className="text-3xl font-normal mt-4">One wallet you can audit.</h2>
        <p className="text-sm text-gray-400 mt-4 max-w-xl">
          All challenge fees are paid into this wallet, and every trader payout is sent from it. Check both sides yourself in the Solana explorer.
        </p>
        {r?.treasuryWallet ? (
          <div className="mt-6 flex flex-col gap-3 items-start">
            <Link href={explorerUrl(r.treasuryWallet)} target="_blank" rel="noreferrer" className="text-button">
              View treasury in explorer <ArrowUpRight size={16} />
            </Link>
            <span className="break-all text-xs text-gray-500">{r.treasuryWallet}</span>
            <span className="text-sm text-gray-400">
              USDC balance:{' '}
              {r.treasuryUsdc !== null ? <strong className="font-normal text-gray-200">{usd(r.treasuryUsdc)}</strong> : 'unavailable right now'}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mt-6">Treasury wallet is not published yet. Not enough data yet.</p>
        )}
      </section>

      <section className="mt-16">
        <span className="eyebrow">HOW PAYOUTS WORK</span>
        <h2 className="text-3xl font-normal mt-4">From profit to your wallet.</h2>
        <div className="journey-grid">
          <article>
            <div className="journey-top"><span>01</span></div>
            <h3>Pass and get funded</h3>
            <p>Finish your evaluation, pass our review, and your account moves to the funded stage with the same rules and size.</p>
          </article>
          <article>
            <div className="journey-top"><span>02</span></div>
            <h3>Trade and request</h3>
            <p>On a funded account you keep an 80% profit share. Request a payout whenever your share is positive and you hold no open positions.</p>
          </article>
          <article>
            <div className="journey-top"><span>03</span></div>
            <h3>Reviewed, paid, recorded</h3>
            <p>An admin approves the request, USDC is sent from the treasury wallet, and the payout is recorded with its on-chain signature.</p>
          </article>
        </div>
      </section>

      <section className="mt-16">
        <span className="eyebrow">HOW THESE NUMBERS ARE COUNTED</span>
        <ul className="mt-6 text-sm text-gray-400 max-w-2xl list-disc pl-5 space-y-2">
          <li><span className="text-gray-200">Challenges sold</span> — count of paid challenge purchases.</li>
          <li><span className="text-gray-200">Pass rate</span> — PASSED divided by all decided evaluations (PASSED + FAILED). Hidden below 20 decided evaluations: a smaller share is noise, not a trend.</li>
          <li><span className="text-gray-200">Paid to traders</span> — sum of completed payouts, in USDC.</li>
          <li><span className="text-gray-200">Funded accounts</span> — accounts approved into the funded stage.</li>
          <li><span className="text-gray-200">Treasury balance</span> — live USDC balance of the treasury wallet&apos;s token account. If it can&apos;t be read, we show nothing rather than zero.</li>
        </ul>
        {r && <p className="mt-6 text-xs text-gray-500">Last updated {new Date(r.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · data refreshes at most once a minute</p>}
      </section>

      <div className="mt-16">
        <Link href="/challenges" className="button-primary">Choose your challenge <ArrowUpRight size={17} /></Link>
      </div>
    </div>
  );
}
