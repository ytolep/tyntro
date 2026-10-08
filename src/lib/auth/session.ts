import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';
import type { AuthUser } from './index';

export const SESSION_COOKIE = 'props_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 дней

// Токен отдаётся только в httpOnly-cookie; в БД лежит sha256(token).
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });
  return token;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

function readCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('cookie');
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Пользователь по сессионной cookie или null (нет/просрочена). */
export async function getUser(req: Request): Promise<AuthUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return { id: session.user.id, walletAddress: session.user.walletAddress, role: session.user.role as AuthUser['role'] };
}

export async function deleteSession(req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await db.session.deleteMany({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
}
