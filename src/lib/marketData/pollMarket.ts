import { MarketSnapshot, isFreshSnapshot } from './types';

// One in-flight request; cancellation also fences results from transports ignoring abort.
export function pollMarket(
  symbol: string,
  fetchSnapshot: (signal: AbortSignal) => Promise<MarketSnapshot>,
  onData: (value: MarketSnapshot | null) => void,
  onStatus: (value: 'connected' | 'error' | 'connecting' | 'reconnecting') => void,
  intervalMs = 2500, timeoutMs = 10000,
): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let last: MarketSnapshot | null = null, failures = 0;
  async function poll() {
    controller = new AbortController();
    const requestController = controller;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { requestController.abort(); reject(new Error('Timed out')); }, timeoutMs);
    });
    try {
      const snapshot = await Promise.race([fetchSnapshot(requestController.signal), deadline]);
      if (stopped) return;
      if (!isFreshSnapshot(snapshot, symbol) || snapshot.slot < (last?.slot ?? -1)) throw new Error('Stale snapshot');
      last = snapshot;
      failures = 0;
      onData(snapshot); onStatus('connected');
    } catch {
      if (stopped) return;
      failures++;
      // M1: одиночный сбой не стирает последний свежий снапшот — держим его, пока
      // он свеж по isFreshSnapshot (≤30 с), со статусом «reconnecting»; прочерк — только после.
      const keep = last && isFreshSnapshot(last, symbol) ? last : null;
      onData(keep); onStatus(keep ? 'reconnecting' : 'error');
    } finally {
      clearTimeout(timeout!);
      if (!stopped) timer = setTimeout(poll, Math.min(intervalMs * 2 ** Math.min(failures, 3), 20000));
    }
  }
  onStatus('connecting');
  void poll();
  return () => { stopped = true; controller?.abort(); clearTimeout(timer); };
}

// M2: рынок по умолчанию — SSE /api/phoenix/stream (серверный WebSocket-поток).
// Ошибки/тишина EventSource — откат на текущий поллинг (fetchSnapshot). Проверки
// свежести и монотонности слота на клиенте сохранены как в pollMarket.
export function streamMarket(
  symbol: string,
  fetchSnapshot: (signal: AbortSignal) => Promise<MarketSnapshot>,
  onData: (value: MarketSnapshot | null) => void,
  onStatus: (value: 'connected' | 'error' | 'connecting' | 'reconnecting') => void,
  options: { firstMessageMs?: number; maxFailures?: number } = {},
): () => void {
  const firstMessageMs = options.firstMessageMs ?? 10_000;
  const maxFailures = options.maxFailures ?? 3;
  let stopped = false, gotFirst = false, failures = 0;
  let last: MarketSnapshot | null = null;
  let source: EventSource | null = null;
  let stopPoll: (() => void) | null = null;
  let firstTimer: ReturnType<typeof setTimeout> | undefined;
  const fallbackToPolling = () => {
    if (stopped || stopPoll) return;
    source?.close();
    stopPoll = pollMarket(symbol, fetchSnapshot, onData, onStatus);
  };
  try {
    source = new EventSource(`/api/phoenix/stream?symbol=${encodeURIComponent(symbol)}`);
  } catch {
    fallbackToPolling();
    return () => { stopped = true; stopPoll?.(); };
  }
  firstTimer = setTimeout(() => { if (!gotFirst) fallbackToPolling(); }, firstMessageMs);
  source.onmessage = (event: MessageEvent<string>) => {
    if (stopped || stopPoll) return;
    let snapshot: MarketSnapshot;
    try { snapshot = JSON.parse(event.data); } catch { return; }
    if (!isFreshSnapshot(snapshot, symbol) || snapshot.slot < (last?.slot ?? -1)) return; // честность на клиенте
    gotFirst = true;
    failures = 0;
    last = snapshot;
    onData(snapshot); onStatus('connected');
  };
  source.onerror = () => {
    if (stopped || stopPoll) return;
    failures++;
    // M1: последний свежий снапшот держим, пока он свеж; прочерк — только после.
    const keep = last && isFreshSnapshot(last, symbol) ? last : null;
    onData(keep); onStatus(keep ? 'reconnecting' : 'error');
    if (failures >= maxFailures) fallbackToPolling();
  };
  return () => {
    stopped = true;
    clearTimeout(firstTimer);
    source?.close();
    stopPoll?.();
  };
}
