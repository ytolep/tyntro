import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { PayoutError, rejectFundedAccount } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/funded/reject {accountId, reason?} (ADMIN): только AuditLog FUNDED_REJECTED. */
export async function POST(req: Request) {
  let adminId: string;
  try {
    adminId = (await requireAdmin(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { accountId, reason } = (await req.json()) as { accountId?: string; reason?: unknown };
    if (typeof accountId !== 'string' || accountId.length === 0)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    if (reason !== undefined && typeof reason !== 'string')
      return NextResponse.json({ error: 'reason must be a string' }, { status: 400 });
    await rejectFundedAccount(adminId, accountId, reason);
    return NextResponse.json({ rejected: true });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Funded reject error:', error);
    return NextResponse.json({ error: 'Failed to reject funded account' }, { status: 500 });
  }
}
