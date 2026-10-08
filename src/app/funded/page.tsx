'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { activeAccountUrl } from '@/lib/activeAccount';
export default function FundedPage() {
 const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{fetch(activeAccountUrl()).then(r=>r.json()).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false))},[]);
 const passed=data?.account?.status==='PASSED';
 const funded=data?.execution?.mode==='FUNDED';
 return <main className="site-container dashboard-page">
  <span className="eyebrow">CHALLENGE → REVIEW → FUNDED</span><h1 className="text-4xl mt-5">Your path to funded.</h1>
  <p className="text-gray-400 mt-5 max-w-2xl">Prove your discipline with virtual capital. After passing, a separate funded account can trade real capital through Phoenix. Challenge balances and profits cannot be withdrawn or converted into a deposit.</p>
  <div className="account-mode-notice mt-8"><div><span className="eyebrow">CURRENT STAGE</span><p>{loading?'Loading account…':funded?'Funded account · awaiting Phoenix connection':passed?'Challenge passed · awaiting funded review':data?.account?`Challenge ${data.account.status.toLowerCase()} · virtual capital`:'Choose a challenge to begin.'}</p></div></div>
  <div className="journey-grid">
   <article><div className="journey-top"><span>01 / CHALLENGE</span></div><h3>Virtual funds. Live markets.</h3><p>Phoenix prices and order books power the evaluation. Orders execute in our simulator; the platform tracks the challenge rules.</p></article>
   <article><div className="journey-top"><span>02 / REVIEW</span></div><h3>Passing is a milestone.</h3><p>A passed evaluation requires a separate funded review and capital allocation. Passing never automatically starts real trading.</p></article>
   <article><div className="journey-top"><span>03 / FUNDED</span></div><h3>Real execution on Phoenix.</h3><p>Activation requires a dedicated Phoenix account, signing permissions and enforced prop risk controls. This connection and payouts are not enabled yet.</p></article>
  </div>
  <div className="flex flex-wrap gap-4 mt-8"><Link className="button-primary" href={data?.account?'/dashboard':'/challenges'}>{data?.account?'Back to account':'Choose a challenge'}</Link><button className="button-secondary opacity-60" disabled>Funded activation unavailable</button></div>
 </main>;
}
