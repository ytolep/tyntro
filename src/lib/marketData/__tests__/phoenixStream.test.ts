// Тесты WS-потока Phoenix: разбор сообщений, правило свежести (fail-closed),
// разрыв соединения, отписка по таймауту, монотонность слота, переподключение.
// Без сети: внедрённая фабрика WebSocket, виртуальные часы и таймеры.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOK_MARKET_MAX_AGE_MS, createPhoenixStream, IDLE_UNSUBSCRIBE_MS, SLOT_ADVANCE_MAX_AGE_MS,
} from '../phoenixStream';
import { Market } from '../types';

const SOL: Market = { symbol: 'SOL-PERP', type: 'perp', baseAsset: 'SOL', quoteAsset: 'USD' };
const SWEEP_INTERVAL_MS = 15_000; // период sweep в реализации — запас для гарантированной отписки

class FakeSocket {
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) {}
  send(data: string): void { this.sent.push(data); }
  close(): void { this.onclose?.({}); }
  /** Сервер: открыть соединение. */
  open(): void { this.onopen?.({}); }
  /** Сервер: прислать сообщение. */
  push(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }); }
}

interface Harness {
  clock: { now: number };
  advance: (ms: number) => void;
  sockets: FakeSocket[];
  stream: ReturnType<typeof createPhoenixStream>;
}

function harness(getRpcSlot?: () => Promise<number | null>): Harness {
  const clock = { now: 1_000_000 };
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let seq = 0;
  const timer = (fn: () => void, ms: number) => {
    const id = ++seq;
    timers.push({ id, at: clock.now + ms, fn });
    return () => { const index = timers.findIndex(t => t.id === id); if (index >= 0) timers.splice(index, 1); };
  };
  const advance = (ms: number) => {
    const target = clock.now + ms;
    for (;;) {
      const due = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.now = due.at;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
    clock.now = target;
  };
  const sockets: FakeSocket[] = [];
  const stream = createPhoenixStream({
    connect: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket as unknown as WebSocket; },
    now: () => clock.now,
    timer,
    getRpcSlot,
  });
  return { clock, advance, sockets, stream };
}

function openSol(h: Harness): FakeSocket {
  h.stream.ensureSubscribed('SOL');
  const socket = h.sockets[0];
  socket.open();
  return socket;
}

const BOOK = { channel: 'orderbook', symbol: 'SOL', orderbook: { bids: [[109.66, 151.51]], asks: [[109.67, 95.84]], mid: 109.665 } };
const MARKET = { channel: 'market', symbol: 'SOL', markPx: 109.67, midPx: 109.665, oraclePx: 109.6, prevDayPx: 116.31, dayNtlVlm: 28771189.26, openInterest: 77776.33, funding: 0.000136 };
const MIDS = (slot: number) => ({ channel: 'allMids', mids: { SOL: 109.665 }, slot, slotIndex: 137 });

function feed(socket: FakeSocket, slot: number): void {
  socket.push(BOOK);
  socket.push(MARKET);
  socket.push(MIDS(slot));
}
const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

test('открывает соединение по требованию: allMids всегда, orderbook+market по символу', () => {
  const h = harness();
  assert.equal(h.sockets.length, 0);
  h.stream.ensureSubscribed('SOL');
  const socket = h.sockets[0];
  socket.open();
  const subscriptions = socket.sent.map(text => JSON.parse(text));
  assert.deepEqual(subscriptions.find(m => m.subscription?.channel === 'allMids'),
    { type: 'subscribe', subscription: { channel: 'allMids' } });
  assert.equal(subscriptions.filter(m => m.type === 'subscribe' && m.subscription.symbol === 'SOL').length, 2);
});

test('разбор сообщений: снапшот из orderbook+market+allMids с честным ticker', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 454699088);
  const snapshot = h.stream.peek(SOL);
  assert.ok(snapshot);
  assert.equal(snapshot.slot, 454699088);
  assert.equal(snapshot.marketId, 'SOL-PERP');
  assert.equal(snapshot.sourceMarketId, 'SOL');
  assert.equal(snapshot.orderBook.bids[0].price, 109.66);
  assert.equal(snapshot.orderBook.asks[0].size, 95.84);
  assert.equal(snapshot.ticker.markPrice, 109.67);
  assert.equal(snapshot.ticker.indexPrice, 109.6);
  assert.equal(snapshot.ticker.change24h, (109.67 / 116.31 - 1) * 100);
  assert.equal(snapshot.ticker.change24hUsd, 109.67 - 116.31);
  assert.equal(snapshot.ticker.volume24h, 28771189.26);
  assert.equal(snapshot.ticker.openInterest, 77776.33);
  assert.equal(snapshot.ticker.fundingRate, 0.000136);
  assert.equal(snapshot.ticker.lastPrice, null);   // ничего не выдумываем
  assert.equal(snapshot.ticker.high24h, null);
  assert.equal(snapshot.referencePrice, 109.67);
  assert.equal(snapshot.priceKind, 'mark');
  assert.equal(snapshot.sourceTimestamp, h.clock.now); // время получения сообщений, не время блока
});

