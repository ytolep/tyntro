import { Market, MarketSnapshot, NormalizedOrderBook, NormalizedTicker } from './types';
import { parseOrderBookSides } from './orderBookValidator';

export const PHOENIX_WS_URL = 'wss://perp-api.phoenix.trade/v1/ws';

/** Свежесть fail-closed. Канал market Phoenix шлёт ~1 сообщение в секунду по каждому
 *  рынку — это пульс: без него дольше этого времени рынок недоступен. */
export const MARKET_MAX_AGE_MS = 5_000;
/** Стакан Phoenix присылает только при изменении (замер 9.10.2026: спокойные рынки молчат
 *  до 20 с), поэтому книга действует до следующего сообщения, но не дольше этого. */
export const BOOK_MAX_AGE_MS = 30_000;
/** Книга, середина которой разошлась с markPx сильнее этой доли, считается недостоверной. */
export const BOOK_MARK_MAX_DEVIATION = 0.02;
/** Slot из allMids должен продвигаться хотя бы с таким интервалом. */
export const SLOT_ADVANCE_MAX_AGE_MS = 15_000;
/** К символу не обращались столько — отписываемся от orderbook и market. */
export const IDLE_UNSUBSCRIBE_MS = 60_000;
/** Санитарная сверка слота allMids с RPC: реже не проверяем, отставание больше
 *  RPC_MAX_SLOT_LAG слотов считается застрявшим потоком. */
export const RPC_CHECK_INTERVAL_MS = 30_000;
export const RPC_MAX_SLOT_LAG = 150;

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const SWEEP_INTERVAL_MS = 15_000;
const WAIT_POLL_MS = 50;

export type CancelTimer = () => void;

export interface PhoenixStreamDeps {
  url?: string;
  /** Фабрика сокета — внедряется в тестах, продакшн — глобальный WebSocket (Node 22+). */
  connect?: (url: string) => WebSocket;
  now?: () => number;
  /** Таймер, не держащий процесс (unref); в тестах — управляемые виртуальные часы. */
  timer?: (fn: () => void, ms: number) => CancelTimer;
  /** Санитарная сверка слота с RPC; без него проверка отключена. */
  getRpcSlot?: () => Promise<number | null>;
}

interface MarketTick {
  markPx: number;
  oraclePx: number | null;
  prevDayPx: number | null;
  dayNtlVlm: number | null;
  openInterest: number | null;
  funding: number | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function positive(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}
function nonNegative(value: unknown): number | null {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
}

/** Канал market Phoenix; markPx обязателен, остальное честно null, если поля нет. */
export function parseMarketTick(raw: any): MarketTick | null {
  const markPx = positive(raw?.markPx);
  if (markPx === null) return null;
  return {
    markPx,
    oraclePx: positive(raw.oraclePx),
    prevDayPx: positive(raw.prevDayPx),
    dayNtlVlm: nonNegative(raw.dayNtlVlm),
    openInterest: nonNegative(raw.openInterest),
    funding: num(raw.funding),
  };
}

/** Ticker из market-канала: ничего не выдумываем, отсутствующее — null. */
export function buildTicker(market: Market, tick: MarketTick, timestamp: number): NormalizedTicker {
  return {
    symbol: market.symbol,
    type: market.type,
    lastPrice: null,
    markPrice: tick.markPx,
    indexPrice: tick.oraclePx,
    change24h: tick.prevDayPx !== null ? (tick.markPx / tick.prevDayPx - 1) * 100 : null,
    change24hUsd: tick.prevDayPx !== null ? tick.markPx - tick.prevDayPx : null,
    high24h: null,
    low24h: null,
    volume24h: tick.dayNtlVlm,
    openInterest: tick.openInterest,
    fundingRate: tick.funding,
    fundingTimeLeft: null,
    timestamp,
  };
}

/** Один WebSocket на процесс: allMids всегда, orderbook+market по требованию. */
export function createPhoenixStream(deps: PhoenixStreamDeps = {}) {
  const url = deps.url ?? PHOENIX_WS_URL;
  const now = deps.now ?? Date.now;
  const connect = deps.connect ?? ((u: string) => new WebSocket(u));
  const timer = deps.timer ?? ((fn: () => void, ms: number) => {
    const handle: unknown = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle as ReturnType<typeof setTimeout>);
  });

