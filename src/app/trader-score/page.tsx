'use client';
import Link from 'next/link';
import { FundedWorkspace } from '@/components/AccountModeNotice';
import { useAccountPage, WorkspaceSkeleton, LoadError, NoAccount, SignInRequired } from '@/app/dashboard/accountPage';

// Аудит A4 + V2: score из /api/trader-score — реальные computeTraderScore данные.
// user === undefined → скелет, null → SignInRequired, ошибка сети → Retry, 404 → нет счетов.
export default function TraderScorePage() {
  const buildUrl = () => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('activeAccountId') : null;
    return `/api/trader-score${id ? `?accountId=${encodeURIComponent(id)}` : ''}`;
  };
  const { state, retry } = useAccountPage(buildUrl);
  if (state.phase === 'pending') return <WorkspaceSkeleton />;
  if (state.phase === 'signin') return <SignInRequired title="Sign in to see your trader score" text="Connect your Solana wallet and sign a message to open your score." />;
  if (state.phase === 'error') return <LoadError retry={retry} />;
  if (state.phase === 'empty') return <NoAccount />;

  const data = state.data;
  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;

  const heading = <div className="dashboard-heading">
    <div><span className="eyebrow">YOUR WORKSPACE / TRADER SCORE</span><h1>Your next level.</h1><p>You don&apos;t buy bigger capital — you earn it. The score is computed from your closed trades and equity curve.</p></div>
    <div className="heading-stat"><span className="eyebrow">ACCOUNT STATUS</span><strong>{data.status}</strong></div>
  </div>;

  if (!data.score) {
    return <div className="site-container dashboard-page">
      {heading}
      <section className="data-panel">
        <span className="eyebrow">NOT ENOUGH DATA YET</span>
        <h2 className="mt-3">Five trades to your first score.</h2>
        <p className="text-gray-400 mt-2">Trader Score requires at least 5 closed trades — this account has {data.tradeCount ?? 0}.</p>
        <div className="flex gap-4 mt-6"><Link className="button-secondary" href="/terminal">Open terminal</Link></div>
      </section>
    </div>;
  }

  const s = data.score;
  const components = [
    { label: 'Risk management', weight: '30%', value: s.riskManagementScore },
    { label: 'Sharpe ratio', weight: '25%', value: s.sharpeScore },
    { label: 'Consistency', weight: '20%', value: s.consistencyScore },
    { label: 'Profit factor', weight: '15%', value: s.profitFactorScore },
    { label: 'Edge (win rate)', weight: '10%', value: s.edgeScore },
  ];
  const bar = (v: unknown) => `${Math.max(0, Math.min(100, Number(v ?? 0)))}%`;

  return <div className="site-container dashboard-page">
    {heading}
    <div className="dashboard-summary">
      <div><span className="eyebrow">TOTAL SCORE</span><strong>{s.totalScore}</strong><small>0–100, weighted by component</small></div>
      <div><span className="eyebrow">TIER</span><strong className="score-tier">{s.tier}</strong><small>Current level</small></div>
      <div><span className="eyebrow">TRADES</span><strong>{s.stats.tradeCount}</strong><small>Closed trades counted</small></div>
      <div><span className="eyebrow">WIN RATE</span><strong>{s.stats.winRatePct.toFixed(1)}%</strong><small>Share of winners</small></div>
    </div>
    <div className="dashboard-main">
      <section className="dashboard-chart">
        <div className="panel-heading"><h2>Score components</h2><span>0–100 / WEIGHTED</span></div>
        {components.map(c => <div className="objective" key={c.label}>
          <div><span>{c.label} · {c.weight}</span><b>{c.value} / 100</b></div>
          <div className="objective-track"><i style={{ width: bar(c.value) }} /></div>
        </div>)}
      </section>
      <section className="dashboard-objectives">
        <span className="eyebrow">RAW STATS</span>
        <h2 className="mt-3">Behind the score.</h2>
        <div className="dashboard-meta"><span className="text-gray-400">Profit factor</span><strong>{s.stats.profitFactor.toFixed(2)}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Sharpe (daily)</span><strong>{s.stats.sharpeRatio.toFixed(2)}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Max drawdown</span><strong>{s.stats.maxDrawdownPct.toFixed(2)}%</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Consistency</span><strong>{s.stats.consistencyPct.toFixed(1)}%</strong></div>
      </section>
    </div>
  </div>;
}
