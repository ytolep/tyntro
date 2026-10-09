import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';
import { buildUsdcTransferInstructions, parseTransferRequestUrl, associatedTokenAddress, toMinorUnits } from '../transferTx';
import { buildTransferRequestUrl } from '../solanaPay';

// Раскладка инструкций Solana Pay перевода USDC: данные, порядок ключей,
// reference в ключах, минорные единицы, parse(build(x)) == x. БД не нужна.

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

const key = () => Keypair.generate().publicKey.toBase58();

test('buildUsdcTransferInstructions: раскладка данных и порядок ключей обеих инструкций', () => {
  const payer = key();
  const recipient = key();
  const mint = key();
  const reference = key();
  const [createAta, transfer] = buildUsdcTransferInstructions({
    payer, recipient, mint, amountUi: '23.00', reference,
  });

  // CreateIdempotent ATA получателя: data [1], фьюжн-ключи в порядке программы ATA.
  assert.equal(createAta.programId.toBase58(), ATA_PROGRAM_ID);
  assert.deepEqual([...createAta.data], [1]);
  assert.deepEqual(
    createAta.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [payer, true, true],
      [associatedTokenAddress(recipient, mint), false, true],
      [recipient, false, false],
      [mint, false, false],
      [SYSTEM_PROGRAM_ID, false, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
  );

  // TransferChecked: data [12, u64 LE, decimals], ключи ATA плательщика → mint → ATA получателя → payer → reference.
  assert.equal(transfer.programId.toBase58(), TOKEN_PROGRAM_ID);
  assert.deepEqual([...transfer.data.subarray(0, 1)], [12]);
  assert.equal(transfer.data[9], 6);
  assert.deepEqual(
    transfer.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [associatedTokenAddress(payer, mint), false, true],
      [mint, false, false],
      [associatedTokenAddress(recipient, mint), false, true],
      [payer, true, false],
      [reference, false, false],
    ],
  );
});

test('сумма 23.00 USDC кодируется как 23000000 в минорных единицах (u64 LE)', () => {
  const [, transfer] = buildUsdcTransferInstructions({
    payer: key(), recipient: key(), mint: key(), amountUi: '23.00',
  });
  assert.equal(transfer.data.length, 10);
  assert.equal(transfer.data.readBigUInt64LE(1), BigInt(23000000));
});

test('reference попадает в ключи read-only последним; без reference ключа нет', () => {
  const payer = key(), recipient = key(), mint = key(), reference = key();
  const [, withRef] = buildUsdcTransferInstructions({ payer, recipient, mint, amountUi: '1', reference });
  const last = withRef.keys[withRef.keys.length - 1];
  assert.deepEqual([last.pubkey.toBase58(), last.isSigner, last.isWritable], [reference, false, false]);

  const [, noRef] = buildUsdcTransferInstructions({ payer, recipient, mint, amountUi: '1' });
  assert.equal(noRef.keys.length, 4);
  assert.ok(noRef.keys.every((k) => k.pubkey.toBase58() !== reference));
});

test('parseTransferRequestUrl — обратная к buildTransferRequestUrl', () => {
  const params = {
    recipient: key(),
    amount: new Decimal('23.00'),
    splToken: key(),
    reference: key(),
    label: 'TYNTRO',
    message: 'Challenge checkout',
  };
  const parsed = parseTransferRequestUrl(buildTransferRequestUrl(params));
  assert.equal(parsed.recipient, params.recipient);
  assert.ok(new Decimal(parsed.amount).eq(params.amount));
  assert.equal(parsed.splToken, params.splToken);
  assert.equal(parsed.reference, params.reference);
});

test('toMinorUnits: точная конвертация строкой, без float', () => {
  assert.equal(toMinorUnits('23.00'), BigInt(23000000));
  assert.equal(toMinorUnits('23'), BigInt(23000000));
  assert.equal(toMinorUnits('23.5'), BigInt(23500000));
  assert.equal(toMinorUnits('0.000001'), BigInt(1));
  assert.throws(() => toMinorUnits('23.0000001')); // больше 6 знаков
  assert.throws(() => toMinorUnits('-1')); // отрицательные/мусор
  assert.throws(() => toMinorUnits('1e3')); // экспоненциальная запись не допускается
});

test('parseTransferRequestUrl отвергает мусорный URL', () => {
  assert.throws(() => parseTransferRequestUrl('https://example.com/pay'));
  assert.throws(() => parseTransferRequestUrl('solana:not-a-pubkey?amount=1'));
});
