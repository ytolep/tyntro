import { clearedSessionCookie, deleteSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** POST → удаляет сессию и гасит cookie. */
export async function POST(req: Request) {
  await deleteSession(req);
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } });
}
