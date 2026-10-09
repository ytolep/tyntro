import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import bs58 from 'bs58';
import { BRAND_NAME } from '../brand';

// SIWS-сообщение (по мотивам CAIP-122): домен, кошелёк, nonce, время выдачи.
export interface SiwsParams {
  domain: string;
  wallet: string; // base58-адрес (публичный ключ ed25519)
  nonce: string;
  issuedAt: string; // ISO
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}

// H2 (docs/REVIEW.md): домен SIWS-сообщения должен быть нашим.
// Белый список APP_DOMAINS (CSV) фиксируется на старте процесса (как BLOCKED_COUNTRIES
// в middleware); APP_DOMAIN — домен-фолбэк (по умолчанию первый из APP_DOMAINS).
const APP_DOMAINS = (process.env.APP_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const APP_DOMAIN = process.env.APP_DOMAIN?.trim().toLowerCase() || APP_DOMAINS[0];

/**
 * Домены, для которых мог быть выдан SIWS, в порядке приоритета: Host запроса,
 * если он входит в APP_DOMAINS (без настроенного списка — Host как есть, dev/тесты),
 * затем APP_DOMAIN; при полном отсутствии — 'props.local'.
 */
export function siwsDomainCandidates(host: string | null): string[] {
  const list: string[] = [];
  if (host && (APP_DOMAINS.length === 0 || APP_DOMAINS.includes(host.toLowerCase()))) {
    list.push(host);
  }
  if (APP_DOMAIN && !list.includes(APP_DOMAIN)) list.push(APP_DOMAIN);
  if (list.length === 0) list.push('props.local');
  return list;
}

// Phantom отклоняет SIWS без окна (-32000), если origin из URI не совпадает с origin страницы
// или Chain ID не совпадает с сетью кошелька. Поэтому Chain ID не пишем (поле необязательное,
// вход от сети не зависит), а локальный стенд открыт по http, всё остальное — https.
export function siwsUri(domain: string): string {
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(domain) ? 'http' : 'https'}://${domain}`;
}

export function createSiwsMessage({ domain, wallet, nonce, issuedAt }: SiwsParams): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    wallet,
    '',
    `By signing, you authenticate with ${BRAND_NAME}. This request will not trigger a blockchain transaction or cost any fees.`,
    '',
    `URI: ${siwsUri(domain)}`,
    'Version: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

// Из сообщения достаём nonce, чтобы найти одноразовую запись в БД.
export function extractNonce(message: string): string | null {
  const m = message.match(/^Nonce: (\S+)$/m);
  return m ? m[1] : null;
}

// Префикс SPKI/DER для сырого 32-байтного публичного ключа ed25519:
// SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING <key> }
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyEd25519(
  message: string,
  signatureBase58: string,
  walletAddress: string,
): boolean {
  try {
    const publicKeyRaw = bs58.decode(walletAddress); // Uint8Array(32)
    if (publicKeyRaw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyRaw)]),
      format: 'der',
      type: 'spki',
    });
    const signature = bs58.decode(signatureBase58);
    // Для ed25519 algorithm = null; подпись и сообщение — байты строки сообщения.
    return cryptoVerify(
      null,
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}
