import Link from 'next/link';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';
export default function Brand() {
  return <Link href="/" className="brand-lockup" aria-label={`${BRAND_NAME} home`}>
    <svg viewBox="0 0 36 36" width="32" height="32" fill="none" aria-hidden="true"><rect x="2" y="2" width="32" height="32" rx="8" fill="#b7a0ff"/><path d="M9.5 11h17M18 11v16" stroke="#09090d" strokeWidth="4.5"/></svg>
    <span>{BRAND_NAME}<small>{BRAND_TAGLINE}</small></span>
  </Link>;
}
