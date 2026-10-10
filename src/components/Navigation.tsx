'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowUpRight, ChevronDown, Menu, X, Wallet, Check, Copy, LogOut, LogIn } from 'lucide-react';
import { useMarketData } from '@/lib/marketData/MarketDataStore';
import Brand from './Brand';
import { stageLabel } from './AccountModeNotice';
import { useAuth } from '@/lib/auth/AuthContext';
import NotificationBell from './NotificationBell';

// Публичные разделы — в основной навигации; личные — только в меню аккаунта справа (N5).
const links = [{ name: 'Overview', href: '/' }, { name: 'Challenges', href: '/challenges' }, { name: 'Trade', href: '/terminal' }, { name: 'Leaderboard', href: '/leaderboard' }];
const accountLinks = [{ name: 'Dashboard', href: '/dashboard' }, { name: 'History', href: '/history' }, { name: 'Trader score', href: '/trader-score' }, { name: 'Risk & rules', href: '/risk' }, { name: 'Profile', href: '/profile' }, { name: 'Funded', href: '/funded' }];

type AccountSummary = { id: string; accountSize: number; mode: string; status: string; phase?: string; currentEquity: number | null };

export default function Navigation() {
  const pathname = usePathname(); const { publicKey, connected, disconnect } = useWallet();
  const { snapshot, selectedMarket, connectionStatus } = useMarketData();
  const [menu, setMenu] = useState(false), [accountOpen, setAccountOpen] = useState(false), [walletOpen, setWalletOpen] = useState(false), [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [active, setActive] = useState<AccountSummary | null>(null);
  const { user: authUser, signIn, signOut, signingIn } = useAuth();

  // Список счетов грузим только после входа (N2): без входа выбор счёта не показывается вовсе.
  useEffect(() => {
    if (!authUser) { setAccounts([]); setActive(null); return; }
    const id = localStorage.getItem('activeAccountId');
    fetch(`/api/accounts/active${id ? `?accountId=${encodeURIComponent(id)}` : ''}`)
      .then(r => r.json())
      .then(j => { setAccounts(j.allAccounts || []); setActive(j.account || null); if (j.account) localStorage.setItem('activeAccountId', j.account.id); })
      .catch(() => {});
  }, [pathname, authUser]);

  useEffect(() => { setMenu(false); setAccountOpen(false); }, [pathname]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setAccountOpen(false); setWalletOpen(false); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, []);

  const address = publicKey?.toBase58() || authUser?.walletAddress || ''; const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';
  // Кошелёк подключён, а сессии под него нет (подпись отклонили или autoConnect после перезагрузки) — вместо адреса одна кнопка Sign in.
  const needsSignIn = connected && (!authUser || authUser.walletAddress !== address);
  const copy = async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  // Admin-ссылка видна только ADMIN (после ответа /api/auth/me); до ответа и после выхода скрыта.
  const personalLinks = authUser?.role === 'ADMIN' ? [...accountLinks, { name: 'Admin', href: '/admin' }] : accountLinks;
  const appPage = !['/', '/challenges'].includes(pathname);
  const activeLabel = active ? `$${active.accountSize / 1000}K ${stageLabel(active)}` : '';

  return <>
    <header className="site-header">
      <div className="nav-inner">
        <Brand />
        <nav aria-label="Main navigation" className="desktop-nav">
          {links.map(l => <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined} className={pathname === l.href ? 'active' : ''}>{l.name}</Link>)}
        </nav>
        <div className="nav-actions">
          {needsSignIn && <button className="wallet-button" onClick={() => void signIn()} disabled={signingIn} title="Sign in with your wallet"><LogIn size={15} /><span>{signingIn ? 'Signing…' : 'Sign in'}</span></button>}
          {authUser && <div className="nav-dropdown account-menu">
            <button className="account-button" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen(!accountOpen)}>
              <span className="status-dot" /><span>{activeLabel || shortAddress || 'Account'}</span><ChevronDown size={12} />
            </button>
            {accountOpen && <div className="dropdown-panel accounts-panel" role="menu">
              <span className="eyebrow">WALLET</span>
              <button role="menuitem" onClick={copy} title="Copy address"><span>{shortAddress}</span>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
              <div className="menu-divider" />
              {accounts.length > 0 && <>
                <span className="eyebrow">YOUR ACCOUNTS</span>
                {accounts.map(a => <button key={a.id} role="menuitem" onClick={() => { localStorage.setItem('activeAccountId', a.id); window.location.reload(); }}>
                  <span>${a.accountSize / 1000}K {stageLabel(a)}<small>{a.currentEquity === null ? 'Awaiting Phoenix connection' : `$${a.currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} virtual`}</small></span>
                  {active?.id === a.id && <Check size={14} />}
                </button>)}
                <Link href="/challenges" role="menuitem">New challenge <ArrowUpRight size={13} /></Link>
                <div className="menu-divider" />
              </>}
              <span className="eyebrow">YOUR WORKSPACE</span>
              {personalLinks.map(l => <Link key={l.href} href={l.href} role="menuitem" className={pathname === l.href ? 'menu-active' : undefined}>{l.name}<ArrowUpRight size={13} /></Link>)}
              <div className="menu-divider" />
              <button role="menuitem" onClick={() => void signOut()}><span>Sign out</span><LogOut size={13} /></button>
            </div>}
          </div>}
          {/* K3: колокольчик уведомлений — слева от кнопки кошелька, только для вошедшего (компонент сам скрывается без входа). */}
          <NotificationBell />
          {/* После входа адрес уже в меню аккаунта — на десктопе кнопку кошелька прячем (signed-in), на мобильном меню аккаунта скрыто и она остаётся. */}
          {!needsSignIn && <button className={authUser && connected ? 'wallet-button signed-in' : 'wallet-button'} onClick={() => connected ? setWalletOpen(true) : void signIn()}><Wallet size={15} /><span>{connected ? shortAddress : 'Connect wallet'}</span></button>}
          <button className="mobile-menu-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {menu && <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-group">
          <span className="mobile-nav-label">EXPLORE</span>
          {links.map(l => <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>{l.name}<ArrowUpRight size={14} /></Link>)}
        </div>
        {authUser && <div className="mobile-nav-group">
          <span className="mobile-nav-label">YOUR WORKSPACE</span>
          {personalLinks.map(l => <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>{l.name}<ArrowUpRight size={14} /></Link>)}
        </div>}
      </nav>}
      {/* M6: на /terminal данные рынка уже в шапке терминала — общую ленту не дублируем. */}
      {appPage && pathname !== '/terminal' && <div className="market-ribbon"><span className="ribbon-source"><i className={connectionStatus === 'connected' ? 'status-dot' : 'status-dot offline'} />PHOENIX {selectedMarket.type.toUpperCase()}</span><strong>{selectedMarket.symbol}</strong><span>{selectedMarket.type === 'perp' ? 'Mark' : 'Mid'}</span><b>{snapshot?.referencePrice ? `$${snapshot.referencePrice.toLocaleString('en-US', { maximumFractionDigits: selectedMarket.priceDecimals })}` : '—'}</b><span className="ribbon-end">{active && stageLabel(active) === 'FUNDED' ? (active.phase === 'FUNDED_SIM' ? 'FUNDED · SIMULATED EXECUTION' : 'FUNDED · NOT CONNECTED') : 'CHALLENGE · VIRTUAL CAPITAL'} <span className="ribbon-divider">/</span> SOLANA</span></div>}
    </header>
    {walletOpen && <div className="modal-scrim" onClick={() => setWalletOpen(false)}><section className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={e => e.stopPropagation()}><button className="dialog-close" aria-label="Close wallet details" onClick={() => setWalletOpen(false)}><X size={20} /></button><span className="eyebrow">SOLANA MAINNET</span><h2 id="wallet-title">Your wallet.</h2><p className="text-gray-400">{shortAddress}</p><button className="button-secondary" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy address'}</button><button className="button-secondary" onClick={() => { disconnect(); setWalletOpen(false); }}><LogOut size={16} />Disconnect</button>{authUser && <button className="button-secondary" onClick={() => void signOut()}><LogOut size={16} />Sign out</button>}</section></div>}
  </>;
}
