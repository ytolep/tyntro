import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import { executionPolicy, assertSimulationAction } from '../policy';

// Тесты режимов счёта на Postgres (props_test из .env.test, воркер db в docker-compose).
// Схема пересоздаётся db push --force-reset перед прогоном.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды (db push --force-reset), если видит
// переменные окружения AI-агента. Тест сам создаёт и сбрасывает свою базу props_test,
// поэтому срезаем эти переменные для дочернего процесса.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: any, accounts: any, checkout: any;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  accounts = (await import('../../../app/api/accounts/active/route')).GET;
  checkout = (await import('../../../app/api/checkout/route')).POST;
  await db.user.create({ data: { id: 'demo', walletAddress: 'demo' } });
  await db.user.create({ data: { id: 'other', walletAddress: 'other' } });
  const challenge = await db.challenge.create({ data: {
    accountSize: new Decimal(10000), planType: 'CORE',
    profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
    priceUsd: new Decimal(89), minTradingDays: 3,
  } });
  const base = {
    userId: 'demo', challengeId: challenge.id,
    accountSize: new Decimal(10000), currentBalance: new Decimal(10000),
    currentEquity: new Decimal(10000), dayStartEquity: new Decimal(10000),
    staticMaxDdFloor: new Decimal(9400), dailyDdFloor: new Decimal(9700),
  };
  for (const a of [
    { id: 'challenge', mode: 'CHALLENGE', status: 'ACTIVE' },
    { id: 'funded', mode: 'FUNDED', status: 'FUNDED' },
    { id: 'legacy-funded', mode: 'CHALLENGE', status: 'FUNDED' },
    { id: 'passed', mode: 'CHALLENGE', status: 'PASSED' },
    { id: 'foreign', mode: 'CHALLENGE', status: 'ACTIVE', userId: 'other' },
  ]) await db.tradingAccount.create({ data: { ...base, ...a } });
});

after(async () => { await db?.$disconnect(); });

const request = (body: unknown) => new Request('http://localhost/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('funded account view cannot present local virtual ledger as Phoenix balances or fills', async () => {
  const response = await accounts(new Request('http://localhost/api/accounts/active?accountId=funded'));
  const result = await response.json();
  assert.equal(result.execution.provider, 'PHOENIX');
  assert.equal(result.execution.canTrade, false);
  assert.equal(result.account.currentEquity, null);
  assert.equal(result.account.currentBalance, null);
  assert.deepEqual(result.account.orders, []);
  assert.equal(result.riskEval, null);
  assert.equal((await accounts(new Request('http://localhost/api/accounts/active?accountId=foreign'))).status, 404);
});

test('checkout always creates challenge capital, ignoring forged funded fields', async () => {
  const response = await checkout(request({ accountSize: 10000, planType: 'CORE', mode: 'FUNDED', status: 'FUNDED' }));
  assert.equal(response.status, 200);
  const result = await response.json();
  const a = await db.tradingAccount.findUnique({ where: { id: result.accountId } });
  assert.equal(a.mode, 'CHALLENGE');
  assert.equal(a.status, 'ACTIVE');
  assert.equal(result.capital, 'VIRTUAL');
  // Инвариант §5: баланс счёта равен сумме его проводок.
  const entries = await db.ledgerEntry.findMany({ where: { accountId: a.id } });
  const ledgerSum = entries.reduce((sum: Decimal, e: { amount: Decimal }) => sum.plus(e.amount), new Decimal(0));
  assert.equal(ledgerSum.toFixed(2), a.currentBalance.toFixed(2));
  assert.equal((await checkout(request({ accountSize: 12345, planType: 'CORE' }))).status, 400);
});

test('policy rejects unknown modes and never lets a status override route into simulation', () => {
  assert.throws(() => assertSimulationAction({ mode: 'UNKNOWN', status: 'ACTIVE' }, 'OPEN_POSITION'));
  assert.throws(() => assertSimulationAction({ mode: 'FUNDED', status: 'ACTIVE' }, 'OPEN_POSITION'));
  assert.equal(executionPolicy({ mode: 'CHALLENGE', status: 'PASSED' }).canWithdraw, false);
});

// Волна 2 (агент F): api/orders сейчас заглушка 503 NOT_IMPLEMENTED, пока simulated.ts
// не переписан на src/lib/core + withAccountLock.
test.todo('every funded action fails closed without any simulated writes, even if client spoofs mode');
test.todo('order endpoint requires selected owned account; cannot silently pick latest account');
test.todo('passed challenge cannot open or trigger new positions and is never auto-funded');
test.todo('cancel cannot touch another account order');
// Волна 2 (агент I): admin/reset-day удалён; демо-инструменты вернутся в api/admin/*.
test.todo('demo reset tools cannot mutate funded account or change its mode');
// Волна 1 (агент A): riskEngine.ts не переносится, риск переезжает на core/risk.evaluateAccount.
test.todo('evaluation passes only with completed days and closed exposure, never activates funded');
