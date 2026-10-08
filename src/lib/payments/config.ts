// Конфиг оплаты из env. Казна обязательна; USDC mainnet по умолчанию,
// devnet-тесты подменяют USDC_MINT и SOLANA_RPC_URL через env.
export interface PaymentsConfig {
  treasuryWallet: string;
  usdcMint: string;
  rpcUrl: string;
}

export function getPaymentsConfig(): PaymentsConfig {
  const treasuryWallet = process.env.TREASURY_WALLET ?? '';
  if (!treasuryWallet) throw new Error('TREASURY_WALLET env is required');
  return {
    treasuryWallet,
    usdcMint: process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    rpcUrl: process.env.PAYMENTS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
}
