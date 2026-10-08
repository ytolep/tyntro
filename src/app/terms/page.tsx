import Link from 'next/link';

export const metadata = {
  title: 'Terms of service (draft)',
  description: 'Draft terms of service for the evaluation platform — pending legal review.',
};

export default function TermsPage() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">LEGAL</span>
      <h1>Terms of service<span>.</span></h1>
      <div className="u3-draft-banner" role="note">
        <b>Draft — pending legal review.</b> This document is not final. It describes how the service is
        intended to work; the finalized version will be published here before it takes effect.
      </div>

      <section className="legal-section">
        <h2>What the service is</h2>
        <p>
          The platform sells one-time evaluations (“challenges”) for traders. An evaluation gives you a
          simulated trading account with fixed rules — profit target, daily and static drawdown limits —
          described on the <Link href="/rules">challenge rules page</Link>. Market data comes from real
          exchanges; execution inside an evaluation is simulated.
        </p>
        <p>
          Evaluations are a skill assessment, not an investment product, not investment advice, and not a
          broker relationship. You trade simulated capital; the only real funds involved are your one-time
          evaluation fee and any payouts you earn on the funded stage.
        </p>
      </section>

      <section className="legal-section">
        <h2>Your account</h2>
        <p>
          Access is tied to a self-custody Solana wallet: you sign in by signing a message with your key. You
          are responsible for keeping control of your wallet. You must be of legal age and must not use the
          service where it is not permitted by local law.
        </p>
      </section>

      <section className="legal-section">
        <h2>Fees and the funded stage</h2>
        <p>
          The evaluation fee is a one-time payment in USDC shown at checkout. Rules of a purchased challenge
          are locked and cannot change mid-evaluation. Passing an evaluation makes you eligible for a funded
          account review; the funded stage, profit split and payout process are described on the{' '}
          <Link href="/rules">rules page</Link> and are subject to the review process stated there.
        </p>
        <p>
          Breaching a drawdown limit ends the evaluation immediately and automatically; the fee is not
          converted into anything else. See the draft <Link href="/refunds">refund policy</Link>.
        </p>
      </section>

      <section className="legal-section">
        <h2>What this draft does not cover yet</h2>
        <p>
          The final terms will also define: acceptable use and prohibited trading techniques on funded
          accounts, account termination conditions, limitation of liability, governing terms for payouts, and
          changes to these terms. Until then, this page makes no promises beyond what the product itself does.
        </p>
      </section>
    </div>
  );
}
