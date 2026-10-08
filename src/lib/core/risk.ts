import { d, D } from './money';
import { PositionState, requiredMargin, unrealizedPnl } from './position';

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
 *
 * riskLevel — пороги прототипа riskEngine.ts: HIGH_RISK при дневной дистанции
 * < 0.5 % или статической < 1.0 %, WARNING при < 1.5 % / < 2.5 %, иначе SAFE.
 */
export function evaluateAccount(input: EvaluateAccountInput): RiskEvaluation {
  const equity = input.positions.reduce(
    (acc, p) => acc.add(unrealizedPnl(p.pos, p.mark)),
    input.balance,
  );
  const staticFloor = input.accountSize.mul(d(100).sub(d(input.rules.maxDdPct))).div(100);
  const dailyFloor = input.dayStartEquity.mul(d(100).sub(d(input.rules.dailyDdPct))).div(100);

  const maintenanceMargin = input.positions.reduce(
    (acc, p) => acc.add(requiredMargin(p.pos, p.mark)),
    d(0),
  );
  const liquidate = input.positions.length > 0 && equity.lt(maintenanceMargin.mul(input.maintenanceRatio));

  // Пробой floor: equity <= floor (ровно на floor — уже пробой).
  let breach: BreachType | null = null;
  if (liquidate) breach = 'LIQUIDATION';
  else if (equity.lte(staticFloor)) breach = 'STATIC_DD';
  else if (equity.lte(dailyFloor)) breach = 'DAILY_DD';

  const target = input.accountSize.mul(d(100).add(d(input.rules.profitTargetPct))).div(100);
  const passed =
    input.status === 'ACTIVE' &&
    equity.gte(target) &&
    input.positions.length === 0 &&
    input.tradingDays >= input.rules.minTradingDays;

  let riskLevel: RiskLevel = 'SAFE';
  if (breach !== null || input.status === 'FAILED') {
    riskLevel = 'FAILED';
  } else {
    const staticDistancePct = Number(equity.sub(staticFloor).div(input.accountSize).mul(100));
    const dailyDistancePct = Number(equity.sub(dailyFloor).div(input.dayStartEquity).mul(100));
    if (dailyDistancePct < 0.5 || staticDistancePct < 1.0) riskLevel = 'HIGH_RISK';
    else if (dailyDistancePct < 1.5 || staticDistancePct < 2.5) riskLevel = 'WARNING';
  }

  const gain = target.sub(input.accountSize);
  const targetProgressPct = gain.isZero()
    ? (equity.gte(target) ? 100 : 0)
    : Number(equity.sub(input.accountSize).div(gain).mul(100));

  return {
    equity,
    staticFloor,
    dailyFloor,
    liquidate,
    breach,
    passed,
    riskLevel,
    targetProgressPct,
  };
}
