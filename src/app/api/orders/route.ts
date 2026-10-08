import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Волна 0: исполнение ордеров не реализовано. Волна 2 (агент F) перепишет
// на src/lib/core + withAccountLock + идемпотентность.
export async function POST() {
  return NextResponse.json(
    { error: 'Order execution is not implemented yet', code: 'NOT_IMPLEMENTED' },
    { status: 503 },
  );
}
