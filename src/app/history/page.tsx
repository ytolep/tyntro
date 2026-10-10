'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import { num } from '@/lib/display';
import { formatUsd } from '@/lib/format';
import { FundedWorkspace } from '@/components/AccountModeNotice';
import { useAccountPage, WorkspaceSkeleton, LoadError, NoAccount, SignInRequired } from '@/app/dashboard/accountPage';

// Аудит A4 + V2: состояние «нужен вход» вместо ошибки, визуальный эталон лендинга/дашборда —
// тонкие линии var(--line), eyebrow, без стеклянных панелей и иконок в заголовках.
export default function HistoryPage() {
  const { state, retry } = useAccountPage(activeAccountUrl);
  if (state.phase === 'pending') return <WorkspaceSkeleton />;
  if (state.phase === 'signin') return <SignInRequired title="Sign in to see your trades" text="Connect your Solana wallet and sign a message to open your execution history." />;
  if (state.phase === 'error') return <LoadError retry={retry} />;
  if (state.phase === 'empty') return <NoAccount />;

  const data = state.data;
  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;
  const { account } = data;
  const orders = account.orders ?? [];

  return <div className="site-container dashboard-page">
    <div className="dashboard-heading">
      <div><span className="eyebrow">YOUR WORKSPACE / EXECUTION</span><h1>Your trades, on record.</h1><p>Complete audit trail of executed orders, fills and fees for #{account.id.slice(0, 8)}.</p></div>
      <div className="heading-stat"><span className="eyebrow">TOTAL ORDERS</span><strong>{account.totalTrades ?? 0}</strong></div>
    </div>
    <section className="data-panel">
      <div className="panel-heading"><h2>Execution history</h2><span>ORDERS / USD</span></div>
      <div className="table-wrap">
        <table className="app-table">
          <thead><tr><th>Timestamp</th><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Notional size</th><th>Leverage</th><th>Status</th></tr></thead>
          <tbody>
            {orders.length > 0 ? orders.map((ord: any) => (
              <tr key={ord.id}>
                <td className="cell-muted">{new Date(ord.createdAt).toLocaleString('en-US')}</td>
                <td className="cell-strong">{ord.symbol}</td>
                <td><span className={ord.side === 'LONG' ? '!text-profit' : '!text-loss'}>{ord.side}</span></td>
                <td className="cell-muted">{ord.type}</td>
                <td>{formatUsd(ord.price)}</td>
                <td>{formatUsd(ord.size)}</td>
                <td>{num(ord.leverage)}×</td>
                <td className="cell-muted">{ord.status}</td>
              </tr>
            )) : <tr><td colSpan={8} className="app-table-empty">No orders recorded yet. Open the terminal to place your first trade.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
