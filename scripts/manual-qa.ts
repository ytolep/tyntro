/**
 * Ручное тестирование: автопроверки против BASE_URL + пошаговый чек-лист по docs/MANUAL_QA.md.
 *
 *   BASE_URL=https://домен npx tsx scripts/manual-qa.ts                 # только автопроверки
 *   BASE_URL=https://домен npx tsx scripts/manual-qa.ts --checklist     # + чек-лист и отчёт
 *
 * Флаги: --checklist, --only=A,B (разделы чек-листа), --no-login (не создавать тестового
 * пользователя), --no-ratelimit (не проверять 429 — он на секунду блокирует вход с вашего IP),
 * --out=файл (отчёт; по умолчанию qa-report-<дата>.md в текущей папке).
 * Доступ к БД не нужен. Код выхода 0 — только если нет FAIL и непройденных шагов.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import bs58 from 'bs58';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// Локально (без Cloudflare и Caddy) приложение доверяет cf-ipcountry напрямую.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

type Res = { status: number; headers: Headers; body: any; text: string };

async function req(path: string, init: { method?: string; json?: unknown; body?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await fetch(BASE_URL + path, {
    method: init.method ?? (init.json !== undefined || init.body !== undefined ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: {
      ...(init.json !== undefined || init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* не JSON — оставляем текст */
  }
  return { status: res.status, headers: res.headers, body, text };
}

// ---- Автопроверки: PASS / FAIL / WARN ----
type Auto = { name: string; result: 'PASS' | 'FAIL' | 'WARN'; note: string };
const auto: Auto[] = [];

class Warn extends Error {}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = (await fn()) ?? '';
    auto.push({ name, result: 'PASS', note });
  } catch (e) {
    auto.push({ name, result: e instanceof Warn ? 'WARN' : 'FAIL', note: (e as Error).message });
  }
  const last = auto[auto.length - 1];
  console.log(`${last.result} ${name}${last.note ? ` — ${last.note}` : ''}`);
}

const PUBLIC_PAGES = ['/', '/challenges', '/terminal', '/leaderboard', '/transparency', '/rules', '/faq', '/terms', '/privacy', '/refunds', '/checkout?size=10000&plan=CORE', '/blocked'];
const CABINET_PAGES = ['/dashboard', '/history', '/trader-score', '/risk', '/profile', '/funded'];

/** Новый кошелёк → nonce → подпись SIWS → verify. Возвращает cookie и адрес. */
async function login(): Promise<{ cookie: string; wallet: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const wallet = bs58.encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const nonce = await req('/api/auth/nonce', { json: { wallet } });
  expect(nonce.status === 200 && typeof nonce.body?.message === 'string', `nonce → ${nonce.status}`);
  const host = new URL(BASE_URL).host;
  expect(nonce.body.message.startsWith(`${host} wants you to sign in`), `в сообщении чужой домен: ${nonce.body.message.split('\n')[0]}`);
  const signature = bs58.encode(sign(null, Buffer.from(nonce.body.message, 'utf8'), privateKey));
  const verify = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, signature, message: nonce.body.message }),
  });
  const token = verify.headers.get('set-cookie')?.match(/props_session=([^;]+)/)?.[1];
  expect(verify.status === 200 && token, `verify → ${verify.status}, cookie ${token ? 'есть' : 'нет'}`);
  return { cookie: `props_session=${token}`, wallet };
}

