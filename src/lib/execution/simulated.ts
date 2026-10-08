import type { Prisma, TradingAccount } from '@prisma/client';
import { db } from '../db';
import { withAccountLock } from '../db/lock';
import type { AuthUser } from '../auth';
import { d, D, roundDownToStep } from '../core/money';
import { applyFill } from '../core/position';
import type { PositionState, Side } from '../core/position';
import { evaluateAccount } from '../core/risk';
import type { RiskEvaluation } from '../core/risk';
import { resolveMarket } from '../marketData/catalog';
import { getMarketSnapshot, MarketDataError } from '../marketData/server';
import { takerFeeOf } from '../marketData/markets';
import type { Market, MarketSnapshot } from '../marketData/types';
import { assertSimulationAction, ExecutionError, executionPolicy } from './policy';
import { checkMargin, requireMark } from './margin';

/**
 * Симулированное исполнение на ядре core/* (план §2): тонкий слой
 * «валидация → цены с сервера → withAccountLock → applyFill → записи».
 * Лимитки исполняет воркер (riskTick), браузер их больше не триггерит.
 *
 * Инварианты §5: баланс = сумма проводок (FEE/PNL в LedgerEntry), повтор
 * команды с тем же idempotencyKey не создаёт второй ордер, после
 * FAILED/PASSED новые позиции не открываются.
 */

/** Доля поддерживающей маржи — та же, что в воркере (riskTick). */
export const MAINTENANCE_RATIO = 0.5;

const ZERO = d(0);

export type OrderRequestBody = Record<string, unknown>;
export type SimulatedOrderResult = Record<string, unknown>;

export interface SimulatedOrderDeps {
  resolveMarket: (symbol: string) => Promise<Market | undefined>;
  getMarketSnapshot: (symbol: string) => Promise<MarketSnapshot>;
  /** epoch ms — дата торгового дня (lastTradeDay). */
  now: () => number;
}

export function defaultSimulatedOrderDeps(): SimulatedOrderDeps {
  return { resolveMarket, getMarketSnapshot, now: () => Date.now() };
}

/** Валидная метка с сервера; браузерные цены никогда не используются. */
export function snapshotMark(snapshot: MarketSnapshot): D {
  const price = snapshot.ticker.markPrice ?? snapshot.referencePrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)
    throw new MarketDataError(`No valid mark price for ${snapshot.marketId}`);
  return d(price);
}

/**
 * Исполняет команду от имени пользователя на его счёте.
 * Ошибки — ExecutionError (status/code) или MarketDataError (503).
 */
export async function executeSimulatedOrder(
  user: AuthUser,
  account: TradingAccount,
  body: OrderRequestBody,
  deps: SimulatedOrderDeps = defaultSimulatedOrderDeps(),
): Promise<SimulatedOrderResult> {
  // Авторизация — только строка в БД, поля тела не имеют силы.
  if (account.userId !== user.id) throw new ExecutionError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
  // Реальный FUNDED закрыт от симуляции (политика режимов; план §5).
  if (executionPolicy(account).mode === 'FUNDED')
    throw new ExecutionError(
      'FUNDED_EXECUTION_UNAVAILABLE',
      'Funded execution awaits a dedicated Phoenix account; simulated orders are disabled.',
      503,
    );
  const action = typeof body.action === 'string' ? body.action : '';
  // Лимитки исполняет воркер: действие из браузера больше не принимается.
  if (action === 'CHECK_LIMIT_ORDERS')
    throw new ExecutionError('CHECK_LIMIT_ORDERS_REMOVED', 'Limit orders are executed by the server worker', 400);
  assertSimulationAction(account, action);

  if (action === 'OPEN_POSITION') return openPosition(account, body, deps);
  if (action === 'CLOSE_POSITION') return closePosition(account, body, deps);
  if (action === 'CANCEL_ORDER') return cancelOrder(account, body);
  throw new ExecutionError('INVALID_ACTION', 'Invalid action', 400);
}

