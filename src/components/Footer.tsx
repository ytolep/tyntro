'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import Brand from './Brand';
import { BRAND_NAME } from '@/lib/brand';

// T5/N3: правила+FAQ+юридические страницы, поддержка mailto только если задан NEXT_PUBLIC_SUPPORT_EMAIL,
// имя бренда из brand.ts вместо заглушки PROJECT.
export default function Footer(){
const path=usePathname();
const supportEmail=process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
if(path==='/terminal')return null;
return <footer className="site-footer"><div className="site-container"><div className="footer-top"><div><Brand/><p>For the next generation<br/>of crypto traders.</p></div><div><span className="eyebrow">EXPLORE</span><Link href="/challenges">Challenges<ArrowUpRight size={13}/></Link><Link href="/terminal">Trading terminal<ArrowUpRight size={13}/></Link><Link href="/dashboard">Dashboard<ArrowUpRight size={13}/></Link></div><div><span className="eyebrow">RULES &amp; SUPPORT</span><Link href="/rules">Challenge rules</Link><Link href="/faq">FAQ</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refunds">Refunds</Link>{supportEmail?<a href={`mailto:${supportEmail}`}>Support<ArrowUpRight size={13}/></a>:null}</div><div className="footer-note"><span className="eyebrow">BUILT AROUND SOLANA</span><p>Real market data. Simulated evaluations. Funded accounts and payouts are under development.</p></div></div><div className="footer-bottom"><span>© 2026 {BRAND_NAME}</span><span>Independent platform · not affiliated with Solana or Phoenix</span><Link href="/challenges">YOUR NEXT MOVE ↗</Link></div></div></footer>}
