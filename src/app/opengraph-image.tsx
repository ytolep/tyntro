import { ImageResponse } from 'next/og';
import { BRAND_NAME } from '@/lib/brand';

// OG-превью 1200x630: тёмный фон сайта, знак из Brand.tsx, имя и подзаголовок.
// Шрифты — встроенный дефолт next/og, никаких внешних запросов при сборке.
export const alt = `${BRAND_NAME} — Crypto prop trading on Solana`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: '#09090d',
          color: '#f3f2f7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {/* Знак из src/components/Brand.tsx (stroke-пути как в логотипе) */}
          <svg width="128" height="128" viewBox="0 0 36 36" fill="none">
            <rect x="2" y="2" width="32" height="32" rx="8" fill="#b7a0ff" />
            <path d="M9.5 11h17M18 11v16" stroke="#09090d" strokeWidth="4.5" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 112,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {BRAND_NAME}
            </div>
            <div style={{ marginTop: 14, fontSize: 38, color: '#9d98a8' }}>
              Crypto prop trading on Solana
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
