'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import { num, usd } from '@/lib/display';
import { FundedWorkspace } from '@/components/AccountModeNotice';
import { useAccountPage, WorkspaceSkeleton, LoadError, NoAccount, SignInRequired } from '@/app/dashboard/accountPage';

// Аудит A4 + V2. Показываем только реальные поля API: riskEval бывает null или
// { stale: true } — тогда этажи прочерк. Дистанции — вычитание реальных чисел,
// никаких выдуманных процентов (старый код звал несуществующие staticDdDistancePct).
export default function RiskPage() {
  const { state, retry } = useAccountPage(activeAccountUrl);
  if (state.phase === 'pending') return <WorkspaceSkeleton />;
  if (state.phase === 'signin') return <SignInRequired title="Sign in to see your risk limits" text="Connect your Solana wallet and sign a message to open your risk rules." />;
  if (state.phase === 'error') return <LoadError retry={retry} />;
  if (state.phase === 'empty') return <NoAccount />;

  const data = state.data;
  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;
  const { account, riskEval } = data;
  const r = riskEval && !riskEval.stale ? riskEval : null;
  const size = num(account.accountSize), equity = num(account.currentEquity);
  const staticFloor = r?.staticFloor != null ? num(r.staticFloor) : null;
  const dailyFloor = r?.dailyFloor != null ? num(r.dailyFloor) : null;
  const dist = (floor: number | null) => floor != null ? (equity - floor >= 0 ? '+' : '') + usd(equity - floor) : '—';
  const events = account.riskEvents ?? [];

  return <div className="site-container dashboard-page">
    <div className="dashboard-heading">
      <div><span className="eyebrow">YOUR WORKSPACE / RISK</span><h1>Know your limits.</h1><p>${size.toLocaleString()} account · {account.status} · #{account.id.slice(0, 8)}</p></div>
      <div className="heading-stat"><span className="eyebrow">RISK STATUS</span><strong className={r?.riskLevel === 'FAILED' ? '!text-loss' : undefined}>{r?.riskLevel ?? '—'}</strong></div>
    </div>
    <div className="dashboard-summary">
      <div><span className="eyebrow">ACCOUNT SIZE</span><strong>{usd(size)}</strong><small>Starting capital</small></div>
      <div><span className="eyebrow">CURRENT EQUITY</span><strong>{usd(equity)}</strong><small>Balance + open PnL</small></div>
      <div><span className="eyebrow">STATIC LOSS FLOOR</span><strong>{staticFloor != null ? usd(staticFloor) : '—'}</strong><small>{account.challenge?.maxDdPct ?? '—'}% maximum loss</small></div>
      <div><span className="eyebrow">DAILY LOSS FLOOR</span><strong>{dailyFloor != null ? usd(dailyFloor) : '—'}</strong><small>{account.challenge?.dailyDdPct ?? '—'}% daily limit</small></div>
    </div>
    <div className="dashboard-main">
      <section className="dashboard-chart">
        <div className="panel-heading"><h2>Static drawdown</h2><span>FLOOR / USD</span></div>
        <p className="risk-note">The static floor is anchored to your initial account size and never moves upwards with open or realized profit.</p>
        <div className="dashboard-meta"><span className="text-gray-400">Initial capital</span><strong>{usd(size)}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Current equity</span><strong>{usd(equity)}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Hard failure floor</span><strong>{staticFloor != null ? usd(staticFloor) : '—'}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Distance to floor</span><strong className={staticFloor != null && equity - staticFloor < 0 ? '!text-loss' : undefined}>{dist(staticFloor)}</strong></div>
      </section>
      <section className="dashboard-objectives">
        <span className="eyebrow">00:00 UTC RESET</span>
        <h2 className="mt-3">Daily drawdown.</h2>
        <p className="risk-note">The daily floor resets every day at 00:00 UTC from the equity at that timestamp, including realized PnL, open PnL, fees and funding.</p>
        <div className="dashboard-meta"><span className="text-gray-400">Day-start equity</span><strong>{account.dayStartEquity != null ? usd(num(account.dayStartEquity)) : '—'}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Today&apos;s failure floor</span><strong>{dailyFloor != null ? usd(dailyFloor) : '—'}</strong></div>
        <div className="dashboard-meta"><span className="text-gray-400">Distance to floor</span><strong className={dailyFloor != null && equity - dailyFloor < 0 ? '!text-loss' : undefined}>{dist(dailyFloor)}</strong></div>
      </section>
    </div>
    <section className="data-panel">
      <div className="panel-heading"><h2>Risk events</h2><span>AUDIT LOG</span></div>
      <div className="table-wrap">
        <table className="app-table">
          <thead><tr><th>Timestamp</th><th>Level</th><th>Rule</th><th>Description</th></tr></thead>
          <tbody>
            {events.length > 0 ? events.map((evt: any) => (
              <tr key={evt.id}>
                <td className="cell-muted">{new Date(evt.timestamp).toLocaleString('en-US')}</td>
                <td><span className={evt.level === 'SAFE' ? '!text-profit' : '!text-loss'}>{evt.level}</span></td>
                <td className="cell-strong">{evt.ruleName}</td>
                <td className="cell-muted">{evt.description}</td>
              </tr>
            )) : <tr><td colSpan={4} className="app-table-empty">No risk events recorded. Your account is within its limits.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
