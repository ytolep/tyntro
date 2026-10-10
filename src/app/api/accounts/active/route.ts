import { NextResponse } from 'next/server';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { executionPolicy } from '@/lib/execution/policy';
import { MAINTENANCE_RATIO, snapshotMark } from '@/lib/execution/simulated';
import { evaluateAccount } from '@/lib/core/risk';
import type { RiskEvaluation } from '@/lib/core/risk';
import { getMarketSnapshot } from '@/lib/marketData/server';

export const dynamic = 'force-dynamic';

// Только собственные счета пользователя (requireUser); Decimal уходит строками,
// деньги не number. riskEval — core/risk.evaluateAccount на текущих метках;
// недоступный рынок помечает оценку stale, а не выдумывает цену.

type AccountRow = NonNullable<Awaited<ReturnType<typeof loadAccountRow>>>;

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const targetAccountId = searchParams.get('accountId');

    const allAccountsRaw = await db.tradingAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        challenge: true,
        positions: { where: { status: 'OPEN' } },
      },
    });

    if (!allAccountsRaw || allAccountsRaw.length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    let selectedAccount = allAccountsRaw[0];
    if (targetAccountId) {
      const found = allAccountsRaw.find((a) => a.id === targetAccountId);
      if (!found) return NextResponse.json({ error: 'Selected account not found' }, { status: 404 });
      selectedAccount = found;
    }

    const account = await loadAccountRow(selectedAccount.id);
    if (!account) {
      return NextResponse.json({ error: 'Selected account not found' }, { status: 404 });
    }

    const execution = executionPolicy(account);
    // Локальная виртуальная оценка риска — только для симулятора; FUNDED не получает её.
    const riskEval = execution.provider === 'SIMULATOR' ? await computeRiskEval(account) : null;

    const formattedAllAccounts = allAccountsRaw.map((acc) => {
      const openPnl = acc.positions.reduce((sum: Decimal, pos: { unrealizedPnl: Decimal }) => sum.plus(pos.unrealizedPnl), new Decimal(0));
      const equity = acc.currentBalance.plus(openPnl);
      const pnlPct = equity.minus(acc.accountSize).div(acc.accountSize).times(100).toNumber();
      const policy = executionPolicy(acc);
      return {
        id: acc.id,
        accountSize: acc.accountSize,
        planType: acc.challenge.planType,
        phase: acc.phase,
        mode: policy.mode,
        currentEquity: policy.provider === 'SIMULATOR' ? equity : null,
        pnlPct: policy.provider === 'SIMULATOR' ? pnlPct : null,
        status: acc.status,
        createdAt: acc.createdAt,
      };
    });

    return NextResponse.json({
      account: execution.provider === 'SIMULATOR' ? account : {
        id: account.id, mode: execution.mode, phase: account.phase, status: account.status,
        accountSize: account.accountSize, challenge: account.challenge, createdAt: account.createdAt,
        currentBalance: null, currentEquity: null, positions: [], orders: [], fills: [], equitySnapshots: [],
      },
      execution,
      riskEval,
      allAccounts: formattedAllAccounts,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: 'Sign in required', code: 'UNAUTHENTICATED' }, { status: 401 });
    console.error('Active account fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 });
  }
}

function loadAccountRow(accountId: string) {
  return db.tradingAccount.findUnique({
    where: { id: accountId },
    include: {
      challenge: true,
      positions: { where: { status: 'OPEN' } },
      orders: { orderBy: { createdAt: 'desc' }, take: 20 },
      fills: { orderBy: { createdAt: 'desc' }, take: 20 },
      equitySnapshots: { orderBy: { timestamp: 'asc' } },
      riskEvents: { orderBy: { timestamp: 'desc' }, take: 5 },
    },
  });
}

/** Оценка риска по текущим меткам с сервера; ошибка рынка → { stale: true }. */
async function computeRiskEval(account: AccountRow): Promise<Record<string, unknown>> {
  const symbols = [...new Set(account.positions.map((p) => p.symbol))];
  const marks = new Map<string, Decimal>();
  let stale = false;
  const loads = symbols.map((symbol) =>
    getMarketSnapshot(symbol).then(
      (snapshot) => marks.set(symbol, snapshotMark(snapshot)),
      () => {
        stale = true;
      },
    ),
  );
  await Promise.all(loads);
  if (stale) return { stale: true };

  const evaluation: RiskEvaluation = evaluateAccount({
    accountSize: account.accountSize,
    balance: account.currentBalance,
    positions: account.positions.map((p) => ({
      pos: {
        side: p.side as 'LONG' | 'SHORT',
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        leverage: p.leverage,
        margin: p.margin,
      },
      mark: marks.get(p.symbol)!,
    })),
    dayStartEquity: account.dayStartEquity,
    rules: {
      maxDdPct: account.challenge.maxDdPct,
      dailyDdPct: account.challenge.dailyDdPct,
      profitTargetPct: account.challenge.profitTargetPct,
      minTradingDays: account.challenge.minTradingDays,
    },
    tradingDays: account.tradingDaysCount,
    status: account.status,
    maintenanceRatio: MAINTENANCE_RATIO,
  });

  return {
    stale: false,
    equity: evaluation.equity.toString(),
    staticFloor: evaluation.staticFloor.toString(),
    dailyFloor: evaluation.dailyFloor.toString(),
    liquidate: evaluation.liquidate,
    breach: evaluation.breach,
    passed: evaluation.passed,
    riskLevel: evaluation.riskLevel,
    targetProgressPct: evaluation.targetProgressPct,
  };
}
