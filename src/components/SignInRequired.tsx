'use client';
import { LogIn } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth/AuthContext';

/** Единое состояние «нужен вход» для внутренних страниц: вместо ошибки и Retry — кнопка входа. */
export default function SignInRequired({ title = 'Sign in to continue', text = 'Connect your Solana wallet and sign a message to see your accounts.' }: { title?: string; text?: string }) {
  const { connected } = useWallet();
  const { signIn, signingIn } = useAuth();
  return (
    <div className="site-container dashboard-page">
      <span className="eyebrow">YOUR WORKSPACE</span>
      <h1 className="text-4xl mt-5">{title}</h1>
      <p className="text-gray-400 mt-4 max-w-xl">{text}</p>
      <div className="flex gap-4 mt-6">
        <button className="button-primary" onClick={() => void signIn()} disabled={signingIn}>
          <LogIn size={17} /> {signingIn ? 'Check your wallet…' : connected ? 'Sign in with wallet' : 'Connect wallet'}
        </button>
      </div>
    </div>
  );
}
