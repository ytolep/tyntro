'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import SignInRequired from '@/components/SignInRequired';

/**
 * Общая логика состояний страниц кабинета (аудит A2/A4):
 * user === undefined или загрузка — спокойный скелет; user === null — SignInRequired;
 * сетевая/серверная ошибка — сообщение с Retry; 404 — «нет счетов»; иначе данные.
 */
export type AccountPageState =
  | { phase: 'pending' }
  | { phase: 'signin' }
  | { phase: 'error' }
  | { phase: 'empty' }
  | { phase: 'data'; data: any };

export function useAccountPage(buildUrl: () => string) {
  const { user } = useAuth();
  const [state, setState] = useState<AccountPageState>({ phase: 'pending' });
  const buildRef = useRef(buildUrl);
  buildRef.current = buildUrl;
  const load = useCallback(async () => {
    setState({ phase: 'pending' });
    try {
      const url = buildRef.current();
      // Клиентский хук: допускаем только относительные пути своего origin — внешние URL запрещены.
      if (!url.startsWith('/')) { setState({ phase: 'error' }); return; }
      const res = await fetch(url);
      if (res.status === 404) { setState({ phase: 'empty' }); return; }
      if (!res.ok) { setState({ phase: 'error' }); return; }
      const json = await res.json();
      setState(json ? { phase: 'data', data: json } : { phase: 'empty' });
    } catch { setState({ phase: 'error' }); }
  }, []);
  useEffect(() => {
    if (user === null) setState({ phase: 'signin' });
    else if (user) void load();
  }, [user, load]);
  return { state, retry: load };
}

/** Спокойный скелет на время загрузки/определения сессии — без спиннеров и ошибок. */
export function WorkspaceSkeleton() {
  return <div className="site-container dashboard-page" aria-busy="true">
    <span className="eyebrow">YOUR WORKSPACE</span>
    <div className="page-skeleton"><i className="sk sk-heading" /><i className="sk sk-line" /><i className="sk sk-line sk-short" /><i className="sk sk-grid" /></div>
  </div>;
}

export function LoadError({ retry }: { retry: () => void }) {
  return <div className="site-container dashboard-page">
    <span className="eyebrow">YOUR WORKSPACE</span>
    <h1 className="text-4xl mt-5">Couldn&apos;t load this page.</h1>
    <p className="text-gray-400 mt-4">A network or server error interrupted the request. Nothing was lost — try again.</p>
    <div className="flex gap-4 mt-6"><button className="button-secondary" onClick={retry}>Retry</button></div>
  </div>;
}

/** Вход есть, счетов нет: приглашение к челленджу вместо ошибки. */
export function NoAccount() {
  return <div className="site-container dashboard-page">
    <span className="eyebrow">YOUR WORKSPACE</span>
    <h1 className="text-4xl mt-5">Your next chapter starts here.</h1>
    <p className="text-gray-400 mt-4">No evaluation account yet. Choose a challenge to begin — it will appear on this page.</p>
    <div className="flex gap-4 mt-6"><Link className="button-primary" href="/challenges">Explore challenges <ArrowUpRight size={17} /></Link></div>
  </div>;
}

export { SignInRequired };
