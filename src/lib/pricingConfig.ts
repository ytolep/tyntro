export interface ChallengeConfig {
  planType: 'SPRINT' | 'CORE' | 'APEX';
  profitTargetPct: number;
  dailyDdPct: number;
  maxDdPct: number; // Static drawdown %
  profitSplitPct: number;
  minTradingDays: number;
}

export interface PlanPricing {
  SPRINT: number;
  CORE: number;
  APEX: number;
}

export const PLAN_CONFIGS: Record<'SPRINT' | 'CORE' | 'APEX', ChallengeConfig> = {
  SPRINT: {
    planType: 'SPRINT',
    profitTargetPct: 9,
    dailyDdPct: 3,
    maxDdPct: 3,
    profitSplitPct: 80,
    minTradingDays: 3,
  },
  CORE: {
    planType: 'CORE',
    profitTargetPct: 10,
    dailyDdPct: 3,
    maxDdPct: 6,
    profitSplitPct: 80,
    minTradingDays: 3,
  },
  APEX: {
    planType: 'APEX',
    profitTargetPct: 12,
    dailyDdPct: 3,
    maxDdPct: 5,
    profitSplitPct: 80,
    minTradingDays: 3,
  },
};

// Account sizes available in V1 MVP
export const ACCOUNT_SIZES = [5000, 10000, 25000, 50000, 100000] as const;
export type AccountSize = typeof ACCOUNT_SIZES[number];

// Цены временные, могут поменяться. Сид при каждом деплое синхронизирует priceUsd в Challenge.
export const PRICING_MATRIX: Record<AccountSize, PlanPricing> = {
  5000: { SPRINT: 25, CORE: 49, APEX: 39 },
  // CORE $10K = $1 — тестовая покупка; боевая цена $99.
  10000: { SPRINT: 45, CORE: 1, APEX: 75 },
  25000: { SPRINT: 109, CORE: 249, APEX: 169 },
  50000: { SPRINT: 219, CORE: 449, APEX: 319 },
  100000: { SPRINT: 399, CORE: 899, APEX: 619 },
};

export function getPrice(accountSize: number, planType: 'SPRINT' | 'CORE' | 'APEX'): number {
  const sizePricing = PRICING_MATRIX[accountSize as AccountSize];
  if (!sizePricing) return 89;
  return sizePricing[planType] || 89;
}
