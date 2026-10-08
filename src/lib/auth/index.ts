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
 * Реализация — волна 1 (агент C): siws.ts + session.ts.
 */
export async function requireUser(req: Request): Promise<AuthUser> {
  void req; // контракт волны 0; реализация — волна 1 (агент C)
  throw new Error('not implemented');
}

/**
 * Требует сессию с ролью ADMIN; без сессии — AuthError(401), без роли — AuthError(403).
 * Реализация — волна 1 (агент C).
 */
export async function requireAdmin(req: Request): Promise<AuthUser> {
  void req; // контракт волны 0; реализация — волна 1 (агент C)
  throw new Error('not implemented');
}