  type Status = 'idle' | 'connecting' | 'open' | 'reconnecting';
  interface SymbolState {
    lastAccess: number;
    /** Желаемая подписка (наш запрос); подтверждение сервера не ждём. */
    desired: boolean;
    book: NormalizedOrderBook | null;
    bookAt: number;
    market: MarketTick | null;
    marketAt: number;
  }
  let status: Status = 'idle';
  let ws: WebSocket | null = null;
  let backoffMs = RECONNECT_MIN_MS;
  let cancelReconnect: CancelTimer | null = null;
  let sweepStarted = false;
  let midsSlot: number | null = null;
  let lastSlotAdvanceAt = -Infinity;
  let stuck = false;
  let lastRpcCheckAt = 0;

  const symbols = new Map<string, SymbolState>();

  function state(symbol: string): SymbolState {
    let s = symbols.get(symbol);
    if (!s) {
      s = { lastAccess: 0, desired: false, book: null, bookAt: 0, market: null, marketAt: 0 };
      symbols.set(symbol, s);
    }
    return s;
  }

  function send(message: unknown): void {
    try { ws?.send(JSON.stringify(message)); } catch { /* закрытие соединения обработает onclose */ }
  }
  function subscribeSymbol(symbol: string): void {
    send({ type: 'subscribe', subscription: { channel: 'orderbook', symbol } });
    send({ type: 'subscribe', subscription: { channel: 'market', symbol } });
  }
  function unsubscribeSymbol(symbol: string): void {
    send({ type: 'unsubscribe', subscription: { channel: 'orderbook', symbol } });
    send({ type: 'unsubscribe', subscription: { channel: 'market', symbol } });
  }

