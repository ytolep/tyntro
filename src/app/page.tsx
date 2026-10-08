'use client';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, ShieldCheck, Layers3, Crosshair, ChevronRight } from 'lucide-react';
import ChallengePicker from '@/components/ChallengePicker';
import { useMarketData } from '@/lib/marketData/MarketDataStore';

export default function LandingPage() {
 const {snapshot,connectionStatus}=useMarketData();
 const price=snapshot?.referencePrice;
 return <div className="landing-page">
  <div className="announcement"><span className="tiny-sol-mark"><i/><i/><i/></span><span>A new arena for crypto traders.</span><Link href="/terminal">Explore the terminal <ArrowUpRight size={13}/></Link></div>
  <section className="hero-section site-container">
   <div className="hero-copy"><div className="eyebrow hero-eyebrow"><span className="status-dot"/> CRYPTO PROP TRADING / SOLANA</div>
    <h1>Your edge.<br/><span>More capital.</span></h1>
    <p>A new home for ambitious traders.<br className="desktop-break"/> Take the challenge. Prove your discipline.<br className="desktop-break"/> Build toward your next level.</p>
    <div className="hero-actions"><Link className="button-primary" href="/challenges">Find your challenge <ArrowUpRight size={18}/></Link><Link className="text-button" href="/terminal">Explore terminal <ArrowRight size={16}/></Link></div>
    <div className="hero-footnote"><span className="tiny-sol-mark"><i/><i/><i/></span><span>Built around Solana</span><span className="fine-divider"/><span>Phoenix market data</span></div>
   </div>
   <div className="hero-art" aria-label="Abstract stacked trading layers">
    <div className="art-coordinate coord-top">01 — CAPITAL, REIMAGINED</div><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
    <div className="art-grid"/><div className="layer-stack" aria-hidden="true"><div className="art-layer layer-back"/><div className="art-layer layer-middle"/><div className="art-layer layer-front"><span className="layer-glyph">↗</span><span className="layer-label">UNLOCK YOUR EDGE</span></div></div>
    <div className="art-cross cross-one">+</div><div className="art-cross cross-two">+</div>
    <div className="live-market-card"><div><span className={connectionStatus==='connected'?'status-dot':'status-dot offline'}/><span>PHOENIX / {snapshot?.marketId||'SOL-PERP'}</span><ArrowUpRight size={15}/></div><strong>{price?`$${price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—'}</strong><small>{connectionStatus==='connected'?'Live market reference':'Connecting to market data'}</small></div>
    <div className="art-coordinate coord-bottom">SOLANA NATIVE. TRADER FIRST.</div>
   </div>
  </section>
  <section className="metrics-strip site-container" aria-label="Evaluation overview"><div><span>Evaluation capital</span><strong>Up to $100K<em>↗</em></strong></div><div><span>Profit split</span><strong>80<span>%</span></strong></div><div><span>Trading instruments</span><strong>Crypto perps</strong></div><div><span>The environment</span><strong>Real markets.<br/><span className="metric-small">Simulated capital.</span></strong></div></section>
  <section className="site-container journey-section" id="how-it-works"><div className="section-heading"><span className="eyebrow">THE PATH FORWARD</span><h2>Skill is your<br/><span>starting capital.</span></h2><p>A clear path from your first evaluation<br/>to your next trading milestone.</p></div><div className="journey-grid">{[{n:'01',title:'Choose your challenge',text:'Pick your capital and a rule set that fits the way you trade.',Icon:Layers3},{n:'02',title:'Trade your edge',text:'Practice on real Phoenix prices. Keep your drawdown in view.',Icon:Crosshair},{n:'03',title:'Qualify for funded',text:'Pass your evaluation, then enter a separate review for real capital on Phoenix.',Icon:ShieldCheck}].map(({n,title,text,Icon})=><article key={n}><div className="journey-top"><span>{n}</span><Icon size={22}/></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
  <section className="terminal-feature site-container"><div><span className="eyebrow">YOUR MARKET. YOUR WORKSPACE.</span><h2>Built for the<br/><span>way you trade.</span></h2><p>A focused terminal with Phoenix order books, an integrated reference chart, and your evaluation in one place.</p><Link href="/terminal" className="text-button">Enter the terminal <ArrowUpRight size={17}/></Link></div><div className="market-depth-preview"><div className="preview-heading"><span><span className="status-dot"/>{snapshot?.marketId||'SOL-PERP'}</span><small>PHOENIX LIVE L2</small></div><div className="preview-columns"><span>PRICE</span><span>SIZE</span><span>DEPTH</span></div>{snapshot?.orderBook? <>{snapshot.orderBook.asks.slice(0,3).reverse().map((row,i)=><div className="depth-row ask" key={`a${i}`}><b>{row.price.toLocaleString('en-US',{maximumFractionDigits:5})}</b><span>{row.size.toLocaleString()}</span><i style={{width:`${Math.max(3,row.depthPct||0)}%`}}/></div>)}<div className="preview-mid">{price?.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} <ArrowUpRight size={16}/><small>MARK PRICE</small></div>{snapshot.orderBook.bids.slice(0,3).map((row,i)=><div className="depth-row bid" key={`b${i}`}><b>{row.price.toLocaleString('en-US',{maximumFractionDigits:5})}</b><span>{row.size.toLocaleString()}</span><i style={{width:`${Math.max(3,row.depthPct||0)}%`}}/></div>)}</>:<div className="preview-empty">Waiting for a fresh Phoenix snapshot.</div>}<Link href="/terminal" className="preview-bottom">Real market data. Simulated execution.<ChevronRight size={14}/></Link></div></section>
  <section className="site-container pricing-section" id="challenges"><div className="section-heading pricing-heading"><span className="eyebrow">FIND YOUR STARTING POINT</span><h2>Your ambition.<br/><span>Your challenge.</span></h2><p>Three paths. Five account sizes.<br/>Choose the rules that work for you.</p></div><ChallengePicker/></section>
  <section className="final-cta site-container"><div className="eyebrow">THE NEXT MOVE IS YOURS</div><h2>Put your edge<br/>to the test<span>.</span></h2><Link href="/challenges" className="button-primary">Choose your challenge <ArrowUpRight size={18}/></Link><div className="cta-decoration" aria-hidden="true">↗</div></section>
 </div>;
}
