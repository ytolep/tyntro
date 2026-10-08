import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/checkout/status?id — статус своей покупки; чужая покупка → 404. */
export async function GET(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser(req)).id;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  let id: string | null;
  try {
    id = new URL(req.url).searchParams.get('id');
  } catch {
    return NextResponse.json({ error: 'Invalid request URL' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing purchase id' }, { status: 400 });

  const purchase = await db.purchase.findUnique({ where: { id } });
  if (!purchase || purchase.userId !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ id: purchase.id, status: purchase.status, accountId: purchase.accountId });
}
