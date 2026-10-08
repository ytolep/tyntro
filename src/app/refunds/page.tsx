import Link from 'next/link';

export const metadata = {
  title: 'Refund policy (draft)',
  description: 'Draft refund policy for the evaluation platform — pending legal review.',
};

export default function RefundsPage() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">LEGAL</span>
      <h1>Refund policy<span>.</span></h1>
      <div className="u3-draft-banner" role="note">
        <b>Draft — pending legal review.</b> This document is not final and creates no commitments yet. The
        finalized version will be published here before it takes effect.
      </div>

      <section className="legal-section">
        <h2>What you pay for</h2>
        <p>
          The challenge fee is a one-time payment in USDC for a single evaluation attempt. The evaluation
          activates automatically as soon as the on-chain payment is confirmed — from that moment the service
          has been delivered in full: your account exists, your rules are locked, and the risk engine is
          running. See the <Link href="/rules">challenge rules</Link>.
        </p>
      </section>

      <section className="legal-section">
        <h2>Duplicate and failed payments</h2>
        <p>
          If a payment is sent but no challenge account is created for it, the funds are not lost: every
          payment request carries a unique on-chain reference key, and unconfirmed or duplicate transfers are
          resolved against that reference. Contact support (see the footer) with your transaction signature
          and we will sort it out.
        </p>
      </section>

      <section className="legal-section">
        <h2>What this draft does not cover yet</h2>
        <p>
          The final policy will define: whether and when a fee can be refunded after activation (for example,
          for technical failures on our side), how refund requests are submitted and processed, and timelines.
          Until the final version is published, this page promises nothing beyond the duplicate-payment
          handling described above.
        </p>
      </section>
    </div>
  );
}
