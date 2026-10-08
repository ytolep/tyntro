import { getUser } from './session';

/**
 * Ошибка авторизации: status — HTTP-код ответа (401 нет сессии, 403 нет роли).
 */
export class AuthError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? 'Authentication required');
    this.name = 'AuthError';
  }
}

export interface AuthUser {
  id: string;
  walletAddress: string;
  role: 'USER' | 'ADMIN';
}

/**
 * Требует валидную сессию из httpOnly-cookie; бросает AuthError(401).
 */
export async function requireUser(req: Request): Promise<AuthUser> {
  const user = await getUser(req);
  if (!user) throw new AuthError(401, 'Sign in required');
  return user;
}

/**
 * Требует сессию с ролью ADMIN; без сессии — AuthError(401), без роли — AuthError(403).
 */
export async function requireAdmin(req: Request): Promise<AuthUser> {
  const user = await requireUser(req);
  if (user.role !== 'ADMIN') throw new AuthError(403, 'Admin role required');
  return user;
}
