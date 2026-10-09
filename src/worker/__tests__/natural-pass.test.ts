import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import type { TradingAccount } from '@prisma/client';
import type { Market, MarketSnapshot } from '../../lib/marketData/types';
import { PLAN_CONFIGS, PRICING_MATRIX } from '../../lib/pricingConfig';
import { executeSimulatedOrder } from '../../lib/execution/simulated';
import type { SimulatedOrderDeps } from '../../lib/execution/simulated';
import { runRiskTick, defaultRiskTickDeps } from '../riskTick';
import type { RiskTickDeps } from '../riskTick';
import { runDayRoll } from '../dayRoll';

// Агент K4 «Естественное прохождение челленджа» (Postgres из .env.test).
// Счёт SPRINT $5K (цель 9 %, дневная и статическая просадка 3 %, мин. 3 торговых
// дня) проходит челлендж БЕЗ прямых проводок ADJUST и ручной смены статуса:
// сделки — только через executeSimulatedOrder (цена и часы подменяются через DI,
// как в scripts/bot-load.ts), смена дня — runDayRoll на виртуальных часах,
// переоценка — runRiskTick с настоящим ядром core/position и core/risk.
// Инвариант §5 «баланс = Σ проводок» проверяется после каждого шага.
//
// Важная механика тика риска: runRiskTick берёт кандидатов только среди счетов
// с открытыми позициями или лимитками. Поэтому главный сценарий завершается
// стоячим лимитом трейдера — после третьего rolld тик видит счёт через него,
// проходит счёт (цель + 3 дня + позиций нет) и отменяет лимит (§5).

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

type Db = typeof import('../../lib/db')['db'];
let db: Db;

const ZERO = new Decimal(0);
const SIZE = new Decimal(5000);
const TARGET = new Decimal(5450); // 5000 × (1 + 9 %) — цель SPRINT
const SYMBOL = 'SOL-PERP';
const FEE_RATE = new Decimal('0.0005');
// Фейковый рынок: точные цены (100 → 106) и точные количества (2500/100 = 25)
// дают terminating-десятичные — все ожидаемые суммы сверяются до цента.
const MARKET: Market = {
  symbol: SYMBOL, type: 'perp', status: 'active', baseAsset: 'SOL', quoteAsset: 'USDC',
  takerFee: 0.0005, maxLeverage: 5,
};

// ---- Виртуальные часы и цена (DI, как scripts/bot-load.ts) ----

interface Ctx { tag: string; price: number; nowMs: number; seq: number }
const makeCtx = (tag: string, day: string): Ctx =>
  ({ tag, price: 100, nowMs: Date.parse(`${day}T10:00:00.000Z`), seq: 0 });

// SAFETY: неполный MarketSnapshot (только поля, читаемые snapshotMark в
// simulated.ts и riskTick.ts: ticker.markPrice/referencePrice/marketId) —
// тот же приём, что в scripts/bot-load.ts и остальных тестах воркера.
const snapshot = (ctx: Ctx): MarketSnapshot =>
  ({ marketId: SYMBOL, ticker: { markPrice: ctx.price }, referencePrice: ctx.price } as unknown as MarketSnapshot);

const simDeps = (ctx: Ctx): SimulatedOrderDeps => ({
  resolveMarket: async (s) => (s.toUpperCase() === SYMBOL ? MARKET : undefined),
  getMarketSnapshot: async () => snapshot(ctx),
  now: () => ctx.nowMs,
});

const workerDeps = (ctx: Ctx): RiskTickDeps => ({
  ...defaultRiskTickDeps(), // db, withAccountLock и НАСТОЯЩИЕ core/applyFill + core/evaluateAccount
  getMarketSnapshot: async () => snapshot(ctx),
  feeRate: async () => FEE_RATE,
  now: () => ctx.nowMs,
  log: () => {},
});

const tick = (ctx: Ctx) => runRiskTick(workerDeps(ctx));
const roll = (at: string): Promise<number> => {
  const ms = Date.parse(at);
  return runDayRoll({ db, now: () => new Date(ms), log: () => {} });
};

