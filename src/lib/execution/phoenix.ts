import { ExecutionError } from './policy';
// Deliberately no simulator fallback. Real execution requires a separate funded
// account, authenticated ownership, signing permissions, and enforced prop risk.
export async function executePhoenixFundedOrder(): Promise<never> {
  throw new ExecutionError('PHOENIX_FUNDED_NOT_CONNECTED',
    'Funded trading requires a connected Phoenix account. Real execution is not enabled; no simulated order was created.', 503);
}
