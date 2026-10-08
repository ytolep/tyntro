export type AccountMode = 'CHALLENGE' | 'FUNDED';
export type ExecutionAccount = { mode: string; status: string };
export class ExecutionError extends Error {
  constructor(public code: string, message: string, public status: number = 409) { super(message); }
}
export function executionPolicy(account: ExecutionAccount) {
  // Legacy FUNDED status must never fall through to simulated execution.
  const funded = account.mode === 'FUNDED' || account.status === 'FUNDED';
  const valid = funded || account.mode === 'CHALLENGE';
  return {
    mode: funded ? 'FUNDED' : valid ? 'CHALLENGE' : 'UNKNOWN',
    provider: funded ? 'PHOENIX' : valid ? 'SIMULATOR' : 'NONE',
    capital: funded ? 'REAL' : valid ? 'VIRTUAL' : 'UNKNOWN',
    marketData: 'PHOENIX',
    state: funded ? 'AWAITING_PHOENIX_CONNECTION' : valid ? account.status : 'UNAVAILABLE',
    canTrade: !funded && valid && ['ACTIVE', 'RISK_REVIEW'].includes(account.status),
    canWithdraw: false,
    message: funded
      ? 'Funded execution awaits a dedicated Phoenix account and an approved signing and risk-control integration. No real orders are enabled.'
      : valid ? (account.status === 'PASSED'
        ? 'Challenge passed. Funded activation is a separate step; virtual balances and profits are not transferred.'
        : 'Virtual capital. Simulated orders using live Phoenix prices. Challenge profits cannot be withdrawn.')
      : 'Unknown account mode. Trading is unavailable.',
  };
}
export function assertSimulationAction(account: ExecutionAccount, action: string) {
  const policy = executionPolicy(account);
  if (policy.provider !== 'SIMULATOR') throw new ExecutionError('SIMULATION_FORBIDDEN', 'This account cannot use simulated execution.');
  if (!['OPEN_POSITION', 'CHECK_LIMIT_ORDERS', 'CLOSE_POSITION', 'CANCEL_ORDER'].includes(action))
    throw new ExecutionError('INVALID_ACTION', 'Invalid action', 400);
  const cleanup = ['CLOSE_POSITION', 'CANCEL_ORDER'].includes(action);
  if (!policy.canTrade && !(cleanup && account.status === 'PASSED'))
    throw new ExecutionError('ACCOUNT_NOT_TRADABLE', `Challenge is ${account.status}; new simulated trades are disabled.`);
}
