import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Ревью (агент L), C1: легаси-роут POST /api/checkout создавал ACTIVE-счёт
// челленджа с DEPOSIT-проводкой без сессии и без оплаты (обход оплаты).
// Исправление (волна 4, агент X1): роут удалён. Единственный путь создания
// счёта — /api/checkout/create (requireUser) + подтверждение перевода USDC
// воркером. Тест охраняет отсутствие легаси-роута и проводок без оплаты.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../../../lib/db').db;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../../../lib/db')).db;
});

after(async () => { await db?.$disconnect(); });

test('legacy POST /api/checkout route is gone and no account appears without payment', async () => {
  // Файл роута удалён — эндпоинт не может существовать ни в каком режиме.
  const routePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'route.ts');
  assert.ok(!existsSync(routePath), 'src/app/api/checkout/route.ts должен быть удалён');
  // @ts-expect-error роут удалён (C1): модуль не должен резолвиться ни tsc, ни tsx
  // (если роут воссоздадут — tsc заметит неиспользованный подавитель и упадёт).
  await assert.rejects(() => import('../route'), 'модуль легаси-роута не должен резолвиться');

  // Ни сессии, ни покупки, ни перевода USDC — счёт и DEPOSIT-проводка появиться не могут.
  assert.equal(await db.tradingAccount.count(), 0, 'счёт без оплаты не создаётся');
  assert.equal(await db.ledgerEntry.count({ where: { type: 'DEPOSIT' } }), 0, 'DEPOSIT-проводка без оплаты не создаётся');
});
