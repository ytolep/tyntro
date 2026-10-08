import { d, D } from '../core/money';
import { requiredMargin, unrealizedPnl } from '../core/position';
import type { PositionState } from '../core/position';
import { MarketDataError } from '../marketData/server';

/** Результат проверки маржи: суммы — для сообщений об отказе. */
export interface MarginCheck {
  ok: boolean;
  /** Σ requiredMargin(pos, mark) по текущим меткам. */
  marginSum: D;
  /** balance + Σ unrealizedPnl по текущим меткам. */
  equity: D;
}

/** Метка символа или 503: без полной картины меток счёт не трогаем. */
export function requireMark(marks: Map<string, D>, symbol: string): D {
  const mark = marks.get(symbol);
  if (mark === undefined)
    throw new MarketDataError(`No mark price for ${symbol}; refusing to settle without full picture`);
  return mark;
}

/**
 * Общая проверка маржи для рыночных ордеров API и лимиток воркера
 * (docs/REVIEW.md M1): Σ requiredMargin(pos, mark) ≤ equity.
 * Маржа позиций — по текущей метке, а не по цене входа (docs/REVIEW.md L2).
 */
export function checkMargin(
  balance: D,
  positions: Map<string, PositionState>,
  marks: Map<string, D>,
): MarginCheck {
  let marginSum = d(0);
  let equity = balance;
  for (const [symbol, pos] of positions) {
    const mark = requireMark(marks, symbol);
    marginSum = marginSum.plus(requiredMargin(pos, mark));
    equity = equity.plus(unrealizedPnl(pos, mark));
  }
  return { ok: !marginSum.gt(equity), marginSum, equity };
}
