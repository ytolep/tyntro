import { d, D } from './money';

export type Side = 'LONG' | 'SHORT';

/** Позиция в чистом виде: без БД, без id — только деньги. */
export interface PositionState {
  side: Side;
  /** Количество в базовом активе (quantity = sizeUsd / fillPrice), не в USD. */
  quantity: D;
  entryPrice: D;
  /** Плечо определяет только требуемую маржу, на PnL не влияет. */
  leverage: number;
  /** margin = notional / leverage на момент последнего изменения позиции. */
  margin: D;
}

/** Один исполненный объём по цене; feeRate — taker-fee рынка (доля, не процент). */
export interface FillInput {
  side: Side;
  quantity: D;
  price: D;
  leverage: number;
  feeRate: D;
}

export interface ApplyFillResult {
  /** Позиция после сделки; null — закрыта полностью. */
  position: PositionState | null;
  /** Реализованный PnL закрытой части (без комиссии). */
  realizedPnl: D;
  /** Комиссия сделки: notional_fill × feeRate. */
  fee: D;
  /** Сколько базового актива старой позиции закрыла сделка (0 при открытии/наращивании). */
  closedQuantity: D;
}

/**
 * Единая точка исполнения: открытие, наращивание, сокращение, флип и закрытие.
 * Инварианты (§5 плана):
 * - realizedPnl = closedQuantity × (fillPrice − entryPrice) × (side==='LONG' ? 1 : −1), без плеча;
 * - флип закрывает старую позицию с PnL и открывает новую в противоположную сторону;
 * - частичное закрытие зачисляет пропорциональный PnL;
 * - сокращение уменьшает и quantity, и margin пропорционально.
 */
export function applyFill(pos: PositionState | null, fill: FillInput): ApplyFillResult {
  if (fill.quantity.lte(0)) throw new Error(`fill.quantity must be > 0, got ${fill.quantity.toString()}`);
  if (fill.price.lte(0)) throw new Error(`fill.price must be > 0, got ${fill.price.toString()}`);
  if (!Number.isFinite(fill.leverage) || fill.leverage < 1) {
    throw new Error(`fill.leverage must be >= 1, got ${fill.leverage}`);
  }
  if (fill.feeRate.lt(0)) throw new Error(`fill.feeRate must be >= 0, got ${fill.feeRate.toString()}`);

  const fee = fill.quantity.mul(fill.price).mul(fill.feeRate);

  // Открытие или наращивание в ту же сторону: средневзвешенная цена входа, margin по цене сделки.
  if (pos === null || pos.side === fill.side) {
    const oldQuantity = pos === null ? d(0) : pos.quantity;
    const oldNotional = pos === null ? d(0) : pos.quantity.mul(pos.entryPrice);
    const quantity = oldQuantity.add(fill.quantity);
    const entryPrice = oldNotional.add(fill.quantity.mul(fill.price)).div(quantity);
    return {
      position: {
        side: fill.side,
        quantity,
        entryPrice,
        leverage: fill.leverage,
        margin: quantity.mul(fill.price).div(fill.leverage),
      },
      realizedPnl: d(0),
      fee,
      closedQuantity: d(0),
    };
  }

  // Противоположная сторона: сокращение, полное закрытие или флип.
  const sign = pos.side === 'LONG' ? 1 : -1;
  const closedQuantity = pos.quantity.lt(fill.quantity) ? pos.quantity : fill.quantity;
  const realizedPnl = closedQuantity.mul(fill.price.sub(pos.entryPrice)).mul(sign);

  if (pos.quantity.eq(fill.quantity)) {
    // Полное закрытие.
    return { position: null, realizedPnl, fee, closedQuantity };
  }

  if (pos.quantity.gt(fill.quantity)) {
    // Частичное закрытие: PnL пропорционален закрытому количеству, entry не меняется,
    // margin сокращается пропорционально (инвариант §5).
    const remaining = pos.quantity.sub(fill.quantity);
    return {
      position: {
        side: pos.side,
        quantity: remaining,
        entryPrice: pos.entryPrice,
        leverage: pos.leverage,
        margin: pos.margin.mul(remaining).div(pos.quantity),
      },
      realizedPnl,
      fee,
      closedQuantity,
    };
  }

  // Флип: старая позиция закрывается целиком с PnL, остаток объёма открывает новую по цене сделки.
  const flippedQuantity = fill.quantity.sub(pos.quantity);
  return {
    position: {
      side: fill.side,
      quantity: flippedQuantity,
      entryPrice: fill.price,
      leverage: fill.leverage,
      margin: flippedQuantity.mul(fill.price).div(fill.leverage),
    },
    realizedPnl,
    fee,
    closedQuantity,
  };
}

/** unrealizedPnL = quantity × (mark − entry) × (side==='LONG' ? 1 : −1). */
export function unrealizedPnl(pos: PositionState, mark: D): D {
  return pos.quantity.mul(mark.sub(pos.entryPrice)).mul(pos.side === 'LONG' ? 1 : -1);
}

/** notional = quantity × mark. */
export function notional(pos: PositionState, mark: D): D {
  return pos.quantity.mul(mark);
}

/** requiredMargin = notional / leverage. */
export function requiredMargin(pos: PositionState, mark: D): D {
  return notional(pos, mark).div(pos.leverage);
}
