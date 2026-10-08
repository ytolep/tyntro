import Link from 'next/link';

export const metadata = {
  title: 'Privacy policy (draft)',
  description: 'Draft privacy policy for the evaluation platform — pending legal review.',
};

export default function PrivacyPage() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">LEGAL</span>
      <h1>Privacy policy<span>.</span></h1>
      <div className="u3-draft-banner" role="note">
        <b>Draft — pending legal review.</b> This document is not final. It describes what the service
        collects today; the finalized version will be published here before it takes effect.
      </div>

      <section className="legal-section">
        <h2>What we collect</h2>
        <ul className="legal-list">
          <li><b>Your Solana wallet address.</b> It is your account identifier — you sign in by signing a message, and payouts go to your wallet.</li>
          <li><b>Evaluation activity.</b> Orders, positions, equity snapshots and risk events of your challenge accounts.</li>
          <li><b>Purchase records.</b> Payment requests and their on-chain references for challenge fees and payouts.</li>
          <li><b>Technical logs.</b> Structured server logs needed to run and debug the service.</li>
        </ul>
        <p>
          There are no passwords, no card numbers and no identity documents in the current product. Payments
          happen on-chain in USDC: the transaction itself is public by the nature of the blockchain, and we
          store only what is needed to verify your purchase and process payouts.
        </p>
      </section>

      <section className="legal-section">
        <h2>How it is used</h2>
        <p>
          Collected data is used to operate your evaluations, enforce risk rules automatically, verify
          payments, process payout requests, and keep the service available and secure. We do not sell
          personal data.
        </p>
      </section>

      <section className="legal-section">
        <h2>Sessions and cookies</h2>
        <p>
          Signing in sets a single httpOnly session cookie. It is not accessible to page scripts and is used
          only to keep you signed in. Clearing it signs you out; there is no tracking cookie.
        </p>
      </section>

      <section className="legal-section">
        <h2>What this draft does not cover yet</h2>
        <p>
          The final policy will define data retention periods, deletion requests, any sub-processors involved
          in running the infrastructure, and contact details for privacy questions. Until then, this page
          makes no commitments beyond what is written here. Questions can be sent to the support address in
          the footer, and the <Link href="/terms">terms draft</Link> explains the service itself.
        </p>
      </section>
    </div>
  );
}
