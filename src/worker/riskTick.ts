import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { D } from '../lib/core/money';
import { applyFill } from '../lib/core/position';
import { checkMargin } from '../lib/execution/margin';
import type { ApplyFillResult, FillInput, PositionState, Side } from '../lib/core/position';
import { evaluateAccount } from '../lib/core/risk';
import type { BreachType, EvaluateAccountInput, RiskEvaluation } from '../lib/core/risk';
import { getMarketSnapshot } from '../lib/marketData/server';
import type { MarketSnapshot } from '../lib/marketData/types';
import { withAccountLock } from '../lib/db/lock';
import { db } from '../lib/db';
import { notify } from '../lib/notifications';
import { jsonLog } from './log';
import { takerFeeOf } from '../lib/marketData/markets';
import { resolveMarket } from '../lib/marketData/catalog';
import type { LogFn } from './log';

/** Доля поддерживающей маржи: ликвидация при equity < Σ margin × ratio. */
const MAINTENANCE_RATIO = 0.5;
/** EquitySnapshot пишется не чаще раза в минуту на счёт. */
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;

export interface RiskTickDeps {
  db: PrismaClient;
  withAccountLock: typeof withAccountLock;
  getMarketSnapshot: (symbol: string) => Promise<MarketSnapshot>;
  applyFill: (pos: PositionState | null, fill: FillInput) => ApplyFillResult;
  evaluateAccount: (input: EvaluateAccountInput) => RiskEvaluation;
  maintenanceRatio: number;
  feeRate: (symbol: string) => D | Promise<D>;
  /** epoch ms — для троттлинга снапшотов и даты торгового дня. */
  now: () => number;
  log: LogFn;
}

export function defaultRiskTickDeps(): RiskTickDeps {
  return {
    db,
    withAccountLock,
    getMarketSnapshot,
    applyFill,
    evaluateAccount,
    maintenanceRatio: MAINTENANCE_RATIO,
    // Taker-комиссия рынка из каталога Phoenix; недоступен — запасное значение.
    feeRate: async (symbol: string) => {
      const market = await resolveMarket(symbol).catch(() => undefined);
      return new Decimal(takerFeeOf(market));
    },
    now: () => Date.now(),
    log: jsonLog,
  };
}

const ZERO = new Decimal(0);
/** accountId → epoch ms последнего EquitySnapshot (троттлинг в пределах процесса). */
const lastSnapshotAt = new Map<string, number>();

function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function unrealized(pos: PositionState, mark: D): D {
  return pos.quantity.mul(mark.minus(pos.entryPrice)).mul(pos.side === 'LONG' ? 1 : -1);
}

/** Оценка цены ликвидации позиции: entry ∓ margin×ratio/quantity. */
function liquidationPrice(pos: PositionState, ratio: number): D {
  const shift = pos.quantity.isZero() ? ZERO : pos.margin.mul(ratio).div(pos.quantity);
  return pos.side === 'LONG' ? pos.entryPrice.minus(shift) : pos.entryPrice.plus(shift);
}

function snapshotMark(snapshot: MarketSnapshot): D {
  const price = snapshot.ticker.markPrice ?? snapshot.referencePrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)
    throw new Error(`Нет валидной метки для ${snapshot.marketId}`);
  return new Decimal(price);
}

/** Проводки сделки: FEE отрицательная, PNL с знаком; возвращает новый баланс. */
async function postLedger(
  tx: Prisma.TransactionClient,
  accountId: string,
  balance: D,
  result: ApplyFillResult,
  fillId: string,
): Promise<D> {
  if (result.fee.gt(0))
    await tx.ledgerEntry.create({ data: { accountId, type: 'FEE', amount: result.fee.neg(), refId: fillId } });
  if (!result.realizedPnl.isZero())
    await tx.ledgerEntry.create({ data: { accountId, type: 'PNL', amount: result.realizedPnl, refId: fillId } });
  return balance.plus(result.realizedPnl).minus(result.fee);
}

