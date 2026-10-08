import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// getAdminFromCookieHeader: серверный гейт /admin (null без cookie, USER или просроченной сессии).
// Postgres: props_test из .env.test, схема пересоздаётся db push --force-reset.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: any;
let SESSION_COOKIE: string;
let createSession: (userId: string) => Promise<string>;
let getAdminFromCookieHeader: (cookieHeader: string | null) => Promise<{ id: string; walletAddress: string; role: string } | null>;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ SESSION_COOKIE, createSession } = await import('../session'));
  ({ getAdminFromCookieHeader } = await import('../server'));
});

after(async () => { await db?.$disconnect(); });

test('без cookie (или без сессионной) → null', async () => {
  assert.equal(await getAdminFromCookieHeader(null), null);
  assert.equal(await getAdminFromCookieHeader('other=1; theme=dark'), null);
});

test('cookie USER-сессии → null', async () => {
  const user = await db.user.create({ data: { walletAddress: 'gate-user' } });
  const token = await createSession(user.id);
  assert.equal(await getAdminFromCookieHeader(`${SESSION_COOKIE}=${token}`), null);
});

test('cookie ADMIN-сессии → пользователь ADMIN', async () => {
  const admin = await db.user.create({ data: { walletAddress: 'gate-admin', role: 'ADMIN' } });
  const token = await createSession(admin.id);
  const got = await getAdminFromCookieHeader(`theme=dark; ${SESSION_COOKIE}=${token}; other=1`);
  assert.ok(got);
  assert.equal(got.id, admin.id);
  assert.equal(got.walletAddress, 'gate-admin');
  assert.equal(got.role, 'ADMIN');
});

test('просроченная сессия ADMIN → null', async () => {
  const admin = await db.user.create({ data: { walletAddress: 'gate-admin-expired', role: 'ADMIN' } });
  const token = await createSession(admin.id);
  await db.session.updateMany({ where: { userId: admin.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await getAdminFromCookieHeader(`${SESSION_COOKIE}=${token}`), null);
});
