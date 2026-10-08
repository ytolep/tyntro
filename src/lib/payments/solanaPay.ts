import { Connection, PublicKey } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';

// Solana Pay без @solana/pay: transfer request URL собирается вручную по спецификации
// https://github.com/solana-labs/solana-pay/blob/master/SPEC.md#specification-transfer-request

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
// ponytail: USDC всегда 6 знаков; если появятся другие токены — читать decimals из mint.
export const USDC_DECIMALS = 6;

export interface TransferRequestUrlParams {
  recipient: string; // base58 pubkey казны
  amount: Decimal; // USDC
  splToken: string; // base58 mint (USDC)
  reference: string; // base58 pubkey, уникальный для покупки
  label: string;
  message: string;
}

/** `solana:<recipient>?amount=&spl-token=&reference=&label=&message=` (значения percent-encoded по RFC 3986). */
export function buildTransferRequestUrl(p: TransferRequestUrlParams): string {
  const enc = encodeURIComponent;
  return (
    `solana:${p.recipient}` +
    `?amount=${enc(p.amount.toFixed())}` +
    `&spl-token=${enc(p.splToken)}` +
    `&reference=${enc(p.reference)}` +
    `&label=${enc(p.label)}` +
    `&message=${enc(p.message)}`
  );
}

/** ATA получателя для mint (чистая деривация, без сети). */
export function associatedTokenAddress(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ATA_PROGRAM_ID),
  );
  return ata.toBase58();
}

// Минимальный структурный вид getParsedTransaction — только то, что нужно для проверки.
export interface PaymentInstruction {
  programId: string;
  parsed?: { type: string; info: unknown };
}

export interface ParsedTransaction {
  meta: { err: unknown; innerInstructions?: { instructions: PaymentInstruction[] }[] } | null;
  transaction: { message: { instructions: PaymentInstruction[] } };
}

export interface VerifyTransferOptions {
  treasury: string;
  splToken: string;
  expectedAmount: Decimal; // USDC, не минорные единицы
}

/**
 * Успешная (err == null) транзакция содержит перевод USDC на ATA казны
 * на сумму не меньше expectedAmount. Список сигнатур мы получили через
 * getSignaturesForAddress(reference), поэтому транзакция уже привязана к покупке.
 */
export function verifyUsdcTransfer(tx: ParsedTransaction, opts: VerifyTransferOptions): boolean {
  if (!tx.meta || tx.meta.err != null) return false;
  const ata = associatedTokenAddress(opts.treasury, opts.splToken);
  const expectedMinor = opts.expectedAmount.times(10 ** USDC_DECIMALS).toFixed(0);
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions ?? []).flatMap((ii) => ii.instructions),
  ];
  return instructions.some((ix) => {
    if (ix.programId !== TOKEN_PROGRAM_ID || !ix.parsed) return false;
    const { type, info } = ix.parsed;
    const i = (info ?? {}) as Record<string, unknown>;
    // transfer: amount — строка в минорных единицах; transferChecked: tokenAmount.{amount,decimals}
    let amountMinor: string | null = null;
    if (type === 'transfer' && i.destination === ata && typeof i.amount === 'string') {
      amountMinor = i.amount;
    } else if (type === 'transferChecked' && i.destination === ata) {
      const ta = i.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
      if (ta && typeof ta.amount === 'string' && ta.decimals === USDC_DECIMALS) amountMinor = ta.amount;
    }
    return amountMinor !== null && new Decimal(amountMinor).gte(expectedMinor);
  });
}

// RPC-порт: ядро проверки зависит только от этих двух методов, тесты подменяют их фейком.
export interface SolanaRpc {
  getSignaturesForAddress(address: string): Promise<{ signature: string }[]>;
  getParsedTransaction(signature: string): Promise<ParsedTransaction | null>;
}

/** Адаптер @solana/web3.js Connection под минимальный порт SolanaRpc. */
export function createSolanaRpc(url: string): SolanaRpc {
  const connection = new Connection(url, 'confirmed');
  // Оба варианта инструкции (parsed и partially decoded) структурно вкладываются в этот тип.
  type Web3Instruction = { programId: PublicKey; parsed?: unknown };
  const plain = (ix: Web3Instruction): PaymentInstruction => ({
    programId: ix.programId.toString(),
    // SAFETY: web3.js для parsed-инструкций всегда даёт объект вида { type, info } —
    // проверяется ниже по типу/сумме, а форма info в verifyUsdcTransfer валидируется вручную.
    parsed: ix.parsed as PaymentInstruction['parsed'],
  });
  return {
    getSignaturesForAddress: async (address) =>
      (await connection.getSignaturesForAddress(new PublicKey(address))).map((s) => ({
        signature: s.signature,
      })),
    getParsedTransaction: async (signature) => {
      const tx = await connection.getParsedTransaction(signature);
      if (!tx || !tx.meta) return null;
      return {
        meta: {
          err: tx.meta.err,
          innerInstructions: (tx.meta.innerInstructions ?? []).map((ii) => ({
            instructions: ii.instructions.map(plain),
          })),
        },
        transaction: {
          message: {
            instructions: tx.transaction.message.instructions.map(plain),
          },
        },
      };
    },
  };
}
