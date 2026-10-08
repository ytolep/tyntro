import { D } from './money';
import { PositionState } from './position';

export type RiskLevel = 'SAFE' | 'WARNING' | 'HIGH_RISK' | 'FAILED';
export type BreachType = 'STATIC_DD' | 'DAILY_DD' | 'LIQUIDATION';

export interface RiskPositionInput {
  pos: PositionState;
  /** Текущая метка рынка для переоценки позиции. */
  mark: D;
}

export interface RiskRules {
  /** Статическая просадка, % от accountSize. */
  maxDdPct: number;
  /** Дневная просадка, % от dayStartEquity. */
  dailyDdPct: number;
  /** Цель прибыли, % от accountSize. */
  profitTargetPct: number;
  minTradingDays: number;
}

export interface EvaluateAccountInput {
  accountSize: D;
  /** Реализованный баланс (сумма проводок). */
  balance: D;
  positions: RiskPositionInput[];
  dayStartEquity: D;
  rules: RiskRules;
  /** Число завершённых торговых дней. */
  tradingDays: number;
  /** Текущий статус счёта: ACTIVE | PASSED | FAILED | RISK_REVIEW | ... */
  status: string;
  /** Доля поддерживающей маржи (например 0.5): ликвидация при equity < Σ margin × ratio. */
  maintenanceRatio: number;
}

export interface RiskEvaluation {
  /** equity = balance + Σ unrealizedPnL. */
  equity: D;
  /** staticFloor = accountSize × (1 − maxDdPct/100). */
  staticFloor: D;
  /** dailyFloor = dayStartEquity × (1 − dailyDdPct/100). */
  dailyFloor: D;
  /** equity ниже поддерживающей маржи — позиции закрывать немедленно. */
  liquidate: boolean;
  breach: BreachType | null;
  /** Счёт прошёл челлендж: equity ≥ цели, торговых дней достаточно, позиций нет. */
  passed: boolean;
  riskLevel: RiskLevel;
  /** Прогресс к цели прибыли, % (может быть отрицательным). */
  targetProgressPct: number;
}

/**
 * Чистая функция риска: переоценка счёта по всем позициям, floors по equity,
 * ликвидация и PASSED. Правила сравниваются с хэшем rulesHash, зафиксированным
 * при покупке (проверка хэша — обязанность вызывающего).
 */
export function evaluateAccount(input: EvaluateAccountInput): RiskEvaluation {
  void input; // контракт волны 0; реализация — волна 1 (агент A)
  throw new Error('not implemented');
}