// ---- Фикстуры и команды ----

interface Trader { user: { id: string; walletAddress: string }; account: TradingAccount }

/** Счёт «после покупки»: реальный конфиг SPRINT из pricingConfig, DEPOSIT 5000. */
// Challenge имеет @@unique(accountSize, planType) — один SPRINT $5K на прогон файла.
let challengeId: string | null = null;

async function makeTrader(tag: string): Promise<Trader> {
  const sprint = PLAN_CONFIGS.SPRINT;
  // Сценарий считает точные суммы под эти правила; защита от дрейфа конфига.
  assert.equal(sprint.profitTargetPct, 9);
  assert.equal(sprint.dailyDdPct, 3);
  assert.equal(sprint.maxDdPct, 3);
  assert.equal(sprint.minTradingDays, 3);
  const user = await db.user.create({ data: { walletAddress: `natural-pass-${tag}` } });
  if (challengeId === null) {
    const challenge = await db.challenge.create({
      data: {
        accountSize: SIZE, planType: 'SPRINT',
        profitTargetPct: sprint.profitTargetPct, dailyDdPct: sprint.dailyDdPct,
        maxDdPct: sprint.maxDdPct, profitSplitPct: sprint.profitSplitPct,
        priceUsd: new Decimal(PRICING_MATRIX[5000].SPRINT), minTradingDays: sprint.minTradingDays,
      },
    });
    challengeId = challenge.id;
  }
  const account = await db.tradingAccount.create({
    data: {
      userId: user.id, challengeId,
      accountSize: SIZE, currentBalance: SIZE, currentEquity: SIZE, dayStartEquity: SIZE,
      staticMaxDdFloor: SIZE.mul(0.97), dailyDdFloor: SIZE.mul(0.97),
      status: 'ACTIVE', mode: 'CHALLENGE', phase: 'CHALLENGE', rulesHash: `natural-pass:${tag}`,
    },
  });
  await db.ledgerEntry.create({ data: { accountId: account.id, type: 'DEPOSIT', amount: SIZE } });
  return { user, account };
}

interface OrderResult {
  status: string;
  position: { id: string; status: string } | null;
  order: { id: string; status: string };
}

async function order(who: Trader, ctx: Ctx, body: Record<string, unknown>): Promise<OrderResult> {
  // SAFETY: приведение сужает Record<string, unknown> из executeSimulatedOrder
  // до полей, которые путь исполнения гарантированно возвращает (status/position/order);
  // строка счёта — настоящая строка из БД (fixture), не заглушка.
  return (await executeSimulatedOrder(
    { id: who.user.id, walletAddress: who.user.walletAddress, role: 'USER' as const },
    who.account,
    { idempotencyKey: `${ctx.tag}-${ctx.seq++}`, ...body },
    simDeps(ctx),
  )) as unknown as OrderResult;
}

/** Открытие LONG по рыночному ордеру: размер $2500, плечо 1 (вне лимитов маржи). */
async function openLong(who: Trader, ctx: Ctx, at: string, price: number): Promise<string> {
  ctx.price = price;
  ctx.nowMs = Date.parse(at);
  const res = await order(who, ctx, {
    action: 'OPEN_POSITION', symbol: SYMBOL, side: 'LONG', orderMode: 'Market', sizeUsd: 2500, leverage: 1,
  });
  assert.equal(res.status, 'FILLED', `открытие @${price}: ${res.status}`);
  assert.equal(res.position?.status, 'OPEN', 'позиция не открыта');
  return res.position!.id;
}

async function closeLong(who: Trader, ctx: Ctx, at: string, price: number, positionId: string): Promise<void> {
  ctx.price = price;
  ctx.nowMs = Date.parse(at);
  const res = await order(who, ctx, { action: 'CLOSE_POSITION', positionId });
  assert.equal(res.status, 'FILLED', `закрытие @${price}: ${res.status}`);
  assert.equal(res.position, null, 'позиция не закрыта');
}

