import { test } from 'node:test';
import assert from 'node:assert/strict';
// D3: стадия счёта для UI определяется phase (FUNDED_SIM), а не mode/status —
// у funded-счёта после approve mode = 'CHALLENGE' (исполнение симулятором).
import { stageLabel } from '../AccountModeNotice';

test('phase FUNDED_SIM с mode CHALLENGE — это funded-стадия', () => {
  assert.equal(stageLabel({ phase: 'FUNDED_SIM', mode: 'CHALLENGE', status: 'ACTIVE' }), 'FUNDED');
});

test('phase CHALLENGE — челлендж, даже если status PASSED', () => {
  assert.equal(stageLabel({ phase: 'CHALLENGE', mode: 'CHALLENGE', status: 'ACTIVE' }), 'CHALLENGE');
  assert.equal(stageLabel({ phase: 'CHALLENGE', mode: 'CHALLENGE', status: 'PASSED' }), 'CHALLENGE');
});

test('легаси mode/status FUNDED остаётся funded', () => {
  assert.equal(stageLabel({ mode: 'FUNDED', status: 'ACTIVE' }), 'FUNDED');
  assert.equal(stageLabel({ mode: 'CHALLENGE', status: 'FUNDED' }), 'FUNDED');
});

test('без phase (старый ответ API) челлендж-счёт остаётся челленджем', () => {
  assert.equal(stageLabel({ mode: 'CHALLENGE', status: 'ACTIVE' }), 'CHALLENGE');
  assert.equal(stageLabel({}), 'CHALLENGE');
});