/** Первое событие SSE за 10 с. */
async function firstSseEvent(path: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(BASE_URL + path, { signal: ctrl.signal });
    expect(res.status === 200 && res.body, `статус ${res.status}`);
    const reader = res.body.getReader();
    let buf = '';
    while (!buf.includes('data:')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    expect(buf.includes('data:'), 'событий нет');
    return buf.slice(buf.indexOf('data:'), buf.indexOf('data:') + 60).replace(/\s+/g, ' ');
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

async function runAuto(): Promise<void> {
  console.log(`\n== Автопроверки: ${BASE_URL}\n`);

  await check('публичные страницы и кабинет без входа отвечают 200', async () => {
    const bad: string[] = [];
    for (const p of [...PUBLIC_PAGES, ...CABINET_PAGES]) {
      const r = await req(p);
      if (r.status !== 200) bad.push(`${p} → ${r.status}`);
    }
    expect(bad.length === 0, bad.join(', '));
    return `${PUBLIC_PAGES.length + CABINET_PAGES.length} страниц`;
  });

  await check('/admin без входа и несуществующий адрес → 404', async () => {
    const admin = await req('/admin');
    const missing = await req('/qa-no-such-page');
    expect(admin.status === 404, `/admin → ${admin.status}`);
    expect(missing.status === 404, `несуществующий → ${missing.status}`);
  });

  await check('robots.txt, sitemap.xml, opengraph-image', async () => {
    const robots = await req('/robots.txt');
    expect(robots.status === 200 && robots.text.includes('Disallow: /admin') && robots.text.includes('Sitemap:'), 'robots.txt без Disallow /admin или Sitemap');
    const sitemap = await req('/sitemap.xml');
    expect(sitemap.status === 200 && sitemap.text.includes('<urlset'), `sitemap.xml → ${sitemap.status}`);
    const og = await fetch(`${BASE_URL}/opengraph-image`);
    expect(og.status === 200 && og.headers.get('content-type')?.startsWith('image/png'), `opengraph-image → ${og.status} ${og.headers.get('content-type')}`);
  });

  await check('заголовки безопасности на /', async () => {
    const r = await req('/');
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp.includes("frame-ancestors 'none'"), 'нет CSP frame-ancestors');
    expect(r.headers.get('x-frame-options') === 'DENY', 'нет X-Frame-Options: DENY');
    expect(r.headers.get('x-content-type-options') === 'nosniff', 'нет X-Content-Type-Options');
    if (BASE_URL.startsWith('https://') && !r.headers.get('strict-transport-security')) throw new Warn('нет HSTS');
  });

  await check('/api/health: БД и воркер', async () => {
    const r = await req('/api/health');
    expect(r.status === 200 && r.body?.status === 'ok', `${r.status} ${r.text.slice(0, 120)}`);
    expect(r.body.worker?.ok === true, `воркер не ok: ${JSON.stringify(r.body.worker)}`);
    if (r.body.worker?.payments === 'disabled') throw new Warn('проверка оплат выключена (нет TREASURY_WALLET)');
    return `тик ${r.body.worker.lastTickAgeMs} мс назад, оплаты ${r.body.worker.payments}`;
  });

  await check('рыночные данные Phoenix: снимок SOL-PERP', async () => {
    const r = await req('/api/phoenix?action=snapshot&symbol=SOL-PERP&type=perp');
    expect(r.status === 200 && Number(r.body?.referencePrice) > 0, `${r.status} ${r.text.slice(0, 120)}`);
    return `цена ${r.body.referencePrice}`;
  });

  await check('поток рынка /api/phoenix/stream отдаёт события', () => firstSseEvent('/api/phoenix/stream?symbol=SOL-PERP'));

  await check('лидерборд (кэш 60 с) и прозрачность', async () => {
    const lb = await req('/api/leaderboard');
    expect(lb.status === 200 && Array.isArray(lb.body?.entries), `leaderboard → ${lb.status}`);
    expect(lb.headers.get('cache-control')?.includes('max-age=60'), 'нет Cache-Control max-age=60');
    const tr = await req('/api/transparency');
    expect(tr.status === 200, `transparency → ${tr.status}`);
    return `в лидерборде ${lb.body.entries.length}`;
  });

  await check('API без входа → 401', async () => {
    const bad: string[] = [];
    for (const [path, init] of [
      ['/api/orders', { json: { action: 'OPEN_POSITION' } }],
      ['/api/accounts/active', {}],
      ['/api/payouts', {}],
      ['/api/admin/metrics', {}],
    ] as const) {
      const r = await req(path, init);
      if (r.status !== 401) bad.push(`${path} → ${r.status}`);
    }
    expect(bad.length === 0, bad.join(', '));
  });

  await check('гео: подделанный x-vercel-ip-country: US не блокирует', async () => {
    const r = await req('/', { headers: { 'x-vercel-ip-country': 'US' } });
    expect(r.status === 200, `статус ${r.status} ${r.headers.get('location') ?? ''}`);
  });

  await check(LOCAL ? 'гео: cf-ipcountry: US → /blocked и 451 (локально заголовок доверенный)' : 'гео: подделанный cf-ipcountry: US не блокирует (его перезаписывает Cloudflare или вырезает Caddy)', async () => {
    const page = await req('/', { headers: { 'cf-ipcountry': 'US' } });
    const api = await req('/api/leaderboard', { headers: { 'cf-ipcountry': 'US' } });
    if (LOCAL) {
      expect(page.status === 307 && page.headers.get('location')?.endsWith('/blocked'), `страница → ${page.status}`);
      expect(api.status === 451, `API → ${api.status}`);
    } else {
      expect(page.status === 200, `страница → ${page.status} ${page.headers.get('location') ?? ''} (вы в заблокированной стране или нет Cloudflare/Caddy?)`);
    }
  });

  if (flag('no-login')) {
    auto.push({ name: 'вход и проверки с сессией', result: 'WARN', note: 'пропущено (--no-login)' });
  } else {
    // Держатель вместо let: присваивание внутри колбэка check TS не видит при сужении типа.
    const held: { session?: { cookie: string; wallet: string } } = {};
    await check('вход SIWS новым кошельком: nonce → подпись → cookie', async () => {
      held.session = await login();
      return `${held.session.wallet.slice(0, 4)}…${held.session.wallet.slice(-4)} (создан тестовый пользователь)`;
    });
    if (held.session) {
      const { cookie, wallet } = held.session;
      await check('сессия: /api/auth/me, обычный пользователь не видит админку', async () => {
        const me = await req('/api/auth/me', { cookie });
        expect(me.status === 200 && me.body?.user?.walletAddress === wallet && me.body.user.role === 'USER', `me → ${me.status} ${me.text.slice(0, 100)}`);
        const api = await req('/api/admin/metrics', { cookie });
        expect(api.status === 403, `/api/admin/metrics → ${api.status}`);
        const page = await req('/admin', { cookie });
        expect(page.status === 404, `/admin → ${page.status}`);
      });
      await check('тело POST /api/orders больше 16 КБ → 413', async () => {
        const r = await req('/api/orders', { cookie, body: JSON.stringify({ action: 'OPEN_POSITION', pad: 'x'.repeat(17 * 1024) }) });
        expect(r.status === 413, `статус ${r.status}`);
      });
      await check('выход: после logout сессия недействительна', async () => {
        await req('/api/auth/logout', { method: 'POST', cookie });
        const me = await req('/api/auth/me', { cookie });
        expect(me.status === 401 || me.body?.user == null, `me после выхода → ${me.status}`);
      });
    }
  }

  if (flag('no-ratelimit')) {
    auto.push({ name: 'rate-limit /api/auth/*', result: 'WARN', note: 'пропущено (--no-ratelimit)' });
  } else {
    await check('rate-limit: всплеск запросов к /api/auth/nonce → 429', async () => {
      const codes = await Promise.all(Array.from({ length: 15 }, () => req('/api/auth/nonce', { json: {} }).then((r) => r.status)));
      expect(codes.includes(429), `429 не было: ${[...new Set(codes)].join(',')}`);
      return `${codes.filter((c) => c === 429).length} из 15 отклонены`;
    });
  }
}

// ---- Чек-лист по docs/MANUAL_QA.md ----
/** Ответы по строкам из очереди: readline/promises теряет строки, пришедшие из пайпа раньше вопроса. Конец ввода → null. */
function answers() {
  const rl = createInterface({ input: process.stdin });
  const queue: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => (waiting.shift() ?? ((l: string) => queue.push(l)))(line));
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(null);
  });
  return {
    ask(prompt: string): Promise<string | null> {
      process.stdout.write(prompt);
      if (queue.length) return Promise.resolve(queue.shift()!);
      return closed ? Promise.resolve(null) : new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
  };
}

