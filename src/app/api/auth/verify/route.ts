import { db } from '@/lib/db';
import { createSiwsMessage, extractNonce, siwsDomainCandidates, verifyEd25519 } from '@/lib/auth/siws';
import { createSession, sessionCookie } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** POST {wallet, signature(base58), message} → сессия в httpOnly-cookie. */
export async function POST(req: Request) {
  let body: { wallet?: unknown; signature?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { wallet, signature, message } = body ?? {};
  if (typeof wallet !== 'string' || typeof signature !== 'string' || typeof message !== 'string') {
    return Response.json({ error: 'wallet, signature and message are required' }, { status: 400 });
  }

  // Сообщение должно быть нашим: nonce из него находит одноразовую запись.
  const nonce = extractNonce(message);
  if (!nonce) {
    return Response.json({ error: 'Invalid message' }, { status: 401 });
  }

  // Nonce: существует, выдан этому кошельку, не использован, не просрочен.
  const record = await db.authNonce.findUnique({ where: { nonce } });
  if (!record || record.usedAt || record.expiresAt <= new Date() || record.wallet !== wallet) {
    return Response.json({ error: 'Invalid or expired nonce' }, { status: 401 });
  }

  // H2: сообщение должно побайтово совпадать с выданным для этого nonce. Схема AuthNonce
  // не хранит message — восстанавливаем его детерминированно из записи (wallet, nonce,
  // createdAt) и домена-кандидата: Host ∈ APP_DOMAINS либо APP_DOMAIN (siwsDomainCandidates).
  // Чужой домен (фишинг) и любая правка текста здесь не проходят.
  const issuedAt = record.createdAt.toISOString();
  const issuedMessage = siwsDomainCandidates(req.headers.get('host'))
    .map((domain) => createSiwsMessage({ domain, wallet, nonce, issuedAt }));
  if (!issuedMessage.includes(message)) {
    return Response.json({ error: 'Invalid message' }, { status: 401 });
  }

  // Подпись ed25519 от публичного ключа-кошелька (node:crypto, SPKI/DER).
  if (!verifyEd25519(message, signature, wallet)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Поглощаем nonce атомарно: параллельный повторный verify увидит count=0.
  const consumed = await db.authNonce.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return Response.json({ error: 'Nonce already used' }, { status: 401 });
  }

  const user = await db.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });

  const token = await createSession(user.id);
  return Response.json(
    { user: { id: user.id, walletAddress: user.walletAddress, role: user.role } },
    { headers: { 'set-cookie': sessionCookie(token) } },
  );
}
