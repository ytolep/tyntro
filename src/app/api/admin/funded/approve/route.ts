import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { approveFundedAccount, PayoutError } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/funded/approve {accountId} (ADMIN): PASSED → новый счёт FUNDED_SIM. */
export async function POST(req: Request) {
  let adminId: string;
  try {
    adminId = (await requireAdmin(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { accountId } = (await req.json()) as { accountId?: string };
    if (typeof accountId !== 'string' || accountId.length === 0)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    const fundedAccountId = await approveFundedAccount(adminId, accountId);
    return NextResponse.json({ fundedAccountId });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Funded approve error:', error);
    return NextResponse.json({ error: 'Failed to approve funded account' }, { status: 500 });
  }
}
