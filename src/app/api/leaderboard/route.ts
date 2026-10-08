import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { computeTraderScore, MIN_TRADES_FOR_SCORE, scoreFillFromRow } from '@/lib/core/score';

export const dynamic = 'force-dynamic';

const LIMIT = 50;

/** Кошелёк для публичной витрины: первые 4 и последние 4 символа. */
function shortWallet(wallet: string): string {
  return wallet.length <= 8 ? `${wallet.slice(0, 2)}…` : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

/**
 * Публичный лидерборд: топ-LIMIT счетов с MIN_TRADES_FOR_SCORE сделок и невылетающим
 * score, отсортированных по totalScore.
 * // ponytail: два полных чтения fills/snapshots по всем кандидатам на каждый запрос;
 * // кэш/материализация TraderScore, когда счётчиков станет тысячи.
 */
export async function GET() {
  try {
    const accounts = await db.tradingAccount.findMany({
      where: { totalTrades: { gte: MIN_TRADES_FOR_SCORE } },
      select: { id: true, accountSize: true, user: { select: { walletAddress: true } } },
    });
    if (accounts.length === 0) return NextResponse.json({ entries: [] });

    const ids = accounts.map((a) => a.id);
    const [fillRows, snapRows] = await Promise.all([
      db.fill.findMany({
        where: { accountId: { in: ids } },
        select: { accountId: true, realizedPnl: true, fee: true, createdAt: true },
      }),
      db.equitySnapshot.findMany({
        where: { accountId: { in: ids } },
        select: { accountId: true, equity: true, timestamp: true },
      }),
    ]);

    const fillsBy = new Map<string, ReturnType<typeof scoreFillFromRow>[]>();
    for (const row of fillRows) {
      const list = fillsBy.get(row.accountId) ?? [];
      list.push(scoreFillFromRow(row));
      fillsBy.set(row.accountId, list);
    }
    const snapsBy = new Map<string, { equity: typeof snapRows[number]['equity']; timestamp: Date }[]>();
    for (const row of snapRows) {
      const list = snapsBy.get(row.accountId) ?? [];
      list.push({ equity: row.equity, timestamp: row.timestamp });
      snapsBy.set(row.accountId, list);
    }

    const entries = [];
    for (const acc of accounts) {
      const score = computeTraderScore(fillsBy.get(acc.id) ?? [], snapsBy.get(acc.id) ?? []);
      if (!score) continue; // недостаточно сделок (кэш totalTrades мог опередить fills)

      // PnL % от последнего снапшота к размеру счёта; без снапшотов — null.
      const snaps = snapsBy.get(acc.id) ?? [];
      let pnlPct: number | null = null;
      if (snaps.length > 0) {
        const last = [...snaps].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[snaps.length - 1];
        if (!acc.accountSize.isZero())
          pnlPct = Number(last.equity.minus(acc.accountSize).div(acc.accountSize).mul(100).toDecimalPlaces(2));
      }

      entries.push({
        wallet: shortWallet(acc.user.walletAddress),
        accountSize: Number(acc.accountSize),
        pnlPct,
        score: score.totalScore,
        tier: score.tier,
        winRatePct: Math.round(score.stats.winRatePct * 10) / 10,
        trades: score.stats.tradeCount,
      });
    }

    entries.sort((a, b) => b.score - a.score);
    return NextResponse.json({
      entries: entries.slice(0, LIMIT).map((e, i) => ({ rank: i + 1, ...e })),
    });
  } catch (error) {
    console.error('leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to load leaderboard' }, { status: 500 });
  }
}
