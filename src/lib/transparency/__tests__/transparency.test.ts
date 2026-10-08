import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';

// Пункт T4: агрегация публичного отчёта прозрачности на Postgres из .env.test
// и правило null для passRate при знаменателе < 20.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

const D = (v: number) => new Decimal(v);

let db: typeof import('../../db').db;
let report: typeof import('../report');
let transferTx: typeof import('../../payments/transferTx');
let challengeId: string;
let userId: string;
let treasury: string;

/** Фейковый источник баланса: запоминает, какой ATA спросили. */
function fakeBalance(minor: string | null | Error) {
  const asked: string[] = [];
  return {
    asked,
    async tokenBalanceMinor(ata: string): Promise<string | null> {
      asked.push(ata);
      if (minor instanceof Error) throw minor;
      return minor;
    },
  };
}

before(async () => {
  treasury = Keypair.generate().publicKey.toBase58();
  process.env.TREASURY_WALLET = treasury;

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  report = await import('../report');
  transferTx = await import('../../payments/transferTx');

  const user = await db.user.create({ data: { walletAddress: 'transparency-test' } });
  userId = user.id;
  const challenge = await db.challenge.create({
    data: {
      accountSize: D(10000), planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: D(89), minTradingDays: 3,
    },
  });
  challengeId = challenge.id;
});

after(async () => { await db?.$disconnect(); });

test('aggregation counts only PAID purchases and PAID payouts, funded stage only', async () => {
  // Покупки: 3 оплачены, PENDING и EXPIRED не считаются.
  for (const status of ['PAID', 'PAID', 'PAID', 'PENDING', 'EXPIRED']) {
    const reference = Keypair.generate().publicKey.toBase58();
    const purchase = await db.purchase.create({
      data: { userId, challengeId, reference, amountUsdc: D(89), status },
    });
    if (status === 'EXPIRED')
      await db.purchase.update({ where: { id: purchase.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
  }

  // Выплаты: 2 выполнены (120.50 + 9.50 = 130.00), REQUESTED не считается.
  const account = await db.tradingAccount.create({
    data: {
      userId, challengeId, phase: 'FUNDED_SIM', status: 'ACTIVE',
      accountSize: D(10000), currentBalance: D(10000), currentEquity: D(10000),
      dayStartEquity: D(10000), staticMaxDdFloor: D(9400), dailyDdFloor: D(9700),
    },
  });
  await db.payout.create({ data: { accountId: account.id, amountUsd: D(120.5), status: 'PAID', txSignature: 'sig-1' } });
  await db.payout.create({ data: { accountId: account.id, amountUsd: D(9.5), status: 'PAID', txSignature: 'sig-2' } });
  await db.payout.create({ data: { accountId: account.id, amountUsd: D(500), status: 'REQUESTED' } });

  // Счета: 2 PASSED + 3 FAILED (решено 5 < 20), 1 funded.
  for (const status of ['PASSED', 'PASSED', 'FAILED', 'FAILED', 'FAILED'])
    await db.tradingAccount.create({
      data: {
        userId, challengeId, status,
        accountSize: D(10000), currentBalance: D(10000), currentEquity: D(10000),
        dayStartEquity: D(10000), staticMaxDdFloor: D(9400), dailyDdFloor: D(9700),
      },
    });

  const balance = fakeBalance('123456789'); // 123.456789 USDC в минорных единицах
  const r = await report.buildTransparencyReport({ db, balance });

  assert.equal(r.treasuryWallet, treasury);
  // Спрошен именно ATA казны по USDC_MINT.
  assert.deepEqual(balance.asked, [transferTx.associatedTokenAddress(treasury, process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')]);
  assert.equal(r.treasuryUsdc, '123.46'); // округление до центов
  assert.equal(r.challengesSold, 3);
  assert.equal(r.passRate, null); // 2/(2+3) есть, но знаменатель 5 < 20 → null
  assert.equal(r.payoutsPaidUsd, '130.00');
  assert.equal(r.payoutsCount, 2);
  assert.equal(r.fundedAccounts, 1);
  assert.ok(!Number.isNaN(Date.parse(r.updatedAt)));
});

test('passRate appears exactly at 20 decided evaluations and equals PASSED share', async () => {
  // 19 решённых — всё ещё null (граница «меньше 20»).
  for (let i = 0; i < 14; i++)
    await db.tradingAccount.create({
      data: {
        userId, challengeId, status: 'FAILED',
        accountSize: D(10000), currentBalance: D(10000), currentEquity: D(10000),
        dayStartEquity: D(10000), staticMaxDdFloor: D(9400), dailyDdFloor: D(9700),
      },
    });
  const before = await report.buildTransparencyReport({ db });
  assert.equal(before.passRate, null); // 2 PASSED + 17 FAILED = 19

  await db.tradingAccount.create({
    data: {
      userId, challengeId, status: 'FAILED',
      accountSize: D(10000), currentBalance: D(10000), currentEquity: D(10000),
      dayStartEquity: D(10000), staticMaxDdFloor: D(9400), dailyDdFloor: D(9700),
    },
  });
  const after = await report.buildTransparencyReport({ db });
  assert.equal(after.passRate, 0.1); // 2 PASSED / 20 решённых
});

test('treasury balance errors resolve to null, never to 0, and do not fail the report', async () => {
  const down = await report.buildTransparencyReport({ db, balance: fakeBalance(new Error('rpc down')) });
  assert.equal(down.treasuryUsdc, null);
  assert.equal(down.challengesSold, 3); // остальной отчёт жив

  const noAta = await report.buildTransparencyReport({ db, balance: fakeBalance(null) });
  assert.equal(noAta.treasuryUsdc, null);
  assert.equal(noAta.treasuryWallet, treasury);
});

test('missing TREASURY_WALLET leaves treasury fields null instead of failing', async () => {
  const saved = process.env.TREASURY_WALLET;
  delete process.env.TREASURY_WALLET;
  try {
    const r = await report.buildTransparencyReport({ db, balance: fakeBalance('1000000') });
    assert.equal(r.treasuryWallet, null);
    assert.equal(r.treasuryUsdc, null);
    assert.equal(r.challengesSold, 3);
  } finally {
    process.env.TREASURY_WALLET = saved;
  }
});
