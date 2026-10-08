'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Check } from 'lucide-react';
import { ACCOUNT_SIZES, PLAN_CONFIGS, PRICING_MATRIX, AccountSize } from '@/lib/pricingConfig';
const descriptions={SPRINT:'A focused test of precision.',CORE:'Find your rhythm. Build your edge.',APEX:'A higher target. A bigger ambition.'};
export default function ChallengePicker() {
 const [size,setSize]=useState<AccountSize>(10000);
 return <div className="challenge-picker">
  <div className="capital-selector"><span className="eyebrow">01 / SELECT YOUR CAPITAL</span><div role="group" aria-label="Account size">{ACCOUNT_SIZES.map(s=><button key={s} aria-pressed={size===s} onClick={()=>setSize(s)} className={size===s?'selected':''}>${s/1000}K</button>)}</div></div>
  <div className="plan-grid">{(['SPRINT','CORE','APEX'] as const).map((name,i)=>{const c=PLAN_CONFIGS[name];return <article key={name} className={`plan-card ${name==='CORE'?'featured':''}`}>
   <div className="plan-top"><span className="plan-number">0{i+1}</span>{name==='CORE'?<span className="plan-badge">THE BALANCED ROUTE</span>:<ArrowUpRight size={19}/>}</div>
   <h3>{name.charAt(0)+name.slice(1).toLowerCase()}</h3><p>{descriptions[name]}</p>
   <div className="plan-price">${PRICING_MATRIX[size][name]}<span>/ challenge</span></div>
   <div className="plan-capital">${size.toLocaleString()} <span>evaluation capital</span></div>
   <dl>{[['Profit target',`${c.profitTargetPct}%`],['Max daily loss',`${c.dailyDdPct}%`],['Static max loss',`${c.maxDdPct}%`],['Minimum trading days',`${c.minTradingDays} days`],['Profit split',`${c.profitSplitPct}%`]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
   <Link href={`/checkout?size=${size}&plan=${name}`} className={name==='CORE'?'button-primary':'button-secondary'}>Choose {name.charAt(0)+name.slice(1).toLowerCase()}<ArrowRight size={16}/></Link>
   <small className="plan-note"><Check size={12}/> Simulated evaluation account</small>
  </article>})}</div>
 </div>;
}
