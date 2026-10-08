/**
 * Отображение чисел из API: Prisma Decimal приходит в JSON строкой.
 * Number — только для показа в UI, не для денежных расчётов (там Decimal).
 */
export function num(x: unknown): number {
  return typeof x === 'number' ? x : Number(x ?? 0);
}

export const usd = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
