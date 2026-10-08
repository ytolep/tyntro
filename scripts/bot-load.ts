// Агент K «Нагрузка»: 500 пользователей и счетов (разные планы/размеры) торгуют
// случайно по записанному ряду Phoenix-цен; воркер тикает между шагами.
// Использование: DATABASE_URL=... node --import tsx scripts/bot-load.ts
//   PRICES=<путь> — файл записи (по умолчанию новейший scripts/data/prices-*.jsonl)
//   BOTS=500 — число счетов; CMDS_PER_TICK=40 — команды ботов на тик; SEED=42
// Подмена источника цены — штатный DI: SimulatedOrderDeps у executeSimulatedOrder
// и RiskTickDeps у runRiskTick (ядро и воркер не менялись). Виртуальные часы:
// now() идёт по времени записи с ускорением (тики прогоняются без ожидания).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';
import { executeSimulatedOrder } from '../src/lib/execution/simulated';
import type { SimulatedOrderDeps } from '../src/lib/execution/simulated';
import { ExecutionError } from '../src/lib/execution/policy';
import { runRiskTick, defaultRiskTickDeps } from '../src/worker/riskTick';
import type { Market, MarketSnapshot } from '../src/lib/marketData/types';
import { PLAN_CONFIGS, ACCOUNT_SIZES, PRICING_MATRIX } from '../src/lib/pricingConfig';
import { FALLBACK_TAKER_FEE } from '../src/lib/marketData/markets';

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

const BOTS = Number(process.env.BOTS ?? 500);
const CMDS_PER_TICK = Number(process.env.CMDS_PER_TICK ?? 40);
const SEED = Number(process.env.SEED ?? 42);
const DATA_DIR = join(import.meta.dirname, 'data');
const D2 = (n: number | Decimal) => new Decimal(n);

// ---- PRNG (детерминированный прогон) ----
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

// ---- Запись цен ----
interface Tick { t: number; marks: Record<string, number> }
function loadPrices(): { file: string; markets: Map<string, Market>; ticks: Tick[] } {
  const arg = process.env.PRICES;
  const file = arg ?? readdirSync(DATA_DIR).filter((f) => /^prices-.*\.jsonl$/.test(f)).sort().pop();
  if (!file) throw new Error('Нет записей цен: запустите scripts/record-prices.ts');
  const path = arg ? file : join(DATA_DIR, file);
  const markets = new Map<string, Market>();
  const ticks: Tick[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`Битая строка в ${path}: ${line.slice(0, 80)}`);
    }
    if (row.type === 'meta') for (const m of Object.values(row.markets as Record<string, Market>)) markets.set(m.symbol.toUpperCase(), m);
    else if (row.type === 'tick') ticks.push({ t: row.t, marks: row.marks });
  }
  if (markets.size < 5 || ticks.length < 10) throw new Error(`Плохая запись цен: ${markets.size} рынков, ${ticks.length} тиков`);
  return { file: path, markets, ticks };
}

// ---- Подменённый источник цены (DI) ----
const state = { marks: new Map<string, number>(), nowMs: Date.now() };
const markets = new Map<string, Market>();

function fakeSnapshot(symbol: string): MarketSnapshot {
  const mark = state.marks.get(symbol.toUpperCase());
  if (typeof mark !== 'number' || !(mark > 0)) throw new Error(`Нет записанной метки для ${symbol}`);
  // SAFETY: неполный MarketSnapshot (только поля, читаемые snapshotMark в simulated.ts
  // и riskTick.ts: ticker.markPrice/referencePrice/marketId); остальной пересбор не нужен.
  return { marketId: symbol, ticker: { markPrice: mark }, referencePrice: mark } as unknown as MarketSnapshot;
}

const simDeps: SimulatedOrderDeps = {
  resolveMarket: async (symbol) => markets.get(symbol.toUpperCase()),
  getMarketSnapshot: async (symbol) => fakeSnapshot(symbol),
  now: () => state.nowMs,
};

const workerDeps = {
  ...defaultRiskTickDeps(),
  getMarketSnapshot: async (symbol: string) => fakeSnapshot(symbol),
  feeRate: async (symbol: string) => D2(markets.get(symbol.toUpperCase())?.takerFee ?? FALLBACK_TAKER_FEE),
  now: () => state.nowMs,
  log: () => {},
};

// ---- Подготовка базы ----
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

interface BotAccount { id: string; userId: string; accountSize: Decimal; aggressive: boolean }

/** Профили для покрытия исходов: edge — гонится за PASSED (цель 1 %, minTradingDays 0, крупные размеры),
 *  mid — середина челленджа (баланс 95.5 % размера, часть пробьёт floor → FAILED-путь воркера), fresh — полный баланс. */
