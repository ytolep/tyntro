import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd } from '../format';

test('formatUsd: разделители разрядов и 2 знака', () => {
  assert.equal(formatUsd(100000), '$100,000.00');
  assert.equal(formatUsd('1234.5'), '$1,234.50');
  assert.equal(formatUsd('0'), '$0.00');
  assert.equal(formatUsd('-9876.5'), '-$9,876.50');
});

test('formatUsd: null/undefined/нечисло → «—»', () => {
  assert.equal(formatUsd(null), '—');
  assert.equal(formatUsd(undefined), '—');
  assert.equal(formatUsd(''), '—');
  assert.equal(formatUsd('abc'), '—');
  assert.equal(formatUsd(Number.NaN), '—');
});

test('formatUsd: Decimal-строка без потери точности', () => {
  assert.equal(formatUsd('12345678901234567.89'), '$12,345,678,901,234,567.89');
});
