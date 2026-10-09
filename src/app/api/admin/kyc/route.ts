import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { getKycByWallet, KycError, KYC_STATUSES, setKycStatus } from '@/lib/payouts/kyc';

export const dynamic = 'force-dynamic';

/**
 * Ручной KYC (Q2), только ADMIN:
 *   POST {userId, status: VERIFIED|REJECTED, note?} — решение: AuditLog + notify.
 *   GET ?wallet=<address> — kycStatus по кошельку (для очереди выплат).
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
    const { userId, status, note } = (await req.json()) as { userId?: string; status?: unknown; note?: unknown };
    if (typeof userId !== 'string' || userId.length === 0)
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (typeof status !== 'string' || !(KYC_STATUSES as readonly string[]).includes(status))
      return NextResponse.json({ error: `status must be one of ${KYC_STATUSES.join('|')}` }, { status: 400 });
    const result = await setKycStatus(adminId, userId, status as (typeof KYC_STATUSES)[number], note as string | undefined);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof KycError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('KYC decide error:', error);
    return NextResponse.json({ error: 'Failed to decide KYC' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const wallet = new URL(req.url).searchParams.get('wallet');
    if (!wallet || wallet.length === 0)
      return NextResponse.json({ error: 'wallet query parameter is required' }, { status: 400 });
    return NextResponse.json(await getKycByWallet(wallet));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof KycError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('KYC lookup error:', error);
    return NextResponse.json({ error: 'Failed to look up KYC status' }, { status: 500 });
  }
}
