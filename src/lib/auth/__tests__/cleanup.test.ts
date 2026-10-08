import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// L6 (docs/REVIEW.md): deleteExpiredAuthRows удаляет только просроченные
// Session и AuthNonce, свежие остаются.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let deleteExpiredAuthRows: typeof import('../cleanup').deleteExpiredAuthRows;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ deleteExpiredAuthRows } = await import('../cleanup'));
});

after(async () => { await db?.$disconnect(); });

test('удаляет просроченные Session/AuthNonce, живые не трогает', async () => {
  const past = new Date(Date.now() - 1000);
  const future = new Date(Date.now() + 60_000);
  const user = await db.user.create({ data: { walletAddress: 'cleanup-test-wallet' } });
  await db.session.create({ data: { userId: user.id, tokenHash: 'expired-hash', expiresAt: past } });
  await db.session.create({ data: { userId: user.id, tokenHash: 'live-hash', expiresAt: future } });
  await db.authNonce.create({ data: { nonce: 'expired-nonce', wallet: user.walletAddress, expiresAt: past } });
  await db.authNonce.create({ data: { nonce: 'live-nonce', wallet: user.walletAddress, expiresAt: future } });

  assert.deepEqual(await deleteExpiredAuthRows(db), { sessions: 1, nonces: 1 });

  assert.equal(await db.session.count(), 1);
  assert.equal(await db.authNonce.count(), 1);
  assert.ok(await db.session.findUnique({ where: { tokenHash: 'live-hash' } }), 'живая сессия осталась');
  assert.ok(await db.authNonce.findUnique({ where: { nonce: 'live-nonce' } }), 'живой nonce остался');
});

test('повторный запуск на чистой базе — нули', async () => {
  assert.deepEqual(await deleteExpiredAuthRows(db), { sessions: 0, nonces: 0 });
});
