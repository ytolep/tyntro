'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getPrice, PLAN_CONFIGS } from '@/lib/pricingConfig';
import { REFUNDS_VERSION, RULES_VERSION, TERMS_VERSION } from '@/lib/legal/versions';
import { useAuth } from '@/lib/auth/AuthContext';
import { associatedTokenAddress, buildUsdcTransferInstructions, parseTransferRequestUrl } from '@/lib/payments/transferTx';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Wallet } from 'lucide-react';

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

  // A1: покупка создаётся только после входа; до входа — нейтральный шаг, без ошибок.
  const { user, signIn, signingIn } = useAuth();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [agreed, setAgreed] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseInfo | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>('LOADING');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const address = publicKey?.toBase58() ?? '';
  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';
  const explorerCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : '';

  const createPurchase = useCallback(async () => {
    // K2: сервер создаёт покупку только с согласием на текущие версии документов.
    if (!agreed) return;
    setStatus('LOADING');
    setError(null);
    setPurchase(null);
    setPayError(null);
    setTxSignature(null);
    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountSize: size,
          planType: plan,
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          refundsVersion: REFUNDS_VERSION,
          rulesVersion: RULES_VERSION,
        }),
      });
      // Сессия могла истечь между входом и оплатой — возвращаем к шагу входа.
      if (res.status === 401) {
        setError('Your session expired — sign in again to continue.');
        return;
      }
      if (!res.ok) throw new Error('Failed to create payment request');
      setPurchase((await res.json()) as PurchaseInfo);
      setStatus('PENDING');
    } catch (err) {
      console.error(err);
      setError('Could not start checkout. Please try again.');
    }
  }, [size, plan, agreed]);

  // Покупка создаётся только для вошедшего пользователя (A1).
  useEffect(() => {
    if (!user) {
      setPurchase(null);
      setStatus('LOADING');
      setError(null);
      return;
    }
    void createPurchase();
  }, [user, createPurchase]);

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
      // Без SOL на комиссию кошелёк показывает только «Simulation failed» — называем причину сами.
      // ponytail: порог = комиссия; если у казны нет ATA, нужна ещё аренда ~0.002 SOL.
      if ((await connection.getBalance(publicKey)) < 10_000) {
        setPayError('Not enough SOL for the network fee on this network');
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
      console.error(err);
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
        // rulesHash в ответе статуса API отсутствует — блок хэша правил не показываем.
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

  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

  return (
    <div className="site-container checkout-page">
      <span className="eyebrow">CHECKOUT / {plan} EVALUATION</span>
      <h1>Review your challenge.</h1>
      <p className="checkout-lede">
        {usd(size)} evaluation capital · one-time fee in USDC · simulated execution on real market prices.
      </p>

      <div className="checkout-grid">
        {/* T3: полная сводка правил плана до оплаты */}
        <section className="checkout-panel" aria-label="Order summary">
          <div className="summary-row">
            <span>Account size</span>
            <b>{usd(size)}</b>
          </div>
          <div className="summary-row">
            <span>Plan</span>
            <b>{plan.charAt(0) + plan.slice(1).toLowerCase()}</b>
          </div>
          <div className="summary-row">
            <span>Profit target</span>
            <b>{config.profitTargetPct}% · {usd(size * config.profitTargetPct / 100)}</b>
          </div>
          <div className="summary-row">
            <span>Max daily loss</span>
            <b>{config.dailyDdPct}% of day-start equity · resets 00:00 UTC</b>
          </div>
          <div className="summary-row">
            <span>Static max loss</span>
            <b>{config.maxDdPct}% · floor at {usd(size * (1 - config.maxDdPct / 100))}</b>
          </div>
          <div className="summary-row">
            <span>Minimum trading days</span>
            <b>{config.minTradingDays} days</b>
          </div>
          <div className="summary-row">
            <span>Profit split on funded</span>
            <b>{config.profitSplitPct}%</b>
          </div>
          <div className="summary-row">
            <span>Leverage</span>
            <b>Up to 5x</b>
          </div>
          <div className="summary-row checkout-total">
            <span>Total due</span>
            <b>${price} USDC</b>
          </div>
          <p className="rules-note">
            Breaching either drawdown floor ends the challenge automatically.{' '}
            <Link href="/rules">Read the full challenge rules</Link> before you pay.
          </p>
          {/* T3: обязательное согласие перед оплатой */}
          <label className="agree-row">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I agree to the <Link href="/terms">Terms</Link>, <Link href="/refunds">Refund policy</Link> and{' '}
              <Link href="/rules">Challenge rules</Link>.
            </span>
          </label>
        </section>

        <section className="checkout-panel" aria-label="Payment">
          {/* A1: нейтральный шаг входа — никаких ошибок до попытки */}
          {user === null && (
            <div className="pay-step">
              <h2>Sign in to pay</h2>
              <p>
                Connect your Solana wallet and sign a message to continue. The payment request is
                created only after you sign in — nothing is charged on this step.
              </p>
              <button
                className="button-primary"
                onClick={() => void signIn()}
                disabled={signingIn || !agreed}
              >
                <Wallet size={17} />
                {signingIn ? 'Check your wallet…' : connected ? 'Sign in to pay' : 'Connect wallet and sign in'}
              </button>
              {!agreed && <small className="pay-hint">Check the agreement box to continue.</small>}
            </div>
          )}

          {user === undefined && (
            <div className="pay-step">
              <p className="pay-waiting"><Loader2 className="w-4 h-4 animate-spin" /> Checking your session…</p>
            </div>
          )}

          {user && error && (
            <div className="pay-step">
              <p className="pay-error"><AlertTriangle size={15} /> {error}</p>
              <button className="button-secondary" onClick={() => void signIn()}>
                Sign in again
              </button>
            </div>
          )}

          {/* Без согласия createPurchase ничего не делает — спиннер здесь висел бы вечно. */}
          {user && !error && status === 'LOADING' && (
            <div className="pay-step">
              {agreed
                ? <p className="pay-waiting"><Loader2 className="w-4 h-4 animate-spin" /> Creating your payment request…</p>
                : <p className="pay-hint">Check the agreement box to create your payment request.</p>}
            </div>
          )}

          {user && purchase && status === 'PENDING' && (
            <div className="pay-step">
              <h2>Pay {purchase.amount} USDC</h2>
              <p>
                The request specifies the treasury address, exact amount and a unique reference key —
                the challenge account is activated automatically once the transfer is confirmed on-chain.
              </p>
              {explorerCluster && (
                <p className="pay-hint">
                  Test mode: Solana devnet. Your wallet must be switched to devnet and hold devnet USDC
                  plus a little devnet SOL for the fee.
                </p>
              )}

              {connected && publicKey ? (
                <button
                  className="button-primary"
                  onClick={() => void payWithWallet()}
                  disabled={sending || !agreed}
                >
                  {sending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending transaction…</>
                  ) : (
                    <><Wallet size={17} /> Pay {purchase.amount} USDC with {shortAddress}</>
                  )}
                </button>
              ) : (
                <p className="pay-hint">
                  Connect the wallet you signed in with to pay directly on this page.
                </p>
              )}

              {payError && (
                <p className="pay-error"><AlertTriangle size={15} /> {payError}</p>
              )}

              {txSignature && (
                <a
                  className="pay-tx"
                  href={`https://explorer.solana.com/tx/${txSignature}${explorerCluster}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sent: {txSignature.slice(0, 24)}… — view transaction on explorer
                </a>
              )}

              {/* Запасной путь: QR-рендер без новой зависимости невозможен; ссылка solana:
                  валидна по спецификации Solana Pay — мобильные кошельки открывают её напрямую. */}
              <a
                href={purchase.url}
                aria-disabled={!agreed}
                onClick={(e) => { if (!agreed) e.preventDefault(); }}
                className={`button-secondary ${!agreed ? 'is-disabled' : ''}`}
              >
                <ExternalLink size={15} /> Pay from mobile wallet
              </a>

              <button className="button-secondary" onClick={() => void copyLink()}>
                <Copy size={15} /> {copied ? 'Copied!' : 'Copy payment link'}
              </button>

              <p className="pay-hint">
                {txSignature
                  ? 'Transaction sent — waiting for on-chain confirmation…'
                  : <>Waiting for payment… reference {purchase.reference.slice(0, 8)}… (expires after 30 minutes)</>}
              </p>
              {!agreed && <small className="pay-hint">Check the agreement box to pay.</small>}
            </div>
          )}

          {user && status === 'EXPIRED' && (
            <div className="pay-step">
              <p className="pay-warn"><AlertTriangle size={15} /> Payment request expired after 30 minutes. No funds were received.</p>
              <button className="button-secondary" onClick={() => void createPurchase()}>
                Create new payment request
              </button>
            </div>
          )}

          {status === 'PAID' && (
            <div className="pay-step">
              <p className="pay-ok"><CheckCircle2 size={16} /> Payment confirmed — redirecting to your dashboard…</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="site-container checkout-page">
        <span className="eyebrow">CHECKOUT</span>
        <h1>Review your challenge.</h1>
        <p className="pay-waiting"><Loader2 className="w-4 h-4 animate-spin" /> Loading checkout…</p>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
