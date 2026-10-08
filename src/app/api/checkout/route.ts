import { NextResponse } from 'next/server';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { PLAN_CONFIGS, ACCOUNT_SIZES } from '@/lib/pricingConfig';

// Волна 0: прямое создание демо-счёта. Волна 2 (агент D) заменит на Solana Pay
// с Purchase/reference; волна 1 (агент C) — на requireUser.
const DEMO_WALLET = 'demo';

export async function POST(req: Request) {
  try {
    const { accountSize, planType } = await req.json();

    const size = Number(accountSize) || 10000;
    const plan = (planType || 'CORE') as keyof typeof PLAN_CONFIGS;
    const config = PLAN_CONFIGS[plan];
    if (!config || !(ACCOUNT_SIZES as readonly number[]).includes(size))
      return NextResponse.json({ error: 'Invalid challenge plan or size' }, { status: 400 });

    // Find or create default user
    const user = await db.user.upsert({
      where: { walletAddress: DEMO_WALLET },
      update: {},
      create: {
        walletAddress: DEMO_WALLET,
        name: 'DemoTrader',
      },
    });

    // Find challenge definition
    const challenge = await db.challenge.findUnique({
      where: {
        accountSize_planType: {
          accountSize: new Decimal(size),
          planType: plan,
        },
      },
    });

    if (!challenge) return NextResponse.json({ error: 'Challenge is not configured' }, { status: 409 });

    const sizeDec = new Decimal(size);
    const staticFloor = sizeDec.times(1 - config.maxDdPct / 100);
    const dailyFloor = sizeDec.times(1 - config.dailyDdPct / 100);

    const account = await db.tradingAccount.create({
      data: {
        userId: user.id,
        challengeId: challenge.id,
        mode: 'CHALLENGE',
        accountSize: sizeDec,
        currentBalance: sizeDec,
        currentEquity: sizeDec,
        dayStartEquity: sizeDec,
        staticMaxDdFloor: staticFloor,
        dailyDdFloor: dailyFloor,
        currentExposure: new Decimal(0),
        leverage: 1,
        status: 'ACTIVE',
        tradingDaysCount: 0,
        winCount: 0,
        lossCount: 0,
        totalTrades: 0,
      },
    });

    // DEPOSIT-проводка: баланс счёта всегда равен сумме проводок ledger.
    await db.ledgerEntry.create({
      data: { accountId: account.id, type: 'DEPOSIT', amount: sizeDec, refId: challenge.id },
    });

    // Add initial equity snapshot
    await db.equitySnapshot.create({
      data: {
        accountId: account.id,
        balance: sizeDec,
        equity: sizeDec,
        dayStartEquity: sizeDec,
        pnlPct: 0,
      },
    });

    return NextResponse.json({ success: true, accountId: account.id, mode: 'CHALLENGE', capital: 'VIRTUAL' });
  } catch (error) {
    console.error('Checkout API error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
