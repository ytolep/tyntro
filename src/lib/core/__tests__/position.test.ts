import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFill, notional, requiredMargin, unrealizedPnl, FillInput, PositionState, Side } from '../position';
import { d, D, roundDownToStep, roundToStep } from '../money';

const FEE_RATE = d('0.001');

function fill(side: Side, quantity: string, price: string, leverage = 1, feeRate: D = FEE_RATE): FillInput {
  return { side, quantity: d(quantity), price: d(price), leverage, feeRate };
}

test('applyFill: открытие — quantity в базовом активе, margin = notional/leverage', () => {
  const r = applyFill(null, fill('LONG', '2', '50', 5));
  assert.equal(r.position?.side, 'LONG');
  assert.equal(r.position?.quantity.toString(), '2');
  assert.equal(r.position?.entryPrice.toString(), '50');
  assert.equal(r.position?.leverage, 5);
  assert.equal(r.position?.margin.toString(), '20'); // 2*50/5
  assert.equal(r.realizedPnl.toString(), '0');
  assert.equal(r.closedQuantity.toString(), '0');
});

test('applyFill: комиссия = |fillQty| × price × feeRate', () => {
  const r = applyFill(null, fill('SHORT', '1.5', '100', 1, d('0.00075')));
  assert.equal(r.fee.toString(), '0.1125'); // 1.5*100*0.00075
});

test('applyFill: наращивание — средневзвешенная цена входа, margin пересчитывается', () => {
  let r = applyFill(null, fill('LONG', '1', '100', 2));
  r = applyFill(r.position, fill('LONG', '1', '120', 2));
  assert.equal(r.position?.quantity.toString(), '2');
  assert.equal(r.position?.entryPrice.toString(), '110'); // (1*100+1*120)/2
  assert.equal(r.position?.margin.toString(), '120'); // 2*120/2
  assert.equal(r.realizedPnl.toString(), '0');
  assert.equal(r.closedQuantity.toString(), '0');
});

test('applyFill: частичное закрытие — PnL пропорционален закрытому количеству', () => {
  let pos = applyFill(null, fill('LONG', '2', '100', 2)).position!;
  const r = applyFill(pos, fill('SHORT', '0.5', '130', 2));
  assert.equal(r.realizedPnl.toString(), '15'); // 0.5*(130-100)
  assert.equal(r.closedQuantity.toString(), '0.5');
  assert.equal(r.position?.quantity.toString(), '1.5');
  assert.equal(r.position?.entryPrice.toString(), '100'); // entry не меняется
  assert.equal(r.position?.margin.toString(), '75'); // 100 × (1.5/2)
  assert.equal(r.position?.side, 'LONG');
});

test('applyFill: полное закрытие — PnL = q*(exit-entry) без плеча, position = null', () => {
  let pos = applyFill(null, fill('LONG', '3', '100', 20)).position!;
  const r = applyFill(pos, fill('SHORT', '3', '110', 20));
  assert.equal(r.position, null);
  assert.equal(r.realizedPnl.toString(), '30'); // 3*(110-100), плечо не участвует
  assert.equal(r.closedQuantity.toString(), '3');
});

test('applyFill: шорт — симметричные знаки', () => {
  let pos = applyFill(null, fill('SHORT', '1', '100', 1)).position!;
  assert.equal(unrealizedPnl(pos, d('90')).toString(), '10');
  assert.equal(unrealizedPnl(pos, d('110')).toString(), '-10');
  const r = applyFill(pos, fill('LONG', '1', '90', 1));
  assert.equal(r.position, null);
  assert.equal(r.realizedPnl.toString(), '10'); // 1*(90-100)*(-1)
});

test('applyFill: флип — закрыть всё с PnL, остаток открыть по цене fill', () => {
  let pos = applyFill(null, fill('LONG', '1', '100', 2)).position!;
  const r = applyFill(pos, fill('SHORT', '3', '110', 4));
  assert.equal(r.realizedPnl.toString(), '10'); // 1*(110-100)
  assert.equal(r.closedQuantity.toString(), '1');
  assert.equal(r.position?.side, 'SHORT');
  assert.equal(r.position?.quantity.toString(), '2');
  assert.equal(r.position?.entryPrice.toString(), '110');
  assert.equal(r.position?.leverage, 4);
  assert.equal(r.position?.margin.toString(), '55'); // 2*110/4
});

