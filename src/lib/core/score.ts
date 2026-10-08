import { D } from './money';

/** Сделка для скоринга: реальные исполнения счёта. */
export interface ScoreFill {
  /** PnL сделки за вычетом комиссии; положительный — прибыльный. */
  netPnl: D;
  /** Прибыль до вычета комиссий (для profit factor). */
  grossPnl: D;
  fee: D;
  createdAt: Date;
}

/** Точка кривой equity счёта. */
export interface EquityPoint {
  equity: D;
  timestamp: Date;
}

export type ScoreTier = 'NOVICE' | 'PRO' | 'ELITE' | 'APEX_MASTER';

/** Сырые метрики, из которых собраны компоненты score. */
export interface ScoreStats {
  tradeCount: number;
  winRatePct: number;
  profitFactor: number; // без убыточных сделок ограничен 999
  sharpeRatio: number; // среднее/σ дневных доходностей, без аннуализации
  maxDrawdownPct: number;
  consistencyPct: number;
}

export interface ScoreBreakdown {
  totalScore: number; // 0 - 100
  riskManagementScore: number; // 30% weight
  sharpeScore: number; // 25% weight
  consistencyScore: number; // 20% weight
  profitFactorScore: number; // 15% weight
  edgeScore: number; // 10% weight
  tier: ScoreTier;
  stats: ScoreStats;
}

/** Минимум сделок для оценки; ниже — null («недостаточно данных»). */
export const MIN_TRADES_FOR_SCORE = 5;

/** Строка Fill из БД → вход скоринга: realizedPnl в БД без комиссии, net = realizedPnl − fee. */
export function scoreFillFromRow(row: { realizedPnl: D; fee: D; createdAt: Date }): ScoreFill {
  return {
    netPnl: row.realizedPnl.minus(row.fee),
    grossPnl: row.realizedPnl,
    fee: row.fee,
    createdAt: row.createdAt,
  };
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

/** Закрытие UTC-дня: последняя equity каждого дня по времени. */
function dailyCloses(points: EquityPoint[]): number[] {
  const byDay = new Map<string, number>();
  const sorted = [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const p of sorted) byDay.set(p.timestamp.toISOString().slice(0, 10), Number(p.equity));
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => e);
}

/** Sharpe дневных доходностей: mean/σ (sample σ); < 2 дней или σ = 0 → 0. */
function sharpeOf(closes: number[]): number {
  if (closes.length < 2) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1 || 1);
  const std = Math.sqrt(variance);
  if (std < 1e-12) return 0;
  return mean / std;
}

/** Максимальная просадка кривой equity, % от пика. */
function maxDrawdownPctOf(points: EquityPoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  const sorted = [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const p of sorted) {
    const e = Number(p.equity);
    if (e > peak) peak = e;
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - e) / peak) * 100);
  }
  return maxDd;
}

/** Стабильность: 100 − доля лучшего дня в суммарной прибыли, 0..100; без прибыльных дней → 0. */
function consistencyOf(closes: number[]): number {
  let totalProfit = 0;
  let best = 0;
  for (let i = 1; i < closes.length; i++) {
    const pnl = closes[i] - closes[i - 1];
    if (pnl > 0) {
      totalProfit += pnl;
      if (pnl > best) best = pnl;
    }
  }
  if (totalProfit <= 0) return 0;
  return clamp(100 - (best / totalProfit) * 100);
}

/**
 * Trader Score из реальных сделок и снапшотов equity, без вымышленных чисел.
 * Веса и формулы компонентов — как в прототипе traderScore.ts:
 * риск 30 %, шарп 25 %, стабильность 20 %, profit factor 15 %, edge (win rate) 10 %.
 * Меньше MIN_TRADES_FOR_SCORE сделок → null: недостаточно данных.
 */
export function computeTraderScore(fills: ScoreFill[], equitySnapshots: EquityPoint[]): ScoreBreakdown | null {
  const tradeCount = fills.length;
  if (tradeCount < MIN_TRADES_FOR_SCORE) return null;

  let netWins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  for (const f of fills) {
    if (f.netPnl.gt(0)) netWins++;
    const g = Number(f.grossPnl);
    if (g > 0) grossWin += g;
    else grossLoss -= g;
  }

  const winRatePct = (netWins / tradeCount) * 100;
  // Без убыточных сделок PF бесконечен; 999 достаточно — score всё равно сатурируется на 100.
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Math.min(grossWin, 999);

  const closes = dailyCloses(equitySnapshots);
  const sharpeRatio = sharpeOf(closes);
  const maxDrawdownPct = maxDrawdownPctOf(equitySnapshots);
  const consistencyPct = consistencyOf(closes);

  // Формулы прототипа traderScore.ts.
  const riskManagementScore = Math.round(clamp(100 - maxDrawdownPct * 12));
  const sharpeScore = Math.round(clamp((sharpeRatio / 2.5) * 100));
  const consistencyScore = Math.round(clamp(consistencyPct));
  const profitFactorScore = Math.round(clamp((profitFactor / 2.5) * 100));
  const edgeScore = Math.round(clamp((winRatePct / 70) * 100 + (tradeCount > 10 ? 15 : 0)));

  const totalScore = Math.round(
    riskManagementScore * 0.3 +
      sharpeScore * 0.25 +
      consistencyScore * 0.2 +
      profitFactorScore * 0.15 +
      edgeScore * 0.1,
  );

  let tier: ScoreTier = 'NOVICE';
  if (totalScore >= 90) tier = 'APEX_MASTER';
  else if (totalScore >= 75) tier = 'ELITE';
  else if (totalScore >= 60) tier = 'PRO';

  return {
    totalScore,
    riskManagementScore,
    sharpeScore,
    consistencyScore,
    profitFactorScore,
    edgeScore,
    tier,
    stats: { tradeCount, winRatePct, profitFactor, sharpeRatio, maxDrawdownPct, consistencyPct },
  };
}
