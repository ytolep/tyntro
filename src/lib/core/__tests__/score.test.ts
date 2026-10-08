import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTraderScore, MIN_TRADES_FOR_SCORE, ScoreFill, EquityPoint } from '../score';
import { d } from '../money';

/** Сделка: net = gross (fee 0), если не задано иное. */
function fill(netPnl: string, createdAt: Date): ScoreFill {
  const g = d(netPnl);
  return { netPnl: g, grossPnl: g, fee: d(0), createdAt };
}

function snap(equity: string, timestamp: Date): EquityPoint {
  return { equity: d(equity), timestamp };
}

const DAY = 86_400_000;
// Фиксированные даты: три разных UTC-дня, детерминированный вывод.
const T0 = Date.UTC(2026, 0, 10);

test('computeTraderScore: меньше 5 сделок → null', () => {
  const snaps = [snap('10000', new Date(T0)), snap('10100', new Date(T0 + DAY))];
  for (let n = 0; n < MIN_TRADES_FOR_SCORE; n++) {
    const fills = Array.from({ length: n }, (_, i) => fill('10', new Date(T0 + i)));
    assert.equal(computeTraderScore(fills, snaps), null, `${n} fills`);
  }
});

test('computeTraderScore: смешанный счёт — точные компоненты', () => {
  // 6 сделок: 4 в плюс (100, 80, 60, 90), 2 в минус (-50, -30).
  const fills = [
    fill('100', new Date(T0)),
    fill('-50', new Date(T0)),
    fill('80', new Date(T0 + DAY)),
    fill('60', new Date(T0 + DAY)),
    fill('-30', new Date(T0 + 2 * DAY)),
    fill('90', new Date(T0 + 2 * DAY)),
  ];
  // День 1: два снапшота (внутридневная точка 10020 перезаписывается закрытием 10050),
  // день 2: 10190, день 3: 10250.
  const snaps = [
    snap('10000', new Date(T0)),
    snap('10020', new Date(T0 + 3_600_000)),
    snap('10050', new Date(T0 + 2 * 3_600_000)),
    snap('10190', new Date(T0 + DAY)),
    snap('10250', new Date(T0 + 2 * DAY)),
  ];

  const r = computeTraderScore(fills, snaps);
  assert.ok(r);

  // win rate 4/6 = 66.(6) %
  assert.ok(Math.abs(r.stats.winRatePct - 200 / 3) < 1e-9);
  // PF = 330 / 80 = 4.125 → компонент сатурируется на 100
  assert.ok(Math.abs(r.stats.profitFactor - 4.125) < 1e-9);
  assert.equal(r.profitFactorScore, 100);
  // equity не опускается ниже пика → dd = 0
  assert.equal(r.stats.maxDrawdownPct, 0);
  assert.equal(r.riskManagementScore, 100);
  // дневные pnl: +140, +60; лучший день 140/200 = 70 % → consistency 30
  assert.equal(r.stats.consistencyPct, 30);
  assert.equal(r.consistencyScore, 30);
  // sharpe = mean/σ двух доходностей (140/10050, 60/10190) ≈ 1.7425 → 70
  assert.ok(Math.abs(r.stats.sharpeRatio - 1.7425) < 1e-3);
  assert.equal(r.sharpeScore, 70);
  // edge = 66.67/70*100 ≈ 95.24 → 95 (сделок ≤ 10, бонуса нет)
  assert.equal(r.edgeScore, 95);
  // total = round(100*0.3 + 70*0.25 + 30*0.2 + 100*0.15 + 95*0.1) = round(78)
  assert.equal(r.totalScore, 78);
  assert.equal(r.tier, 'ELITE');
  assert.equal(r.stats.tradeCount, 6);
});

test('computeTraderScore: просадка и лучший день бьют риск и стабильность', () => {
  const fills = [
    fill('50', new Date(T0)),
    fill('-40', new Date(T0 + DAY)),
    fill('70', new Date(T0 + DAY)),
    fill('-60', new Date(T0 + 2 * DAY)),
    fill('80', new Date(T0 + 2 * DAY)),
    fill('90', new Date(T0 + 2 * DAY)),
  ];
  // 10000 → 10050 → 9800 → 10100: dd = 250/10050 ≈ 2.4876 %.
  const snaps = [
    snap('10000', new Date(T0)),
    snap('10050', new Date(T0 + DAY)),
    snap('9800', new Date(T0 + 2 * DAY)),
    snap('10100', new Date(T0 + 3 * DAY)),
  ];

  const r = computeTraderScore(fills, snaps);
  assert.ok(r);
  assert.ok(Math.abs(r.stats.maxDrawdownPct - (250 / 10050) * 100) < 1e-9);
  // 100 − 2.4876×12 ≈ 70.15 → 70
  assert.equal(r.riskManagementScore, 70);
  // дневные pnl: +50, −250, +300; лучший 300/350 ≈ 85.71 % → 14.29 → 14
  assert.equal(r.stats.consistencyPct, 100 - (300 / 350) * 100);
  assert.equal(r.consistencyScore, 14);
});

