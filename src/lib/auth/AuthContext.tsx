'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';

export type AuthUser = { id: string; walletAddress: string; role: string };
type AuthState = {
  /** null — не вошёл; undefined — ещё не известно (идёт /api/auth/me). */
  user: AuthUser | null | undefined;
  signingIn: boolean;
  /** Подключить кошелёк (если нужно) и войти подписью сообщения. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [signingIn, setSigningIn] = useState(false);
  // Кошелёк подключают ради входа: после подключения сразу просим подпись, второй клик «Sign in» не нужен.
  const signInAfterConnect = useRef(false);

  // Сессия в httpOnly-cookie: состояние входа знает только сервер.
  useEffect(() => {
    let live = true;
    fetch('/api/auth/me').then(r => r.json()).then(j => live && setUser(j.user ?? null)).catch(() => live && setUser(null));
    return () => { live = false; };
  }, [publicKey]);

  // SIWS: nonce → подпись кошельком → verify.
  const signIn = useCallback(async () => {
    if (!connected || !publicKey || !signMessage) { signInAfterConnect.current = true; setVisible(true); return; }
    if (signingIn) return;
    setSigningIn(true);
    try {
      const wallet = publicKey.toBase58();
      const n = await fetch('/api/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet }) });
      const { message } = await n.json();
      if (!message) throw new Error('nonce failed');
      const signature = await signMessage(new TextEncoder().encode(message));
      const v = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(signature), message }) });
      const data = await v.json().catch(() => ({}));
      setUser(v.ok ? data.user : null);
    } catch { setUser(null); } // отмена подписи или ошибка сети
    finally { setSigningIn(false); }
  }, [connected, publicKey, signMessage, signingIn, setVisible]);

  useEffect(() => {
    if (!signInAfterConnect.current || !connected || !publicKey || !signMessage) return;
    signInAfterConnect.current = false;
    if (user?.walletAddress !== publicKey.toBase58()) void signIn();
  }, [connected, publicKey, signMessage, user, signIn]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, signingIn, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider is required');
  return v;
}
