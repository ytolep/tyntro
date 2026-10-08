import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

// Инструкции оплаты USDC для отправки подключённым кошельком (браузер) и скриптами (node):
// один и тот же код собирает транзакцию Solana Pay без зависимости @solana/pay.
// Модуль браузер-безопасен: без @prisma/client/runtime (его ESM тянет node:fs и ломает
// клиентский бандл) — суммы конвертируются точной BigInt-арифметикой, без float.

export const USDC_DECIMALS = 6; // ponytail: USDC всегда 6 знаков; другие токены — читать decimals из mint.
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** ATA владельца для mint (чистая деривация, без сети). */
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

/** "23.00" → 23000000n: точная конвертация в минорные единицы строковой арифметикой, без float. */
export function toMinorUnits(amountUi: string, decimals: number = USDC_DECIMALS): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amountUi.trim());
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error(`Invalid token amount: ${amountUi}`);
  return BigInt(m[1]) * BigInt(10) ** BigInt(decimals) + BigInt((m[2] ?? '').padEnd(decimals, '0') || '0');
}

export interface UsdcTransferParams {
  payer: string; // base58 плательщик (signer, платит комиссию)
  recipient: string; // base58 получатель (казна)
  mint: string; // base58 mint USDC
  amountUi: string; // сумма в USDC, например "23.00"
  reference?: string; // base58 reference-ключ покупки (read-only ключом в перевод)
}

/** [CreateIdempotent ATA получателя, TransferChecked] — Solana Pay перевод USDC. */
export function buildUsdcTransferInstructions(p: UsdcTransferParams): TransactionInstruction[] {
  const payer = new PublicKey(p.payer);
  const recipient = new PublicKey(p.recipient);
  const mint = new PublicKey(p.mint);
  const payerAta = new PublicKey(associatedTokenAddress(p.payer, p.mint));
  const recipientAta = new PublicKey(associatedTokenAddress(p.recipient, p.mint));

  // CreateIdempotent (дискриминатор 1): ATA получателя создаётся, если его нет;
  // на существующем ATA инструкция не падает.
  const createRecipientAta = new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM_ID),
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
  });

  // TransferChecked (дискриминатор 12): u64 LE в минорных единицах + decimals mint-а.
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(toMinorUnits(p.amountUi), 1);
  data[9] = USDC_DECIMALS;
  const transferChecked = new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    data,
    keys: [
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      ...(p.reference
        ? [{ pubkey: new PublicKey(p.reference), isSigner: false, isWritable: false }]
        : []),
    ],
  });

  return [createRecipientAta, transferChecked];
}

export interface ParsedTransferRequest {
  recipient: string;
  amount: string; // USDC строкой, например "23" (без float; при нужна точность — обернуть в Decimal)
  splToken: string;
  reference: string;
}

/** Обратная к buildTransferRequestUrl: `solana:<recipient>?amount=&spl-token=&reference=&…`. */
export function parseTransferRequestUrl(url: string): ParsedTransferRequest {
  let u: URL;
  try {
    u = new URL(url.replace('solana:', 'solana://'));
  } catch {
    throw new Error(`Invalid Solana Pay transfer request URL: ${url}`);
  }
  const amount = u.searchParams.get('amount');
  const splToken = u.searchParams.get('spl-token');
  const reference = u.searchParams.get('reference');
  if (!u.host || !amount || !splToken || !reference)
    throw new Error(`Invalid Solana Pay transfer request URL: ${url}`);
  return { recipient: u.host, amount, splToken, reference };
}
