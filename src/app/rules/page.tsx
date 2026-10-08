import Link from 'next/link';
import { PLAN_CONFIGS, PRICING_MATRIX } from '@/lib/pricingConfig';

export const metadata = {
  title: 'Challenge rules',
  description: 'Evaluation rules: profit targets, daily and static drawdown, pass conditions, funded stage and the 80% profit split.',
};

// Пример считается из реальной конфигурации (pricingConfig.ts), не из головы.
const EXAMPLE_SIZE = 10000;
const core = PLAN_CONFIGS.CORE;
const corePrice = PRICING_MATRIX[EXAMPLE_SIZE].CORE;
const target = EXAMPLE_SIZE * (1 + core.profitTargetPct / 100);
const staticFloor = EXAMPLE_SIZE * (1 - core.maxDdPct / 100);
const dailyExampleStart = 10400;
const dailyExampleFloor = dailyExampleStart * (1 - core.dailyDdPct / 100);
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

const plans = (['SPRINT', 'CORE', 'APEX'] as const).map((name) => ({
  name,
  price: PRICING_MATRIX[EXAMPLE_SIZE][name],
  ...PLAN_CONFIGS[name],
}));

export default function RulesPage() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">EVALUATION RULES</span>
      <h1>Clear rules.<br /><span>No surprises.</span></h1>
      <p className="legal-lede">
        Every challenge runs on the same principles: fixed drawdown floors, an automatic risk engine,
        and rules that cannot change after you buy. This page explains exactly how each rule is measured.
      </p>

      <section className="legal-section">
        <h2>The three plans</h2>
        <p>
          All plans share the minimum trading days and the {core.profitSplitPct}% profit split. They differ in
          profit target and — most importantly — in the softness of the static drawdown. Prices shown for a{' '}
          {usd(EXAMPLE_SIZE)} account.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Fee ({usd(EXAMPLE_SIZE)})</th>
                <th>Profit target</th>
                <th>Max daily loss</th>
                <th>Static max loss</th>
                <th>Min trading days</th>
                <th>Profit split</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.name}>
                  <td>{p.name.charAt(0) + p.name.slice(1).toLowerCase()}</td>
                  <td>${p.price}</td>
                  <td>{p.profitTargetPct}%</td>
                  <td>{p.dailyDdPct}%</td>
                  <td>{p.maxDdPct}%</td>
                  <td>{p.minTradingDays}</td>
                  <td>{p.profitSplitPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="legal-section">
        <h2>Worked example — Core, {usd(EXAMPLE_SIZE)}</h2>
        <p>
          The Core plan on a {usd(EXAMPLE_SIZE)} account costs ${corePrice} and gives you {usd(EXAMPLE_SIZE)} of
          simulated evaluation capital. Here is what each number means for this exact account.
        </p>

        <div className="rule-example">
          <div>
            <span className="eyebrow">PROFIT TARGET</span>
            <p>
              <b>{core.profitTargetPct}% — reach equity of {usd(target)}.</b> Your account passes when equity
              (balance plus unrealized PnL) reaches {usd(target)}, you have traded at least{' '}
              {core.minTradingDays} days, and no position is open.
            </p>
          </div>
          <div>
            <span className="eyebrow">STATIC MAX LOSS</span>
            <p>
              <b>{core.maxDdPct}% — floor at {usd(staticFloor)}, fixed forever.</b> The floor is anchored to your
              initial {usd(EXAMPLE_SIZE)}: {usd(EXAMPLE_SIZE)} × (1 − {core.maxDdPct}%) = {usd(staticFloor)}. It never
              moves up, no matter how much profit you make. If equity touches {usd(staticFloor)}, the challenge
              is failed — even from a profitable peak.
            </p>
          </div>
          <div>
            <span className="eyebrow">MAX DAILY LOSS</span>
            <p>
              <b>{core.dailyDdPct}% of day-start equity, reset at 00:00 UTC.</b> Each trading day starts by
              recording your equity. Example: if a day starts at {usd(dailyExampleStart)}, that day&apos;s floor is{' '}
              {usd(dailyExampleStart)} × (1 − {core.dailyDdPct}%) = {usd(dailyExampleFloor)}. Touch it and the
              challenge is failed. At 00:00 UTC the floor is recalculated from the new equity.
            </p>
          </div>
        </div>

        <p>
          Both floors are measured on <b>equity</b>: realized balance plus unrealized PnL of open positions,
          with trading fees included. A breach is checked continuously by an automatic risk engine — there is
          no manual tolerance and no exception process.
        </p>
      </section>

      <section className="legal-section">
        <h2>How you pass</h2>
        <p>A challenge is marked PASSED when all of the following hold at the same time:</p>
        <ul className="legal-list">
          <li>Equity has reached the profit target — {usd(target)} in the Core {usd(EXAMPLE_SIZE)} example.</li>
          <li>At least {core.minTradingDays} trading days are completed.</li>
          <li>No position is open at the moment of evaluation.</li>
          <li>Neither drawdown floor has been breached at any point.</li>
        </ul>
        <p>
          The check runs automatically on every mark-price update. Positions are executed in a simulator on
          real Phoenix market prices — fills, fees and liquidation mechanics follow the live market catalogue.
        </p>
      </section>

      <section className="legal-section">
        <h2>After you pass — funded stage and payouts</h2>
        <p>
          A PASSED account moves to a funded review. After approval you receive a funded account with the{' '}
          <b>same rules and the same size</b>, and your share of its profit is{' '}
          <b>{core.profitSplitPct}%</b>.
        </p>
        <ul className="legal-list">
          <li>Your payout share is {core.profitSplitPct}% of the profit above the starting size, paid in USDC on Solana.</li>
          <li>You request a payout from the funded workspace; each request is reviewed before payment.</li>
          <li>Already-requested and already-paid payouts are subtracted from what is available next.</li>
        </ul>
        <p>
          The funded stage currently runs on simulated execution while real-capital trading is being rolled
          out. Payout mechanics and the split are already live.
        </p>
      </section>

      <section className="legal-section">
        <h2>What ends a challenge</h2>
        <ul className="legal-list">
          <li><b>Static floor breach</b> — equity at or below the fixed static floor.</li>
          <li><b>Daily floor breach</b> — equity at or below that day&apos;s floor.</li>
          <li><b>Liquidation</b> — equity no longer covers required maintenance margin.</li>
        </ul>
        <p>
          Any breach closes all open positions at market and sets the account to FAILED permanently. A failed
          account cannot be resumed — you can start a fresh challenge at any time. Limit orders are cancelled
          as well, so nothing executes on a dead account.
        </p>
      </section>

      <section className="legal-section">
        <h2>What stays fixed</h2>
        <ul className="legal-list">
          <li>
            <b>Rules are locked at purchase.</b> The exact rule set of your account is hashed when the challenge
            is created, and every risk check is compared against that hash. Rules cannot be changed mid-challenge —
            by us or by anyone else.
          </li>
          <li><b>Leverage is capped at 5x.</b> Margin requirements follow the market catalogue of the exchange.</li>
          <li><b>Evaluation capital is simulated.</b> Fees and price moves mirror the real market; the money at risk during the evaluation is only your one-time fee.</li>
        </ul>
        <p className="legal-footer-links">
          Ready? <Link href="/challenges">Choose your challenge</Link>, or read the{' '}
          <Link href="/faq">FAQ</Link>.
        </p>
      </section>
    </div>
  );
}
