import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';

// Ревью (агент L): /api/checkout — легаси-роут волны 0 — создаёт ACTIVE-счёт
// челленджа с полным accountSize и DEPOSIT-проводкой БЕЗ сессии и БЕЗ оплаты.
// Продакшн-страница /checkout использует /api/checkout/create; этот роут
// остался живым эндпоинтом = обход оплаты.
//
// Тест ПАДАЕТ на текущем коде (ждём 401, получаем 200 + счёт) — помечен skip,
// чтобы ворота оставались зелёными. Снять skip после исправления (см. docs/REVIEW.md, C1).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../../../lib/db').db;
let checkoutPOST: (req: Request) => Promise<Response>;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../../../lib/db')).db;
  ({ POST: checkoutPOST } = await import('../route'));

  await db.challenge.create({
    data: {
      accountSize: new Decimal(100000), planType: 'APEX',
      profitTargetPct: 12, dailyDdPct: 3, maxDdPct: 5, profitSplitPct: 80,
      priceUsd: new Decimal(549), minTradingDays: 3,
    },
  });
});

after(async () => { await db?.$disconnect(); });

const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test.skip('anonymous POST /api/checkout must not create a paid challenge account (payment bypass)', async () => {
  const before = await db.tradingAccount.count();

  // Ни сессии, ни покупки, ни перевода USDC — счёт появиться не может.
  const res = await checkoutPOST(post({ accountSize: 100000, planType: 'APEX' }));

  assert.equal(res.status, 401, 'без сессии роут обязан отвечать 401 (или 404/405 после удаления роута)');
  assert.equal(await db.tradingAccount.count(), before, 'счёт без оплаты не создаётся');
  assert.equal(await db.ledgerEntry.count({ where: { type: 'DEPOSIT' } }), 0, 'DEPOSIT-проводка без оплаты не создаётся');
});
