import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AuthError, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Очереди решений админа (роль ADMIN):
 * 1) счета PASSED без решения (phase CHALLENGE) — кандидаты на funded-одобрение;
 * 2) выплаты в статусе REQUESTED/APPROVED.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const [fundedQueue, payoutQueue] = await Promise.all([
      db.tradingAccount.findMany({
        where: { status: 'PASSED', phase: 'CHALLENGE' },
        orderBy: { updatedAt: 'asc' },
        select: {
          id: true,
          accountSize: true,
          status: true,
          phase: true,
          totalTrades: true,
          updatedAt: true,
          user: { select: { walletAddress: true } },
          challenge: { select: { planType: true } },
        },
      }),
      db.payout.findMany({
        where: { status: { in: ['REQUESTED', 'APPROVED'] } },
        orderBy: { timestamp: 'asc' },
        select: {
          id: true,
          amountUsd: true,
          status: true,
          timestamp: true,
          approvedBy: true,
          account: {
            select: {
              id: true,
              user: { select: { walletAddress: true } },
              challenge: { select: { planType: true } },
            },
          },
        },
      }),
    ]);

    return NextResponse.json({ fundedQueue, payoutQueue });
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('admin queue error:', error);
    return NextResponse.json({ error: 'Failed to load queues' }, { status: 500 });
  }
}
