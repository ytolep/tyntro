import { BRAND_NAME } from '@/lib/brand';

export const metadata = { title: 'Unavailable in your region' };

// Заглушка гео-блока: сюда редиректит proxy со страниц из заблокированных стран.
export default function BlockedPage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-32 text-center">
      <p className="eyebrow">GEO RESTRICTION</p>
      <h1 className="text-4xl font-medium tracking-tight">Unavailable in your region</h1>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted)' }}>
        {BRAND_NAME} does not provide services in your country or region. If you believe this is a
        mistake, contact support.
      </p>
    </section>
  );
}
