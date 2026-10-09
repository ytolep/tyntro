import { NextResponse } from 'next/server';
import { resolveMarket } from '@/lib/marketData/catalog';
import { phoenixStream } from '@/lib/marketData/server';

// SSE поверх серверного WebSocket-потока Phoenix: снапшот при каждом обновлении,
// не чаще 4 раз в секунду на клиента; heartbeat-комментарий раз в 15 с; закрытие
// при уходе клиента (req.signal). Клиент при ошибке EventSource откатывается на поллинг.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SEND_TICK_MS = 250;          // ≤4 события в секунду на клиента
const HEARTBEAT_MS = 15_000;
const COLD_START_GRACE_MS = 10_000; // сколько ждём первый снапшот при старте, пока не закрыть поток

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get('symbol') || 'SOL-PERP';
  let market;
  try {
    market = await resolveMarket(symbol);
  } catch {
    return NextResponse.json({ error: 'Market data unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!market || market.type !== 'perp')
    return NextResponse.json({ error: 'Market or instrument type is not supported' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } });

  phoenixStream.ensureSubscribed(market.baseAsset);
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let stop: () => void = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastKey = '';
      let lastEventAt = startedAt;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(sendTimer);
        clearInterval(heartbeatTimer);
        req.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* уже закрыт клиентом */ }
      };
      const sendTimer = setInterval(() => {
        if (closed) return;
        const snapshot = phoenixStream.peek(market);
        if (snapshot) {
          const key = `${snapshot.slot}:${snapshot.sourceTimestamp}`;
          if (key !== lastKey) {
            lastKey = key;
            lastEventAt = Date.now();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
          }
          return;
        }
        // Данных нет: холодный старт терпим, иначе (поток недоступен) закрываем —
        // EventSource клиента уйдёт в ошибку и откатится на поллинг.
        if (!phoenixStream.available() && Date.now() - startedAt > COLD_START_GRACE_MS) close();
      }, SEND_TICK_MS);
      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastEventAt >= HEARTBEAT_MS) {
          lastEventAt = Date.now();
          controller.enqueue(encoder.encode(': ping\n\n'));
        }
      }, 1_000);
      req.signal.addEventListener('abort', close);
      stop = close;
    },
    cancel() { stop(); },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
