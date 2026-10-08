import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { PayoutError, requestFundedReview } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/funded/request {accountId}: запрос трейдером активации funded
 * для своего PASSED-счёта (кнопка «Запросить funded» на /funded).
 * Пишет AuditLog FUNDED_REQUESTED; решение принимает админ в /api/admin/funded/*.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { accountId } = (await req.json()) as { accountId?: string };
    if (typeof accountId !== 'string' || accountId.length === 0)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    return NextResponse.json(await requestFundedReview(userId, accountId));
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Funded request error:', error);
    return NextResponse.json({ error: 'Failed to request funded review' }, { status: 500 });
  }
}