const eqD = (actual: Decimal, expected: string, msg: string) =>
  assert.ok(actual.equals(new Decimal(expected)), `${msg}: ${actual.toString()} ≠ ${expected}`);
const account = (id: string) => db.tradingAccount.findUniqueOrThrow({ where: { id } });

/** §5: баланс = Σ проводок; equity = баланс + Σ нереализованного PnL открытых позиций. */
async function checkInvariants(accountId: string, label: string): Promise<void> {
  const [acc, entries, open] = await Promise.all([
    db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } }),
    db.ledgerEntry.findMany({ where: { accountId }, select: { amount: true } }),
    db.position.findMany({ where: { accountId, status: 'OPEN' }, select: { unrealizedPnl: true } }),
  ]);
  const sum = entries.reduce((s, e) => s.plus(e.amount), ZERO);
  assert.ok(sum.equals(acc.currentBalance), `${label}: баланс ${acc.currentBalance} ≠ Σ проводок ${sum.toString()}`);
  const equity = acc.currentBalance.plus(open.reduce((s, p) => s.plus(p.unrealizedPnl), ZERO));
  assert.ok(equity.equals(acc.currentEquity), `${label}: equity ${acc.currentEquity} ≠ баланс + Σ нереализ. ${equity.toString()}`);
}

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  db = (await import('../../lib/db')).db;
});

after(async () => {
  await db?.$disconnect();
});

// ---- Главный сценарий: естественное PASSED за 3 торговых дня ----

