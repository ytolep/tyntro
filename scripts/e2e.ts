/**
 * Сквозной сценарий Tyntro (агент M, волна 3): вход → оплата → сделки →
 * PASSED → одобрение funded → прибыль → выплата, плюс негативные проверки.
 *
 * Запускается против ПОДНЯТОГО приложения (web + worker), см. docs/E2E.md:
 *
 *   BASE_URL=http://localhost:3100 \
 *   DATABASE_URL=postgresql://props:props@localhost:54339/props_e2e \
 *   TREASURY_WALLET=<тот же, что у web/worker> \
 *   npx tsx scripts/e2e.ts
 *
 * Реальный USDC не тратится. Три тестовых приёма (помечены ТЕСТОВЫЙ ПРИЁМ):
 *  1. Оплата: подтверждение вызывается напрямую (checkPendingPayments — та же
 *     функция, что в воркере) с фейковым RPC, «нашедшим» перевод на ATA казны.
 *  2. PASSED и прибыль на funded: минуя 3 торговых дня и удачу, счёт доводится
 *     до цели прямыми проводками ADJUST в тестовой базе.
 *  3. PAID: подпись транзакции выплаты — случайный base58, перевода не было.
 *
 * Код выхода 0 — только если все шаги PASS.
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign as ed25519Sign } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { checkPendingPayments } from '../src/worker/payments';
import { associatedTokenAddress, USDC_DECIMALS } from '../src/lib/payments/solanaPay';
import { TERMS_VERSION, REFUNDS_VERSION, RULES_VERSION } from '../src/lib/legal/versions';
import { getPrice } from '../src/lib/pricingConfig';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const TREASURY_WALLET = process.env.TREASURY_WALLET ?? '';
const USDC_MINT = process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Сценарий: SPRINT $5K — цель +9 % → 5450; прибыль на funded +600; выплата 300
// при сплите 80 % → списание с баланса 300×100/80 = 375.
const ACCOUNT_SIZE = new Decimal(5000);
const FUNDED_PROFIT = new Decimal(600);
const PAYOUT_AMOUNT = new Decimal(300);
const PAYOUT_DEDUCTION = PAYOUT_AMOUNT.mul(100).div(80); // 375

const prisma = new PrismaClient();

// ---- Подпись ed25519 (как кошелёк Solana) ----

// PKCS#8/DER-префикс для сырого 32-байтного seed ed25519.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function signBase58(message: string, seed: Uint8Array): string {
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  return bs58.encode(ed25519Sign(null, Buffer.from(message, 'utf8'), key));
}

// ---- HTTP ----

interface HttpResult {
  status: number;
  body: any;
  cookie: string | null;
}

async function http(
  method: string,
  path: string,
  opts: { json?: unknown; cookie?: string | null; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let body: any = text || null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* не-JSON ответ оставляем строкой */
  }
  const token = res.headers.get('set-cookie')?.match(/props_session=([^;]+)/)?.[1] ?? null;
  return { status: res.status, body, cookie: token ? `props_session=${token}` : null };
}

// ---- Шаги: PASS/FAIL, код выхода 0 только если всё зелёное ----

