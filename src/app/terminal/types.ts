// Shared client-side shapes for the terminal. API monetary values arrive as
// strings (Prisma Decimal) — convert with toNum before display math. All
// authoritative money math lives on the server (core + worker).

export type OrderIntent = {
  side: 'LONG' | 'SHORT';
  orderMode: 'Market' | 'Limit';
  limitPrice: number;
  sizeUsd: number;
  leverage: number;
};

// Mirrors ReturnType<typeof executionPolicy> from src/lib/execution/policy.ts.
export interface ExecutionPolicyView {
  mode: string;
  provider: string;
  capital: string;
  marketData: string;
  state: string;
  canTrade: boolean;
  canWithdraw: boolean;
  message: string;
}

export interface PositionRow {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number | string;
  currentMarkPrice: number | string;
  quantity: number | string;
  leverage: number;
  liquidationPrice: number | string;
}

export interface OrderRow {
  id: string;
  symbol: string;
  side: string;
  type: string;
  price: number | string;
  size: number | string;
  status: string;
  createdAt: string;
}

export interface FillRow {
  id: string;
  symbol: string;
  side: string;
  price: number | string;
  quantity: number | string;
  fee: number | string;
  realizedPnL: number | string;
  createdAt: string;
}

export interface AccountPayload {
  account?: {
    id: string;
    currentEquity?: number | string | null;
    positions: PositionRow[];
    orders: OrderRow[];
    fills: FillRow[];
  } | null;
  execution?: ExecutionPolicyView | null;
}

export function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function toNum(v: number | string | null | undefined): number {
  return numOrNull(v) ?? 0;
}
