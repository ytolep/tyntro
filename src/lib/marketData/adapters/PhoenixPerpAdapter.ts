import { Market } from '../types';
import { SnapshotAdapter } from './SnapshotAdapter';
export class PhoenixPerpAdapter extends SnapshotAdapter {
  constructor(market: Market) {
    if (market.type !== 'perp') throw new Error('Incorrect market type');
    super(market);
  }
}
