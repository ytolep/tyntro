import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { Decimal } from '@prisma/client/runtime/library';

// K2: покупка требует согласия с текущими версиями документов; согласие
// записывается атомарно с Purchase (rulesHash = хэш правил плана).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../../../lib/db').db;
let purchase: typeof import('../../../../lib/payments/purchase');
let createPOST: (req: Request) => Promise<Response>;
let cookie: string;

const post = (body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/checkout/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...extraHeaders },
    body: JSON.stringify(body),
  });

before(async () => {
  process.env.TREASURY_WALLET = Keypair.generate().publicKey.toBase58();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../../../lib/db')).db;
  purchase = await import('../../../../lib/payments/purchase');
  ({ POST: createPOST } = await import('../create/route'));

  const user = await db.user.create({ data: { walletAddress: 'terms-consent-test' } });
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  cookie = `props_session=${token}`;

  await db.challenge.create({
    data: {
      accountSize: new Decimal(10000), planType: 'CORE',
      profitTargetPct: 10, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80,
      priceUsd: new Decimal(89), minTradingDays: 3,
    },
  });
});

after(async () => { await db?.$disconnect(); });

test('checkout without consent → 400, nothing created', async () => {
  const res = await createPOST(post({ accountSize: 10000, planType: 'CORE' }));
  assert.equal(res.status, 400);
  const { error, code } = await res.json();
  assert.match(error, /documents updated/i);
  assert.equal(code, 'documents_updated');
  assert.equal(await db.purchase.count(), 0);
  assert.equal(await db.termsAcceptance.count(), 0);
});

test('checkout with stale document versions → 400, nothing created', async () => {
  const res = await createPOST(
    post({ accountSize: 10000, planType: 'CORE', acceptedTerms: true, termsVersion: '2000-01-01', refundsVersion: '2000-01-01', rulesVersion: '2000-01-01' }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /documents updated/i);
  assert.equal(await db.purchase.count(), 0);
  assert.equal(await db.termsAcceptance.count(), 0);
});

test('valid consent → purchase + acceptance in one shot, linked, rulesHash matches', async () => {
  const res = await createPOST(
    post(
      {
        accountSize: 10000,
        planType: 'CORE',
        acceptedTerms: true,
        termsVersion: (await import('../../../../lib/legal/versions')).TERMS_VERSION,
        refundsVersion: (await import('../../../../lib/legal/versions')).REFUNDS_VERSION,
        rulesVersion: (await import('../../../../lib/legal/versions')).RULES_VERSION,
      },
      { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'terms-consent-test-agent' },
    ),
  );
  assert.equal(res.status, 200);
  const { id } = await res.json();

  const acceptance = await db.termsAcceptance.findUniqueOrThrow({
    where: { purchaseId: id },
    include: { purchase: true },
  });
  assert.equal(acceptance.purchase!.id, id, 'acceptance linked to the purchase');
  assert.equal(acceptance.purchase!.status, 'PENDING');
  const versions = await import('../../../../lib/legal/versions');
  assert.equal(acceptance.termsVersion, versions.TERMS_VERSION);
  assert.equal(acceptance.refundsVersion, versions.REFUNDS_VERSION);
  assert.equal(acceptance.rulesVersion, versions.RULES_VERSION);

  // rulesHash — тот же хэш правил, что воркер фиксирует на счёте при оплате.
  const challenge = await db.challenge.findUniqueOrThrow({
    where: { accountSize_planType: { accountSize: new Decimal(10000), planType: 'CORE' } },
  });
  assert.equal(acceptance.rulesHash, purchase.computeRulesHash(challenge));

  // ip/userAgent записаны из заголовков запроса.
  assert.equal(acceptance.ip, '203.0.113.9');
  assert.equal(acceptance.userAgent, 'terms-consent-test-agent');
  assert.ok(acceptance.acceptedAt <= new Date());
});
