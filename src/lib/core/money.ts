import { Decimal } from '@prisma/client/runtime/library';

/**
 * Деньги, цены и количества — только Decimal (decimal.js, тот же экземпляр, что у Prisma-клиента;
 * в Prisma 5.10 он экспортируется из runtime/library, `Prisma.Decimal` из плана — это он же).
 * number допустим только для процентов, рейтингов и счётчиков.
 */
export type D = Decimal;

/** Строит Decimal из числа, строки или Decimal; выбрасывает ошибку на нечисловом вводе. */
export function d(x: number | string | D): D {
  void x; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}

/**
 * Округляет значение вниз к шагу (tick или lot): floor(value / step) * step.
 * Для размеров позиции, чтобы не превысить лимит маржи.
 */
export function roundDownToStep(value: D, step: D): D {
  void value; void step; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}

/** Округляет значение к ближайшему шагу (half-up к шагу рынка). Для предельных цен. */
export function roundToStep(value: D, step: D): D {
  void value; void step; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}
