import { MarketSnapshot, isFreshSnapshot } from './types';

// One in-flight request; cancellation also fences results from transports ignoring abort.
export function pollMarket(
  symbol: string,
  fetchSnapshot: (signal: AbortSignal) => Promise<MarketSnapshot>,
  onData: (value: MarketSnapshot | null) => void,
  onStatus: (value: 'connected' | 'error' | 'connecting') => void,
  intervalMs = 2500, timeoutMs = 10000,
): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let lastSlot = -1, failures = 0;
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
      if (!isFreshSnapshot(snapshot, symbol) || snapshot.slot < lastSlot) throw new Error('Stale snapshot');
      lastSlot = snapshot.slot;
      failures = 0;
      onData(snapshot); onStatus('connected');
    } catch {
      if (stopped) return;
      failures++;
      onData(null); onStatus('error');
    } finally {
      clearTimeout(timeout!);
      if (!stopped) timer = setTimeout(poll, Math.min(intervalMs * 2 ** Math.min(failures, 3), 20000));
    }
  }
  onStatus('connecting');
  void poll();
  return () => { stopped = true; controller?.abort(); clearTimeout(timer); };
}
