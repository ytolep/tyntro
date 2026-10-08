import { D } from './money';

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
  void pos; void fill; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}

/** unrealizedPnL = quantity × (mark − entry) × (side==='LONG' ? 1 : −1). */
export function unrealizedPnl(pos: PositionState, mark: D): D {
  void pos; void mark; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}

/** notional = quantity × mark. */
export function notional(pos: PositionState, mark: D): D {
  void pos; void mark; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}

/** requiredMargin = notional / leverage. */
export function requiredMargin(pos: PositionState, mark: D): D {
  void pos; void mark; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}