type Step = { id: string; section: string; text: string; result: 'PASS' | 'FAIL' | 'SKIP' | 'NOT RUN'; note: string };

function parseScenarios(): Step[] {
  const md = readFileSync(join(import.meta.dirname, '..', 'docs', 'MANUAL_QA.md'), 'utf8');
  const steps: Step[] = [];
  let section: { letter: string; title: string } | null = null;
  for (const line of md.slice(md.indexOf('## Сценарии')).split('\n')) {
    const head = line.match(/^### ([A-Z])\. (.+)$/);
    if (head) section = { letter: head[1], title: head[2] };
    const item = line.match(/^(\d+)\. (.+)$/);
    if (item && section) steps.push({ id: `${section.letter}${item[1]}`, section: `${section.letter}. ${section.title}`, text: item[2], result: 'NOT RUN', note: '' });
  }
  return steps;
}

async function runChecklist(): Promise<Step[]> {
  const only = opt('only')?.toUpperCase().split(',');
  const steps = parseScenarios().filter((s) => !only || only.includes(s.id[0]));
  console.log(`\n== Чек-лист: ${steps.length} шагов. Ответ: y — прошло, n — не прошло, s — пропустить, q — закончить\n`);
  const rl = answers();
  let section = '';
  try {
    for (const step of steps) {
      if (step.section !== section) console.log(`\n${(section = step.section)}`);
      const answer = (await rl.ask(`  [${step.id}] ${step.text}\n      > `))?.trim().toLowerCase() ?? 'q';
      if (answer === 'q') break;
      if (answer === 'y') step.result = 'PASS';
      else if (answer === 'n') {
        step.result = 'FAIL';
        step.note = (await rl.ask('      что не так? '))?.trim() ?? '';
      } else step.result = 'SKIP';
    }
  } finally {
    rl.close();
  }
  return steps;
}

function report(steps: Step[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    `# Отчёт ручного тестирования`,
    ``,
    `- Адрес: ${BASE_URL}`,
    `- Дата: ${new Date().toISOString()}`,
    ``,
    `## Автопроверки`,
    ``,
    `| Результат | Проверка | Примечание |`,
    `|---|---|---|`,
    ...auto.map((a) => `| ${a.result} | ${cell(a.name)} | ${cell(a.note)} |`),
  ];
  if (steps.length) {
    lines.push(``, `## Чек-лист`, ``, `| Шаг | Результат | Сценарий | Примечание |`, `|---|---|---|---|`);
    lines.push(...steps.map((s) => `| ${s.id} | ${s.result} | ${cell(s.text)} | ${cell(s.note)} |`));
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  await runAuto();
  const steps = flag('checklist') ? await runChecklist() : [];
  const autoFail = auto.filter((a) => a.result === 'FAIL').length;
  const stepFail = steps.filter((s) => s.result === 'FAIL').length;
  console.log(`\nАвтопроверки: ${auto.length - autoFail} из ${auto.length} без FAIL (WARN: ${auto.filter((a) => a.result === 'WARN').length})`);
  if (steps.length) {
    const count = (r: Step['result']) => steps.filter((s) => s.result === r).length;
    console.log(`Чек-лист: PASS ${count('PASS')}, FAIL ${stepFail}, SKIP ${count('SKIP')}, не дошли ${count('NOT RUN')}`);
  }
  if (steps.length || opt('out')) {
    const out = opt('out') ?? `qa-report-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.md`;
    writeFileSync(out, report(steps));
    console.log(`Отчёт: ${out}`);
  }
  process.exit(autoFail || stepFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
