import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { recentPaidPurchases } from '@/lib/payments/refund';

export const dynamic = 'force-dynamic';

/** GET /api/admin/purchases (ADMIN): последние 20 PAID-покупок для админки. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return NextResponse.json({ purchases: await recentPaidPurchases(20) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Admin purchases error:', error);
    return NextResponse.json({ error: 'Failed to load purchases' }, { status: 500 });
  }
}
