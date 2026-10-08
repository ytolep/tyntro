import { NextResponse } from 'next/server';
import { getPhoenixCandles } from '@/lib/marketData/candleServer';
import { getPhoenixMarkets, resolveMarket } from '@/lib/marketData/catalog';
import { getMarketSnapshot, MarketDataError } from '@/lib/marketData/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const action = params.get('action') || 'snapshot';
    if (action === 'markets') return NextResponse.json(await getPhoenixMarkets(), { headers });
    if (!['snapshot', 'orderbook', 'markPrice', 'stats', 'candles'].includes(action))
      throw new MarketDataError('Unsupported market data action', 400);
    const symbol = params.get('symbol') || 'SOL-PERP';
    const type = params.get('type') || undefined;
    const market = await resolveMarket(symbol, type);
    if (!market) throw new MarketDataError('Market or instrument type is not supported', 400);
    if (action === 'candles') return NextResponse.json(await getPhoenixCandles(market, params.get('timeframe') || '5m'), { headers });
    if (action === 'stats') return NextResponse.json({ symbol: market.symbol, stats: [], available: false }, { headers });
    const snapshot = await getMarketSnapshot(market.symbol);
    if (action === 'snapshot') return NextResponse.json(snapshot, { headers });
    if (action === 'markPrice') return NextResponse.json({ ...snapshot, symbol: market.baseAsset,
      markPrice: { price: snapshot.ticker.markPrice, slot: snapshot.slot } }, { headers });
    return NextResponse.json({ ...snapshot, symbol: market.baseAsset,
      bids: snapshot.orderBook.bids.map(x => [x.price, x.size]),
      asks: snapshot.orderBook.asks.map(x => [x.price, x.size]) }, { headers });
  } catch (error) {
    const status = error instanceof MarketDataError ? error.status : 503;
    // Do not include RPC URLs (which may contain credentials) in logs or responses.
    console.warn(JSON.stringify({ event: 'market_data_unavailable', status }));
    return NextResponse.json({ error: error instanceof MarketDataError ? error.message : 'Market data unavailable' }, { status, headers });
  }
}
