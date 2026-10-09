import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { markRead } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** POST /api/notifications/read {ids?: string[], all?: true} — отметить свои прочитанными. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
    if (body.all === true) return NextResponse.json({ updated: await markRead(user.id) });
    if (Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string' && id.length > 0))
      return NextResponse.json({ updated: await markRead(user.id, body.ids) });
    return NextResponse.json({ error: 'Expected {ids: string[]} or {all: true}' }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
