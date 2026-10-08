import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { CheckoutError, createPendingPurchase } from '@/lib/payments/purchase';

export const dynamic = 'force-dynamic';

/** POST /api/checkout/create {accountSize, planType} → Purchase PENDING + ссылка Solana Pay. */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try {
    const { accountSize, planType } = (await req.json()) as { accountSize?: unknown; planType?: unknown };
    const created = await createPendingPurchase(userId, Number(accountSize), String(planType ?? ''));
    return NextResponse.json({
      id: created.purchaseId,
      reference: created.reference,
      amount: created.amount.toFixed(2),
      url: created.payUrl,
    });
  } catch (error) {
    if (error instanceof CheckoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Checkout create error:', error);
    return NextResponse.json({ error: 'Failed to create purchase' }, { status: 500 });
  }
}