test('естественное прохождение: +4/+3/+3 % за 3 дня → PASSED на тике риска, tradingDaysCount = 3', async () => {
  const who = await makeTrader('main');
  const ctx = makeCtx('main', '2026-10-05');
  const accId = who.account.id;

  // День 1 (2026-10-05): сделка с прибылью ~4 % — позиция открыта и закрыта.
  const pos1 = await openLong(who, ctx, '2026-10-05T10:00:00.000Z', 100);
  await checkInvariants(accId, 'день 1, после открытия');
  ctx.price = 99;
  ctx.nowMs = Date.parse('2026-10-05T11:00:00.000Z');
  await tick(ctx); // лёгкая просадка внутри дня: equity 4973.75 > floor 4850
  await checkInvariants(accId, 'день 1, тик при 99');
  await closeLong(who, ctx, '2026-10-05T14:00:00.000Z', 108, pos1);
  await checkInvariants(accId, 'день 1, после закрытия');

  let acc = await account(accId);
  eqD(acc.currentBalance, '5197.4', 'день 1: баланс'); // 5000 − 1.25 fee + 200 PnL − 1.35 fee
  eqD(acc.currentEquity, '5197.4', 'день 1: equity');
  assert.equal(acc.status, 'ACTIVE');
  assert.equal(acc.tradingDaysCount, 0, 'день ещё не завершён');
  assert.equal(acc.lastTradeDay, '2026-10-05');

  // 00:00 UTC: смена дня, 1-й торговый день засчитан.
  assert.equal(await roll('2026-10-06T00:00:30.000Z'), 1, 'ролл прокатал 1 ACTIVE-счёт');
  await checkInvariants(accId, 'после ролла в 00:00 UTC');
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 1);
  eqD(acc.dayStartEquity, '5197.4', 'dayStartEquity = equity на ролле');
  eqD(acc.dailyDdFloor, '5041.478', 'дневной floor 5197.4 × 0.97');

  // День 2 (2026-10-06): ещё ~3 %.
  const pos2 = await openLong(who, ctx, '2026-10-06T10:00:00.000Z', 100);
  await checkInvariants(accId, 'день 2, после открытия');
  ctx.price = 101.5;
  ctx.nowMs = Date.parse('2026-10-06T10:05:00.000Z');
  await tick(ctx);
  await checkInvariants(accId, 'день 2, тик при 101.5');
  await closeLong(who, ctx, '2026-10-06T15:00:00.000Z', 106, pos2);
  await checkInvariants(accId, 'день 2, после закрытия');
  acc = await account(accId);
  eqD(acc.currentBalance, '5344.825', 'день 2: баланс'); // +150 PnL − 1.25 − 1.325 fee

  assert.equal(await roll('2026-10-07T00:00:30.000Z'), 1);
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 2);

  // День 3 (2026-10-07): ещё ~3 % → итог ≥ 9 %, но 3-й торговый день не завершён.
  const pos3 = await openLong(who, ctx, '2026-10-07T09:00:00.000Z', 100);
  ctx.price = 102;
  ctx.nowMs = Date.parse('2026-10-07T09:05:00.000Z');
  await tick(ctx);
  await closeLong(who, ctx, '2026-10-07T16:00:00.000Z', 106, pos3);
  await checkInvariants(accId, 'день 3, после закрытия');
  acc = await account(accId);
  eqD(acc.currentBalance, '5492.25', 'день 3: баланс');
  assert.ok(acc.currentEquity.gte(TARGET), 'итог ≥ цели 9 %');
  assert.equal(acc.status, 'ACTIVE', 'PASSED не может наступить до завершения 3-го дня');
  assert.equal(acc.tradingDaysCount, 2);

  // Трейдер оставляет стоячий лимит на ночь — через него тик риска увидит счёт.
  ctx.nowMs = Date.parse('2026-10-07T16:30:00.000Z');
  const limit = await order(who, ctx, {
    action: 'OPEN_POSITION', symbol: SYMBOL, side: 'LONG', orderMode: 'Limit',
    sizeUsd: 950, leverage: 1, limitPrice: 95, // ниже метки 106 — стоячий
  });
  assert.equal(limit.status, 'PENDING_LIMIT_ORDER');
  await checkInvariants(accId, 'после постановки лимита');

  // 00:00 UTC: 3-й торговый день засчитан.
  assert.equal(await roll('2026-10-08T00:00:30.000Z'), 1);
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 3);

  // Тик риска: цель + 3 торговых дня + позиций нет → PASSED, лимитки отменены.
  ctx.price = 106;
  ctx.nowMs = Date.parse('2026-10-08T00:01:00.000Z');
  await tick(ctx);
  acc = await account(accId);
  assert.equal(acc.status, 'PASSED');
  assert.equal(acc.tradingDaysCount, 3);
  assert.equal(await db.position.count({ where: { accountId: accId, status: 'OPEN' } }), 0, 'открытых позиций нет');
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: limit.order.id } })).status,
    'CANCELLED',
    'лимитка отменена при PASSED (§5)',
  );
  eqD(acc.currentBalance, '5492.25', 'смена статуса не меняет денег');
  eqD(acc.currentEquity, '5492.25', 'equity = баланс без позиций');
  assert.equal(await db.fill.count({ where: { accountId: accId } }), 6, '3 открытия + 3 закрытия');
  await checkInvariants(accId, 'итог');
});

// ---- Негативная ветка 1: цель достигнута раньше 3-го торгового дня ----