async function upsertPosition(
  tx: Prisma.TransactionClient,
  accountId: string,
  symbol: string,
  rowId: string | undefined,
  next: PositionState | null,
  price: D,
  maintenanceRatio: number,
): Promise<void> {
  if (!next) {
    if (rowId)
      await tx.position.update({
        where: { id: rowId },
        data: { status: 'CLOSED', currentMarkPrice: price, unrealizedPnl: ZERO },
      });
    return;
  }
  const data = {
    side: next.side,
    quantity: next.quantity,
    entryPrice: next.entryPrice,
    leverage: next.leverage,
    margin: next.margin,
    liquidationPrice: liquidationPrice(next, maintenanceRatio),
  };
  if (rowId) await tx.position.update({ where: { id: rowId }, data });
  else
    await tx.position.create({
      data: { accountId, symbol, status: 'OPEN', currentMarkPrice: price, unrealizedPnl: ZERO, ...data },
    });
}

type Tx = Prisma.TransactionClient;
type AccountWithRelations = Prisma.TradingAccountGetPayload<{
  include: { challenge: true; positions: { where: { status: 'string' } }; orders: { where: { status: 'string'; type: 'string' } } };
}>;

async function processAccount(deps: RiskTickDeps, accountId: string, marks: Map<string, D>): Promise<void> {
  await deps.withAccountLock(accountId, async (tx: Tx) => {
    const account = (await tx.tradingAccount.findUnique({
      where: { id: accountId },
      include: {
        challenge: true,
        positions: { where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } },
        orders: { where: { status: 'OPEN', type: 'LIMIT' }, orderBy: { createdAt: 'asc' } },
      },
    })) as AccountWithRelations | null;
    if (!account || !['ACTIVE', 'RISK_REVIEW'].includes(account.status)) return;

    // Свежее состояние могло принести новые символы — без полной картины счёт не трогаем.
    const needed = new Set<string>([
      ...account.positions.map((p) => p.symbol),
      ...account.orders.map((o) => o.symbol),
    ]);
    for (const symbol of needed) if (!marks.has(symbol)) return;

    let balance = account.currentBalance as D;
    let tradedToday = false;

    const posRows = new Map(account.positions.map((p) => [p.symbol, p]));
    const posState = new Map<string, PositionState>();
    for (const [symbol, row] of posRows)
      posState.set(symbol, {
        side: row.side as Side,
        quantity: row.quantity as D,
        entryPrice: row.entryPrice as D,
        leverage: row.leverage,
        margin: row.margin as D,
      });

    // 1) Лимитки: LONG срабатывает при mark ≤ limit, SHORT при mark ≥ limit.
    const executed = new Set<string>();
    for (const order of account.orders) {
      const mark = marks.get(order.symbol)!;
      if (order.side === 'LONG' ? mark.gt(order.price) : mark.lt(order.price)) continue;
      const result = deps.applyFill(posState.get(order.symbol) ?? null, {
        side: order.side as Side,
        quantity: order.size as D,
        price: order.price as D,
        leverage: order.leverage,
        feeRate: await deps.feeRate(order.symbol),
      });
      // M1 (docs/REVIEW.md): та же проверка маржи, что у API (execution/margin).
      // Пробный филл выводит Σ маржи за equity → ордер CANCELLED с RiskEvent.
      const trial = new Map(posState);
      if (result.position) trial.set(order.symbol, result.position);
      else trial.delete(order.symbol);
      const margin = checkMargin(balance.plus(result.realizedPnl).minus(result.fee), trial, marks);
      if (!margin.ok) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
        await tx.riskEvent.create({
          data: {
            accountId,
            level: 'WARNING',
            ruleName: 'INSUFFICIENT_MARGIN',
            description: `INSUFFICIENT_MARGIN: лимитный ордер отменён при исполнении — требуемая маржа ${margin.marginSum.toFixed(2)} выше equity ${margin.equity.toFixed(2)}`,
          },
        });
        deps.log('warn', 'лимит отменён: маржа выше equity', { accountId, orderId: order.id, symbol: order.symbol });
        continue;
      }
      const fill = await tx.fill.create({
        data: {
          orderId: order.id,
          accountId,
          symbol: order.symbol,
          side: order.side,
          price: order.price,
          quantity: order.size,
          realizedPnl: result.realizedPnl,
          fee: result.fee,
        },
      });
      balance = await postLedger(tx, accountId, balance, result, fill.id);
      await upsertPosition(tx, accountId, order.symbol, posRows.get(order.symbol)?.id, result.position, order.price as D, deps.maintenanceRatio);
      if (result.position) posState.set(order.symbol, result.position);
      else posState.delete(order.symbol);
      await tx.order.update({ where: { id: order.id }, data: { status: 'FILLED' } });
      executed.add(order.id);
      tradedToday = true;
    }

    // 2) Переоценка и решение ядра риска.
    const evaluation = deps.evaluateAccount({
      accountSize: account.accountSize as D,
      balance,
      positions: [...posState].map(([symbol, pos]) => ({ pos, mark: marks.get(symbol)! })),
      dayStartEquity: account.dayStartEquity as D,
      rules: {
        maxDdPct: account.challenge.maxDdPct,
        dailyDdPct: account.challenge.dailyDdPct,
        profitTargetPct: account.challenge.profitTargetPct,
        minTradingDays: account.challenge.minTradingDays,
      },
      tradingDays: account.tradingDaysCount,
      status: account.status,
      maintenanceRatio: deps.maintenanceRatio,
    });

    // 3) Пробой или ликвидация: закрыть все позиции по метке, счёт в FAILED.
    let status = account.status;
    let equity = evaluation.equity;
    if (evaluation.liquidate || evaluation.breach) {
      const reason: string = evaluation.liquidate ? 'LIQUIDATION' : (evaluation.breach as BreachType);
      for (const [symbol, pos] of posState) {
        const mark = marks.get(symbol)!;
        const closeSide: Side = pos.side === 'LONG' ? 'SHORT' : 'LONG';
        const result = deps.applyFill(pos, {
          side: closeSide,
          quantity: pos.quantity,
          price: mark,
          leverage: pos.leverage,
          feeRate: await deps.feeRate(symbol),
        });
        // Fill требует orderId — принудительное закрытие получает синтетический MARKET-ордер
        // с детерминированным idempotencyKey (повтор невозможен: позиция уже CLOSED).
        const closeOrder = await tx.order.create({
          data: {
            accountId,
            symbol,
            side: closeSide,
            type: 'MARKET',
            price: mark,
            size: pos.quantity,
            leverage: pos.leverage,
            status: 'FILLED',
            idempotencyKey: `risk-close:${posRows.get(symbol)?.id ?? symbol}`,
          },
        });
        const fill = await tx.fill.create({
          data: {
            orderId: closeOrder.id,
            accountId,
            symbol,
            side: closeSide,
            price: mark,
            quantity: pos.quantity,
            realizedPnl: result.realizedPnl,
            fee: result.fee,
          },
        });
        balance = await postLedger(tx, accountId, balance, result, fill.id);
        const row = posRows.get(symbol);
        if (row)
          await tx.position.update({
            where: { id: row.id },
            data: { status: 'CLOSED', currentMarkPrice: mark, unrealizedPnl: ZERO },
          });
      }
      posState.clear();
      status = 'FAILED';
      equity = balance;
      await tx.riskEvent.create({
        data: {
          accountId,
          level: 'FAILED',
          ruleName: reason,
          description: `${reason}: equity ${evaluation.equity.toFixed(2)} (static floor ${evaluation.staticFloor.toFixed(2)}, daily floor ${evaluation.dailyFloor.toFixed(2)}); позиции закрыты по метке`,
        },
      });
      const cause = reason === 'DAILY_DD' ? 'daily drawdown breach' : reason === 'STATIC_DD' ? 'max drawdown breach' : 'liquidation';
      await notify(tx, {
        userId: account.userId,
        kind: 'ACCOUNT_FAILED',
        title: 'Account failed',
        body: `Account failed by ${cause}. Equity $${evaluation.equity.toFixed(2)} — all positions were closed at market.`,
        accountId,
      });
      deps.log('warn', 'account failed, positions force-closed', { accountId, reason });
    } else if (evaluation.passed) {
      status = 'PASSED';
      await notify(tx, {
        userId: account.userId,
        kind: 'ACCOUNT_PASSED',
        title: 'Challenge passed!',
        body: 'Profit target reached — your challenge account is PASSED. Request funded activation from the Funded page.',
        accountId,
      });
      deps.log('info', 'account passed', { accountId });
    }

    // §5: после FAILED или PASSED новые позиции не открываются — лимитки отменяем.
    if (status !== account.status) {
      const remaining = account.orders.filter((o) => !executed.has(o.id)).map((o) => o.id);
      if (remaining.length)
        await tx.order.updateMany({ where: { id: { in: remaining } }, data: { status: 'CANCELLED' } });
    }

    // 4) Кэш меток по открытым позициям.
    for (const [symbol, pos] of posState) {
      const row = posRows.get(symbol);
      const mark = marks.get(symbol)!;
      if (row)
        await tx.position.update({
          where: { id: row.id },
          data: { currentMarkPrice: mark, unrealizedPnl: unrealized(pos, mark) },
        });
    }

    const size = account.accountSize as D;
    await tx.tradingAccount.update({
      where: { id: accountId },
      data: {
        currentBalance: balance,
        currentEquity: equity,
        staticMaxDdFloor: evaluation.staticFloor,
        dailyDdFloor: evaluation.dailyFloor,
        ...(status !== account.status ? { status } : {}),
        ...(tradedToday ? { lastTradeDay: utcDayOf(deps.now()) } : {}),
      },
    });

    // 5) Снапшот equity не чаще раза в минуту на счёт.
    const last = lastSnapshotAt.get(accountId);
    if (last === undefined || deps.now() - last >= SNAPSHOT_MIN_INTERVAL_MS) {
      await tx.equitySnapshot.create({
        data: {
          accountId,
          balance,
          equity,
          dayStartEquity: account.dayStartEquity,
          pnlPct: size.isZero() ? 0 : Number(equity.minus(size).div(size).mul(100)),
        },
      });
      lastSnapshotAt.set(accountId, deps.now());
    }
  });
}

