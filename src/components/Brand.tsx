import Link from 'next/link';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';
export default function Brand() {
  return <Link href="/" className="brand-lockup" aria-label={`${BRAND_NAME} home`}>
    <svg viewBox="0 0 36 36" width="32" height="32" fill="none" aria-hidden="true"><path d="M7 27V8h16l6 6-6 7H13" stroke="currentColor" strokeWidth="4" strokeLinejoin="miter"/><path d="m19 25 9 5" stroke="#b7a0ff" strokeWidth="4"/></svg>
    <span>{BRAND_NAME}<small>{BRAND_TAGLINE}</small></span>
  </Link>;
}
