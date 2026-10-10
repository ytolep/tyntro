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

// Временные тестовые цены $1/$2/$3 (порядок Sprint < Apex < Core сохранён).
// Боевые цены по спецификации — вернуть перед запуском (и priceUsd в Challenge):
// $5K: Sprint $23, Core $49, Apex $39
// $10K: Sprint $39, Core $89, Apex $69
// $25K: Sprint $99, Core $219, Apex $149
// $50K: Sprint $199, Core $399, Apex $299
// $100K: Sprint $369, Core $799, Apex $549
const TEST_PRICES: PlanPricing = { SPRINT: 1, CORE: 3, APEX: 2 };
export const PRICING_MATRIX: Record<AccountSize, PlanPricing> = {
  5000: TEST_PRICES,
  10000: TEST_PRICES,
  25000: TEST_PRICES,
  50000: TEST_PRICES,
  100000: TEST_PRICES,
};

export function getPrice(accountSize: number, planType: 'SPRINT' | 'CORE' | 'APEX'): number {
  const sizePricing = PRICING_MATRIX[accountSize as AccountSize];
  if (!sizePricing) return 89;
  return sizePricing[planType] || 89;
}
