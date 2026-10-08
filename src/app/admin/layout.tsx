import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAdminFromCookieHeader } from '@/lib/auth/server';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/** /admin существует только для ADMIN: без сессии или роли — 404 (без раскрытия страницы). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await getAdminFromCookieHeader(cookies().toString());
  if (!admin) notFound();
  return <>{children}</>;
}
