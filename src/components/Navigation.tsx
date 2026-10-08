'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ArrowUpRight, ChevronDown, Menu, X, Wallet, Check, Copy, LogOut, LogIn } from 'lucide-react';
import { useMarketData } from '@/lib/marketData/MarketDataStore';
import Brand from './Brand';
const links = [{name:'Overview',href:'/'},{name:'Challenges',href:'/challenges'},{name:'Trade',href:'/terminal'},{name:'Dashboard',href:'/dashboard'}];
const moreLinks = [{name:'Funded',href:'/funded'},{name:'Risk & rules',href:'/risk'},{name:'Trade history',href:'/history'},{name:'Trader score',href:'/trader-score'},{name:'Leaderboard',href:'/leaderboard'},{name:'Profile',href:'/profile'},{name:'Admin',href:'/admin'}];
export default function Navigation() {
 const pathname=usePathname(); const {publicKey,connected,disconnect,signMessage}=useWallet(); const {setVisible}=useWalletModal();
 const {snapshot,selectedMarket,connectionStatus}=useMarketData();
 const [menu,setMenu]=useState(false),[more,setMore]=useState(false),[accountsOpen,setAccountsOpen]=useState(false),[walletOpen,setWalletOpen]=useState(false),[copied,setCopied]=useState(false);
 const [accounts,setAccounts]=useState<any[]>([]),[active,setActive]=useState<any>(null);
 const [authUser,setAuthUser]=useState<any>(null),[signingIn,setSigningIn]=useState(false);
 // Статус входа: /api/auth/me по httpOnly-cookie; сбрасывается при смене/отключении кошелька и восстанавливается, если сессия жива.
 useEffect(()=>{setAuthUser(null);fetch('/api/auth/me').then(r=>r.json()).then(j=>setAuthUser(j.user||null)).catch(()=>{});},[publicKey]);
 useEffect(()=>{const id=localStorage.getItem('activeAccountId');fetch(`/api/accounts/active${id?`?accountId=${encodeURIComponent(id)}`:''}`).then(r=>r.json()).then(j=>{setAccounts(j.allAccounts||[]);setActive(j.account||null);if(j.account)localStorage.setItem('activeAccountId',j.account.id)}).catch(()=>{});},[pathname]);
 useEffect(()=>{setMenu(false);setMore(false);setAccountsOpen(false);},[pathname]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);setMore(false);setWalletOpen(false);setAccountsOpen(false)}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[]);
 const address=publicKey?.toBase58()||''; const shortAddress=address?`${address.slice(0,4)}…${address.slice(-4)}`:'';
 const copy=async()=>{await navigator.clipboard.writeText(address);setCopied(true);setTimeout(()=>setCopied(false),1800)};
 // SIWS: nonce → signMessage адаптера → verify; сессия кладётся в httpOnly-cookie.
 const signIn=async()=>{
  if(!publicKey||!signMessage||signingIn)return;
  setSigningIn(true);
  try{
   const wallet=publicKey.toBase58();
   const nres=await fetch('/api/auth/nonce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wallet})});
   const {message}=await nres.json();
   if(!message)throw new Error('nonce failed');
   const signature=await signMessage(new TextEncoder().encode(message));
   const vres=await fetch('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wallet,signature:bs58.encode(signature),message})});
   const data=await vres.json().catch(()=>({}));
   setAuthUser(vres.ok?data.user:null);
  }catch{setAuthUser(null)} // отмена подписи в кошельке или ошибка сети
  finally{setSigningIn(false)}
 };
 const signOut=async()=>{await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});setAuthUser(null)};
 const appPage=!['/','/challenges'].includes(pathname);
 return <>
  <header className="site-header">
   <div className="nav-inner">
    <Brand/>
    <nav aria-label="Main navigation" className="desktop-nav">
     {links.map(l=><Link key={l.href} href={l.href} aria-current={pathname===l.href?'page':undefined} className={pathname===l.href?'active':''}>{l.name}</Link>)}
     <div className="nav-dropdown"><button aria-expanded={more} onClick={()=>setMore(!more)}>More <ChevronDown size={12}/></button>{more&&<div className="dropdown-panel">{moreLinks.map(l=><Link key={l.href} href={l.href}>{l.name}<ArrowUpRight size={13}/></Link>)}</div>}</div>
    </nav>
    <div className="nav-actions">
     {appPage&&<div className="nav-dropdown account-nav"><button className="account-button" aria-expanded={accountsOpen} onClick={()=>setAccountsOpen(!accountsOpen)}><span className="status-dot"/><span>{active?`$${active.accountSize/1000}K ${active.mode === 'FUNDED' || active.status === 'FUNDED' ? 'FUNDED' : 'CHALLENGE'}`:'Select account'}</span><ChevronDown size={12}/></button>{accountsOpen&&<div className="dropdown-panel accounts-panel"><span className="eyebrow">YOUR ACCOUNTS</span>{accounts.map(a=><button key={a.id} onClick={()=>{localStorage.setItem('activeAccountId',a.id);window.location.reload()}}><span>${a.accountSize/1000}K {a.mode}<small>{a.currentEquity === null ? 'Awaiting Phoenix connection' : `$${a.currentEquity.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} virtual`}</small></span>{active?.id===a.id&&<Check size={14}/>}</button>)}<Link href="/challenges">New challenge <ArrowUpRight size={14}/></Link></div>}</div>}
     {connected&&(!authUser||authUser.walletAddress!==address)&&<button className="wallet-button" onClick={signIn} disabled={signingIn} title="Sign in with your wallet"><LogIn size={15}/><span>{signingIn?'Signing…':'Sign in'}</span></button>}
     {connected&&authUser?.walletAddress===address&&<span className="account-button" title={`Signed in as ${address}`}><i className="status-dot"/><span>Signed in</span></span>}
     <button className="wallet-button" onClick={()=>connected?setWalletOpen(true):setVisible(true)}><Wallet size={15}/><span>{connected?shortAddress:'Connect wallet'}</span></button>
     <button className="mobile-menu-button" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu?<X size={20}/>:<Menu size={20}/>}</button>
    </div>
   </div>
   {menu&&<nav className="mobile-nav" aria-label="Mobile navigation">{[...links,...moreLinks].map(l=><Link key={l.href} href={l.href} className={pathname===l.href?'active':''}>{l.name}<ArrowUpRight size={14}/></Link>)}</nav>}
   {appPage&&<div className="market-ribbon"><span className="ribbon-source"><i className={connectionStatus==='connected'?'status-dot':'status-dot offline'}/>PHOENIX {selectedMarket.type.toUpperCase()}</span><strong>{selectedMarket.symbol}</strong><span>{selectedMarket.type==='perp'?'Mark':'Mid'}</span><b>{snapshot?.referencePrice?`$${snapshot.referencePrice.toLocaleString('en-US',{maximumFractionDigits:selectedMarket.priceDecimals})}`:'—'}</b><span className="ribbon-end">{active?.mode === 'FUNDED' || active?.status === 'FUNDED' ? 'FUNDED · NOT CONNECTED' : 'CHALLENGE · VIRTUAL CAPITAL'} <span className="ribbon-divider">/</span> SOLANA</span></div>}
  </header>
  {walletOpen&&<div className="modal-scrim" onClick={()=>setWalletOpen(false)}><section className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={e=>e.stopPropagation()}><button className="dialog-close" aria-label="Close wallet details" onClick={()=>setWalletOpen(false)}><X size={20}/></button><span className="eyebrow">SOLANA MAINNET</span><h2 id="wallet-title">Your wallet.</h2><p className="text-gray-400">{shortAddress}</p><button className="button-secondary" onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy address'}</button><button className="button-secondary" onClick={()=>{disconnect();setWalletOpen(false)}}><LogOut size={16}/>Disconnect</button>{authUser&&<button className="button-secondary" onClick={signOut}><LogOut size={16}/>Sign out</button>}</section></div>}
 </>;
}
