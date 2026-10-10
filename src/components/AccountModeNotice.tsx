import Link from 'next/link';
import { executionPolicy } from '@/lib/execution/policy';
type Policy = ReturnType<typeof executionPolicy>;

// D3: стадия счёта определяется phase (FUNDED_SIM = funded-стадия на симуляторе),
// а не mode/status — у FUNDED_SIM-счёта mode = 'CHALLENGE' (исполнение симулятором).
// mode/status 'FUNDED' — легаси-ветка реального Phoenix-исполнения.
export type StageAccount = { phase?: string | null; mode?: string | null; status?: string | null };
export function stageLabel(a: StageAccount): 'FUNDED' | 'CHALLENGE' {
  return a.phase === 'FUNDED_SIM' || a.mode === 'FUNDED' || a.status === 'FUNDED' ? 'FUNDED' : 'CHALLENGE';
}

export default function AccountModeNotice({ execution, phase }: { execution: Policy; phase?: string | null }) {
  const fundedSim = phase === 'FUNDED_SIM';
  const eyebrow = fundedSim ? 'FUNDED · SIMULATED EXECUTION'
    : stageLabel({ mode: execution.mode }) === 'FUNDED' ? 'FUNDED · PHOENIX EXECUTION'
    : 'CHALLENGE · VIRTUAL CAPITAL';
  const message = fundedSim
    ? 'Funded stage. Orders are simulated with live Phoenix prices; profits follow the funded payout schedule.'
    : execution.message;
 return <section className="account-mode-notice" aria-label="Account trading mode">
  <div><span className="eyebrow">{eyebrow}</span><p>{message}</p></div>
  <Link href="/funded" className="text-button">Funded stage ↗</Link>
 </section>;
}
export function FundedWorkspace() {
 return <div className="site-container dashboard-page"><span className="eyebrow">FUNDED / PHOENIX</span><h1 className="text-4xl mt-5">Awaiting Phoenix connection.</h1><p className="text-gray-400 my-6 max-w-xl">Real capital, positions and fills must come from a dedicated Phoenix account. Live trading is not enabled yet. Your challenge balance is not a real deposit.</p><Link className="button-primary" href="/funded">View funded setup</Link></div>;
}
