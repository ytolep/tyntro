import Link from 'next/link';
import { PLAN_CONFIGS } from '@/lib/pricingConfig';

export const metadata = {
  title: 'FAQ',
  description: 'How challenges, drawdown rules, passing, the funded stage and payouts actually work.',
};

// Все числа ниже — из конфигурации планов (pricingConfig.ts).
const core = PLAN_CONFIGS.CORE;

const faq = [
  {
    q: 'What exactly am I buying?',
    a: <>A one-time evaluation (“challenge”): a simulated trading account with real market prices and a fixed rule set. Reach the profit target without breaching the drawdown limits, and you qualify for the funded stage. The fee is paid in USDC on Solana and covers one attempt.</>,
  },
  {
    q: 'Is the trading real?',
    a: <>Market data, order books, fees and liquidation mechanics come from the real Phoenix exchange. Execution inside an evaluation is simulated — your one-time fee is the only real money at risk during the challenge. The funded stage runs on the same market data; real-capital trading is being rolled out gradually.</>,
  },
  {
    q: 'How do I pass a challenge?',
    a: <>Three conditions at the same time: your equity reaches the profit target, you have completed the minimum of {core.minTradingDays} trading days, and no position is open. The check runs automatically on every price update — nobody approves or denies a pass manually.</>,
  },
  {
    q: 'What is the difference between daily and static drawdown?',
    a: <>The daily limit ({core.dailyDdPct}%) is measured from your equity at the start of the trading day and resets at 00:00 UTC. The static limit ({core.maxDdPct}% on Core) is anchored to your starting balance and never moves up — profits do not loosen it. Both are checked on equity, including unrealized PnL and fees.</>,
  },
  {
    q: 'What happens if I breach a rule?',
    a: <>All open positions are closed at market, pending limit orders are cancelled, and the account is marked FAILED permanently. Breaches are detected automatically within seconds. A failed account cannot be resumed — you can start a fresh challenge at any time.</>,
  },
  {
    q: 'When does the trading day reset?',
    a: <>At 00:00 UTC. Your equity at that moment becomes the baseline for the new day’s drawdown limit, and completed trading days are counted for the minimum-days requirement.</>,
  },
  {
    q: 'What leverage can I use?',
    a: <>From 1x up to 5x, within the margin requirements of the market you trade. Leverage changes how much margin a position occupies — it does not multiply your drawdown limits.</>,
  },
  {
    q: 'Can the rules change after I buy?',
    a: <>No. The exact rule set is hashed when your challenge is created, and every risk check is compared against that hash. Plan parameters you see at checkout are the parameters that will judge your account.</>,
  },
  {
    q: 'What do I get after passing?',
    a: <>You request a funded review from your dashboard. After approval you receive a funded account with the same size and the same rules, and you keep {core.profitSplitPct}% of the profit it generates.</>,
  },
  {
    q: 'How do payouts work?',
    a: <>On the funded stage you request a payout; each request is reviewed and then paid in USDC to your wallet on Solana. Your share is {core.profitSplitPct}% of the profit above the account’s starting size, minus amounts already requested or paid out.</>,
  },
  {
    q: 'How do I sign in? Do I need an email or documents?',
    a: <>Neither. Access is tied to your Solana wallet: you sign in by signing a message with your key — no password, no email, no identity documents in the current product. Your wallet is also where payouts arrive.</>,
  },
  {
    q: 'Which plan should I pick?',
    a: <>The plans differ in profit target and static drawdown softness. Sprint is the tightest test, Apex has the highest target, and Core carries the softest static drawdown ({core.maxDdPct}%) — that is why Core costs more. Full comparison with a worked example is on the <Link href="/rules">rules page</Link>.</>,
  },
];

export default function FaqPage() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">QUESTIONS & ANSWERS</span>
      <h1>Frequently asked<span><br />questions.</span></h1>
      <p className="legal-lede">
        Straight answers about how challenges, drawdown rules and payouts actually work.
        The full rule set with a worked example lives on the <Link href="/rules">rules page</Link>.
      </p>
      <div className="faq-list">
        {faq.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
