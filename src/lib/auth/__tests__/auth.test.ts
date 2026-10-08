import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as cryptoSign, KeyObject } from 'node:crypto';
import bs58 from 'bs58';

// SIWS-вход: подпись ed25519, одноразовый nonce, сессия в cookie, роли.
// Postgres: props_test из .env.test, схема пересоздаётся db push --force-reset.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: any;
let noncePOST: (req: Request) => Promise<Response>;
let verifyPOST: (req: Request) => Promise<Response>;
let logoutPOST: (req: Request) => Promise<Response>;
let requireUser: (req: Request) => Promise<{ id: string; walletAddress: string; role: string }>;
let requireAdmin: (req: Request) => Promise<{ id: string; walletAddress: string; role: string }>;
let AuthErrorCtor: new (status: number, message?: string) => Error & { status: number };

let wallet: string;
let publicKey: KeyObject;
let privateKey: KeyObject;
let strangerKey: KeyObject;

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const signMessage = (message: string, key: KeyObject = privateKey) =>
  bs58.encode(cryptoSign(null, Buffer.from(message, 'utf8'), key));

async function freshNonce(): Promise<string> {
  const res = await noncePOST(post('/api/auth/nonce', { wallet }));
  assert.equal(res.status, 200);
  const { message } = await res.json();
  assert.ok(typeof message === 'string' && message.includes(wallet));
  return message;
}

async function login(): Promise<{ cookie: string; token: string }> {
  const message = await freshNonce();
  const res = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(message), message }));
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = /props_session=([^;]+)/.exec(setCookie)?.[1] ?? '';
  assert.ok(token);
  return { cookie: `props_session=${token}`, token };
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ POST: noncePOST } = await import('../../../app/api/auth/nonce/route'));
  ({ POST: verifyPOST } = await import('../../../app/api/auth/verify/route'));
  ({ POST: logoutPOST } = await import('../../../app/api/auth/logout/route'));
  ({ requireUser, requireAdmin } = await import('../index'));
  ({ AuthError: AuthErrorCtor } = await import('../index'));

  // Кошелёк = публичный ключ ed25519 в base58; вход подписывает приватным ключом.
  ({ publicKey, privateKey } = generateKeyPairSync('ed25519'));
  wallet = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  ({ privateKey: strangerKey } = generateKeyPairSync('ed25519'));
});

after(async () => { await db?.$disconnect(); });

test('valid signature → 200, user upserted, session cookie 30d, sha256(token) in db', async () => {
  const message = await freshNonce();
  const res = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(message), message }));
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.walletAddress, wallet);
  assert.equal(user.role, 'USER');

  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=2592000/);

  const dbUser = await db.user.findUnique({ where: { walletAddress: wallet } });
  assert.ok(dbUser, 'user upserted by walletAddress');
  const token = /props_session=([^;]+)/.exec(setCookie)?.[1];
  assert.ok(token);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await db.session.findUnique({ where: { tokenHash } });
  assert.ok(session, 'db stores sha256(token), not the token');
  assert.equal(session.userId, dbUser.id);
});

test('signature by another key over same message → 401', async () => {
  const message = await freshNonce();
  const res = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(message, strangerKey), message }));
  assert.equal(res.status, 401);
});

test('tampered message (valid key, message not ours) → 401', async () => {
  const message = await freshNonce();
  const forged = message.replace('Nonce: ', 'Nonce: x'); // не проходит extractNonce/проверку записи
  const res = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(forged), message: forged }));
  assert.equal(res.status, 401);
});

test('nonce replay: second verify with same nonce → 401', async () => {
  const message = await freshNonce();
  const signature = signMessage(message);
  const first = await verifyPOST(post('/api/auth/verify', { wallet, signature, message }));
  assert.equal(first.status, 200);
  const second = await verifyPOST(post('/api/auth/verify', { wallet, signature, message }));
  assert.equal(second.status, 401);
});

test('expired nonce → 401', async () => {
  const res = await noncePOST(post('/api/auth/nonce', { wallet }));
  const { message, nonce } = await res.json();
  await db.authNonce.update({ where: { nonce }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const verify = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(message), message }));
  assert.equal(verify.status, 401);
});

test('requireUser/requireAdmin: 401 без сессии, USER → 403 в admin, ADMIN проходит', async () => {
  // без cookie — 401
  await assert.rejects(
    requireUser(new Request('http://localhost:3000/')),
    (e: unknown) => e instanceof AuthErrorCtor && e.status === 401,
  );

  const { cookie } = await login();
  const req = new Request('http://localhost:3000/', { headers: { cookie } });

  const user = await requireUser(req);
  assert.equal(user.walletAddress, wallet);
  assert.equal(user.role, 'USER');

  // USER не проходит в админку
  await assert.rejects(
    requireAdmin(req),
    (e: unknown) => e instanceof AuthErrorCtor && e.status === 403,
  );

  // повышаем до ADMIN — проходит
  await db.user.update({ where: { walletAddress: wallet }, data: { role: 'ADMIN' } });
  const admin = await requireAdmin(req);
  assert.equal(admin.role, 'ADMIN');
  await db.user.update({ where: { walletAddress: wallet }, data: { role: 'USER' } });
});

test('logout удаляет сессию и гасит cookie', async () => {
  const { cookie } = await login();
  const res = await logoutPOST(post('/api/auth/logout', {}, cookie));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);

  const me = new Request('http://localhost:3000/api/auth/me', { headers: { cookie } });
  const { GET: meGET } = await import('../../../app/api/auth/me/route');
  assert.equal((await meGET(me)).status, 200);
  assert.equal((await (await meGET(me)).json()).user, null);
  await assert.rejects(
    requireUser(new Request('http://localhost:3000/', { headers: { cookie } })),
    (e: unknown) => e instanceof AuthErrorCtor && e.status === 401,
  );
});
