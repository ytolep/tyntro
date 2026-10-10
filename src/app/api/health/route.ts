import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jsonLog } from '@/lib/log';
import { HEARTBEAT_ID } from '@/worker/heartbeat';
import { isPaymentsConfigured } from '@/lib/payments/config';
import pkg from '../../../../package.json';

// Health: БД + живость воркера (Q1). Воркер раз в 5 с upsert'ит WorkerHeartbeat;
// тик риска старше 30 с, проверка оплат старше 90 с или отсутствие строки
// → HTTP 503 status 'degraded': healthcheck и мониторинг видят падение воркера.
// Без TREASURY_WALLET (payments disabled) свежесть lastPaymentsCheckAt не требуется:
// воркер не запускает цикл платежей, поле остаётся null — это норма, не деградация.
// ?scope=web — только БД: healthcheck контейнера web не должен рестартовать
// web из-за воркера (воркер падает — страницы работают, рестарт не нужен).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

const TICK_STALE_MS = 30_000;
const PAYMENTS_STALE_MS = 90_000;

/** Возраст отметки; null (цикл ещё не завершался) — от старта воркера. */
const ageMs = (at: Date | null, fallbackAt: Date): number =>
  Date.now() - (at ?? fallbackAt).getTime();

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get('scope');
  try {
    await db.$queryRaw`SELECT 1`;
    if (scope === 'web') {
      return NextResponse.json({ status: 'ok', db: 'up', version: pkg.version }, { headers });
    }

    const paymentsEnabled = isPaymentsConfigured();
    const heartbeat = await db.workerHeartbeat.findUnique({ where: { id: HEARTBEAT_ID } });
    if (!heartbeat) {
      return NextResponse.json(
        {
          status: 'degraded', db: 'up', version: pkg.version,
          worker: { ok: false, payments: paymentsEnabled ? 'enabled' : 'disabled', lastTickAgeMs: null, lastPaymentsCheckAgeMs: null },
        },
        { status: 503, headers },
      );
    }

    const lastTickAgeMs = ageMs(heartbeat.lastTickAt, heartbeat.startedAt);
    const lastPaymentsCheckAgeMs = ageMs(heartbeat.lastPaymentsCheckAt, heartbeat.startedAt);
    // payments disabled → отсутствие/устаревание lastPaymentsCheckAt не роняет воркера.
    const workerOk = lastTickAgeMs <= TICK_STALE_MS
      && (!paymentsEnabled || lastPaymentsCheckAgeMs <= PAYMENTS_STALE_MS);

    return NextResponse.json(
      {
        status: workerOk ? 'ok' : 'degraded', db: 'up', version: pkg.version,
        worker: {
          ok: workerOk,
          payments: paymentsEnabled ? 'enabled' : 'disabled',
          lastTickAgeMs,
          lastPaymentsCheckAgeMs: paymentsEnabled ? lastPaymentsCheckAgeMs : null,
        },
      },
      { status: workerOk ? 200 : 503, headers },
    );
  } catch (error) {
    jsonLog('error', 'health: БД недоступна', { error: String(error) });
    return NextResponse.json({ status: 'error', db: 'down' }, { status: 503, headers });
  }
}
