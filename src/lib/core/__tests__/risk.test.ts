import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccount, EvaluateAccountInput, RiskRules } from '../risk';
import { d } from '../money';

const RULES: RiskRules = { maxDdPct: 6, dailyDdPct: 3, profitTargetPct: 10, minTradingDays: 5 };

/** Счёт без позиций: equity = balance, floors по правилам. */
function input(overrides: Partial<EvaluateAccountInput> = {}): EvaluateAccountInput {
  return {
    accountSize: d('10000'),
    balance: d('10000'),
    positions: [],
    dayStartEquity: d('10000'),
    rules: RULES,
    tradingDays: 10,
    status: 'ACTIVE',
    maintenanceRatio: 0.5,
    ...overrides,
  };
}

test('evaluateAccount: floors и equity без позиций', () => {
  const r = evaluateAccount(input());
  assert.equal(r.equity.toString(), '10000');
  assert.equal(r.staticFloor.toString(), '9400'); // 10000*(1-6/100)
  assert.equal(r.dailyFloor.toString(), '9700'); // 10000*(1-3/100)
  assert.equal(r.breach, null);
  assert.equal(r.liquidate, false);
  assert.equal(r.riskLevel, 'SAFE');
});

test('evaluateAccount: equity ровно на staticFloor = breach STATIC_DD', () => {
  const r = evaluateAccount(input({ balance: d('9400') }));
  assert.equal(r.equity.toString(), '9400');
  assert.equal(r.breach, 'STATIC_DD');
  assert.equal(r.riskLevel, 'FAILED');
  assert.equal(r.liquidate, false);
  assert.equal(r.passed, false);
});

test('evaluateAccount: на цент выше staticFloor — breach нет, но HIGH_RISK', () => {
  // dayStart = equity, чтобы дневной floor (× 0.97) был ниже equity и не маскировал проверку
  const r = evaluateAccount(input({ balance: d('9400.01'), dayStartEquity: d('9400.01') }));
  assert.equal(r.breach, null);
  assert.equal(r.riskLevel, 'HIGH_RISK'); // статическая дистанция 0.0001 % < 1 %
});

test('evaluateAccount: equity ровно на dailyFloor = breach DAILY_DD', () => {
  // dailyDd = 4 %, dayStart = 9900 → dailyFloor = 9504 ровно; статический floor 9400 ниже
  const rules = { ...RULES, dailyDdPct: 4 };
  const r = evaluateAccount(input({ balance: d('9504'), dayStartEquity: d('9900'), rules }));
  assert.equal(r.dailyFloor.toString(), '9504');
  assert.equal(r.equity.toString(), '9504');
  assert.equal(r.breach, 'DAILY_DD');
  assert.equal(r.riskLevel, 'FAILED');
});

test('evaluateAccount: equity выше dailyFloor — breach нет', () => {
  const r = evaluateAccount(input({ balance: d('9700.01') }));
  assert.equal(r.breach, null);
  assert.equal(r.riskLevel, 'HIGH_RISK'); // дневная дистанция 0.0001 % < 0.5 %
});

test('evaluateAccount: staticFloor приоритетнее dailyFloor', () => {
  // equity = 9400 <= staticFloor 9400 и <= dailyFloor 9700 → STATIC_DD
  const r = evaluateAccount(input({ balance: d('9400') }));
  assert.equal(r.breach, 'STATIC_DD');
});

function longPos(quantity: string, entry: string, mark: string, leverage = 10) {
  const q = d(quantity);
  return {
    pos: { side: 'LONG' as const, quantity: q, entryPrice: d(entry), leverage, margin: q.mul(d(entry)).div(leverage) },
    mark: d(mark),
  };
}

test('evaluateAccount: equity = balance + Σ unrealized', () => {
  const r = evaluateAccount(
    input({ balance: d('10000'), positions: [longPos('2', '100', '125'), longPos('1', '50', '40')] }),
  );
  // 2*(125-100) + 1*(40-50) = 50 - 10 = 40
  assert.equal(r.equity.toString(), '10040');
});

