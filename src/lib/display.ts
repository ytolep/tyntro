import { formatUsd } from './format';

/**
 * Отображение чисел из API: Prisma Decimal приходит в JSON строкой.
 * Number — только для показа в UI, не для денежных расчётов (там Decimal).
 */
export function num(x: unknown): number {
  return typeof x === 'number' ? x : Number(x ?? 0);
}

/** Единственный форматтер сумм — formatUsd: Decimal-строки из API без потери точности. */
export const usd = (value: string | number) => formatUsd(value);

/** Кошелёк в таблицах: сокращение, полный адрес — в title (используется admin-страницами). */
export const shortWallet = (wallet?: string | null) =>
  wallet && wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : (wallet ?? '');
