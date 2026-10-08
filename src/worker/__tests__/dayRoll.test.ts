import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import { runDayRoll, DAY_ROLL_ACTION } from '../dayRoll';
import { withAccountLock } from '../../lib/db/lock';

// Интеграционный тест смены торгового дня на Postgres (.env.test):
// ролл в 00:00 UTC, идемпотентность в пределах дня и после «рестарта»
// (маркер — строка AuditLog, никакого состояния в памяти).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

type Db = typeof import('../../lib/db')['db'];
let db: Db;
let accountA: { id: string };
let accountB: { id: string };

const deps = (now: () => Date) => ({ db, withAccountLock, now, log: () => {} });

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../lib/db')).db;
  const user = await db.user.create({ data: { walletAddress: 'worker-dayroll-test' } });
  const challenge = await db.challenge.create({
    data: {
      accountSize: new Decimal(10000), planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: new Decimal(89), minTradingDays: 3,
    },
  });
  const base = {
    userId: user.id, challengeId: challenge.id,
    accountSize: new Decimal(10000), currentBalance: new Decimal(10000),
    dayStartEquity: new Decimal(10000), staticMaxDdFloor: new Decimal(9400),
    dailyDdFloor: new Decimal(9700),
  };
  // A: торговал вчера (2026-10-07); B: ни одной сделки.
  accountA = await db.tradingAccount.create({
    data: { ...base, currentEquity: new Decimal(9800), lastTradeDay: '2026-10-07', tradingDaysCount: 0 },
  });
  accountB = await db.tradingAccount.create({
    data: { ...base, currentEquity: new Decimal(10500), tradingDaysCount: 0 },
  });
});

after(async () => {
  await db?.$disconnect();
});

test('00:00 UTC: floors пересчитаны, день засчитан; повтор в тот же день — пустой', async () => {
  const oct8 = deps(() => new Date('2026-10-08T00:00:30.000Z'));
  assert.equal(await runDayRoll(oct8), 2);

  const a = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountA.id } });
  assert.equal(a.dayStartEquity.toFixed(2), '9800.00');
  assert.equal(a.dailyDdFloor.toFixed(2), '9506.00'); // 9800 × (1 − 0.03)
  assert.equal(a.tradingDaysCount, 1); // lastTradeDay == завершившийся день

  const b = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountB.id } });
  assert.equal(b.dayStartEquity.toFixed(2), '10500.00');
  assert.equal(b.dailyDdFloor.toFixed(2), '10185.00');
  assert.equal(b.tradingDaysCount, 0); // сделок не было — день не засчитан

  assert.equal(await db.auditLog.count({ where: { action: DAY_ROLL_ACTION } }), 1);

  // День продолжился: equity изменилось, затем ролл запустили снова (рестарт воркера).
  await db.tradingAccount.update({
    where: { id: accountA.id },
    data: { currentEquity: new Decimal(9600) },
  });
  assert.equal(await runDayRoll(oct8), 0);

  const a2 = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountA.id } });
  assert.equal(a2.dayStartEquity.toFixed(2), '9800.00'); // не сброшено повторно
  assert.equal(a2.dailyDdFloor.toFixed(2), '9506.00');
  assert.equal(a2.tradingDaysCount, 1); // не инкрементировано дважды
  assert.equal(await db.auditLog.count({ where: { action: DAY_ROLL_ACTION } }), 1);
});

test('следующий день: счёт без сделок день назад не засчитывается', async () => {
  // B торговал 2026-10-08; A — нет.
  await db.tradingAccount.update({
    where: { id: accountB.id },
    data: { lastTradeDay: '2026-10-08' },
  });
  assert.equal(await runDayRoll(deps(() => new Date('2026-10-09T00:00:30.000Z'))), 2);

  const a = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountA.id } });
  assert.equal(a.tradingDaysCount, 1); // lastTradeDay 10-07 ≠ завершившийся 10-08
  assert.equal(a.dayStartEquity.toFixed(2), '9600.00'); // equity на момент ролла
  assert.equal(a.dailyDdFloor.toFixed(2), '9312.00'); // 9600 × 0.97

  const b = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountB.id } });
  assert.equal(b.tradingDaysCount, 1);
});