// ---- OPEN_POSITION ----

async function openPosition(
  account: TradingAccount,
  body: OrderRequestBody,
  deps: SimulatedOrderDeps,
): Promise<SimulatedOrderResult> {
  const idempotencyKey = strField(body.idempotencyKey);
  if (!idempotencyKey)
    throw new ExecutionError('IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required for OPEN_POSITION', 400);

  // Рынок — только из каталога Phoenix: perp и active.
  const symbolInput = typeof body.symbol === 'string' ? body.symbol.toUpperCase() : '';
  const market = await deps.resolveMarket(symbolInput);
  if (!market || market.type !== 'perp')
    throw new ExecutionError('MARKET_NOT_SUPPORTED', 'Only supported perpetual instruments can be traded in this simulation', 400);
  if (market.status !== 'active')
    throw new ExecutionError('MARKET_NOT_ACTIVE', 'Phoenix market is not active', 409);

  const side: Side | null = body.side === 'LONG' || body.side === 'SHORT' ? body.side : null;
  const orderMode = body.orderMode === 'Market' || body.orderMode === 'Limit' ? body.orderMode : null;
  if (!side || !orderMode)
    throw new ExecutionError('INVALID_ORDER_PARAMS', 'Invalid order parameters', 400);

  const sizeUsd = positiveNumber(body.sizeUsd);
  if (sizeUsd === null)
    throw new ExecutionError('INVALID_ORDER_PARAMS', 'sizeUsd must be a positive number', 400);

  const leverage = positiveNumber(body.leverage);
  const maxLeverage = Math.min(5, market.maxLeverage ?? 5);
  if (leverage === null || leverage < 1 || leverage > maxLeverage)
    throw new ExecutionError('INVALID_ORDER_PARAMS', `Leverage must be between 1 and ${maxLeverage}`, 400);

  const mark = snapshotMark(await deps.getMarketSnapshot(market.symbol));

  // Лимит, пересекающий рынок, — тейкер-филл по метке; стоячий лимит исполнит
  // воркер по своей цене, поэтому количество считается от неё.
  let crosses = true;
  let limitPrice: D | null = null;
  if (orderMode === 'Limit') {
    const lp = positiveNumber(body.limitPrice);
    if (lp === null) throw new ExecutionError('INVALID_LIMIT_PRICE', 'Invalid limit price', 400);
    limitPrice = d(lp);
    crosses = side === 'LONG' ? limitPrice.gte(mark) : limitPrice.lte(mark);
  }
  const refPrice = limitPrice !== null && !crosses ? limitPrice : mark;
  const lot = typeof market.lotSize === 'number' && market.lotSize > 0 ? d(market.lotSize) : null;
  const quantity = lot !== null ? roundDownToStep(d(sizeUsd).div(refPrice), lot) : d(sizeUsd).div(refPrice);
  if (quantity.lte(0))
    throw new ExecutionError('ORDER_TOO_SMALL', 'Order size is below one lot of the market', 400);

  const feeRate = d(takerFeeOf(market));

  return withAccountLock(account.id, async (tx) => {
    const replay = await replayIfDuplicate(tx, account.id, idempotencyKey);
    if (replay) return replay;

    const acc = await loadAccount(tx, account.id);
    assertSimulationAction(acc, 'OPEN_POSITION');

    // Стоячий лимит: только ордер OPEN, исполнит воркер.
    if (!crosses && limitPrice !== null) {
      const order = await tx.order.create({
        data: {
          accountId: acc.id, symbol: market.symbol, side, type: 'LIMIT',
          price: limitPrice, size: quantity, leverage, status: 'OPEN', idempotencyKey,
        },
      });
      return {
        success: true, status: 'PENDING_LIMIT_ORDER', order: orderJson(order),
        message: `Limit order placed at $${limitPrice.toString()}. Pending market trigger.`,
      };
    }

    // M3 (docs/REVIEW.md): метки читаем ПОСЛЕ лока по свежим позициям счёта —
    // между предзагрузкой и локом воркер мог открыть/закрыть другой символ.
    const marks = await marksForAccount(acc.positions.map((p) => p.symbol), market.symbol, mark, deps);

    return fillAndSettle(tx, acc, {
      symbol: market.symbol, side, quantity, price: mark, leverage, feeRate,
    }, {
      type: orderMode === 'Limit' ? 'LIMIT' : 'MARKET',
      idempotencyKey, checkMargin: true,
      message: `Filled ${side} ${market.symbol} @ $${mark.toString()}.`,
    }, marks, deps.now);
  });
}

