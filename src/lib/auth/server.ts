import { getUser, SESSION_COOKIE } from './session';
import type { AuthUser } from './index';

/**
 * ADMIN по заголовку cookie или null (нет cookie/сессии, просрочена, не ADMIN).
 * Для серверных компонентов (admin/layout.tsx); переиспользует getUser без дубля проверки токена.
 */
export async function getAdminFromCookieHeader(cookieHeader: string | null): Promise<AuthUser | null> {
  if (!cookieHeader?.includes(`${SESSION_COOKIE}=`)) return null;
  const user = await getUser(new Request('http://localhost', { headers: { cookie: cookieHeader } }));
  return user?.role === 'ADMIN' ? user : null;
}
