import { NextResponse } from 'next/server';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { executionPolicy } from '@/lib/execution/policy';

export const dynamic = 'force-dynamic';

// Волна 0: демо-пользователь по плейсхолдер-кошельку; волна 1 (агент C) заменит на requireUser.
const DEMO_WALLET = 'demo';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const targetAccountId = searchParams.get('accountId');

    const user = await db.user.findUnique({
      where: { walletAddress: DEMO_WALLET },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch all user accounts for dropdown navigation
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

    // Determine target account
    let selectedAccount = allAccountsRaw[0];
    if (targetAccountId) {
      const found = allAccountsRaw.find((a: (typeof allAccountsRaw)[number]) => a.id === targetAccountId);
      if (!found) return NextResponse.json({ error: 'Selected account not found' }, { status: 404 });
      selectedAccount = found;
    }

    // Fetch detailed data for selected account
    const account = await db.tradingAccount.findUnique({
      where: { id: selectedAccount.id },
      include: {
        challenge: true,
        positions: { where: { status: 'OPEN' } },
        orders: { orderBy: { createdAt: 'desc' }, take: 20 },
        fills: { orderBy: { createdAt: 'desc' }, take: 20 },
        equitySnapshots: { orderBy: { timestamp: 'asc' } },
        riskEvents: { orderBy: { timestamp: 'desc' }, take: 5 },
      },
    });

    if (!account) {
      return NextResponse.json({ error: 'Selected account not found' }, { status: 404 });
    }

    const execution = executionPolicy(account);
    // Волна 1: риск-оценка переезжает на core/risk.evaluateAccount (агент A/B).
    const riskEval = null;

    // Format all accounts for dropdown menu
    const formattedAllAccounts = allAccountsRaw.map((acc: (typeof allAccountsRaw)[number]) => {
      const openPnl = acc.positions.reduce((sum: Decimal, pos: { unrealizedPnl: Decimal }) => sum.plus(pos.unrealizedPnl), new Decimal(0));
      const equity = acc.currentBalance.plus(openPnl);
      const pnlPct = equity.minus(acc.accountSize).div(acc.accountSize).times(100).toNumber();
      const policy = executionPolicy(acc);
      return {
        id: acc.id,
        accountSize: acc.accountSize,
        planType: acc.challenge.planType,
        mode: policy.mode,
        currentEquity: policy.provider === 'SIMULATOR' ? equity : null,
        pnlPct: policy.provider === 'SIMULATOR' ? pnlPct : null,
        status: acc.status,
        createdAt: acc.createdAt,
      };
    });

    return NextResponse.json({
      account: execution.provider === 'SIMULATOR' ? account : {
        id: account.id, mode: execution.mode, status: account.status,
        accountSize: account.accountSize, challenge: account.challenge, createdAt: account.createdAt,
        currentBalance: null, currentEquity: null, positions: [], orders: [], fills: [], equitySnapshots: [],
      },
      execution,
      riskEval,
      allAccounts: formattedAllAccounts,
    });
  } catch (error) {
    console.error('Active account fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 });
  }
}
