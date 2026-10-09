import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { refundPurchase, RefundError } from '@/lib/payments/refund';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/refunds {purchaseId, txSignature, reason?} (ADMIN):
 * фиксирует возврат, который админ уже сделал вручную переводом USDC.
 * Purchase → REFUNDED; ACTIVE-счёт без открытых позиций → FAILED
 * (OPEN-ордера CANCELLED, RiskEvent REFUND). Повтор или счёт с решением → 409.
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
    const { purchaseId, txSignature, reason } = (await req.json()) as {
      purchaseId?: unknown;
      txSignature?: unknown;
      reason?: unknown;
    };
    if (typeof purchaseId !== 'string' || purchaseId.length === 0)
      return NextResponse.json({ error: 'purchaseId is required' }, { status: 400 });
    const result = await refundPurchase(adminId, purchaseId, txSignature, reason);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RefundError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Refund error:', error);
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 });
  }
}
