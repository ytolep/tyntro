import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AuthError, requireUser } from '@/lib/auth';
import { computeTraderScore, scoreFillFromRow } from '@/lib/core/score';
import { executionPolicy } from '@/lib/execution/policy';

export const dynamic = 'force-dynamic';

/**
 * Trader Score активного счёта пользователя: только свои счета, score из реальных
 * сделок и снапшотов equity; меньше 5 сделок — score: null («недостаточно данных»).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    const { searchParams } = new URL(req.url);
    const targetAccountId = searchParams.get('accountId');

    const ownAccounts = await db.tradingAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (ownAccounts.length === 0)
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const target =
      (targetAccountId ? ownAccounts.find((a) => a.id === targetAccountId) : undefined) ?? ownAccounts[0];
    if (!target) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const account = await db.tradingAccount.findUnique({
      where: { id: target.id },
      include: { challenge: true },
    });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const [fills, snaps] = await Promise.all([
      db.fill.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'asc' },
        select: { realizedPnl: true, fee: true, createdAt: true },
      }),
      db.equitySnapshot.findMany({
        where: { accountId: account.id },
        orderBy: { timestamp: 'asc' },
        select: { equity: true, timestamp: true },
      }),
    ]);

    const score = computeTraderScore(
      fills.map(scoreFillFromRow),
      snaps.map((s) => ({ equity: s.equity, timestamp: s.timestamp })),
    );

    return NextResponse.json({
      accountId: account.id,
      status: account.status,
      tradeCount: fills.length,
      execution: executionPolicy(account),
      score,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('trader-score error:', error);
    return NextResponse.json({ error: 'Failed to compute trader score' }, { status: 500 });
  }
}