const failures: string[] = [];
let stepNo = 0;

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  stepNo += 1;
  const label = String(stepNo).padStart(2, '0');
  try {
    await fn();
    console.log(`PASS ${label} ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} ${name}: ${message}`);
    failures.push(`${label} ${name}: ${message}`);
    return false;
  }
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function eq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected)
    throw new Error(`${message}: получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

const d = (x: Decimal | string | number): Decimal => new Decimal(x);

// ---- Инвариант §5: баланс счёта = сумма его проводок ----

async function assertLedgerInvariant(accountId: string, label: string): Promise<Decimal> {
  const [account, entries] = await Promise.all([
    prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } }),
    prisma.ledgerEntry.findMany({ where: { accountId }, select: { amount: true } }),
  ]);
  const sum = entries.reduce((acc, e) => acc.plus(d(e.amount as Decimal)), new Decimal(0));
  check(
    sum.equals(d(account.currentBalance as Decimal)),
    `${label}: баланс ${account.currentBalance} ≠ Σ проводок ${sum.toFixed(2)}`,
  );
  return sum;
}

/**
 * ТЕСТОВЫЙ ПРИЁМ (не продукционный путь): прямая проводка ADJUST до целевого
 * баланса + правка кэша счёта. Инвариант «баланс = Σ проводок» сохраняется.
 */
async function adjustTo(
  accountId: string,
  targetBalance: Decimal,
  opts: { setStatus?: string; note: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const acc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const delta = targetBalance.minus(d(acc.currentBalance as Decimal));
    check(delta.gt(0), `${opts.note}: баланс ${acc.currentBalance} уже не ниже цели ${targetBalance}`);
    await tx.ledgerEntry.create({
      data: { accountId, type: 'ADJUST', amount: delta, refId: `e2e:${opts.note}` },
    });
    await tx.tradingAccount.update({
      where: { id: accountId },
      data: {
        currentBalance: targetBalance,
        currentEquity: targetBalance,
        ...(opts.setStatus ? { status: opts.setStatus } : {}),
      },
    });
  });
  console.log(`     [тестовый приём] ADJUST ${opts.note}: баланс → ${targetBalance.toFixed(2)}`);
}

/**
 * ТЕСТОВЫЙ ПРИЁМ: фейковый RPC «находит» перевод USDC на ATA казны по reference
 * покупки. Реальной транзакции и траты USDC нет; проверяется та же логика
 * воркера (findVerifiedSignature → verifyUsdcTransfer → confirmPurchase).
 */
function fakeSolanaRpc(amount: Decimal, reference: string) {
  const ata = associatedTokenAddress(TREASURY_WALLET, USDC_MINT);
  const amountMinor = amount.times(10 ** USDC_DECIMALS).toFixed(0);
  const signature = Keypair.generate().publicKey.toBase58(); // правдоподобная строка, транзакции нет
  const tx = {
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [reference], // Solana Pay несёт reference среди ключей транзакции
        instructions: [
          {
            programId: TOKEN_PROGRAM_ID,
            parsed: { type: 'transfer', info: { destination: ata, amount: amountMinor } },
          },
        ],
      },
    },
  };
  return {
    getSignaturesForAddress: async () => [{ signature }],
    getParsedTransaction: async () => tx,
  };
}

/** Вход кошельком: nonce → подпись ed25519 → verify → сессионная cookie. */
async function login(kp: Keypair, expectRole: string): Promise<string> {
  const wallet = kp.publicKey.toBase58();
  const nonceRes = await http('POST', '/api/auth/nonce', { json: { wallet } });
  eq(nonceRes.status, 200, 'POST /api/auth/nonce');
  const message = nonceRes.body?.message;
  check(typeof message === 'string' && message.includes(wallet), 'сообщение SIWS не содержит кошелёк');
  const verifyRes = await http('POST', '/api/auth/verify', {
    json: { wallet, signature: signBase58(message, kp.secretKey.slice(0, 32)), message },
  });
  eq(verifyRes.status, 200, 'POST /api/auth/verify');
  eq(verifyRes.body?.user?.role, expectRole, `роль пользователя (${wallet.slice(0, 8)}…)`);
  check(verifyRes.cookie, 'verify не вернул httpOnly-cookie props_session');
  return verifyRes.cookie!;
}

/** Сид матрицы челленджей + ADMIN_WALLET (тот же prisma/seed.ts, что в compose). */
function seedAdmin(adminWallet: string): void {
  execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
    env: { ...process.env, ADMIN_WALLET: adminWallet },
    stdio: 'pipe',
  });
}

// ---- Сценарий ----

async function main(): Promise<void> {
  console.log(`Tyntro e2e → ${BASE_URL} (база ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')})`);

  // Предполётная проверка (не шаг): приложение живо, БД отвечает, env на месте.
  const health = await http('GET', '/api/health');
  check(health.status === 200 && health.body?.db === 'up', `приложение недоступно на ${BASE_URL} (health ${health.status}); запуск — см. docs/E2E.md`);
  check(DATABASE_URL && TREASURY_WALLET, 'нужны env DATABASE_URL и TREASURY_WALLET — те же значения, что у web/worker');

  const trader = Keypair.generate();
  const admin = Keypair.generate();
  console.log(`кошельки: трейдер ${trader.publicKey.toBase58()}, админ ${admin.publicKey.toBase58()}`);
  seedAdmin(admin.publicKey.toBase58());

  // Состояние, передаваемое между шагами.
  const S = {
    traderCookie: '',
    adminCookie: '',
    purchaseId: '',
    reference: '',
    amount: new Decimal(0),
    accountId: '',
    positionId: '',
    fundedId: '',
    payoutId: '',
  };

  type MainStep = [name: string, fn: () => Promise<void>];
  const main: MainStep[] = [
    ['вход трейдера: nonce → подпись → verify (cookie, роль USER)', async () => {
      S.traderCookie = await login(trader, 'USER');
    }],

    ['POST /api/checkout/create: покупка SPRINT $5K (цена из прайс-матрицы), PENDING + Solana Pay URL', async () => {
      const res = await http('POST', '/api/checkout/create', {
        json: {
          accountSize: 5000,
          planType: 'SPRINT',
          // K2: покупка требует согласия с текущими версиями документов (terms/refunds/rules).
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          refundsVersion: REFUNDS_VERSION,
          rulesVersion: RULES_VERSION,
        },
        cookie: S.traderCookie,
      });
      eq(res.status, 200, 'POST /api/checkout/create');
      eq(res.body?.amount, getPrice(5000, 'SPRINT').toFixed(2), 'сумма SPRINT $5K из прайс-матрицы');
      check(typeof res.body?.reference === 'string' && res.body.reference.length >= 32, 'нет reference-ключа');
      const url = String(res.body?.url ?? '');
      check(url.startsWith(`solana:${TREASURY_WALLET}?`), 'URL Solana Pay ведёт не на TREASURY_WALLET приложения');
      check(url.includes(`spl-token=${encodeURIComponent(USDC_MINT)}`), 'в URL другой USDC-mint, чем в env скрипта');
      S.purchaseId = res.body.id;
      S.reference = res.body.reference;
      S.amount = d(res.body.amount);
    }],

    ['оплата: подтверждение напрямую checkPendingPayments с фейковым RPC (USDC не тратится)', async () => {
      const { paid } = await checkPendingPayments({ rpc: fakeSolanaRpc(S.amount, S.reference) });
      eq(paid, 1, 'подтверждённых покупок за цикл');
      const res = await http('GET', `/api/checkout/status?id=${S.purchaseId}`, { cookie: S.traderCookie });
      eq(res.status, 200, 'GET /api/checkout/status');
      eq(res.body?.status, 'PAID', 'статус покупки');
      S.accountId = res.body?.accountId ?? '';
      check(S.accountId.length > 0, 'у покупки нет счёта');
    }],

    ['счёт создан: ACTIVE/CHALLENGE, DEPOSIT 5000, баланс = Σ проводок', async () => {
      const acc = await prisma.tradingAccount.findUniqueOrThrow({
        where: { id: S.accountId },
        include: { challenge: true },
      });
      eq(acc.status, 'ACTIVE', 'статус счёта');
      eq(acc.phase, 'CHALLENGE', 'фаза счёта');
      check(d(acc.accountSize as Decimal).equals(ACCOUNT_SIZE), `размер счёта ${acc.accountSize}`);
      const deposit = await prisma.ledgerEntry.findFirst({
        where: { accountId: S.accountId, type: 'DEPOSIT' },
      });
      check(deposit && d(deposit.amount as Decimal).equals(ACCOUNT_SIZE), 'нет DEPOSIT-проводки на 5000');
      await assertLedgerInvariant(S.accountId, 'после покупки');
    }],

    ['OPEN SOL-PERP LONG $500 x1 по живой цене Phoenix → FILLED, позиция открыта', async () => {
      const res = await http('POST', '/api/orders', {
        json: {
          accountId: S.accountId,
          action: 'OPEN_POSITION',
          symbol: 'SOL-PERP',
          side: 'LONG',
          orderMode: 'Market',
          sizeUsd: 500,
          leverage: 1,
          idempotencyKey: Keypair.generate().publicKey.toBase58(),
        },
        cookie: S.traderCookie,
      });
      check(res.status === 200, `POST /api/orders (OPEN_POSITION): ${res.status} ${JSON.stringify(res.body)}`);
      eq(res.body?.status, 'FILLED', 'статус исполнения');
      eq(res.body?.position?.status, 'OPEN', 'позиция не открыта');
      S.positionId = res.body?.position?.id ?? '';
      console.log(`     открытие по метке Phoenix $${res.body?.order?.price}, комиссия $${res.body?.fee}`);
      await assertLedgerInvariant(S.accountId, 'после OPEN');
    }],

    ['CLOSE позиции → FILLED, позиция закрыта, баланс = Σ проводок', async () => {
      const res = await http('POST', '/api/orders', {
        json: {
          accountId: S.accountId,
          action: 'CLOSE_POSITION',
          positionId: S.positionId,
          idempotencyKey: Keypair.generate().publicKey.toBase58(),
        },
        cookie: S.traderCookie,
      });
      check(res.status === 200, `POST /api/orders (CLOSE_POSITION): ${res.status} ${JSON.stringify(res.body)}`);
      eq(res.body?.status, 'FILLED', 'статус исполнения');
      check(res.body?.position === null, 'позиция всё ещё возвращается открытой');
      const pos = await prisma.position.findUniqueOrThrow({ where: { id: S.positionId } });
      eq(pos.status, 'CLOSED', 'статус позиции в БД');
      await assertLedgerInvariant(S.accountId, 'после CLOSE');
    }],

    ['[тестовый приём] ADJUST до цели +9 % (5450) → счёт PASSED', async () => {
      // Естественный PASSED требует 3 торговых дней (minTradingDays) — в e2e
      // не ждём, доводим баланс проводкой ADJUST и ставим статус напрямую.
      const acc = await prisma.tradingAccount.findUniqueOrThrow({
        where: { id: S.accountId },
        include: { challenge: true },
      });
      const target = ACCOUNT_SIZE.mul(d(100).add(d(acc.challenge.profitTargetPct))).div(100);
      await adjustTo(S.accountId, target, { setStatus: 'PASSED', note: 'force-passed' });
      const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.accountId } });
      eq(after.status, 'PASSED', 'статус счёта после ADJUST');
      await assertLedgerInvariant(S.accountId, 'после force-PASSED');
    }],

    ['вход админа вторым ключом (роль ADMIN через ADMIN_WALLET/seed)', async () => {
      S.adminCookie = await login(admin, 'ADMIN');
    }],

    ['POST /api/admin/funded/approve: PASSED → новый счёт FUNDED_SIM, аудит', async () => {
      const res = await http('POST', '/api/admin/funded/approve', {
        json: { accountId: S.accountId },
        cookie: S.adminCookie,
      });
      eq(res.status, 200, 'POST /api/admin/funded/approve');
      S.fundedId = res.body?.fundedAccountId ?? '';
      check(S.fundedId.length > 0, 'не вернул fundedAccountId');
      const funded = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.fundedId } });
      eq(funded.phase, 'FUNDED_SIM', 'фаза funded-счёта');
      eq(funded.status, 'ACTIVE', 'статус funded-счёта');
      check(d(funded.currentBalance as Decimal).equals(ACCOUNT_SIZE), 'баланс funded ≠ accountSize');
      const source = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.accountId } });
      eq(source.status, 'PASSED', 'исходный счёт должен остаться PASSED');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'FUNDED_APPROVED', targetId: S.accountId },
      });
      check(audit, 'нет записи AuditLog FUNDED_APPROVED');
      await assertLedgerInvariant(S.fundedId, 'funded после approve');
    }],

    ['[тестовый приём] ADJUST +600 на funded: прибыль 5600, баланс = Σ проводок', async () => {
      await adjustTo(S.fundedId, ACCOUNT_SIZE.plus(FUNDED_PROFIT), { note: 'funded-profit' });
      await assertLedgerInvariant(S.fundedId, 'funded после прибыли');
    }],

    ['POST /api/payouts/request: запрос выплаты 300 USDC → REQUESTED, доступно 180', async () => {
      // Доля трейдера: (5600 − 5000) × 80 % = 480; после запроса 300 остаётся 180.
      const res = await http('POST', '/api/payouts/request', {
        json: { accountId: S.fundedId, amount: PAYOUT_AMOUNT.toFixed(2) },
        cookie: S.traderCookie,
      });
      eq(res.status, 200, 'POST /api/payouts/request');
      eq(res.body?.status, 'REQUESTED', 'статус выплаты');
      eq(res.body?.availableUsd, (FUNDED_PROFIT.mul(0.8).minus(PAYOUT_AMOUNT)).toFixed(2), 'остаток доступного');
      S.payoutId = res.body?.id ?? '';
      check(S.payoutId.length > 0, 'не вернул id выплаты');
    }],

    ['[тестовый приём] KYC VERIFIED + админ PAID с фейковой подписью → PAYOUT −375, баланс 5225, аудит', async () => {
      // Q2: PAID требует kycStatus VERIFIED у владельца — верифицируем трейдера
      // реальным админ-эндпоинтом (не прямой правкой БД).
      const fundedAcc = await prisma.tradingAccount.findUniqueOrThrow({
        where: { id: S.fundedId },
        select: { userId: true },
      });
      const kycRes = await http('POST', '/api/admin/kyc', {
        json: { userId: fundedAcc.userId, status: 'VERIFIED' },
        cookie: S.adminCookie,
      });
      eq(kycRes.status, 200, 'POST /api/admin/kyc (VERIFIED)');
      const fakeSignature = Keypair.generate().publicKey.toBase58(); // перевода USDC не было
      const res = await http('POST', '/api/admin/payouts/decide', {
        json: { payoutId: S.payoutId, approve: true, txSignature: fakeSignature },
        cookie: S.adminCookie,
      });
      eq(res.status, 200, 'POST /api/admin/payouts/decide');
      eq(res.body?.status, 'PAID', 'статус выплаты');
      const payout = await prisma.payout.findUniqueOrThrow({ where: { id: S.payoutId } });
      eq(payout.status, 'PAID', 'статус выплаты в БД');
      eq(payout.txSignature, fakeSignature, 'подпись транзакции не сохранена');
      const ledgerPayout = await prisma.ledgerEntry.findFirst({
        where: { accountId: S.fundedId, type: 'PAYOUT' },
      });
      check(
        ledgerPayout && d(ledgerPayout.amount as Decimal).equals(PAYOUT_DEDUCTION.neg()),
        `проводка PAYOUT ≠ −${PAYOUT_DEDUCTION.toFixed(2)}`,
      );
      const funded = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.fundedId } });
      check(
        d(funded.currentBalance as Decimal).equals(ACCOUNT_SIZE.plus(FUNDED_PROFIT).minus(PAYOUT_DEDUCTION)),
        `баланс funded после выплаты ${funded.currentBalance}, ожидалось 5225`,
      );
      const audit = await prisma.auditLog.findFirst({ where: { action: 'PAYOUT_PAID', targetId: S.payoutId } });
      check(audit, 'нет записи AuditLog PAYOUT_PAID');
      await assertLedgerInvariant(S.fundedId, 'funded после PAID');
    }],

    ['итог: статусы (PAID/PASSED/ACTIVE) и ledger обоих счетов сходятся', async () => {
      const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: S.purchaseId } });
      eq(purchase.status, 'PAID', 'покупка');
      const challenge = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.accountId } });
      eq(challenge.status, 'PASSED', 'челлендж-счёт');
      const funded = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: S.fundedId } });
      eq(funded.status, 'ACTIVE', 'funded-счёт');
      const sum1 = await assertLedgerInvariant(S.accountId, 'итог челлендж');
      const sum2 = await assertLedgerInvariant(S.fundedId, 'итог funded');
      console.log(`     челлендж ${challenge.status} (${sum1.toFixed(2)}), funded ${funded.phase} ${funded.status} (${sum2.toFixed(2)}), выплата ${PAYOUT_AMOUNT.toFixed(2)} PAID`);
    }],
  ];

  // Основной путь: обрыв на первом FAIL (дальше некуда), негативные проверки ниже.
  for (const [name, fn] of main) {
    if (!(await step(name, fn))) {
      console.log('SKIP остальные шаги основного пути после первого FAIL');
      break;
    }
  }

  // Негативные проверки (независимы от основного пути, запускаются всегда).
  await step('без cookie POST /api/orders → 401', async () => {
    const res = await http('POST', '/api/orders', {
      json: { accountId: S.accountId, action: 'OPEN_POSITION', symbol: 'SOL-PERP', side: 'LONG', orderMode: 'Market', sizeUsd: 100, leverage: 1 },
    });
    check(res.status === 401, `ответ без сессии: ${res.status} ${JSON.stringify(res.body)}`);
  });

  await step('чужой счёт (админ на счёте трейдера) → 404', async () => {
    // Вход админа независим от основного пути: негативная проверка должна
    // работать, даже если цепочка выше оборвалась.
    if (!S.adminCookie) S.adminCookie = await login(admin, 'ADMIN');
    const res = await http('POST', '/api/orders', {
      json: { accountId: S.accountId, action: 'OPEN_POSITION', symbol: 'SOL-PERP', side: 'LONG', orderMode: 'Market', sizeUsd: 100, leverage: 1, idempotencyKey: 'e2e-foreign' },
      cookie: S.adminCookie,
    });
    check(res.status === 404, `ответ для чужого счёта: ${res.status} ${JSON.stringify(res.body)}`);
  });

  await step('cf-ipcountry: US → 451 (гео-блок)', async () => {
    const res = await http('GET', '/api/health', { headers: { 'cf-ipcountry': 'US' } });
    eq(res.status, 451, 'ответ для заблокированной страны');
  });

  console.log('');
  if (failures.length === 0) console.log('E2E RESULT: PASS — все шаги зелёные');
  else {
    console.log(`E2E RESULT: FAIL (${failures.length}):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  await prisma.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`E2E RESULT: FAIL (ошибка сценария: ${error instanceof Error ? error.message : String(error)})`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
