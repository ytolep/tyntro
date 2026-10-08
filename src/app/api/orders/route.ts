import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { executeSimulatedOrder } from '@/lib/execution/simulated';
import { ExecutionError } from '@/lib/execution/policy';
import { MarketDataError } from '@/lib/marketData/server';

export const dynamic = 'force-dynamic';

/** Лимит тела команды: ордер — маленький JSON, большое тело — ошибка клиента. */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
      return NextResponse.json({ error: 'Request body too large', code: 'BODY_TOO_LARGE' }, { status: 413 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });

    // Счёт выбирается явно; последний счёт пользователя молча не подставляется.
    const accountId = typeof (body as { accountId?: unknown }).accountId === 'string'
      ? (body as { accountId: string }).accountId
      : '';
    if (!accountId)
      return NextResponse.json({ error: 'accountId is required', code: 'ACCOUNT_ID_REQUIRED' }, { status: 400 });

    // Чужой счёт неотличим от несуществующего.
    const account = await db.tradingAccount.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== user.id)
      return NextResponse.json({ error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' }, { status: 404 });

    const result = await executeSimulatedOrder(user, account, body as Record<string, unknown>);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: 'Sign in to place orders', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (error instanceof ExecutionError)
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof MarketDataError)
      return NextResponse.json({ error: error.message, code: 'MARKET_DATA_UNAVAILABLE' }, { status: 503 });
    console.error('Order API error:', error);
    return NextResponse.json({ error: 'Order execution failed' }, { status: 500 });
  }
}
