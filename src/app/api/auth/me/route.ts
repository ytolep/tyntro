import { AuthError, requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET → текущий пользователь или {user: null} без сессии. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ user });
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) return Response.json({ user: null });
    throw e;
  }
}
