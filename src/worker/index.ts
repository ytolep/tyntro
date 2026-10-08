// Воркер (план §2): отдельный процесс, тот же код.
//  - каждую 1 с: тик риска (лимитки, переоценка, ликвидация, floors)
//  - каждые 15 с: проверка оплат Solana Pay (подтверждение покупок)
//  - каждые 30 с: проверка смены торгового дня (сам ролл — в 00:00 UTC, идемпотентен)
import { db } from '../lib/db';
import { runRiskTick } from './riskTick';
import { runDayRoll, DAY_ROLL_CHECK_MS } from './dayRoll';
import { checkPendingPayments } from './payments';
import { createSolanaRpc } from '../lib/payments/solanaPay';
import { jsonLog } from './log';

const RISK_TICK_MS = 1_000;
export const PAYMENTS_CHECK_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;

// Реальный RPC на SOLANA_RPC_URL (публичный mainnet как запасной);
// циклPayments идёт строго последовательно — наложения запусков нет.
const paymentsRpc = createSolanaRpc(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

let running = true;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Сон с проверкой running: после SIGTERM циклы выходят в пределах секунды. */
async function sleepWhileRunning(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (running && Date.now() < end) await sleep(Math.min(1_000, Math.max(0, end - Date.now())));
}

// Итерации внутри цикла идут строго последовательно: тики не накладываются.
async function loop(name: string, intervalMs: number, step: () => Promise<unknown>): Promise<void> {
  while (running) {
    const startedAt = Date.now();
    try {
      await step();
    } catch (error) {
      jsonLog('error', `${name}: итерация упала`, { error: String(error) });
    }
    await sleepWhileRunning(intervalMs - (Date.now() - startedAt));
  }
  jsonLog('info', `${name}: цикл остановлен`);
}

const loops = Promise.all([
  loop('riskTick', RISK_TICK_MS, () => runRiskTick()),
  loop('payments', PAYMENTS_CHECK_MS, () => checkPendingPayments({ rpc: paymentsRpc })),
  loop('dayRoll', DAY_ROLL_CHECK_MS, () => runDayRoll()),
]);

jsonLog('info', 'worker запущен', { pid: process.pid, riskTickMs: RISK_TICK_MS, paymentsCheckMs: PAYMENTS_CHECK_MS, dayRollCheckMs: DAY_ROLL_CHECK_MS });

let exiting = false;
function shutdown(signal: string): void {
  if (exiting) return;
  exiting = true;
  running = false;
  jsonLog('info', 'worker останавливается', { signal });
  const timeout = setTimeout(() => {
    jsonLog('warn', 'worker: таймаут graceful shutdown');
    process.exit(1);
  }, STOP_TIMEOUT_MS);
  timeout.unref?.();
  void loops.then(async () => {
    clearTimeout(timeout);
    await db.$disconnect().catch(() => {});
    jsonLog('info', 'worker остановлен', { signal });
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
