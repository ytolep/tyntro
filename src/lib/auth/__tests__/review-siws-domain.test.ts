import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign, KeyObject } from 'node:crypto';
import bs58 from 'bs58';

// Ревью (агент L): /api/auth/verify не проверяет домен в SIWS-сообщении.
// Проверяются только: nonce существует/не использован/выдан этому кошельку,
// кошелёк упомянут в тексте и подпись валидна. Домен первой строки и URI
// не сверяются ни с хостом запроса, ни с allowlist.
//
// Сценарий: атакующий публично получает nonce для кошелька жертвы, на своём
// фишинговом сайте показывает сообщение «evil.example wants you to sign in…»
// с этим nonce, жертва подписывает у себя, атакующий подставляет подпись в
// /api/auth/verify — сессия выдаётся за кошелёк жертвы.
//
// Исправлено (X2, docs/REVIEW.md H2): verify восстанавливает выданное сообщение
// побайтово из записи AuthNonce и домена-кандидата (Host ∈ APP_DOMAINS / APP_DOMAIN) —
// подпись под чужим доменом больше не проходит.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let noncePOST: (req: Request) => Promise<Response>;
let verifyPOST: (req: Request) => Promise<Response>;

let wallet: string;
let privateKey: KeyObject;

const post = (path: string, body: unknown) =>
  new Request(`http://props.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'props.example' },
    body: JSON.stringify(body),
  });

const signMessage = (message: string) => bs58.encode(cryptoSign(null, Buffer.from(message, 'utf8'), privateKey));

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../db')).db;
  ({ POST: noncePOST } = await import('../../../app/api/auth/nonce/route'));
  ({ POST: verifyPOST } = await import('../../../app/api/auth/verify/route'));

  // Кошелёк = публичный ключ ed25519 в base58; вход подписывает приватный ключ (как в auth.test.ts).
  const kp = generateKeyPairSync('ed25519');
  wallet = bs58.encode(kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  privateKey = kp.privateKey;
});

after(async () => { await db?.$disconnect(); });

test('SIWS message signed for a foreign domain must be rejected (domain check)', async () => {
  // 1) Легальный nonce для кошелька жертвы (публичный эндпоинт).
  const nonceRes = await noncePOST(post('/api/auth/nonce', { wallet }));
  assert.equal(nonceRes.status, 200);
  const { message: legitMessage } = (await nonceRes.json()) as { message: string };
  const nonce = /Nonce: (\S+)/.exec(legitMessage)?.[1];
  assert.ok(nonce);

  // 2) Атакующий подменяет домен (первая строка и URI), nonce и кошелёк те же.
  const evilMessage = legitMessage
    .replace('props.example wants you to sign in', 'evil.example wants you to sign in')
    .replace('URI: https://props.example', 'URI: https://evil.example');
  assert.notEqual(evilMessage, legitMessage);

  // 3) Жертва подписывает evil-сообщение на фишинговом сайте; атакующий
  //    предъявляет его нашему verify.
  const res = await verifyPOST(post('/api/auth/verify', { wallet, signature: signMessage(evilMessage), message: evilMessage }));

  assert.equal(res.status, 401, 'подпись под чужим доменом не должна приниматься');
  assert.equal(await db.session.count(), 0, 'сессия за чужой домен не выдаётся');
});