// ---- CLOSE_POSITION ----

async function closePosition(
  account: TradingAccount,
  body: OrderRequestBody,
  deps: SimulatedOrderDeps,
): Promise<SimulatedOrderResult> {
  const positionId = strField(body.positionId);
  if (!positionId) throw new ExecutionError('POSITION_ID_REQUIRED', 'positionId is required', 400);

  const pos = await db.position.findUnique({ where: { id: positionId } });
  if (!pos) throw new ExecutionError('POSITION_NOT_FOUND', 'Position not found', 404);
  if (pos.accountId !== account.id || pos.status !== 'OPEN')
    throw new ExecutionError('POSITION_NOT_OPEN', 'Position is not open on this account', 409);

  const market = await deps.resolveMarket(pos.symbol);
  if (!market || market.type !== 'perp')
    throw new ExecutionError('MARKET_NOT_SUPPORTED', 'Position instrument is not supported for execution', 400);

  const mark = snapshotMark(await deps.getMarketSnapshot(market.symbol));
  const feeRate = d(takerFeeOf(market));
  const idempotencyKey = strField(body.idempotencyKey) ?? undefined;

  return withAccountLock(account.id, async (tx) => {
    if (idempotencyKey) {
      const replay = await replayIfDuplicate(tx, account.id, idempotencyKey);
      if (replay) return replay;
    }
    const acc = await loadAccount(tx, account.id);
    assertSimulationAction(acc, 'CLOSE_POSITION');

    // Свежее состояние под блокировкой: позицию мог закрыть воркер.
    const fresh = await tx.position.findUnique({ where: { id: positionId } });
    if (!fresh || fresh.accountId !== account.id || fresh.status !== 'OPEN')
      throw new ExecutionError('POSITION_NOT_OPEN', 'Position is not open on this account', 409);
    // M3 (docs/REVIEW.md): метки — по свежим позициям ПОСЛЕ лока.
    const marks = await marksForAccount(acc.positions.map((p) => p.symbol), fresh.symbol, mark, deps);

    const closeSide: Side = fresh.side === 'LONG' ? 'SHORT' : 'LONG';
    return fillAndSettle(tx, acc, {
      symbol: fresh.symbol, side: closeSide, quantity: fresh.quantity as D,
      price: mark, leverage: fresh.leverage, feeRate,
    }, {
      type: 'MARKET', idempotencyKey, checkMargin: false,
      message: `Position closed for ${fresh.symbol}`,
    }, marks, deps.now);
  });
}

// ---- CANCEL_ORDER ----

async function cancelOrder(account: TradingAccount, body: OrderRequestBody): Promise<SimulatedOrderResult> {
  const orderId = strField(body.orderId);
  if (!orderId) throw new ExecutionError('ORDER_ID_REQUIRED', 'orderId is required', 400);

  return withAccountLock(account.id, async (tx) => {
    // updateMany с guard по accountId: чужой ордер неотличим от несуществующего.
    const res = await tx.order.updateMany({
      where: { id: orderId, accountId: account.id, status: 'OPEN' },
      data: { status: 'CANCELLED' },
    });
    if (res.count === 0)
      throw new ExecutionError('ORDER_NOT_FOUND', 'Open order not found on this account', 404);
    return { success: true, message: 'Order cancelled successfully' };
  });
}