test('цель +9 % достигнута на 2-й день → ACTIVE/RISK_REVIEW, PASSED не раньше 3-го торгового дня', async () => {
  const who = await makeTrader('early');
  const ctx = makeCtx('early', '2026-11-01');
  const accId = who.account.id;

  // День 1: +~5 %.
  const pos1 = await openLong(who, ctx, '2026-11-01T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2026-11-01T15:00:00.000Z', 110, pos1);
  await checkInvariants(accId, 'день 1');
  await roll('2026-11-02T00:00:30.000Z');

  // День 2: ещё +~5 % → итог ≥ 9 % уже на 2-й день.
  const pos2 = await openLong(who, ctx, '2026-11-02T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2026-11-02T15:00:00.000Z', 110, pos2);
  await checkInvariants(accId, 'день 2, после закрытия');
  let acc = await account(accId);
  eqD(acc.currentBalance, '5494.75', 'день 2: баланс');
  assert.ok(acc.currentEquity.gte(TARGET), 'цель достигнута на 2-й день');
  assert.ok(['ACTIVE', 'RISK_REVIEW'].includes(acc.status), 'статус не PASSED');
  assert.equal(acc.status, 'ACTIVE');
  assert.equal(acc.tradingDaysCount, 1);

  // Тик риска оценивает счёт, но не проходит: торговых дней меньше трёх.
  ctx.nowMs = Date.parse('2026-11-02T16:00:00.000Z');
  const limit = await order(who, ctx, {
    action: 'OPEN_POSITION', symbol: SYMBOL, side: 'LONG', orderMode: 'Limit',
    sizeUsd: 950, leverage: 1, limitPrice: 95,
  });
  assert.equal(limit.status, 'PENDING_LIMIT_ORDER');
  ctx.nowMs = Date.parse('2026-11-02T16:05:00.000Z');
  await tick(ctx);
  await checkInvariants(accId, 'тик при 1 завершённом дне');
  acc = await account(accId);
  assert.equal(acc.status, 'ACTIVE', 'тик не проходит счёт без 3 торговых дней');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: limit.order.id } })).status, 'OPEN');

  await roll('2026-11-03T00:00:30.000Z'); // 2-й день

  // День 3: сделка-возврат по той же цене — день торговый, статус всё ещё не PASSED.
  const pos3 = await openLong(who, ctx, '2026-11-03T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2026-11-03T10:30:00.000Z', 100, pos3);
  await checkInvariants(accId, 'день 3, после закрытия');
  acc = await account(accId);
  eqD(acc.currentBalance, '5492.25', 'день 3: только комиссии');
  assert.equal(acc.status, 'ACTIVE', 'на закрытии 3-го дня счёт ещё не PASSED');
  assert.equal(acc.tradingDaysCount, 2);

  // Смена дня засчитывает 3-й торговый день и сама проходит счёт без позиций:
  // трейдеру не нужно открывать новую сделку и рисковать результатом.
  await roll('2026-11-04T00:00:30.000Z');
  await checkInvariants(accId, 'итог');
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 3);
  assert.equal(acc.status, 'PASSED', 'после 3-го торгового дня — PASSED при смене дня');
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: limit.order.id } })).status,
    'CANCELLED',
    'лимитка отменена при PASSED',
  );
  eqD(acc.currentBalance, '5492.25', 'итог: без лишней сделки и её комиссии');
  const note = await db.notification.findFirst({ where: { accountId: accId, kind: 'ACCOUNT_PASSED' } });
  assert.ok(note, 'уведомление о прохождении создано');
});

test('счёт без позиций не проходит при смене дня, если цель не достигнута', async () => {
  const who = await makeTrader('flat-short');
  const ctx = makeCtx('flat-short', '2027-01-01');
  const accId = who.account.id;
  for (const [day, next] of [['2027-01-01', '2027-01-02'], ['2027-01-02', '2027-01-03'], ['2027-01-03', '2027-01-04']]) {
    const pos = await openLong(who, ctx, `${day}T10:00:00.000Z`, 100);
    await closeLong(who, ctx, `${day}T11:00:00.000Z`, 101, pos); // +1 % в день: цель 9 % не достигнута
    await roll(`${next}T00:00:30.000Z`);
  }
  const acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 3);
  assert.equal(acc.status, 'ACTIVE', 'без достигнутой цели счёт остаётся ACTIVE');
});

// ---- Негативная ветка 2: день без сделок ----

