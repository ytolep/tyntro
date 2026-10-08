import { Market } from '../types';
import { SnapshotAdapter } from './SnapshotAdapter';
export class PhoenixSpotAdapter extends SnapshotAdapter {
  constructor(market: Market) {
    if (market.type !== 'spot') throw new Error('Incorrect market type');
    super(market);
  }
}