test('кривые сообщения отклоняются: скрещённая книга, кривые уровни, чужой символ, кривой market', () => {
  const h = harness();
  const socket = openSol(h);
  // Скрещённая книга не принимается, снапшота нет.
  socket.push({ channel: 'orderbook', symbol: 'SOL', orderbook: { bids: [[110, 1]], asks: [[109.9, 1]] } });
  socket.push(MARKET);
  socket.push(MIDS(1));
  assert.equal(h.stream.peek(SOL), null);
  // Кривые уровни (цена-строка, отрицательный размер) не принимаются.
  socket.push({ channel: 'orderbook', symbol: 'SOL', orderbook: { bids: [['109.66', 1]], asks: [[109.67, 1]] } });
  socket.push({ channel: 'orderbook', symbol: 'SOL', orderbook: { bids: [[109.66, -1]], asks: [[109.67, 1]] } });
  // Чужой символ игнорируется.
  socket.push({ channel: 'orderbook', symbol: 'BTC', orderbook: { bids: [[1, 1]], asks: [[2, 1]] } });
  socket.push({ channel: 'market', symbol: 'BTC', markPx: 1 });
  assert.equal(h.stream.peek(SOL), null);
  // Market без markPx не принимается; без prevDayPx/dayNtlVlm поля честно null.
  socket.push({ channel: 'market', symbol: 'SOL', oraclePx: 109.6 });
  socket.push({ channel: 'market', symbol: 'SOL', markPx: 109.67 });
  socket.push(BOOK);
  socket.push(MIDS(2));
  const snapshot = h.stream.peek(SOL);
  assert.ok(snapshot);
  assert.equal(snapshot.ticker.markPrice, 109.67);
  assert.equal(snapshot.ticker.change24h, null);
  assert.equal(snapshot.ticker.volume24h, null);
});

test('свежесть fail-closed: старый стакан или market → недоступно', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 100);
  assert.ok(h.stream.peek(SOL));
  // Стакан стареет сверх 5 с — данных нет, старое не отдаём.
  h.advance(BOOK_MARKET_MAX_AGE_MS + 1);
  assert.equal(h.stream.peek(SOL), null);
  // Новый стакан, но market старый — всё ещё недоступно.
  socket.push(BOOK);
  assert.equal(h.stream.peek(SOL), null);
  // Обновился и market — доступно.
  socket.push(MARKET);
  socket.push(MIDS(101));
  assert.ok(h.stream.peek(SOL));
});

test('свежесть fail-closed: застрявший slot из allMids → недоступно', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 100);
  // Стакан и market продолжают приходить, но allMids молчит.
  h.advance(SLOT_ADVANCE_MAX_AGE_MS + 1);
  socket.push(BOOK);
  socket.push(MARKET);
  assert.equal(h.stream.peek(SOL), null);
  // Слот двинулся — снова доступно.
  socket.push(MIDS(101));
  assert.ok(h.stream.peek(SOL));
});

test('монотонность slot: регресс allMids игнорируется', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 200);
  assert.ok(h.stream.peek(SOL));
  h.advance(1000);
  socket.push(MIDS(199)); // slot пошёл назад — сообщение игнорируется
  socket.push(BOOK);
  socket.push(MARKET);
  const regressed = h.stream.peek(SOL);
  assert.ok(regressed);
  assert.equal(regressed.slot, 200);
});

