// Агент K4 «Естественное прохождение челленджа»: счёт SPRINT $5K (цель 9 % →
// $5450, дневная и статическая просадка 3 %, мин. 3 торговых дня) проходит
// челлендж БЕЗ прямых проводок ADJUST и ручной смены статуса. Сделки — только
// через executeSimulatedOrder с DI-подменой цены, смена дня — runDayRoll на
// виртуальных часах, переоценка — runRiskTick с настоящим ядром core/*
// (приём тот же, что в scripts/bot-load.ts; приложение не поднимается).
//
// Сценарий: день 1 +4 %, ролл; день 2 +3 %, ролл; день 3 +3 % → итог ≥ 9 %,
// позиций нет, но 3-й торговый день ещё не завершён → статус ACTIVE. Трейдер
// оставляет стоячий лимит; после третьего ролла (tradingDaysCount = 3) тик
// риска видит счёт через лимитку, проходит его и отменяет лимит (§5).
//
// Использование: node --env-file=.env.test --import tsx scripts/natural-pass.ts
// (DATABASE_URL обязан указывать на props_test). Код выхода 0 — все шаги PASS.
import { execFileSync } from 'node:child_process';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '../src/lib/db';
import { executeSimulatedOrder } from '../src/lib/execution/simulated';
import type { SimulatedOrderDeps } from '../src/lib/execution/simulated';
import { runRiskTick, defaultRiskTickDeps } from '../src/worker/riskTick';
import type { RiskTickDeps } from '../src/worker/riskTick';
import { runDayRoll } from '../src/worker/dayRoll';
import { PLAN_CONFIGS, PRICING_MATRIX } from '../src/lib/pricingConfig';
import type { Market, MarketSnapshot } from '../src/lib/marketData/types';

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

const ZERO = new Decimal(0);
const SIZE = new Decimal(5000);
const TARGET = new Decimal(5450); // 5000 × (1 + 9 %)
const SYMBOL = 'SOL-PERP';
const FEE_RATE = new Decimal('0.0005');
// Фейковый рынок: точные цены и количества дают terminating-десятичные —
// все ожидаемые суммы сверяются до цента.
const MARKET: Market = {
  symbol: SYMBOL, type: 'perp', status: 'active', baseAsset: 'SOL', quoteAsset: 'USDC',
  takerFee: 0.0005, maxLeverage: 5,
};

// ---- Шаги PASS/FAIL (код выхода 0 — только если всё зелёное) ----

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

function eqD(actual: Decimal, expected: string, message: string): void {
  check(actual.equals(new Decimal(expected)), `${message}: ${actual.toString()} ≠ ${expected}`);
}

// ---- Виртуальные часы и цена (DI) ----

const state = { price: 100, nowMs: Date.parse('2026-10-05T10:00:00.000Z'), seq: 0 };

// SAFETY: неполный MarketSnapshot (только поля, читаемые snapshotMark в
// simulated.ts и riskTick.ts: ticker.markPrice/referencePrice/marketId) —
// тот же приём, что в scripts/bot-load.ts и тестах воркера.
const snapshot = (): MarketSnapshot =>
  ({ marketId: SYMBOL, ticker: { markPrice: state.price }, referencePrice: state.price } as unknown as MarketSnapshot);

const simDeps: SimulatedOrderDeps = {
  resolveMarket: async (s) => (s.toUpperCase() === SYMBOL ? MARKET : undefined),
  getMarketSnapshot: async () => snapshot(),
  now: () => state.nowMs,
};

const workerDeps: RiskTickDeps = {
  ...defaultRiskTickDeps(), // db, withAccountLock и НАСТОЯЩИЕ core/applyFill + core/evaluateAccount
  getMarketSnapshot: async () => snapshot(),
  feeRate: async () => FEE_RATE,
  now: () => state.nowMs,
  log: () => {},
};

// ---- Состояние сценария ----

let userId = '';
let accountId = '';
let posId = '';
let limitOrderId = '';

const user = () => ({ id: userId, walletAddress: 'natural-pass', role: 'USER' as const });
const accountRow = () => ({ id: accountId, userId, mode: 'CHALLENGE', status: 'ACTIVE' });
const reload = () => db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

interface OrderResult {
  status: string;
  position: { id: string } | null;
  order: { id: string; status: string };
}

async function cmd(body: Record<string, unknown>): Promise<OrderResult> {
  // SAFETY: приведение сужает Record<string, unknown> из executeSimulatedOrder
  // до полей, которые путь исполнения гарантированно возвращает (status/position/order);
  // строка-заглушка счёта легитимна — executeSimulatedOrder проверяет только userId,
  // статус и режимы под блокировкой перечитываются из БД (как в scripts/bot-load.ts).
  return (await executeSimulatedOrder(
    user(),
    accountRow() as Parameters<typeof executeSimulatedOrder>[1],
    { idempotencyKey: `np-${state.seq++}`, ...body },
    simDeps,
  )) as unknown as OrderResult;
}

