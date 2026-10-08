import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d, roundDownToStep, roundToStep } from '../money';
import { Decimal } from '@prisma/client/runtime/library';

test('d: строит Decimal из number, строки и Decimal', () => {
  assert.equal(d(1.5).toString(), '1.5');
  assert.equal(d('0.00000012').toFixed(), '0.00000012');
  assert.equal(d(d('7')).toString(), '7');
  assert.ok(d('7') instanceof Decimal);
});

test('d: выбрасывает на нечисловом вводе', () => {
  assert.throws(() => d(NaN));
  assert.throws(() => d(Infinity));
  assert.throws(() => d(-Infinity));
  assert.throws(() => d('abc'));
  assert.throws(() => d(''));
});

test('roundDownToStep: округляет вниз к шагу', () => {
  assert.equal(roundDownToStep(d('10.7'), d('0.5')).toString(), '10.5');
  assert.equal(roundDownToStep(d('10.999'), d('1')).toString(), '10');
  assert.equal(roundDownToStep(d('0.3'), d('0.1')).toString(), '0.3');
  assert.equal(roundDownToStep(d('0.29'), d('0.1')).toString(), '0.2');
  assert.equal(roundDownToStep(d('10'), d('0.001')).toString(), '10');
  assert.equal(roundDownToStep(d('0'), d('0.01')).toString(), '0');
});

test('roundDownToStep: выбрасывает на нулевом или отрицательном шаге', () => {
  assert.throws(() => roundDownToStep(d('1'), d('0')));
  assert.throws(() => roundDownToStep(d('1'), d('-0.1')));
});

test('roundToStep: округляет к ближайшему шагу half-up', () => {
  assert.equal(roundToStep(d('10.7'), d('0.5')).toString(), '10.5');
  assert.equal(roundToStep(d('10.75'), d('0.5')).toString(), '11');
  assert.equal(roundToStep(d('10.24'), d('0.1')).toString(), '10.2');
  assert.equal(roundToStep(d('10.25'), d('0.1')).toString(), '10.3');
  assert.equal(roundToStep(d('10.26'), d('0.1')).toString(), '10.3');
  assert.equal(roundToStep(d('0.05'), d('0.1')).toString(), '0.1');
});

test('roundToStep: выбрасывает на нулевом или отрицательном шаге', () => {
  assert.throws(() => roundToStep(d('1'), d('0')));
  assert.throws(() => roundToStep(d('1'), d('-1')));
});
