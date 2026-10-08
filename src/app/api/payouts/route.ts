import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { payoutOverview } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/payouts: funded-счёта пользователя с доступной к выплате суммой,
 * история выплат и счёта с незакрытым запросом funded-активации.
 */
export async function GET(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    return NextResponse.json(await payoutOverview(userId));
  } catch (error) {
    console.error('Payout overview error:', error);
    return NextResponse.json({ error: 'Failed to load payouts' }, { status: 500 });
  }
}
