import Link from 'next/link';
import { executionPolicy } from '@/lib/execution/policy';
type Policy = ReturnType<typeof executionPolicy>;
export default function AccountModeNotice({ execution }: { execution: Policy }) {
 return <section className="account-mode-notice" aria-label="Account trading mode">
  <div><span className="eyebrow">{execution.mode === 'CHALLENGE' ? 'CHALLENGE · VIRTUAL CAPITAL' : 'FUNDED · PHOENIX EXECUTION'}</span><p>{execution.message}</p></div>
  <Link href="/funded" className="text-button">Funded stage ↗</Link>
 </section>;
}
export function FundedWorkspace() {
 return <div className="site-container dashboard-page"><span className="eyebrow">FUNDED / PHOENIX</span><h1 className="text-4xl mt-5">Awaiting Phoenix connection.</h1><p className="text-gray-400 my-6 max-w-xl">Real capital, positions and fills must come from a dedicated Phoenix account. Live trading is not enabled yet. Your challenge balance is not a real deposit.</p><Link className="button-primary" href="/funded">View funded setup</Link></div>;
}
