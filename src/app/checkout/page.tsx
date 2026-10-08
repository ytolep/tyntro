'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getPrice, PLAN_CONFIGS } from '@/lib/pricingConfig';
import { ShieldCheck, Wallet, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const size = Number(searchParams.get('size')) || 10000;
  const plan = (searchParams.get('plan') || 'CORE') as 'SPRINT' | 'CORE' | 'APEX';

  const config = PLAN_CONFIGS[plan];
  const price = getPrice(size, plan);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountSize: size, planType: plan }),
      });

      if (!res.ok) throw new Error('Checkout failed');

      const result = await res.json();
      localStorage.setItem('activeAccountId', result.accountId);
      setSuccess(true);
      setTimeout(() => {
        router.push('/dashboard');
      }, 1200);
    } catch (err) {
      console.error(err);
      alert('Challenge creation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 font-mono">
      <div className="glass-panel p-8 rounded-2xl border border-surface-border">
        <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-profit" /> Challenge Checkout
        </h1>
        <p className="text-xs text-gray-400 font-sans mb-8">
          Review your evaluation parameters and complete simulated provisioning.
        </p>

        {/* Order Summary */}
        <div className="bg-[#101015] p-6 rounded-xl border border-surface-border space-y-4 font-mono text-sm mb-8">
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
            <span className="text-2xl font-extrabold text-profit">${price} USD</span>
          </div>
        </div>

        {/* Checkout Button */}
        <button
          onClick={handleCheckout}
          disabled={loading || success}
          className="w-full py-4 bg-gradient-to-r from-brand-600 via-profit to-brand-500 hover:opacity-90 text-black font-extrabold rounded-xl text-base transition-all flex items-center justify-center space-x-2 shadow-lg shadow-brand-500/20 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Provisioning Account...</span>
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="w-5 h-5" />
              <span>Account Provisioned! Redirecting...</span>
            </>
          ) : (
            <>
              <Wallet className="w-5 h-5" />
              <span>Pay ${price} & Activate Account</span>
              <ArrowRight className="w-5 h-5 ml-1" />
            </>
          )}
        </button>

        <p className="text-[11px] text-gray-500 text-center font-mono mt-4">
          Simulation Mode • Instant provisioning in database
        </p>
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
