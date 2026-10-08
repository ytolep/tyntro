import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { decidePayout, PayoutError } from '@/lib/payouts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payouts/decide {payoutId, approve, txSignature?} (ADMIN):
 * approve=false → REJECTED; без подписи → APPROVED; с подписью → PAID
 * (перевод USDC админ делает вручную, подпись фиксируется в записи).
 */
export async function POST(req: Request) {
  let adminId: string;
  try {
    adminId = (await requireAdmin(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { payoutId, approve, txSignature } = (await req.json()) as {
      payoutId?: string;
      approve?: unknown;
      txSignature?: unknown;
    };
    if (typeof payoutId !== 'string' || payoutId.length === 0)
      return NextResponse.json({ error: 'payoutId is required' }, { status: 400 });
    if (typeof approve !== 'boolean')
      return NextResponse.json({ error: 'approve must be a boolean' }, { status: 400 });
    if (txSignature !== undefined && typeof txSignature !== 'string')
      return NextResponse.json({ error: 'txSignature must be a string' }, { status: 400 });
    const result = await decidePayout(adminId, payoutId, approve, txSignature);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Payout decide error:', error);
    return NextResponse.json({ error: 'Failed to decide payout' }, { status: 500 });
  }
}
