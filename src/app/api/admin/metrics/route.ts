import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AuthError, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Реальные метрики платформы для админки (роль ADMIN).
 * Деньги — Decimal, в JSON уходят строками; Number только для счётчиков и процентов.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const [purchases, revenueAgg, activeAccounts, passed, failed, fundedAccounts, payoutsPaidAgg, payoutsPendingCount] =
      await Promise.all([
        db.purchase.count({ where: { status: 'PAID' } }),
        db.purchase.aggregate({ _sum: { amountUsdc: true }, where: { status: 'PAID' } }),
        db.tradingAccount.count({ where: { status: 'ACTIVE' } }),
        db.tradingAccount.count({ where: { status: 'PASSED' } }),
        db.tradingAccount.count({ where: { status: 'FAILED' } }),
        db.tradingAccount.count({ where: { OR: [{ phase: 'FUNDED_SIM' }, { mode: 'FUNDED' }] } }),
        db.payout.aggregate({ _sum: { amountUsd: true }, _count: true, where: { status: 'PAID' } }),
        db.payout.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
      ]);

    const decided = passed + failed;

    return NextResponse.json({
      purchases,
      revenueUsdc: (revenueAgg._sum.amountUsdc ?? '0').toString(),
      activeAccounts,
      passed,
      failed,
      passRatePct: decided > 0 ? (passed / decided) * 100 : null,
      fundedAccounts,
      payoutsPaid: {
        count: payoutsPaidAgg._count,
        totalUsd: (payoutsPaidAgg._sum.amountUsd ?? '0').toString(),
      },
      payoutsPendingCount,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('admin metrics error:', error);
    return NextResponse.json({ error: 'Failed to compute metrics' }, { status: 500 });
  }
}