test('applyFill: флип в лонг из шорта', () => {
  let pos = applyFill(null, fill('SHORT', '2', '50', 1)).position!;
  const r = applyFill(pos, fill('LONG', '5', '60', 1));
  assert.equal(r.realizedPnl.toString(), '-20'); // 2*(60-50)*(-1)
  assert.equal(r.position?.side, 'LONG');
  assert.equal(r.position?.quantity.toString(), '3');
  assert.equal(r.position?.entryPrice.toString(), '60');
});

test('applyFill: плечо не влияет на PnL, только на margin', () => {
  const low = applyFill(null, fill('LONG', '1', '100', 1));
  const high = applyFill(null, fill('LONG', '1', '100', 100));
  assert.equal(low.realizedPnl.toString(), high.realizedPnl.toString());
  assert.equal(unrealizedPnl(low.position!, d('150')).toString(), '50');
  assert.equal(unrealizedPnl(high.position!, d('150')).toString(), '50');
  assert.equal(low.position!.margin.toString(), '100');
  assert.equal(high.position!.margin.toString(), '1');
});

test('applyFill: валидация входа', () => {
  assert.throws(() => applyFill(null, fill('LONG', '0', '100')));
  assert.throws(() => applyFill(null, fill('LONG', '-1', '100')));
  assert.throws(() => applyFill(null, fill('LONG', '1', '0')));
  assert.throws(() => applyFill(null, fill('LONG', '1', '-5')));
  assert.throws(() => applyFill(null, fill('LONG', '1', '100', 0)));
  assert.throws(() => applyFill(null, fill('LONG', '1', '100', -2)));
  assert.throws(() => applyFill(null, fill('LONG', '1', '100', 1, d('-0.001'))));
});

test('unrealizedPnl / notional / requiredMargin', () => {
  const pos: PositionState = { side: 'LONG', quantity: d('2'), entryPrice: d('100'), leverage: 4, margin: d('50') };
  assert.equal(unrealizedPnl(pos, d('125')).toString(), '50');
  assert.equal(notional(pos, d('125')).toString(), '250');
  assert.equal(requiredMargin(pos, d('125')).toString(), '62.5');
});

// ---------------------------------------------------------------------------
// 10 000 случайных последовательностей fill по одному рынку (seeded PRNG).
// Инварианты §5: сумма realized + unrealized при mark = последняя цена равна
// cash-flow оценке: signedPos × mark − Σ signedQty × price (комиссии отдельно).
// ---------------------------------------------------------------------------

