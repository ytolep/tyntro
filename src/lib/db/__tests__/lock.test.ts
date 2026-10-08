import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import { withAccountLock } from '../lock';

// withAccountLock — единственная точка изменения счёта (D5): параллельные
// читай-потом-пиши внутри блокировки не теряют обновления.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: any;
let accountId: string;
const START = new Decimal(1000);

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  const user = await db.user.create({ data: { walletAddress: 'lock-test' } });
  const challenge = await db.challenge.create({ data: {
    accountSize: new Decimal(10000), planType: 'CORE',
    profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
    priceUsd: new Decimal(89), minTradingDays: 3,
  } });
  const account = await db.tradingAccount.create({ data: {
    userId: user.id, challengeId: challenge.id,
    accountSize: new Decimal(10000), currentBalance: START,
    currentEquity: START, dayStartEquity: START,
    staticMaxDdFloor: new Decimal(9400), dailyDdFloor: new Decimal(9700),
  } });
  accountId = account.id;
});

after(async () => { await db?.$disconnect(); });

test('withAccountLock serializes concurrent read-then-write updates', async () => {
  const N = 20;
  await Promise.all(Array.from({ length: N }, () =>
    withAccountLock(accountId, async (tx) => {
      const acc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
      await tx.tradingAccount.update({
        where: { id: accountId },
        data: { currentBalance: acc.currentBalance.plus(1) },
      });
    })));
  const final = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert.equal(final.currentBalance.toFixed(0), START.plus(N).toFixed(0));
});

test('withAccountLock returns the callback result', async () => {
  assert.equal(await withAccountLock(accountId, async () => 42), 42);
});