test('computeTraderScore: без убыточных сделок PF ограничен, компонент 100', () => {
  const fills = Array.from({ length: 5 }, (_, i) => fill('40', new Date(T0 + i * 3_600_000)));
  const snaps = [
    snap('10200', new Date(T0)),
    snap('10200', new Date(T0 + DAY)),
    snap('10200', new Date(T0 + 2 * DAY)),
  ];
  const r = computeTraderScore(fills, snaps);
  assert.ok(r);
  assert.equal(r.stats.profitFactor, 200); // min(grossWin=200, 999)
  assert.equal(r.profitFactorScore, 100);
  // равные дневные закрытия: σ = 0 → sharpe 0; прибыли по дням нет → consistency 0
  assert.equal(r.stats.sharpeRatio, 0);
  assert.equal(r.sharpeScore, 0);
  assert.equal(r.consistencyScore, 0);
  // edge = 100/70*100 + 15 > 100 → clamp 100
  assert.equal(r.edgeScore, 100);
  // total = round(100*0.3 + 0 + 0 + 100*0.15 + 100*0.1) = 55
  assert.equal(r.totalScore, 55);
  assert.equal(r.tier, 'NOVICE');
});

test('computeTraderScore: один день снапшотов → sharpe 0, dd считается по точкам', () => {
  const fills = Array.from({ length: 5 }, (_, i) => fill(i % 2 ? '-20' : '30', new Date(T0 + i * 3_600_000)));
  // один день, equity внутри дня падала с 10000 до 9900 и закрылась 10050
  const snaps = [
    snap('10000', new Date(T0)),
    snap('9900', new Date(T0 + 3_600_000)),
    snap('10050', new Date(T0 + 2 * 3_600_000)),
  ];
  const r = computeTraderScore(fills, snaps);
  assert.ok(r);
  assert.equal(r.stats.sharpeRatio, 0); // меньше двух дневных закрытий
  assert.ok(Math.abs(r.stats.maxDrawdownPct - 1) < 1e-9); // 100/10000
  assert.equal(r.riskManagementScore, 88); // 100 − 12
  assert.equal(r.stats.consistencyPct, 0); // нет перехода день→день
});

test('computeTraderScore: только убытки — всё зажато в 0, но оценка считается', () => {
  const fills = Array.from({ length: 5 }, (_, i) => fill('-25', new Date(T0 + i * 3_600_000)));
  const snaps = [
    snap('10000', new Date(T0)),
    snap('9900', new Date(T0 + DAY)),
    snap('9800', new Date(T0 + 2 * DAY)),
  ];
  const r = computeTraderScore(fills, snaps);
  assert.ok(r);
  assert.equal(r.stats.winRatePct, 0);
  assert.equal(r.stats.profitFactor, 0);
  assert.equal(r.stats.consistencyPct, 0);
  assert.equal(r.edgeScore, 0);
  assert.equal(r.profitFactorScore, 0);
  assert.equal(r.sharpeScore, 0); // отрицательный sharpe клампится
  assert.ok(r.totalScore > 0 && r.totalScore <= 100);
  assert.equal(r.tier, 'NOVICE');
});

test('computeTraderScore: комиссии учитываются — gross без комиссии, net с комиссией', () => {
  // В БД realizedPnl хранится без комиссии (core/position.ts); net = realizedPnl − fee.
  const winner: ScoreFill = { netPnl: d('95'), grossPnl: d('100'), fee: d('5'), createdAt: new Date(T0) };
  const losers = Array.from({ length: 4 }, (_, i) => ({
    netPnl: d('-52'),
    grossPnl: d('-50'),
    fee: d('2'),
    createdAt: new Date(T0 + i),
  }));
  const snaps = [
    snap('10000', new Date(T0)),
    snap('10100', new Date(T0 + DAY)),
  ];
  const r = computeTraderScore([winner, ...losers], snaps);
  assert.ok(r);
  // grossWin = 100, grossLoss = 4×50 = 200 → PF = 0.5 (profit factor до комиссий)
  assert.ok(Math.abs(r.stats.profitFactor - 0.5) < 1e-9);
  // победитель по net (95 > 0) — один из пяти
  assert.equal(r.stats.winRatePct, 20);
});