/** §5: баланс = Σ проводок; equity = баланс + Σ нереализованного PnL. */
async function ledgerCheck(label: string): Promise<void> {
  const [acc, entries, open] = await Promise.all([
    db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } }),
    db.ledgerEntry.findMany({ where: { accountId }, select: { amount: true } }),
    db.position.findMany({ where: { accountId, status: 'OPEN' }, select: { unrealizedPnl: true } }),
  ]);
  const sum = entries.reduce((s, e) => s.plus(e.amount), ZERO);
  check(sum.equals(acc.currentBalance), `${label}: баланс ${acc.currentBalance} ≠ Σ проводок ${sum.toString()}`);
  const equity = acc.currentBalance.plus(open.reduce((s, p) => s.plus(p.unrealizedPnl), ZERO));
  check(equity.equals(acc.currentEquity), `${label}: equity ${acc.currentEquity} ≠ баланс + Σ нереализ. ${equity.toString()}`);
}

async function openLong(at: string, price: number): Promise<void> {
  state.price = price;
  state.nowMs = Date.parse(at);
  const res = await cmd({ action: 'OPEN_POSITION', symbol: SYMBOL, side: 'LONG', orderMode: 'Market', sizeUsd: 2500, leverage: 1 });
  check(res.status === 'FILLED' && res.position, `открытие @${price}: ${JSON.stringify(res)}`);
  posId = res.position!.id;
}

async function closeLong(at: string, price: number): Promise<void> {
  state.price = price;
  state.nowMs = Date.parse(at);
  const res = await cmd({ action: 'CLOSE_POSITION', positionId: posId });
  check(res.status === 'FILLED' && res.position === null, `закрытие @${price}: ${JSON.stringify(res)}`);
}

const tick = () => runRiskTick(workerDeps);
const roll = async (at: string): Promise<number> => {
  const ms = Date.parse(at);
  return runDayRoll({ db, now: () => new Date(ms), log: () => {} });
};

// ---- Сценарий ----

