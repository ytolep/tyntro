import { db } from '@/lib/db';
import { createSiwsMessage, newNonce, siwsDomainCandidates } from '@/lib/auth/siws';
import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

const NONCE_TTL_MS = 10 * 60 * 1000; // 10 минут

// Валидный base58-адрес Solana: 32 байта публичного ключа ed25519.
function isValidWallet(wallet: unknown): wallet is string {
  if (typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 44) return false;
  try {
    return bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

/** POST {wallet} → сообщение для подписи; nonce живёт 10 минут. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { wallet } = (body ?? {}) as { wallet?: unknown };
  if (!isValidWallet(wallet)) {
    return Response.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const nonce = newNonce();
  const domain = siwsDomainCandidates(req.headers.get('host'))[0];

  // issuedAt = createdAt записи: verify восстанавливает сообщение побайтово из записи
  // (wallet, nonce, createdAt) и домена, поэтому выданное время нельзя брать с отдельных часов.
  const record = await db.authNonce.create({
    data: { nonce, wallet, expiresAt: new Date(Date.now() + NONCE_TTL_MS) },
  });

  return Response.json({
    message: createSiwsMessage({ domain, wallet, nonce, issuedAt: record.createdAt.toISOString() }),
    nonce,
  });
}
