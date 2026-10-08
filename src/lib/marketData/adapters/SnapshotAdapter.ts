import { isFreshSnapshot, Market, MarketSnapshot } from '../types';
export class SnapshotAdapter {
  constructor(protected market: Market) {}
  getMarket(): Market { return this.market; }
  async fetchSnapshot(signal: AbortSignal): Promise<MarketSnapshot> {
    const params = new URLSearchParams({ action: 'snapshot', symbol: this.market.symbol, type: this.market.type });
    const res = await fetch(`/api/phoenix?${params}`, { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Market data unavailable');
    const snapshot: MarketSnapshot = await res.json();
    if (!snapshot?.market || !snapshot.orderBook || !snapshot.ticker ||
        snapshot.market.type !== this.market.type ||
        snapshot.source !== (this.market.type === 'spot' ? 'phoenix-spot' : 'phoenix-perp') ||
        !isFreshSnapshot(snapshot, this.market.symbol)) throw new Error('Stale or mismatched market data');
    return snapshot;
  }
}