test('разрыв соединения: все данные сразу недоступны, переподключение с backoff', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 100);
  assert.ok(h.stream.peek(SOL));
  assert.equal(h.stream.available(), true);
  socket.close(); // разрыв
  assert.equal(h.stream.available(), false);
  assert.equal(h.stream.peek(SOL), null); // старое не отдаём
  assert.equal(h.sockets.length, 1);
  h.advance(500); // backoff 0.5 с — новая попытка
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  assert.equal(h.stream.available(), true);
  // Повторная подписка всех активных символов и allMids.
  const resent = h.sockets[1].sent.map(text => JSON.parse(text));
  assert.equal(resent.filter(m => m.type === 'subscribe' && m.subscription.symbol === 'SOL').length, 2);
  assert.ok(resent.some(m => m.subscription?.channel === 'allMids'));
  feed(h.sockets[1], 101);
  assert.ok(h.stream.peek(SOL));
});

test('backoff растёт 0.5 → 1 → 2 … с и до 8 с', () => {
  const h = harness();
  h.stream.ensureSubscribed('SOL');
  h.sockets[0].open();
  h.sockets[0].close();
  h.advance(500);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].close();
  h.advance(500); // ещё 0.5 с — вторая попытка не раньше чем через 1 с
  assert.equal(h.sockets.length, 2);
  h.advance(500);
  assert.equal(h.sockets.length, 3);
});

test('ensureSubscribed отписывается, если к символу не обращались 60 с', () => {
  const h = harness();
  const socket = openSol(h);
  feed(socket, 100);
  assert.ok(h.stream.peek(SOL));
  // Обращаемся каждые 30 с (и данные текут) — подписка жива.
  h.advance(30_000); feed(socket, 101); h.stream.ensureSubscribed('SOL');
  h.advance(30_000); feed(socket, 102); h.stream.ensureSubscribed('SOL');
  assert.ok(h.stream.peek(SOL));
  // Больше не обращаемся: через 60 с sweep отписывает символ.
  h.advance(IDLE_UNSUBSCRIBE_MS + SWEEP_INTERVAL_MS);
  const messages = socket.sent.map(text => JSON.parse(text));
  assert.equal(messages.filter(m => m.type === 'unsubscribe' && m.subscription?.symbol === 'SOL').length, 2); // orderbook и market
  assert.equal(h.stream.peek(SOL), null);
  // Сообщения по отписанному символу больше не принимаются.
  feed(socket, 103);
  assert.equal(h.stream.peek(SOL), null);
  // Новое обращение — подписка снова.
  h.stream.ensureSubscribed('SOL');
  assert.equal(messages_length(socket, 'subscribe'), 4);
  feed(socket, 104);
  assert.ok(h.stream.peek(SOL));
});
function messages_length(socket: FakeSocket, type: string): number {
  return socket.sent.map(text => JSON.parse(text)).filter(m => m.type === type && m.subscription?.symbol === 'SOL').length;
}

test('санитарная сверка: slot из allMids отстаёт от RPC больше 150 слотов — поток застрял', async () => {
  let rpcSlot = 454699088;
  const h = harness(async () => rpcSlot);
  const socket = openSol(h);
  feed(socket, 454699000); // отставание 88 < 150
  assert.ok(h.stream.peek(SOL));
  h.advance(31_000); // санитарная проверка прошла — поток жив
  feed(socket, 454699100);
  rpcSlot = 454699300; // теперь отставание 200 > 150
  h.advance(31_000);   // следующая проверка: поток застрял
  await flushMicrotasks();
  assert.equal(h.stream.available(), false);
  assert.equal(h.stream.peek(SOL), null);
  // Переподключение и свежие данные восстанавливают поток.
  const reopened = h.sockets[h.sockets.length - 1];
  reopened.open();
  feed(reopened, 454699300);
  assert.equal(h.stream.available(), true);
  assert.ok(h.stream.peek(SOL));
});

test('waitForSnapshot: новая подписка дожидается первого стакана и market', async () => {
  const h = harness();
  const socket = openSol(h);
  const waiting = h.stream.waitForSnapshot(SOL, 3_000);
  // Через секунду приходят данные; следующий тик ожидания (50 мс) подхватывает их —
  // обещание разрешается, не дожидаясь таймаута.
  h.advance(1_000);
  feed(socket, 100);
  h.advance(100);
  const snapshot = await waiting;
  assert.ok(snapshot);
  assert.equal(snapshot.ticker.markPrice, 109.67);
});

test('waitForSnapshot: тишина до таймаута — null (снапшот недоступен)', async () => {
  const h = harness();
  openSol(h);
  const waiting = h.stream.waitForSnapshot(SOL, 3_000);
  h.advance(3_100); // таймеры waitForSnapshot тикают виртуальными часами
  assert.equal(await waiting, null);
});