  /** Разрыв или сбой: все данные немедленно недоступны (fail-closed), переподключение с backoff. */
  function onLost(socket: WebSocket): void {
    if (ws !== socket) return;
    ws = null;
    status = 'reconnecting';
    for (const s of symbols.values()) { s.book = null; s.market = null; }
    // midsSlot сохраняем для проверки монотонности; продвижение слота сбрасываем.
    lastSlotAdvanceAt = -Infinity;
    cancelReconnect?.();
    cancelReconnect = timer(() => connectNow(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }

  function connectNow(): void {
    status = 'connecting';
    let socket: WebSocket;
    try {
      socket = connect(url);
    } catch {
      scheduleFailure();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      status = 'open';
      stuck = false;
      backoffMs = RECONNECT_MIN_MS;
      send({ type: 'subscribe', subscription: { channel: 'allMids' } });
      for (const [symbol, s] of symbols) if (s.desired) subscribeSymbol(symbol);
    };
    socket.onmessage = (event: MessageEvent) => handleMessage(String(event.data));
    socket.onclose = () => onLost(socket);
    socket.onerror = () => { /* close следует за error; обрабатываем в onclose */ };
  }
  function scheduleFailure(): void {
    status = 'reconnecting';
    for (const s of symbols.values()) { s.book = null; s.market = null; }
    lastSlotAdvanceAt = -Infinity;
    cancelReconnect?.();
    cancelReconnect = timer(() => connectNow(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }

  function handleMessage(text: string): void {
    let message: any;
    try { message = JSON.parse(text); } catch { return; }
    if (!message || typeof message !== 'object') return;
    const channel = message.channel;
    if (channel === 'orderbook') {
      const s = symbols.get(message.symbol);
      if (!s?.desired) return;
      const book = parseOrderBookSides(message.orderbook?.bids, message.orderbook?.asks, now());
      if (book) { s.book = book; s.bookAt = now(); }
    } else if (channel === 'market') {
      const s = symbols.get(message.symbol);
      if (!s?.desired) return;
      const tick = parseMarketTick(message);
      if (tick) { s.market = tick; s.marketAt = now(); }
    } else if (channel === 'allMids') {
      const slot = message.slot;
      if (!Number.isSafeInteger(slot) || slot <= 0 || message.mids === null || typeof message.mids !== 'object') return;
      if (midsSlot !== null && slot < midsSlot) return; // регресс слота — застрявший поток
      if (slot > (midsSlot ?? -1)) { midsSlot = slot; lastSlotAdvanceAt = now(); }
    } else if (channel === 'subscriptionStatus' && message.subscription?.symbol) {
      const s = state(message.subscription.symbol);
      if (message.status === 'unsubscribed') { s.book = null; s.market = null; }
    }
    // subscriptionError / error: данные просто не обновятся и состарятся по правилам свежести.
  }

  /** Санитарная сверка: slot из allMids отстаёт от RPC больше чем на RPC_MAX_SLOT_LAG — поток застрял. */
  function checkRpcLag(): void {
    if (!deps.getRpcSlot || status !== 'open' || midsSlot === null) return;
    if (now() - lastRpcCheckAt < RPC_CHECK_INTERVAL_MS) return;
    lastRpcCheckAt = now();
    deps.getRpcSlot().then(rpcSlot => {
      if (rpcSlot !== null && midsSlot !== null && rpcSlot - midsSlot > RPC_MAX_SLOT_LAG) {
        stuck = true;
        for (const s of symbols.values()) { s.book = null; s.market = null; }
        lastSlotAdvanceAt = -Infinity;
        try { ws?.close(); } catch { /* onclose переподключит */ }
        if (!ws) scheduleFailure();
      }
    }).catch(() => { /* сбой RPC не топит рабочий поток: правила свежести остаются */ });
  }

  function sweep(): void {
    const t = now();
    for (const [symbol, s] of symbols) {
      if (s.desired && t - s.lastAccess > IDLE_UNSUBSCRIBE_MS) {
        s.desired = false;
        s.book = null;
        s.market = null;
        if (status === 'open') unsubscribeSymbol(symbol);
      }
    }
    checkRpcLag();
    timer(sweep, SWEEP_INTERVAL_MS);
  }

  return {
    /** Подписка по требованию: вызывает соединение из idle и подписку после открытия. */
    ensureSubscribed(symbol: string): void {
      const s = state(symbol);
      const wasDesired = s.desired;
      s.lastAccess = now();
      s.desired = true;
      if (status === 'idle') {
        status = 'connecting';
        if (!sweepStarted) { sweepStarted = true; timer(sweep, SWEEP_INTERVAL_MS); }
        connectNow();
      } else if (status === 'open' && !wasDesired) {
        subscribeSymbol(symbol);
      }
    },
    /** Поток можно использовать? Открыт и не застрял (санитарная проверка слота). */
    available(): boolean {
      return status === 'open' && !stuck;
    },
    status(): Status { return status; },
    /** Снапшот из памяти по правилам свежести; null — данные недоступны. */
    peek(market: Market): MarketSnapshot | null {
      const s = symbols.get(market.baseAsset);
      if (this.unavailableReason(market) !== null || !s?.book || !s.market || midsSlot === null) return null;
      const t = now();
      // Возраст данных — по пульсу market: книга без изменений остаётся верной, пока рынок жив.
      const sourceTimestamp = s.marketAt;
      const ticker = buildTicker(market, s.market, sourceTimestamp);
      return {
        marketId: market.symbol, market, source: 'phoenix-perp', sourceMarketId: market.baseAsset,
        sourceTimestamp, receivedAt: t, slot: midsSlot, orderBook: s.book, ticker,
        referencePrice: ticker.markPrice, priceKind: 'mark',
      };
    },
    /** Почему снапшота нет (для логов и ошибок); null — данные доступны. */
    unavailableReason(market: Market): string | null {
      const s = symbols.get(market.baseAsset);
      if (!this.available()) return stuck ? 'stream stuck' : `stream ${status}`;
      if (!s?.book) return 'no order book yet';
      if (!s.market) return 'no market tick yet';
      if (midsSlot === null) return 'no slot yet';
      const t = now();
      if (t - s.bookAt > BOOK_MAX_AGE_MS) return `order book ${t - s.bookAt}ms old`;
      if (t - s.marketAt > MARKET_MAX_AGE_MS) return `market tick ${t - s.marketAt}ms old`;
      if (t - lastSlotAdvanceAt > SLOT_ADVANCE_MAX_AGE_MS) return `slot not advancing for ${t - lastSlotAdvanceAt}ms`;
      const mark = s.market.markPx;
      if (s.book.midPrice > 0 && Math.abs(s.book.midPrice - mark) / mark > BOOK_MARK_MAX_DEVIATION) return 'order book diverged from mark';
      return null;
    },
    /** Ждать первый снапшот до timeoutMs (новая подписка); null — не дождались. */
    waitForSnapshot(market: Market, timeoutMs: number): Promise<MarketSnapshot | null> {
      return new Promise(resolve => {
        const attempt = () => {
          if (!this.available()) return resolve(null);
          const snapshot = this.peek(market);
          if (snapshot) return resolve(snapshot);
          if (now() >= deadline) return resolve(null);
          timer(attempt, WAIT_POLL_MS);
        };
        const deadline = now() + timeoutMs;
        attempt();
      });
    },
  };
}

export type PhoenixStream = ReturnType<typeof createPhoenixStream>;
