// Агент K «Нагрузка»: запись живых mark-цен Phoenix в JSONL.
// Использование: node --import tsx scripts/record-prices.ts [минуты]   (по умолчанию 20)
// Выход: scripts/data/prices-<UTC-таймстамп>.jsonl
//   1-я строка  {"type":"meta", intervalMs, markets:{SYMBOL-PERP: Market}}
//   далее        {"type":"tick", i, t, marks:{SYMBOL-PERP: number}}
// Phoenix perp-api жёстко лимитирует (429 при бёрстах):mark-цены берём
// последовательно с паузами и retry — так 20 минут записи проходят без потерь.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMarket } from '../src/lib/marketData/catalog';
import { phoenixJson } from '../src/lib/marketData/server';
import type { Market } from '../src/lib/marketData/types';

const MINUTES = Number(process.argv[2] ?? process.env.MINUTES ?? 20);
const INTERVAL_MS = 10_000;
const INTRA_GAP_MS = 350;
const MAX_MARKETS = 8;
// Порядок — от самых ликвидных перпов Phoenix вниз; берём первые активные.
const CANDIDATE_BASES = ['SOL', 'BTC', 'ETH', 'BNB', 'WIF', 'JUP', 'TRX', 'XRP', 'DOGE', 'SUI', 'LINK', 'AVAX', 'LTC', 'ONDO', 'UNI'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

async function pickMarkets(): Promise<Market[]> {
  const picked: Market[] = [];
  for (const base of CANDIDATE_BASES) {
    if (picked.length >= MAX_MARKETS) break;
    const market = await resolveMarket(`${base}-PERP`).catch(() => undefined);
    if (market && market.type === 'perp' && market.status === 'active') picked.push(market);
  }
  if (picked.length < 5) throw new Error(`Phoenix: найдено только ${picked.length} активных ликвидных рынков`);
  return picked;
}

/** mark-price с retry: 429 → пауза и повтор, до 3 попыток. */
async function fetchMark(base: string): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await phoenixJson(`/v1/market/${encodeURIComponent(base)}/mark-price`);
      const price = raw?.markPrice?.price;
      if (raw?.symbol !== base || typeof price !== 'number' || !(price > 0)) throw new Error('bad mark payload');
      return price;
    } catch (e) {
      lastError = e;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const markets = await pickMarkets();
  const startedAt = new Date();
  // argv[3] — дозапись в существующий файл после обрыва: тики продолжают нумерацию.
  const resumePath = process.argv[3];
  const file = resumePath ?? join(import.meta.dirname, 'data', `prices-${stamp(startedAt)}.jsonl`);
  mkdirSync(join(import.meta.dirname, 'data'), { recursive: true });
  if (!resumePath) writeFileSync(file, JSON.stringify({ type: 'meta', v: 1, intervalMs: INTERVAL_MS, source: 'phoenix', markets }) + '\n');

  const lastMarks = new Map<string, number>();
  let startTick = 0;
  if (resumePath) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row: any;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'tick') {
        startTick = row.i + 1;
        for (const [k, v] of Object.entries(row.marks ?? {}) as [string, number][]) lastMarks.set(k, v);
      }
    }
    appendFileSync(file, ''); // файл существует?
  }
  const ticks = Math.max(1, Math.round((MINUTES * 60_000) / INTERVAL_MS));
  let fetchErrors = 0;

  console.log(`Запись ${MINUTES} мин (тик ${INTERVAL_MS / 1000} с)${resumePath ? `, продолжение с тика ${startTick}` : ''}: ${markets.map((m) => m.symbol).join(', ')}\n→ ${file}`);
  const t0 = Date.now();
  for (let i = startTick; i < startTick + ticks; i++) {
    for (const market of markets) {
      try {
        lastMarks.set(market.symbol, await fetchMark(market.baseAsset));
      } catch {
        fetchErrors++; // форвард-филл: линия пишется с последней известной ценой
      }
      await sleep(INTRA_GAP_MS);
    }
    appendFileSync(file, JSON.stringify({ type: 'tick', i, t: Date.now(), marks: Object.fromEntries(lastMarks) }) + '\n');
    if (i % 6 === 0) console.log(`[${((Date.now() - t0) / 60000).toFixed(0)}/${MINUTES} мин] тик ${i}/${ticks}, ошибок сети ${fetchErrors}`);
    await sleep(Math.max(0, INTERVAL_MS - markets.length * (INTRA_GAP_MS + 500)));
  }
  console.log(`Готово: ${ticks} тиков, ${markets.length} рынков, ошибок сети ${fetchErrors}. Файл: ${file}`);
}

main().catch((e) => {
  console.error('record-prices упал:', e);
  process.exit(1);
});