/** mulberry32 — детерминированный PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TICK = d('0.01');
const LOT = d('0.001');
const LEVERAGES = [1, 2, 5, 10, 20];

function approxEq(a: D, b: D, tolerance = '1e-8'): boolean {
  return a.sub(b).abs().lte(d(tolerance));
}

test('инвариант: 10 000 случайных последовательностей сделок на одном рынке', () => {
  const rnd = mulberry32(20261008);
  let sequences = 0;
  let fillsChecked = 0;
  let fullCloses = 0;
  let partialCloses = 0;
  let flips = 0;
  while (sequences < 10000) {
    sequences++;
    const length = 1 + Math.floor(rnd() * 15);
    let pos: PositionState | null = null;
    let price = d('100');
    let realizedTotal = d(0);
    let cashFlow = d(0); // Σ signedQty × price, LONG = +
    let lastPrice = price;

    for (let i = 0; i < length; i++) {
      // случайное блуждание цены ±2 %, тик 0.01
      const drift = d((1 + (rnd() * 0.04 - 0.02)).toFixed(6));
      price = roundToStep(price.mul(drift), TICK);
      if (price.lte(0)) price = TICK;
      lastPrice = price;

      const side: Side = rnd() < 0.5 ? 'LONG' : 'SHORT';
      // с шансом 15 % — точное закрытие позиции, чтобы инвариант полного закрытия покрывался стабильно
      const quantity =
        pos !== null && rnd() < 0.15
          ? pos.quantity
          : roundDownToStep(d((0.001 + rnd() * 5).toFixed(6)), LOT);
      if (quantity.lte(0)) continue;
      const leverage = LEVERAGES[Math.floor(rnd() * LEVERAGES.length)]!;

      const f: FillInput = { side, quantity, price, leverage, feeRate: FEE_RATE };
      const result = applyFill(pos, f);
      fillsChecked++;

      // комиссия каждой сделки по формуле
      assert.ok(
        result.fee.eq(quantity.mul(price).mul(FEE_RATE)),
        `fee mismatch at seq ${sequences} fill ${i}`,
      );

      const sign = side === 'LONG' ? 1 : -1;
      cashFlow = cashFlow.add(quantity.mul(price).mul(sign));

      if (pos !== null && pos.side !== side) {
        // закрытие/флип: PnL закрытой части = closedQty × (fill − entry) × sign(pos), без плеча
        const posSign = pos.side === 'LONG' ? 1 : -1;
        const closedQty = pos.quantity.lt(quantity) ? pos.quantity : quantity;
        assert.ok(
          result.realizedPnl.eq(closedQty.mul(price.sub(pos.entryPrice)).mul(posSign)),
          `close pnl mismatch at seq ${sequences} fill ${i}`,
        );
        if (result.position === null) {
          fullCloses++;
          // полное закрытие: PnL = q*(exit-entry) без плеча
          assert.equal(result.closedQuantity.toString(), pos.quantity.toString());
        } else if (result.position.side === pos.side) {
          partialCloses++;
          // частичное закрытие: пропорциональный PnL и margin, entry не меняется
          assert.ok(result.closedQuantity.eq(quantity), `closed qty at seq ${sequences} fill ${i}`);
          assert.ok(result.realizedPnl.eq(quantity.mul(price.sub(pos.entryPrice)).mul(posSign)));
          assert.ok(approxEq(result.position.margin, pos.margin.mul(pos.quantity.sub(quantity)).div(pos.quantity)));
          assert.ok(result.position.entryPrice.eq(pos.entryPrice));
        } else {
          flips++;
          // флип: закрыто всё с PnL, остаток по цене fill
          assert.ok(result.closedQuantity.eq(pos.quantity));
          assert.ok(result.realizedPnl.eq(pos.quantity.mul(price.sub(pos.entryPrice)).mul(posSign)));
          assert.ok(result.position.entryPrice.eq(price));
          assert.ok(result.position.quantity.eq(quantity.sub(pos.quantity)));
          assert.ok(result.position.margin.eq(quantity.sub(pos.quantity).mul(price).div(leverage)));
        }
      } else if (pos !== null) {
        // наращивание: средневзвешенный entry и margin по цене сделки
        const newQty = pos.quantity.add(quantity);
        assert.ok(approxEq(result.position!.entryPrice, pos.quantity.mul(pos.entryPrice).add(quantity.mul(price)).div(newQty)));
        assert.ok(result.position!.margin.eq(newQty.mul(price).div(leverage)));
        assert.ok(result.realizedPnl.eq(d(0)));
      } else {
        // открытие
        assert.ok(result.position!.entryPrice.eq(price));
        assert.ok(result.position!.margin.eq(quantity.mul(price).div(leverage)));
      }

      pos = result.position;
      realizedTotal = realizedTotal.add(result.realizedPnl);
    }

    // Инвариант: realized Σ + unrealized(mark = последняя цена) == signedPos*mark − cashFlow
    const unreal = pos === null ? d(0) : unrealizedPnl(pos, lastPrice);
    const signedPos = pos === null ? d(0) : pos.quantity.mul(pos.side === 'LONG' ? 1 : -1);
    const expected = signedPos.mul(lastPrice).sub(cashFlow);
    const total = realizedTotal.add(unreal);
    assert.ok(
      approxEq(total, expected, '1e-6'),
      `cash-flow invariant broken: seq ${sequences}, total ${total.toString()}, expected ${expected.toString()}`,
    );
  }

  // покрытие: гарантировать, что генератор реально прошёл все ветки
  assert.ok(fullCloses > 0 && partialCloses > 0 && flips > 0);
  // статистика для отладки при падении
  console.log(
    `random fills: ${fillsChecked} (full closes ${fullCloses}, partial ${partialCloses}, flips ${flips})`,
  );
});
