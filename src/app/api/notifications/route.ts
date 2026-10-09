import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { listNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** GET /api/notifications: свои последние 50 + unreadCount. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return NextResponse.json(await listNotifications(user.id));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
