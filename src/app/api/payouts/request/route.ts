import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { PayoutError, requestPayout } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/** POST /api/payouts/request {accountId, amount}: Payout REQUESTED после проверок. */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { accountId, amount } = (await req.json()) as { accountId?: string; amount?: unknown };
    if (typeof accountId !== 'string' || accountId.length === 0)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    const created = await requestPayout(userId, accountId, amount);
    return NextResponse.json({ id: created.payoutId, status: 'REQUESTED', availableUsd: created.availableUsd });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Payout request error:', error);
    return NextResponse.json({ error: 'Failed to request payout' }, { status: 500 });
  }
}