test('день без сделок не засчитывается как торговый', async () => {
  const who = await makeTrader('idle');
  const ctx = makeCtx('idle', '2026-12-01');
  const accId = who.account.id;

  // День 1: сделка +~4 %.
  const pos1 = await openLong(who, ctx, '2026-12-01T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2026-12-01T14:00:00.000Z', 108, pos1);
  await checkInvariants(accId, 'день 1');
  await roll('2026-12-02T00:00:30.000Z');
  let acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 1);

  // День 2 (2026-12-02): ни сделок, ни ордеров — ролл не засчитывает день.
  await roll('2026-12-03T00:00:30.000Z');
  await checkInvariants(accId, 'после пустого дня');
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 1, 'пустой день не засчитан');
  assert.equal(acc.lastTradeDay, '2026-12-01');
  eqD(acc.dayStartEquity, '5197.4', 'dayStartEquity тем не менее обновлён');
  eqD(acc.dailyDdFloor, '5041.478', 'дневной floor после пустого дня');

  // День 3: сделка — день засчитывается только теперь.
  const pos2 = await openLong(who, ctx, '2026-12-03T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2026-12-03T15:00:00.000Z', 106, pos2);
  await checkInvariants(accId, 'день 3');
  await roll('2026-12-04T00:00:30.000Z');
  acc = await account(accId);
  assert.equal(acc.tradingDaysCount, 2, 'торговый день засчитан после сделки');
  assert.notEqual(acc.status, 'PASSED', 'до цели и 3 дней PASSED нет');
  await checkInvariants(accId, 'итог');
});

// ---- Негативная ветка 3: внутридневная просадка по нереализованному PnL ----

test('просадка внутри дня ниже дневного floor → FAILED сразу на тике, позиции закрыты', async () => {
  const who = await makeTrader('dd');
  const ctx = makeCtx('dd', '2027-01-05');
  const accId = who.account.id;

  // День 1: +~4 % — после ролла дневной floor (5041.478) выше статического (4850).
  const pos1 = await openLong(who, ctx, '2027-01-05T10:00:00.000Z', 100);
  await closeLong(who, ctx, '2027-01-05T14:00:00.000Z', 108, pos1);
  await checkInvariants(accId, 'день 1');
  assert.ok((await roll('2027-01-06T00:00:30.000Z')) >= 1);

  // День 2: длинная позиция, рынок идёт против — но floor ещё не пробит.
  const pos2 = await openLong(who, ctx, '2027-01-06T10:00:00.000Z', 100);
  await checkInvariants(accId, 'день 2, после открытия');
  ctx.price = 97;
  ctx.nowMs = Date.parse('2027-01-06T11:00:00.000Z');
  await tick(ctx);
  await checkInvariants(accId, 'тик при 97');
  let acc = await account(accId);
  eqD(acc.currentEquity, '5121.15', 'equity при 97'); // 5196.15 − 75 нереализованного убытка
  assert.equal(acc.status, 'ACTIVE', 'floor не пробит');
  assert.equal((await db.position.findUniqueOrThrow({ where: { id: pos2 } })).status, 'OPEN');

  // Метка 93.5: equity 5033.65 ≤ dailyFloor 5041.478 → FAILED на этом же тике.
  ctx.price = 93.5;
  ctx.nowMs = Date.parse('2027-01-06T12:00:00.000Z');
  await tick(ctx);
  acc = await account(accId);
  assert.equal(acc.status, 'FAILED');
  eqD(acc.currentBalance, '5032.48125', 'закрытие по метке: −162.5 PnL − 1.16875 fee');
  eqD(acc.currentEquity, '5032.48125', 'equity = баланс без позиций');
  assert.equal((await db.position.findUniqueOrThrow({ where: { id: pos2 } })).status, 'CLOSED', 'позиция закрыта');
  const events = await db.riskEvent.findMany({ where: { accountId: accId } });
  assert.equal(events.length, 1);
  assert.equal(events[0].level, 'FAILED');
  assert.equal(events[0].ruleName, 'DAILY_DD', 'пробит именно дневной floor');
  await checkInvariants(accId, 'после FAILED');

  // Повторный тик ничего не меняет: FAILED-счёт больше не переоценивается.
  await tick(ctx);
  assert.equal(await db.riskEvent.count({ where: { accountId: accId } }), 1);
  assert.equal((await account(accId)).status, 'FAILED');
});
