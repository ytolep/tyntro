import { NextResponse } from 'next/server';
import {
  buildTransparencyReport,
  createTreasuryBalanceSource,
  treasuryRpcUrl,
  type TransparencyReport,
} from '@/lib/transparency/report';

export const dynamic = 'force-dynamic';

/**
 * Публичный отчёт прозрачности (audit T4): без сессии, без персональных данных.
 * Серверный кэш 60 с — и баланс казны, и агрегаты БД обновляются не чаще раза в минуту.
 */
const CACHE_TTL_MS = 60_000;
let cached: { at: number; report: TransparencyReport } | null = null;

export async function GET() {
  try {
    if (!cached || Date.now() - cached.at >= CACHE_TTL_MS) {
      const rpcUrl = treasuryRpcUrl();
      cached = {
        at: Date.now(),
        report: await buildTransparencyReport(rpcUrl ? { balance: createTreasuryBalanceSource(rpcUrl) } : {}),
      };
    }
    return NextResponse.json(cached.report, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('transparency report error:', error);
    return NextResponse.json({ error: 'Failed to build transparency report' }, { status: 500 });
  }
}
