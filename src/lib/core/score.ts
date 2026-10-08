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

export interface ScoreBreakdown {
  totalScore: number; // 0 - 100
  riskManagementScore: number; // 30% weight
  sharpeScore: number; // 25% weight
  consistencyScore: number; // 20% weight
  profitFactorScore: number; // 15% weight
  edgeScore: number; // 10% weight
  tier: ScoreTier;
}

/**
 * Trader Score из реальных сделок и снапшотов equity, без вымышленных чисел.
 * Веса компонентов: риск 30 %, шарп 25 %, стабильность 20 %, profit factor 15 %, edge 10 %.
 */
export function computeTraderScore(fills: ScoreFill[], equitySnapshots: EquityPoint[]): ScoreBreakdown {
  void fills; void equitySnapshots; // контракт волны 0; реализация — волны 1–2 (H)
  throw new Error('not implemented');
}