type Profile = 'edge' | 'mid' | 'fresh';
const profileOf = (i: number): Profile => (i % 10 === 0 ? 'edge' : i % 10 === 5 ? 'mid' : 'fresh');

async function seed(accounts: BotAccount[], runId: string): Promise<void> {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });

  const combos = ACCOUNT_SIZES.flatMap((size) =>
    (['SPRINT', 'CORE', 'APEX'] as const).map((planType) => ({ size, planType })));
  const challengeRows = [
    ...combos.map(({ size, planType }) => {
      const config = PLAN_CONFIGS[planType];
      return { accountSize: D2(size), planType, profitTargetPct: config.profitTargetPct, dailyDdPct: config.dailyDdPct,
        maxDdPct: config.maxDdPct, profitSplitPct: config.profitSplitPct, priceUsd: D2(PRICING_MATRIX[size][planType]), minTradingDays: config.minTradingDays };
    }),
    // Нагрузочный план: edge-счета могут дойти до PASSED за один прогон (цель 1 %, дней 0).
    { accountSize: D2(5000), planType: 'LOAD-EDGE', profitTargetPct: 0.3, dailyDdPct: 3, maxDdPct: 6, profitSplitPct: 80, priceUsd: D2(49), minTradingDays: 0 },
  ];
  await db.challenge.createMany({ data: challengeRows });
  const challenges = await db.challenge.findMany();
  const byCombo = new Map(challenges.map((c) => [`${c.accountSize}:${c.planType}`, c]));

  await db.user.createMany({ data: accounts.map((_, i) => ({ walletAddress: `loadbot-${runId}-${i}` })) });
  const users = await db.user.findMany({ select: { id: true } });

  const accountRows: Prisma.TradingAccountCreateManyInput[] = [];
  const depositRows: Prisma.LedgerEntryCreateManyInput[] = [];
  accounts.forEach((a, i) => {
    const profile = profileOf(i);
    const combo = profile === 'edge' ? { size: 5000, planType: 'LOAD-EDGE' } : combos[i % combos.length];
    const challenge = byCombo.get(`${combo.size}:${combo.planType}`)!;
    a.userId = users[i].id;
    const size = D2(challenge.accountSize);
    a.accountSize = size;
    const staticFloor = size.mul(100 - challenge.maxDdPct).div(100);
    const dailyFloor = size.mul(100 - challenge.dailyDdPct).div(100);
    // mid: баланс 95.5 % размера — счёт в середине челленджа; SPRINT (floor 97 %) пробьёт пол сам.
    const balance = profile === 'mid' ? size.mul(0.955) : size;
    accountRows.push({
      userId: users[i].id, challengeId: challenge.id,
      accountSize: size, currentBalance: balance, currentEquity: balance, dayStartEquity: balance,
      staticMaxDdFloor: staticFloor, dailyDdFloor: dailyFloor,
      status: 'ACTIVE', mode: 'CHALLENGE', rulesHash: `load:${runId}`,
    });
    depositRows.push({ accountId: '', type: 'DEPOSIT', amount: balance });
  });
  // accountId придётся подставить после создания счетов
  await db.tradingAccount.createMany({ data: accountRows });
  const created = await db.tradingAccount.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  // createMany без orderBy-гарантии: раздаём id по порядку создания (все строки одной вставки)
  created.forEach((row, i) => { depositRows[i].accountId = row.id; accounts[i].id = row.id; });
  await db.ledgerEntry.createMany({ data: depositRows });
}

// ---- Действия бота ----
const tally = new Map<string, number>();
const bump = (code: string) => tally.set(code, (tally.get(code) ?? 0) + 1);
let seq = 0;