// ---- Общий путь исполнения ----

type AccountWithBook = Prisma.TradingAccountGetPayload<{
  include: { challenge: true; positions: { where: { status: string } } };
}>;

interface FillCommand {
  symbol: string;
  side: Side;
  quantity: D;
  price: D;
  leverage: number;
  feeRate: D;
}

interface FillMeta {
  type: string;
  idempotencyKey?: string;
  /** Проверка Σ margin ≤ equity — только для открытия/наращивания. */
  checkMargin: boolean;
  message: string;
}

/**
 * Один исполненный объём под блокировкой счёта: Order + Fill + проводки
 * FEE/PNL + upsert позиции + кэш баланса/equity + evaluateAccount + смена
 * статуса (PASSED; пустой пробой — FAILED; пробой с позициями закроет воркер).
 */
async function fillAndSettle(
  tx: Prisma.TransactionClient,
  acc: AccountWithBook,
  cmd: FillCommand,
  meta: FillMeta,
  marks: Map<string, D>,
  now: () => number,
): Promise<SimulatedOrderResult> {
  const rows = new Map(acc.positions.map((p) => [p.symbol, p]));
  const states = new Map<string, PositionState>();
  for (const row of acc.positions)
    states.set(row.symbol, {
      side: row.side as Side, quantity: row.quantity as D, entryPrice: row.entryPrice as D,
      leverage: row.leverage, margin: row.margin as D,
    });

  const result = applyFill(states.get(cmd.symbol) ?? null, {
    side: cmd.side, quantity: cmd.quantity, price: cmd.price, leverage: cmd.leverage, feeRate: cmd.feeRate,
  });
  if (result.position) states.set(cmd.symbol, result.position);
  else states.delete(cmd.symbol);

  let balance = (acc.currentBalance as D).plus(result.realizedPnl).minus(result.fee);

  if (meta.checkMargin) {
    // M1/L2 (docs/REVIEW.md): общая с воркером проверка — Σ маржи по текущим меткам не выше equity.
    const margin = checkMargin(balance, states, marks);
    if (!margin.ok)
      throw new ExecutionError(
        'INSUFFICIENT_MARGIN',
        `Required margin $${margin.marginSum.toFixed(2)} exceeds equity $${margin.equity.toFixed(2)}`,
        409,
      );
  }

  const order = await tx.order.create({
    data: {
      accountId: acc.id, symbol: cmd.symbol, side: cmd.side, type: meta.type,
      price: cmd.price, size: cmd.quantity, leverage: cmd.leverage, status: 'FILLED',
      ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
    },
  });
  const fill = await tx.fill.create({
    data: {
      orderId: order.id, accountId: acc.id, symbol: cmd.symbol, side: cmd.side,
      price: cmd.price, quantity: cmd.quantity, realizedPnl: result.realizedPnl, fee: result.fee,
    },
  });
  if (result.fee.gt(ZERO))
    await tx.ledgerEntry.create({ data: { accountId: acc.id, type: 'FEE', amount: result.fee.neg(), refId: fill.id } });
  if (!result.realizedPnl.isZero())
    await tx.ledgerEntry.create({ data: { accountId: acc.id, type: 'PNL', amount: result.realizedPnl, refId: fill.id } });

  const row = rows.get(cmd.symbol);
  if (result.position) {
    const data = {
      side: result.position.side, quantity: result.position.quantity, entryPrice: result.position.entryPrice,
      leverage: result.position.leverage, margin: result.position.margin,
      liquidationPrice: liquidationPrice(result.position, MAINTENANCE_RATIO),
      currentMarkPrice: cmd.price, unrealizedPnl: ZERO,
    };
    if (row) await tx.position.update({ where: { id: row.id }, data });
    else await tx.position.create({ data: { accountId: acc.id, symbol: cmd.symbol, status: 'OPEN', ...data } });
  } else if (row) {
    await tx.position.update({
      where: { id: row.id },
      data: { status: 'CLOSED', currentMarkPrice: cmd.price, unrealizedPnl: ZERO },
    });
  }

  const evaluation = evaluateAccount({
    accountSize: acc.accountSize as D,
    balance,
    positions: [...states].map(([symbol, pos]) => ({ pos, mark: requireMark(marks, symbol) })),
    dayStartEquity: acc.dayStartEquity as D,
    rules: {
      maxDdPct: acc.challenge.maxDdPct, dailyDdPct: acc.challenge.dailyDdPct,
      profitTargetPct: acc.challenge.profitTargetPct, minTradingDays: acc.challenge.minTradingDays,
    },
    tradingDays: acc.tradingDaysCount,
    status: acc.status,
    maintenanceRatio: MAINTENANCE_RATIO,
  });

  let status = acc.status;
  if (evaluation.passed) status = 'PASSED';
  // Пробой без открытых позиций воркер уже не увидит (нет кандидатов) — FAILED здесь.
  // Пробой с позициями оставляем ACTIVE: воркер закроет их по метке в пределах секунды.
  else if ((evaluation.breach !== null || evaluation.liquidate) && states.size === 0) status = 'FAILED';

  await tx.tradingAccount.update({
    where: { id: acc.id },
    data: {
      currentBalance: balance,
      currentEquity: evaluation.equity,
      staticMaxDdFloor: evaluation.staticFloor,
      dailyDdFloor: evaluation.dailyFloor,
      lastTradeDay: utcDayOf(now()),
      totalTrades: { increment: 1 },
      // win/loss — по закрытию части позиции, чистым PnL за вычетом комиссии (как прототип).
      ...(result.closedQuantity.gt(0)
        ? result.realizedPnl.minus(result.fee).gt(0)
          ? { winCount: { increment: 1 } }
          : { lossCount: { increment: 1 } }
        : {}),
      ...(status !== acc.status ? { status } : {}),
    },
  });

  // §5 + L1 (docs/REVIEW.md): после PASSED/FAILED новые позиции не открываются —
  // отменяем открытые лимитки при любой смене статуса, тем же путём, что и воркер.
  if (status !== acc.status)
    await tx.order.updateMany({ where: { accountId: acc.id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
  if (status === 'FAILED')
    await tx.riskEvent.create({
      data: {
        accountId: acc.id, level: 'FAILED', ruleName: evaluation.breach ?? 'LIQUIDATION',
        description: `${evaluation.breach ?? 'LIQUIDATION'} at order settlement: equity ${evaluation.equity.toFixed(2)} (static floor ${evaluation.staticFloor.toFixed(2)}, daily floor ${evaluation.dailyFloor.toFixed(2)}); no positions left open`,
      },
    });

  const position = result.position
    ? await tx.position.findFirst({ where: { accountId: acc.id, symbol: cmd.symbol, status: 'OPEN' } })
    : null;

  return {
    success: true, status: 'FILLED',
    order: orderJson(order), position: position ? positionJson(position) : null,
    realizedPnl: result.realizedPnl.toString(), fee: result.fee.toString(),
    message: meta.message, riskEval: riskJson(evaluation),
  };
}

// ---- Хелперы ----

async function loadAccount(tx: Prisma.TransactionClient, accountId: string): Promise<AccountWithBook> {
  const acc = await tx.tradingAccount.findUnique({
    where: { id: accountId },
    include: { challenge: true, positions: { where: { status: 'OPEN' } } },
  });
  if (!acc) throw new ExecutionError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
  return acc as AccountWithBook;
}

/**
 * Метки открытых позиций счёта. Вызывается ПОСЛЕ захвата лока по свежим
 * позициям (M3, docs/REVIEW.md): между предзагрузкой и локом воркер мог
 * открыть/закрыть символ — requireMark больше не падает 503.
 */
async function marksForAccount(
  positionSymbols: string[],
  tradedSymbol: string,
  tradedMark: D,
  deps: SimulatedOrderDeps,
): Promise<Map<string, D>> {
  const marks = new Map<string, D>([[tradedSymbol, tradedMark]]);
  const symbols = [...new Set(positionSymbols)].filter((s) => s !== tradedSymbol);
  const loads = symbols.map((symbol) =>
    deps.getMarketSnapshot(symbol).then((snapshot) => marks.set(symbol, snapshotMark(snapshot))),
  );
  await Promise.all(loads);
  return marks;
}

/** Повтор команды с тем же ключом: исходный ордер, новых записей нет. */
async function replayIfDuplicate(
  tx: Prisma.TransactionClient,
  accountId: string,
  idempotencyKey: string,
): Promise<SimulatedOrderResult | null> {
  const existing = await tx.order.findUnique({ where: { idempotencyKey } });
  if (!existing) return null;
  if (existing.accountId !== accountId)
    throw new ExecutionError('IDEMPOTENCY_KEY_CONFLICT', 'idempotencyKey is already used by another account', 409);
  if (existing.status === 'OPEN')
    return { success: true, status: 'PENDING_LIMIT_ORDER', order: orderJson(existing), message: 'Limit order is pending market trigger.', duplicate: true };
  const fill = await tx.fill.findFirst({ where: { orderId: existing.id } });
  const position = await tx.position.findFirst({ where: { accountId, symbol: existing.symbol, status: 'OPEN' } });
  return {
    success: true, status: 'FILLED', order: orderJson(existing),
    position: position ? positionJson(position) : null,
    realizedPnl: fill ? (fill.realizedPnl as D).toString() : '0',
    fee: fill ? (fill.fee as D).toString() : '0',
    message: 'Duplicate command ignored; original order returned.', duplicate: true,
  };
}

/** Оценка цены ликвидации позиции: entry ∓ margin×ratio/quantity (как воркер). */
function liquidationPrice(pos: PositionState, ratio: number): D {
  const shift = pos.quantity.isZero() ? ZERO : pos.margin.mul(ratio).div(pos.quantity);
  return pos.side === 'LONG' ? pos.entryPrice.minus(shift) : pos.entryPrice.plus(shift);
}

function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function strField(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 && x.length <= 200 ? x : null;
}

function positiveNumber(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Decimal всегда сериализуется строкой (план: деньги не number).
type OrderRow = { id: string; symbol: string; side: string; type: string; price: D; size: D; leverage: number; status: string; createdAt: Date };
function orderJson(o: OrderRow) {
  return { id: o.id, symbol: o.symbol, side: o.side, type: o.type, price: o.price.toString(), size: o.size.toString(), leverage: o.leverage, status: o.status, createdAt: o.createdAt.toISOString() };
}

type PositionRow = { id: string; symbol: string; side: string; entryPrice: D; currentMarkPrice: D; quantity: D; margin: D; leverage: number; liquidationPrice: D; unrealizedPnl: D; status: string };
function positionJson(p: PositionRow) {
  return {
    id: p.id, symbol: p.symbol, side: p.side,
    entryPrice: p.entryPrice.toString(), currentMarkPrice: p.currentMarkPrice.toString(),
    quantity: p.quantity.toString(), margin: p.margin.toString(), leverage: p.leverage,
    liquidationPrice: p.liquidationPrice.toString(), unrealizedPnl: p.unrealizedPnl.toString(), status: p.status,
  };
}

function riskJson(e: RiskEvaluation) {
  return {
    equity: e.equity.toString(), staticFloor: e.staticFloor.toString(), dailyFloor: e.dailyFloor.toString(),
    liquidate: e.liquidate, breach: e.breach, passed: e.passed, riskLevel: e.riskLevel,
    targetProgressPct: e.targetProgressPct,
  };
}
