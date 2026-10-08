'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getPrice, PLAN_CONFIGS } from '@/lib/pricingConfig';
import { associatedTokenAddress, buildUsdcTransferInstructions, parseTransferRequestUrl } from '@/lib/payments/transferTx';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

interface PurchaseInfo {
  id: string;
  reference: string;
  amount: string;
  url: string;
}

type CheckoutStatus = 'LOADING' | 'PENDING' | 'PAID' | 'EXPIRED';

const POLL_MS = 2500;

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const size = Number(searchParams.get('size')) || 10000;
  const plan = (searchParams.get('plan') || 'CORE') as 'SPRINT' | 'CORE' | 'APEX';

  const config = PLAN_CONFIGS[plan];
  const price = getPrice(size, plan);

  const [purchase, setPurchase] = useState<PurchaseInfo | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>('LOADING');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [sending, setSending] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const address = publicKey?.toBase58() ?? '';
  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';
  const explorerCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : '';

  const createPurchase = useCallback(async () => {
    setStatus('LOADING');
    setError(null);
    setPurchase(null);
    setPayError(null);
    setTxSignature(null);
    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountSize: size, planType: plan }),
      });
      if (res.status === 401) {
        setError('Sign in with your Solana wallet to purchase a challenge.');
        return;
      }
      if (!res.ok) throw new Error('Failed to create payment request');
      setPurchase((await res.json()) as PurchaseInfo);
      setStatus('PENDING');
    } catch (err) {
      console.error(err);
      setError('Could not start checkout. Please try again.');
    }
  }, [size, plan]);

  useEffect(() => {
    void createPurchase();
  }, [createPurchase]);

  // Оплата подключённым кошельком: баланс → инструкции из transferTx → отправка адаптером →
  // confirmTransaction('confirmed'). Статус покупки дальше продолжает опрашивать эффект поллинга.
  const payWithWallet = useCallback(async () => {
    if (!purchase || !publicKey || sending) return;
    setSending(true);
    setPayError(null);
    try {
      const req = parseTransferRequestUrl(purchase.url);
      const balance = await connection
        .getTokenAccountBalance(new PublicKey(associatedTokenAddress(address, req.splToken)))
        .catch(() => null); // нет ATA у плательщика → счета/баланса нет
      // UX-проверка до подписи; сам перевод проверяется цепочкой и воркером.
      if (Number(balance?.value?.uiAmountString ?? 0) < Number(req.amount)) {
        setPayError('Not enough USDC on this network');
        return;
      }
      const ixs = buildUsdcTransferInstructions({
        payer: address,
        recipient: req.recipient,
        mint: req.splToken,
        amountUi: req.amount,
        reference: req.reference,
      });
      const signature = await sendTransaction(new Transaction().add(...ixs), connection);
      await connection.confirmTransaction(signature, 'confirmed');
      setTxSignature(signature);
    } catch (err) {
      const msg = `${(err as { name?: unknown })?.name ?? ''} ${(err as { message?: unknown })?.message ?? ''}`;
      setPayError(/reject|cancel|declin/i.test(msg) ? 'Payment cancelled' : 'Payment failed — try again');
    } finally {
      setSending(false);
    }
  }, [purchase, publicKey, address, sending, connection, sendTransaction]);

  // Поллинг статуса, пока покупка ждёт оплаты; подтверждает воркер по reference-ключу.
  useEffect(() => {
    if (!purchase || status !== 'PENDING') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/status?id=${encodeURIComponent(purchase.id)}`);
        if (!res.ok) return;
        const data: { status: string; accountId: string | null } = await res.json();
        if (data.status === 'PAID') {
          if (data.accountId) localStorage.setItem('activeAccountId', data.accountId);
          setStatus('PAID');
        } else if (data.status === 'EXPIRED') {
          setStatus('EXPIRED');
        }
      } catch {
        /* следующий тик поллинга */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [purchase, status]);

  useEffect(() => {
    if (status !== 'PAID') return;
    const timeout = setTimeout(() => router.push('/dashboard'), 1000);
    return () => clearTimeout(timeout);
  }, [status, router]);

  const copyLink = async () => {
    if (!purchase) return;
    try {
      await navigator.clipboard.writeText(purchase.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен — ссылку можно скопировать из адресной строки кошелька */
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 font-mono">
      <div className="glass-panel p-8 rounded-2xl border border-surface-border">
        <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-profit" /> Challenge Checkout
        </h1>
        <p className="text-xs text-gray-400 font-sans mb-8">
          Review your evaluation parameters and pay in USDC via Solana Pay.
        </p>

        {/* Order Summary */}
        <div className="bg-[#101015] p-6 rounded-xl border border-surface-border space-y-4 font-mono text-sm mb-6">
          <div className="flex justify-between items-center border-b border-surface-border/60 pb-3">
            <span className="text-gray-400">ACCOUNT SIZE</span>
            <span className="text-lg font-bold text-white">${size.toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center border-b border-surface-border/60 pb-3">
            <span className="text-gray-400">EVALUATION PLAN</span>
            <span className="text-profit font-bold">{plan}</span>
          </div>

          <div className="flex justify-between items-center border-b border-surface-border/60 pb-3">
            <span className="text-gray-400">PROFIT TARGET</span>
            <span className="text-white">{config.profitTargetPct}% (${(size * (config.profitTargetPct / 100)).toLocaleString()})</span>
          </div>

          <div className="flex justify-between items-center border-b border-surface-border/60 pb-3">
            <span className="text-gray-400">STATIC MAX DRAWDOWN FLOOR</span>
            <span className="text-white">${(size * (1 - config.maxDdPct / 100)).toLocaleString()} ({config.maxDdPct}%)</span>
          </div>

          <div className="flex justify-between items-center border-b border-surface-border/60 pb-3">
            <span className="text-gray-400">DAILY DRAWDOWN LIMIT</span>
            <span className="text-white">3% (00:00 UTC Reset)</span>
          </div>

          <div className="flex justify-between items-center pt-2">
            <span className="text-base font-bold text-gray-200">TOTAL DUE</span>
            <span className="text-2xl font-extrabold text-profit">${price} USDC</span>
          </div>
        </div>

        {/* Payment flow */}
        {error && (
          <div className="bg-red-950/40 border border-red-800/60 p-5 rounded-xl flex flex-col gap-3 items-start">
            <div className="flex items-center gap-2 text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
            <button
              onClick={() => void createPurchase()}
              className="px-4 py-2 rounded-lg border border-red-700 text-red-200 text-xs hover:bg-red-900/40 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'LOADING' && !error && (
          <div className="flex items-center justify-center gap-3 text-gray-400 text-sm py-8">
            <Loader2 className="w-5 h-5 animate-spin text-profit" />
            <span>Creating payment request…</span>
          </div>
        )}

        {purchase && status === 'PENDING' && (
          <div className="bg-[#101015] p-6 rounded-xl border border-surface-border space-y-5">
            <div className="flex justify-between items-center font-mono text-sm">
              <span className="text-gray-400">AMOUNT DUE</span>
              <span className="text-xl font-extrabold text-profit">${purchase.amount} USDC</span>
            </div>

            <p className="text-[11px] text-gray-500 font-sans leading-relaxed">
              Pay with your connected wallet below, or open the payment link in a Solana
              wallet with USDC. The request specifies the treasury address, exact amount and
              a unique reference key — the challenge account is activated automatically once
              the transfer is confirmed on-chain.
            </p>

            {/* Основной путь: кошелёк сам подписывает и отправляет транзакцию. */}
            {connected && publicKey ? (
              <button
                onClick={() => void payWithWallet()}
                disabled={sending}
                className="w-full py-4 bg-gradient-to-r from-brand-600 via-profit to-brand-500 hover:opacity-90 text-black font-extrabold rounded-xl text-base transition-all flex items-center justify-center space-x-2 shadow-lg shadow-brand-500/20 disabled:opacity-60 disabled:pointer-events-none"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Sending transaction…</span>
                  </>
                ) : (
                  <>
                    <Wallet className="w-5 h-5" />
                    <span>Pay ${purchase.amount} USDC with {shortAddress}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => setVisible(true)}
                className="w-full py-4 bg-gradient-to-r from-brand-600 via-profit to-brand-500 hover:opacity-90 text-black font-extrabold rounded-xl text-base transition-all flex items-center justify-center space-x-2 shadow-lg shadow-brand-500/20"
              >
                <Wallet className="w-5 h-5" />
                <span>Connect wallet</span>
              </button>
            )}

            {payError && (
              <div className="flex items-center gap-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {payError}
              </div>
            )}

            {txSignature && (
              <a
                href={`https://explorer.solana.com/tx/${txSignature}${explorerCluster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-profit underline underline-offset-4 break-all"
              >
                Sent: {txSignature.slice(0, 24)}… — view transaction on explorer
              </a>
            )}

            {/* Запасной путь: QR-рендер без новой зависимости невозможен; ссылка solana:
                валидна по спецификации Solana Pay — мобильные кошельки открывают её напрямую. */}
            <a
              href={purchase.url}
              className="w-full py-3 rounded-xl border border-surface-border text-gray-300 text-sm hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Pay from mobile wallet</span>
            </a>

            <button
              onClick={() => void copyLink()}
              className="w-full py-3 rounded-xl border border-surface-border text-gray-300 text-sm hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              <span>{copied ? 'Copied!' : 'Copy payment link'}</span>
            </button>

            <div className="flex items-center gap-3 text-xs text-gray-500 pt-1">
              <Loader2 className="w-4 h-4 animate-spin text-profit" />
              <span>
                {txSignature
                  ? 'Transaction sent — waiting for on-chain confirmation…'
                  : <>Waiting for payment… reference {purchase.reference.slice(0, 8)}… (expires after 30 minutes)</>}
              </span>
            </div>
          </div>
        )}

        {status === 'EXPIRED' && (
          <div className="bg-amber-950/40 border border-amber-800/60 p-5 rounded-xl flex flex-col gap-3 items-start">
            <div className="flex items-center gap-2 text-amber-300 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>Payment request expired after 30 minutes. No funds were received.</span>
            </div>
            <button
              onClick={() => void createPurchase()}
              className="px-4 py-2 rounded-lg border border-amber-700 text-amber-200 text-xs hover:bg-amber-900/40 transition-colors"
            >
              Create new payment request
            </button>
          </div>
        )}

        {status === 'PAID' && (
          <div className="bg-profit/10 border border-profit/40 p-5 rounded-xl flex items-center gap-3 text-sm">
            <CheckCircle2 className="w-5 h-5 text-profit" />
            <span className="text-profit font-bold">Payment confirmed — redirecting to your dashboard…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="max-w-3xl mx-auto px-4 py-20 text-center font-mono text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin text-profit mx-auto mb-4" />
        <span>Loading Checkout Parameters...</span>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
