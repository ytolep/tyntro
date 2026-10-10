'use client';
import { activeAccountUrl } from '@/lib/activeAccount';
import { num, usd } from '@/lib/display';
import AccountModeNotice, { FundedWorkspace } from '@/components/AccountModeNotice';
import { useAccountPage, WorkspaceSkeleton, LoadError, NoAccount, SignInRequired } from './accountPage';
import Link from 'next/link';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ArrowUpRight, ShieldCheck, History, Award, RefreshCw } from 'lucide-react';

// Аудит A2: без входа — SignInRequired, пока сессия неизвестна — спокойный скелет,
// сетевая ошибка — Retry. riskEval-поля из API проверяются на null: никаких
// выдуманных чисел (targetEquity считается из реальных size и процента цели).
export default function DashboardPage() {
  const { state, retry } = useAccountPage(activeAccountUrl);
  if (state.phase === 'pending') return <WorkspaceSkeleton />;
  if (state.phase === 'signin') return <SignInRequired title="Sign in to see your accounts" text="Connect your Solana wallet and sign a message to open your workspace." />;
  if (state.phase === 'error') return <LoadError retry={retry} />;
  if (state.phase === 'empty') return <NoAccount />;

  const data = state.data;
  if (data.execution?.provider !== 'SIMULATOR') return <FundedWorkspace />;
  const { account: a, riskEval } = data;
  const r = riskEval && !riskEval.stale ? riskEval : null;
  const pct = (v: unknown, digits = 1) => v != null ? Number(v).toFixed(digits) + '%' : '—';
  const money = (v: unknown) => v != null ? usd(num(v)) : '—';
  const equity = num(a.currentEquity), size = num(a.accountSize), balance = num(a.currentBalance);
  const pnl = equity - size;
  const dailyFloorDist = r?.dailyFloor != null ? equity - num(r.dailyFloor) : null;
  const chart = a.equitySnapshots.map((s: any) => ({ time: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), equity: num(s.equity) }));
  // D3: funded-стадия — phase FUNDED_SIM (mode остаётся CHALLENGE, т.к. исполнение симулятором).
  const funded = a.phase === 'FUNDED_SIM';

  return <div className="site-container dashboard-page">
    <div className="dashboard-heading"><div><span className="eyebrow">YOUR WORKSPACE / {a.challenge.planType} {funded ? 'FUNDED' : 'EVALUATION'}</span><h1>Make every trade count.</h1><p>${size.toLocaleString()} account · {a.status} · #{a.id.slice(0, 8)}</p></div><Link href="/terminal" className="button-primary">Open terminal <ArrowUpRight size={17} /></Link></div>
    <AccountModeNotice execution={data.execution} phase={a.phase} />
    <div className="dashboard-summary"><div><span className="eyebrow">ACCOUNT EQUITY</span><strong>{usd(equity)}</strong><small className={pnl >= 0 ? '!text-profit' : '!text-loss'}>{pnl >= 0 ? '+' : ''}{(pnl / size * 100).toFixed(2)}% from starting capital</small></div><div><span className="eyebrow">REALIZED BALANCE</span><strong>{usd(balance)}</strong><small>Recorded account balance</small></div><div><span className="eyebrow">DAILY LOSS FLOOR</span><strong>{money(r?.dailyFloor)}</strong><small>{a.challenge.dailyDdPct}% daily limit</small></div><div><span className="eyebrow">STATIC LOSS FLOOR</span><strong>{money(r?.staticFloor)}</strong><small>{a.challenge.maxDdPct}% maximum loss</small></div></div>
    <div className="dashboard-main"><section className="dashboard-chart"><div className="panel-heading"><h2>Your performance</h2><span>EQUITY / USD</span></div><div style={{ height: 300, minWidth: 0 }}>{chart.length < 2 ? <div className="flex h-full items-center justify-center"><p className="text-gray-400 text-sm">Equity curve appears after your first trades</p></div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{ top: 15, right: 8, bottom: 0, left: 0 }}><defs><linearGradient id="equity-purple" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b7a0ff" stopOpacity={.28} /><stop offset="100%" stopColor="#b7a0ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#2a2132" vertical={false} strokeDasharray="3 6" /><XAxis dataKey="time" stroke="#776386" tickLine={false} axisLine={false} fontSize={10} dy={10} /><YAxis domain={['auto', 'auto']} stroke="#776386" tickLine={false} axisLine={false} fontSize={10} width={64} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} /><Tooltip contentStyle={{ background: '#17101f', border: '1px solid #574368', borderRadius: 6, fontSize: 12 }} formatter={(v: any) => [usd(v), 'Equity']} /><Area dataKey="equity" type="monotone" stroke="#b7a0ff" strokeWidth={2} fill="url(#equity-purple)" isAnimationActive={false} /></AreaChart></ResponsiveContainer>}</div><div className="dashboard-meta"><span className="text-gray-500 text-xs">Recorded equity snapshots</span><button aria-label="Refresh account" className="text-violet-300" onClick={retry}><RefreshCw size={14} /></button></div></section>
      <section className="dashboard-objectives"><span className="eyebrow">STAY ON TRACK</span><h2 className="mt-3">{funded ? 'Your funded account.' : 'Your evaluation.'}</h2>{!funded && <div className="objective"><div><span>Profit target · {a.challenge.profitTargetPct}%</span><b>{pct(r?.targetProgressPct)}</b></div><div className="objective-track"><i style={{ width: `${r?.targetProgressPct != null ? Math.max(0, Math.min(100, num(r.targetProgressPct))) : 0}%` }} /></div><p>Target equity {usd(size * (1 + a.challenge.profitTargetPct / 100))}</p></div>}<div className="objective"><div><span>Trading days</span><b>{a.tradingDaysCount} / {a.challenge.minTradingDays}</b></div><div className="objective-track"><i style={{ width: `${Math.max(0, Math.min(100, a.tradingDaysCount / a.challenge.minTradingDays * 100))}%`, background: '#8ff0cc' }} /></div><p>Minimum {a.challenge.minTradingDays} trading days</p></div><div className="dashboard-meta"><span className="text-gray-400">Distance to daily floor</span><strong>{dailyFloorDist != null ? (dailyFloorDist >= 0 ? '+' : '') + usd(dailyFloorDist) : '—'}</strong></div><div className="dashboard-meta"><span className="text-gray-400">Risk status</span><strong className={r?.riskLevel === 'FAILED' ? '!text-loss' : ''}>{r?.riskLevel ?? '—'}</strong></div></section></div>
    <div className="dashboard-links"><Link href="/risk"><ShieldCheck size={21} /><span>Know your limits<small>Risk rules & account health</small></span><ArrowUpRight size={16} className="ml-auto" /></Link><Link href="/history"><History size={21} /><span>Review your trades<small>Your execution history</small></span><ArrowUpRight size={16} className="ml-auto" /></Link><Link href="/trader-score"><Award size={21} /><span>Find your next level<small>Your trader score</small></span><ArrowUpRight size={16} className="ml-auto" /></Link></div>
  </div>;
}