/**
 * Один тик риска: для каждого счёта с открытыми позициями или лимитками —
 * метки рынков (одна загрузка на символ), исполнение лимиток, evaluateAccount,
 * ликвидация/FAILED/PASSED, кэш баланса и equity. Ошибка рынка убирает только
 * символ из тика; счёты без полной картины меток не трогаются.
 */
export async function runRiskTick(deps: RiskTickDeps = defaultRiskTickDeps()): Promise<void> {
  const candidates = await deps.db.tradingAccount.findMany({
    where: {
      status: { in: ['ACTIVE', 'RISK_REVIEW'] },
      OR: [
        { positions: { some: { status: 'OPEN' } } },
        { orders: { some: { status: 'OPEN', type: 'LIMIT' } } },
      ],
    },
    select: {
      id: true,
      positions: { where: { status: 'OPEN' }, select: { symbol: true } },
      orders: { where: { status: 'OPEN', type: 'LIMIT' }, select: { symbol: true } },
    },
  });
  if (candidates.length === 0) return;

  const symbols = new Set<string>();
  for (const candidate of candidates)
    for (const row of [...candidate.positions, ...candidate.orders]) symbols.add(row.symbol);

  const marks = new Map<string, D>();
  const markLoads: Promise<void>[] = [];
  for (const symbol of symbols) {
    markLoads.push(
      deps.getMarketSnapshot(symbol).then(
        (snapshot) => {
          marks.set(symbol, snapshotMark(snapshot));
        },
        (error: unknown) => {
          deps.log('warn', 'рынок пропущен: нет метки в этом тике', { symbol, error: String(error) });
        },
      ),
    );
  }
  await Promise.all(markLoads);

  for (const candidate of candidates) {
    const complete = [...candidate.positions, ...candidate.orders].every((row) => marks.has(row.symbol));
    if (!complete) continue;
    try {
      await processAccount(deps, candidate.id, marks);
    } catch (error) {
      deps.log('error', 'тик риска не прошёл для счёта', { accountId: candidate.id, error: String(error) });
    }
  }
}