test('evaluateAccount: ликвидация при equity < Σ margin × maintenanceRatio', () => {
  // позиция 10 @ 100, leverage 10 → requiredMargin = 100; порог = 50
  const positions = [longPos('10', '100', '100', 10)];
  const below = evaluateAccount(input({ balance: d('49.99'), positions }));
  assert.equal(below.liquidate, true);
  assert.equal(below.breach, 'LIQUIDATION');
  assert.equal(below.riskLevel, 'FAILED');

  // ровно на пороге: strict <, liquidate = false (но equity ниже floors → STATIC_DD breach)
  const exact = evaluateAccount(input({ balance: d('50'), positions }));
  assert.equal(exact.liquidate, false);
  assert.equal(exact.breach, 'STATIC_DD');

  const above = evaluateAccount(input({ balance: d('50.01'), positions }));
  assert.equal(above.liquidate, false);
});

test('evaluateAccount: liquidate = false без позиций даже при отрицательном equity', () => {
  const r = evaluateAccount(input({ balance: d('-100') }));
  assert.equal(r.liquidate, false);
  assert.equal(r.breach, 'STATIC_DD');
});

test('evaluateAccount: passed — все условия', () => {
  const r = evaluateAccount(input({ balance: d('11000') }));
  assert.equal(r.passed, true);
  assert.equal(r.riskLevel, 'SAFE');
});

test('evaluateAccount: не passed, пока есть позиции', () => {
  const r = evaluateAccount(
    input({ balance: d('11000'), positions: [longPos('1', '100', '100')] }),
  );
  assert.equal(r.passed, false);
});

test('evaluateAccount: не passed при нехватке торговых дней', () => {
  const r = evaluateAccount(input({ balance: d('11000'), tradingDays: 4 }));
  assert.equal(r.passed, false);
});

test('evaluateAccount: не passed при статусе не ACTIVE', () => {
  assert.equal(evaluateAccount(input({ balance: d('11000'), status: 'PASSED' })).passed, false);
  assert.equal(evaluateAccount(input({ balance: d('11000'), status: 'FAILED' })).passed, false);
  assert.equal(evaluateAccount(input({ balance: d('11000'), status: 'FAILED' })).riskLevel, 'FAILED');
});

test('evaluateAccount: passed при equity ровно на цели', () => {
  const r = evaluateAccount(input({ balance: d('11000.00') }));
  assert.equal(r.passed, true);
  assert.equal(r.targetProgressPct, 100);
});

test('evaluateAccount: не passed при equity на цент ниже цели', () => {
  const r = evaluateAccount(input({ balance: d('10999.99') }));
  assert.equal(r.passed, false);
  assert.ok(r.targetProgressPct > 99.9 && r.targetProgressPct < 100);
});

test('evaluateAccount: riskLevel WARNING по статической дистанции', () => {
  // staticDist = (9500-9400)/10000 = 1.0 % (не < 1.0), dailyDist = 3 % → WARNING
  const r = evaluateAccount(input({ balance: d('9500'), dayStartEquity: d('9500') }));
  assert.equal(r.breach, null);
  assert.equal(r.riskLevel, 'WARNING');
});

test('evaluateAccount: riskLevel WARNING по дневной дистанции', () => {
  // staticDist = 4 %, dailyDist = (9760-9700)/10000 = 0.6 % → WARNING
  const r = evaluateAccount(input({ balance: d('9760') }));
  assert.equal(r.riskLevel, 'WARNING');
});

test('evaluateAccount: riskLevel SAFE при дистанциях выше порогов', () => {
  // staticDist = 4.5 %, dailyDist = 1.5 % (не < 1.5) → SAFE
  const r = evaluateAccount(input({ balance: d('9850') }));
  assert.equal(r.riskLevel, 'SAFE');
});

test('evaluateAccount: targetProgressPct может быть отрицательным и выше 100', () => {
  const neg = evaluateAccount(input({ balance: d('9500') }));
  assert.equal(neg.targetProgressPct, -50); // (9500-10000)/1000*100
  const over = evaluateAccount(input({ balance: d('12000') }));
  assert.equal(over.targetProgressPct, 200);
});

test('evaluateAccount: profitTargetPct = 0 не даёт NaN', () => {
  const r = evaluateAccount(input({ rules: { ...RULES, profitTargetPct: 0 }, balance: d('10000') }));
  assert.equal(r.passed, true); // equity = accountSize = target
  assert.ok(Number.isFinite(r.targetProgressPct));
  const belowTarget = evaluateAccount(
    input({ rules: { ...RULES, profitTargetPct: 0 }, balance: d('9999') }),
  );
  assert.equal(belowTarget.targetProgressPct, 0);
  assert.equal(belowTarget.passed, false);
});
