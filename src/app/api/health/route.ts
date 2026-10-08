import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jsonLog } from '@/lib/log';
import pkg from '../../../../package.json';

// Health: БД доступна + версия сборки. Живость воркера health не проверяет —
// мониторинг воркера описан в README (логи + свежесть EquitySnapshot).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'up', version: pkg.version }, { headers });
  } catch (error) {
    jsonLog('error', 'health: БД недоступна', { error: String(error) });
    return NextResponse.json({ status: 'error', db: 'down' }, { status: 503, headers });
  }
}