async function main(): Promise<void> {
  const sprint = PLAN_CONFIGS.SPRINT;
  check(
    sprint.profitTargetPct === 9 && sprint.dailyDdPct === 3 && sprint.maxDdPct === 3 && sprint.minTradingDays === 3,
    `конфиг SPRINT изменился: ${JSON.stringify(sprint)}`,
  );
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  console.log('natural-pass: SPRINT $5K, цель 9 % (5450), просадки 3 %/3 %, мин. 3 торговых дня');

  type MainStep = [name: string, fn: () => Promise<void>];
  const steps: MainStep[] = [
    ['база: счёт ACTIVE после покупки, DEPOSIT 5000, баланс = Σ проводок', async () => {
      const u = await db.user.create({ data: { walletAddress: 'natural-pass' } });
      userId = u.id;
      const challenge = await db.challenge.create({
        data: {
          accountSize: SIZE, planType: 'SPRINT',
          profitTargetPct: sprint.profitTargetPct, dailyDdPct: sprint.dailyDdPct,
          maxDdPct: sprint.maxDdPct, profitSplitPct: sprint.profitSplitPct,
          priceUsd: new Decimal(PRICING_MATRIX[5000].SPRINT), minTradingDays: sprint.minTradingDays,
        },
      });
      const account = await db.tradingAccount.create({
        data: {
          userId, challengeId: challenge.id,
          accountSize: SIZE, currentBalance: SIZE, currentEquity: SIZE, dayStartEquity: SIZE,
          staticMaxDdFloor: SIZE.mul(0.97), dailyDdFloor: SIZE.mul(0.97),
          status: 'ACTIVE', mode: 'CHALLENGE', phase: 'CHALLENGE', rulesHash: 'natural-pass',
        },
      });
      accountId = account.id;
      await db.ledgerEntry.create({ data: { accountId, type: 'DEPOSIT', amount: SIZE } });
      await ledgerCheck('seed');
    }],

    ['день 1: LONG 25 SOL-PERP @100 (fee 1.25), тик при 99 — floor цел', async () => {
      await openLong('2026-10-05T10:00:00.000Z', 100);
      await ledgerCheck('день 1, открытие');
      state.price = 99;
      state.nowMs = Date.parse('2026-10-05T11:00:00.000Z');
      await tick();
      const acc = await reload();
      eqD(acc.currentEquity, '4973.75', 'equity при 99');
      check(acc.status === 'ACTIVE', `floor не пробит, статус ${acc.status}`);
      await ledgerCheck('день 1, тик при 99');
    }],

    ['день 1: закрытие @108 → баланс 5197.4 (+3.95 %), статус ACTIVE', async () => {
      await closeLong('2026-10-05T14:00:00.000Z', 108);
      await ledgerCheck('день 1, закрытие');
      const acc = await reload();
      eqD(acc.currentBalance, '5197.4', 'баланс');
      eqD(acc.currentEquity, '5197.4', 'equity');
      check(acc.status === 'ACTIVE', 'статус');
      check(acc.tradingDaysCount === 0 && acc.lastTradeDay === '2026-10-05', 'день ещё не завершён');
    }],

    ['ролл 00:00 UTC: tradingDays 1, dayStart 5197.4, dailyFloor 5041.478', async () => {
      const rolled = await roll('2026-10-06T00:00:30.000Z');
      check(rolled === 1, `ролл прокатал ${rolled} счетов`);
      const acc = await reload();
      check(acc.tradingDaysCount === 1, `tradingDaysCount ${acc.tradingDaysCount}`);
      eqD(acc.dayStartEquity, '5197.4', 'dayStartEquity');
      eqD(acc.dailyDdFloor, '5041.478', 'dailyDdFloor');
      await ledgerCheck('после ролла');
    }],

    ['день 2: @100 → @106 → баланс 5344.825 (+6.90 % суммарно)', async () => {
      await openLong('2026-10-06T10:00:00.000Z', 100);
      state.price = 101.5;
      state.nowMs = Date.parse('2026-10-06T10:05:00.000Z');
      await tick();
      await closeLong('2026-10-06T15:00:00.000Z', 106);
      await ledgerCheck('день 2, закрытие');
      const acc = await reload();
      eqD(acc.currentBalance, '5344.825', 'баланс');
      check(acc.status === 'ACTIVE', 'статус');
    }],

    ['ролл 00:00 UTC: tradingDays 2', async () => {
      await roll('2026-10-07T00:00:30.000Z');
      check((await reload()).tradingDaysCount === 2, 'tradingDaysCount');
    }],

    ['день 3: @100 → @106 → баланс 5492.25 (≥ цели 5450), но статус ACTIVE — 3-й день не завершён', async () => {
      await openLong('2026-10-07T09:00:00.000Z', 100);
      state.price = 102;
      state.nowMs = Date.parse('2026-10-07T09:05:00.000Z');
      await tick();
      await closeLong('2026-10-07T16:00:00.000Z', 106);
      await ledgerCheck('день 3, закрытие');
      const acc = await reload();
      eqD(acc.currentBalance, '5492.25', 'баланс');
      check(acc.currentEquity.gte(TARGET), 'equity ≥ цели 9 %');
      check(acc.status === 'ACTIVE', `PASSED раньше 3-го завершённого дня: ${acc.status}`);
      check(acc.tradingDaysCount === 2, 'торговых дней ещё 2');
    }],

    ['стоячий лимит LONG @95 → PENDING (по нему тик риска увидит счёт)', async () => {
      state.nowMs = Date.parse('2026-10-07T16:30:00.000Z');
      const res = await cmd({
        action: 'OPEN_POSITION', symbol: SYMBOL, side: 'LONG', orderMode: 'Limit',
        sizeUsd: 950, leverage: 1, limitPrice: 95, // ниже метки 106 — стоячий
      });
      check(res.status === 'PENDING_LIMIT_ORDER', `лимит: ${JSON.stringify(res)}`);
      limitOrderId = res.order.id;
      await ledgerCheck('после лимита');
    }],

    ['ролл 00:00 UTC: tradingDays 3', async () => {
      await roll('2026-10-08T00:00:30.000Z');
      check((await reload()).tradingDaysCount === 3, 'tradingDaysCount');
    }],

    ['тик риска: PASSED, лимитка отменена, позиций нет, деньги не тронуты', async () => {
      state.price = 106;
      state.nowMs = Date.parse('2026-10-08T00:01:00.000Z');
      await tick();
      const acc = await reload();
      check(acc.status === 'PASSED', `статус ${acc.status}`);
      check(acc.tradingDaysCount === 3, 'tradingDaysCount');
      check(await db.position.count({ where: { accountId, status: 'OPEN' } }) === 0, 'открытых позиций нет');
      check((await db.order.findUniqueOrThrow({ where: { id: limitOrderId } })).status === 'CANCELLED', 'лимитка отменена');
      eqD(acc.currentBalance, '5492.25', 'смена статуса не меняет денег');
      eqD(acc.currentEquity, '5492.25', 'equity = баланс');
      check(await db.fill.count({ where: { accountId } }) === 6, '3 открытия + 3 закрытия');
      await ledgerCheck('итог');
      const pnl = acc.currentBalance.minus(SIZE);
      console.log(`     итог: PASSED за 3 торговых дня, баланс ${acc.currentBalance.toFixed(2)}, PnL +${pnl.toFixed(2)} (+${pnl.div(SIZE).mul(100).toFixed(3)} %)`);
    }],
  ];

  for (const [name, fn] of steps) {
    if (!(await step(name, fn))) {
      console.log('SKIP остальные шаги после первого FAIL');
      break;
    }
  }

  console.log('');
  if (failures.length === 0) console.log('NATURAL-PASS RESULT: PASS — все шаги зелёные');
  else {
    console.log(`NATURAL-PASS RESULT: FAIL (${failures.length}):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  await db.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`NATURAL-PASS RESULT: FAIL (ошибка сценария: ${error instanceof Error ? error.message : String(error)})`);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
