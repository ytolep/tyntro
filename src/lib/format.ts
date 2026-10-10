/**
 * Форматирование сумм для UI (ошибка D4: разделители разрядов).
 * Суммы из API приходят строками Decimal — строка передаётся в Intl.NumberFormat
 * как есть (без Number()), поэтому точность не теряется на больших значениях.
 * (as `${number}`) — только для типов: либа TS знает строковый вход лишь как литерал,
 * в рантайме Intl.NumberFormat.format принимает любые числовые строки.
 */
export function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return '—';
  }
  const s = String(value).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(s as `${number}`);
}
