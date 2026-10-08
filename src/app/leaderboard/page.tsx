'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { num } from '@/lib/display';
import { BRAND_NAME } from '@/lib/brand';

// Публичный лидерборд из /api/leaderboard: топ счетов с реальным Trader Score,
// кошельки укорочены на сервере, никаких мок-массивов. Пусто → правила рейтинга
// (аудит V3): минимум 5 закрытых сделок, веса Trader Score как в lib/core/score.ts.
export default function LeaderboardPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/leaderboard')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load leaderboard');
        setEntries(json.entries ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="site-container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{BRAND_NAME} / LEADERBOARD</span>
          <h1>Ranked by execution.</h1>
          <p>
            Top accounts by Trader Score — computed from executed trades and equity snapshots.
            Accounts with fewer than 5 trades are not ranked.
          </p>
        </div>
        <Link className="text-button" href="/challenges">
          Start a challenge <ArrowUpRight size={16} />
        </Link>
      </div>

      {loading ? (
        <div className="u2-empty">
          <p>Loading leaderboard…</p>
        </div>
      ) : error ? (
        <div className="u2-empty">
          <p>{error}</p>
          <button className="button-secondary" onClick={load}>
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="u2-empty">
          <span className="eyebrow">HOW RANKING WORKS</span>
          <h2>No ranked traders yet.</h2>
          <p>
            Trader Score rates every account from 0 to 100, computed from its closed trades and equity
            curve. Accounts with at least 5 closed trades are ranked — the top 50 are shown here.
            The score is weighted:
          </p>
          <dl className="u2-rules">
            <div><dt>Risk management</dt><dd>30%</dd></div>
            <div><dt>Sharpe ratio</dt><dd>25%</dd></div>
            <div><dt>Consistency</dt><dd>20%</dd></div>
            <div><dt>Profit factor</dt><dd>15%</dd></div>
            <div><dt>Edge (win rate)</dt><dd>10%</dd></div>
          </dl>
          <Link className="button-primary" href="/challenges">
            Start a challenge <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="u2-table-wrap">
          <table className="u2-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Trader</th>
                <th>Account size</th>
                <th>Net PnL</th>
                <th>Trader score</th>
                <th>Win rate</th>
                <th>Trades</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((t) => (
                <tr key={t.rank}>
                  <td className={t.rank <= 3 ? 'u2-rank-top' : undefined}>
                    {String(t.rank).padStart(2, '0')}
                  </td>
                  <td>{t.wallet}</td>
                  <td>{num(t.accountSize).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                  <td className={t.pnlPct === null ? undefined : t.pnlPct >= 0 ? 'text-profit' : 'text-loss'}>
                    {t.pnlPct === null ? '—' : `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`}
                  </td>
                  <td>{t.score} / 100</td>
                  <td>{t.winRatePct.toFixed(1)}%</td>
                  <td>{t.trades}</td>
                  <td>{t.tier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
