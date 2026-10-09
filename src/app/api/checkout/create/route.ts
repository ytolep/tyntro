import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { CheckoutError, createPendingPurchase } from '@/lib/payments/purchase';
import { DOCUMENTS_UPDATED_ERROR, consentAccepted, type ConsentBody } from '@/lib/legal/versions';
import { clientIp } from '@/lib/security/clientIp';

export const dynamic = 'force-dynamic';

// M2 (docs/REVIEW.md): IP только из доверенных источников, см. src/lib/security/clientIp.ts.
// env фиксируются на старте процесса; смена требует рестарта.
const trustedIpHeader = process.env.TRUSTED_IP_HEADER?.trim() || null;
const trustedProxyCount =
  Number(process.env.TRUSTED_PROXY_COUNT) > 0 ? Number(process.env.TRUSTED_PROXY_COUNT) : 1;

/**
 * POST /api/checkout/create {accountSize, planType, acceptedTerms, termsVersion,
 * refundsVersion, rulesVersion} → Purchase PENDING + TermsAcceptance + ссылка Solana Pay.
 * Согласие обязательно и только с текущими версиями документов (K2).
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
    const body = (await req.json()) as ConsentBody & { accountSize?: unknown; planType?: unknown };
    // K2: без явного согласия с текущими версиями покупка не создаётся.
    if (!consentAccepted(body))
      return NextResponse.json({ error: DOCUMENTS_UPDATED_ERROR, code: 'documents_updated' }, { status: 400 });
    const created = await createPendingPurchase(
      userId,
      Number(body.accountSize),
      String(body.planType ?? ''),
      {
        ip: clientIp((name) => req.headers.get(name), { trustedIpHeader, trustedProxyCount }),
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    );
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