async function botAct(acct: BotAccount): Promise<void> {
  const [positions, orders] = await Promise.all([
    db.position.findMany({ where: { accountId: acct.id, status: 'OPEN' }, select: { id: true, symbol: true } }),
    db.order.findMany({ where: { accountId: acct.id, status: 'OPEN', type: 'LIMIT' }, select: { id: true } }),
  ]);

  const user = { id: acct.userId, walletAddress: 'loadbot', role: 'USER' as const };
  const symbols = [...markets.keys()];
  const frac = () => (acct.aggressive ? 0.3 + rnd() * 0.6 : 0.05 + rnd() * 0.45);
  const lev = () => (acct.aggressive ? 3 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3));

  let body: Record<string, unknown>;
  const r = rnd();
  if (orders.length && r < 0.1) {
    body = { action: 'CANCEL_ORDER', orderId: pick(orders).id };
  } else if (positions.length && r < (acct.aggressive ? 0.25 : 0.55)) {
    body = { action: 'CLOSE_POSITION', positionId: pick(positions).id };
  } else {
    const symbol = pick(symbols);
    const side = rnd() < 0.5 ? 'LONG' : 'SHORT';
    const sizeUsd = Math.round(Number(acct.accountSize.mul(frac())));
    const base: Record<string, unknown> = { action: 'OPEN_POSITION', symbol, side, sizeUsd, leverage: lev() };
    if (rnd() < 0.3) {
      const mark = state.marks.get(symbol)!;
      base.orderMode = 'Limit';
      base.limitPrice = side === 'LONG' ? mark * (0.97 + rnd() * 0.025) : mark * (1.005 + rnd() * 0.025);
    } else {
      base.orderMode = 'Market';
    }
    body = base;
  }
  if (body.action === 'OPEN_POSITION') body.idempotencyKey = `bot-${seq}`;

  state.nowMs += 1; // виртуальное время команд внутри тика
  try {
    const result = await executeSimulatedOrder(user, { ...fakeAccountRow(acct) }, body, simDeps);
    if (result.status === 'FILLED' || result.status === 'PENDING_LIMIT_ORDER') {
      bump(result.status === 'FILLED' ? 'FILLED' : 'LIMIT_PLACED');
      // ~2 %: повтор той же команды — идемпотентность под нагрузкой
      if (body.action === 'OPEN_POSITION' && rnd() < 0.02) {
        try {
          const replay = await executeSimulatedOrder(user, { ...fakeAccountRow(acct) }, body, simDeps);
          bump(replay.duplicate ? 'DUPLICATE_OK' : 'DUPLICATE_MISMATCH');
        } catch (e) { bump(replayErr(e)); }
      }
    }
  } catch (e) {
    bump(errCode(e));
  }
  seq++;
}

function fakeAccountRow(acct: BotAccount) {
  // executeSimulatedOrder проверяет только userId и режимы; статус под блокировкой
  // перечитывается из БД, поэтому безопасно передавать строку-заглушку.
  return { id: acct.id, userId: acct.userId, mode: 'CHALLENGE', status: 'ACTIVE' } as Parameters<typeof executeSimulatedOrder>[1];
}

function errCode(e: unknown): string {
  if (e instanceof ExecutionError) return e.code;
  return `UNEXPECTED:${String((e as Error)?.message ?? e).slice(0, 120)}`;
}
function replayErr(e: unknown): string {
  return `REPLAY_${errCode(e)}`;
}

// ---- Прогон ----
async function main(): Promise<void> {
  const { file, markets: mkts, ticks } = loadPrices();
  for (const [k, v] of mkts) markets.set(k, v);
  const runId = file.split('/').pop()!.replace(/\.jsonl$/, '');

  const accounts: BotAccount[] = Array.from({ length: BOTS }, (_, i) => ({
    id: '', userId: '', accountSize: D2(0), aggressive: profileOf(i) === 'edge',
  }));
  console.log(`bot-load: ${BOTS} счетов, ряд ${file} (${ticks.length} тиков × ${mkts.size} рынков), seed ${SEED}`);
  const t0 = Date.now();
  await seed(accounts, runId);
  console.log(`База засеяна за ${((Date.now() - t0) / 1000).toFixed(1)} с`);

  state.marks = new Map(Object.entries(ticks[0].marks).map(([k, v]) => [k.toUpperCase(), v]));
  let cursor = 0;
  for (let i = 1; i < ticks.length; i++) {
    state.marks = new Map(Object.entries(ticks[i].marks).map(([k, v]) => [k.toUpperCase(), v]));
    state.nowMs = ticks[i].t;

    for (let c = 0; c < CMDS_PER_TICK; c++) {
      const acct = accounts[cursor];
      cursor = (cursor + 1) % accounts.length;
      await botAct(acct);
    }

    state.nowMs = ticks[i].t + 9_999; // тик воркера — после команд тика
    await runRiskTick(workerDeps);
    if (i % 10 === 0) {
      const filled = tally.get('FILLED') ?? 0;
      console.log(`тик ${i}/${ticks.length - 1}: команд ${seq}, исполнено ${filled}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
    }
  }

  // Финальный тик теми же метками: кэши unrealizedPnl/equity приходят к согласованному состоянию
  await runRiskTick(workerDeps);

  console.log(`\nГотово за ${((Date.now() - t0) / 1000).toFixed(0)} с. Итоги по кодам:`);
  for (const [code, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${code}: ${n}`);
  const statuses = await db.tradingAccount.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('Статусы счетов:', statuses.map((s) => `${s.status}=${s._count._all}`).join(', '));
  console.log('Дальше: node --import tsx scripts/check-ledger.ts');
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error('bot-load упал:', e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
