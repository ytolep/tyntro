# Ручное тестирование Tyntro

Справочник эндпоинтов и сценарии ручной проверки. Скрипт `scripts/manual-qa.ts` прогоняет
автоматические проверки против любого адреса и проводит по сценариям ниже как по чек-листу
(разделы `### X.` и нумерованные шаги — его формат, сохраняйте его при правках).

```sh
BASE_URL=https://ваш-домен npx tsx scripts/manual-qa.ts               # только автопроверки
BASE_URL=https://ваш-домен npx tsx scripts/manual-qa.ts --checklist   # + чек-лист, отчёт в qa-report-*.md
BASE_URL=http://localhost:3000 npx tsx scripts/manual-qa.ts --checklist --only=B,D
```

Правила планов: SPRINT — цель 9 %, дневная просадка 3 %, максимальная 3 %; CORE — 10/3/6 %;
APEX — 12/3/5 %. У всех минимум 3 торговых дня, сплит 80 %, плечо до 5.
Цены — из `src/lib/pricingConfig.ts` (сейчас тестовые $1 / $2 / $3).

## Эндпоинты API

Доступ: 🌐 без входа, 👤 нужен вход (cookie `props_session`), 🛡 только ADMIN.

| Метод | Путь | Доступ | Назначение и параметры |
|---|---|---|---|
| POST | `/api/auth/nonce` | 🌐 | `{wallet}` → сообщение SIWS для подписи |
| POST | `/api/auth/verify` | 🌐 | `{wallet, signature (base58), message}` → cookie сессии |
| GET | `/api/auth/me` | 👤 | текущий пользователь и роль |
| POST | `/api/auth/logout` | 🌐 | выход |
| POST | `/api/checkout/create` | 👤 | `{accountSize, planType, acceptedTerms, termsVersion, refundsVersion, rulesVersion}` → покупка PENDING и ссылка Solana Pay |
| GET | `/api/checkout/status?id=` | 👤 | статус покупки PENDING / PAID / EXPIRED |
| GET | `/api/accounts/active?accountId=` | 👤 | активный счёт и список счетов (без счетов — 404) |
| POST | `/api/orders` | 👤 | `action`: `OPEN_POSITION` (`accountId, symbol, side LONG/SHORT, orderMode Market/Limit, sizeUsd, leverage 1–5, limitPrice, idempotencyKey`), `CLOSE_POSITION`, `CANCEL_ORDER`; тело до 16 КБ |
| GET | `/api/trader-score?accountId=` | 👤 | Trader Score счёта |
| POST | `/api/funded/request` | 👤 | `{accountId}` — заявка на funded для PASSED-челленджа |
| GET | `/api/payouts` | 👤 | funded-счета, доступно к выплате, история выплат, KYC |
| POST | `/api/payouts/request` | 👤 | `{accountId, amount}` — заявка на выплату |
| GET | `/api/notifications` | 👤 | уведомления |
| POST | `/api/notifications/read` | 👤 | `{ids: [...]}` или `{all: true}` |
| GET | `/api/phoenix?action=snapshot\|markets\|candles&symbol=&type=&timeframe=` | 🌐 | рыночные данные Phoenix |
| GET | `/api/phoenix/stream?symbol=` | 🌐 | поток рынка (SSE) |
| GET | `/api/leaderboard` | 🌐 | топ-50, кэш 60 с |
| GET | `/api/transparency` | 🌐 | казна, продажи, доля прошедших, выплаты; кэш 60 с |
| GET | `/api/health?scope=web` | 🌐 | БД, воркер, проверка оплат; при зависшем воркере — 503 |
| GET | `/api/admin/metrics` | 🛡 | метрики платформы |
| GET | `/api/admin/queue` | 🛡 | очереди funded и выплат |
| GET | `/api/admin/purchases` | 🛡 | последние покупки |
| POST | `/api/admin/funded/approve` | 🛡 | `{accountId}` → новый счёт FUNDED_SIM |
| POST | `/api/admin/funded/reject` | 🛡 | `{accountId, reason?}` |
| POST | `/api/admin/payouts/decide` | 🛡 | `{payoutId, approve, txSignature?}`; с подписью — PAID |
| GET, POST | `/api/admin/kyc` | 🛡 | GET `?wallet=` — найти пользователя; POST `{userId, status VERIFIED/REJECTED, note?}` |
| POST | `/api/admin/refunds` | 🛡 | `{purchaseId, txSignature, reason?}` — возврат |

Служебные: `/robots.txt`, `/sitemap.xml`, `/opengraph-image`.

## Страницы

- Публичные: `/`, `/challenges`, `/terminal`, `/leaderboard`, `/transparency`, `/rules`, `/faq`, `/terms`, `/privacy`, `/refunds`, `/checkout?size=10000&plan=CORE`, `/blocked`.
- Кабинет (нужен вход): `/dashboard`, `/history`, `/trader-score`, `/risk`, `/profile`, `/funded`.
- Админка: `/admin` — без роли ADMIN отвечает 404.

## Сценарии

### A. Гость

1. `/` — цены планов из прайс-матрицы, блок прозрачности, в шапке «Connect wallet».
2. `/challenges`, `/rules`, `/faq`, `/terms`, `/privacy`, `/refunds`, `/transparency`, `/leaderboard` открываются; пустой лидерборд объясняет правила рейтинга.
3. `/terminal` — живая цена Phoenix и стакан, главная кнопка «Sign in to trade».
4. `/checkout` без входа — сводка правил и чекбокс согласия, красных ошибок нет.
5. `/admin` и несуществующий адрес — своя страница 404.
6. Телефон (390 px): в терминале вкладки Chart / Order book / Trade, форма ордера доступна без длинной прокрутки.

### B. Вход

1. «Connect wallet» → Phantom → подпись запрашивается сама → в шапке меню аккаунта с адресом и колокольчик.
2. Отклонить подпись → в шапке одна кнопка «Sign in».
3. Перезагрузить страницу → сессия сохранилась, повторная подпись не нужна.
4. Сменить аккаунт в Phantom → появляется «Sign in» для нового адреса.
5. Меню аккаунта → Sign out → в шапке «Sign in».
6. В меню аккаунта клик по адресу копирует его; у админа в меню есть пункт Admin.

### C. Покупка

1. Checkout SPRINT $5K: без чекбокса согласия оплатить нельзя.
2. Оплата через Solana Pay → через 15–60 с статус PAID, счёт виден в дашборде, пришло уведомление.
3. Перезагрузка checkout до оплаты отдаёт ту же покупку, новая не создаётся.
4. Четыре разные неоплаченные покупки → на четвёртой ошибка 409; через 30 мин неоплаченная становится EXPIRED.
5. `/transparency` — сумма продаж выросла на сумму покупки.

### D. Торговля

1. Терминал: Market LONG $500, плечо 1 → позиция открыта, удержана комиссия.
2. Закрыть позицию → PnL учтён в балансе, запись в `/history`.
3. Лимитный ордер в стороне от цены стоит в «Open orders»; при достижении цены его исполняет сервер; отмена убирает ордер.
4. Плечо 6 → ошибка; размер больше доступной маржи → отказ INSUFFICIENT_MARGIN.
5. Быстрые кнопки 25 / 50 / 75 % / MAX считают размер от доступной маржи.
6. Двойной клик по кнопке ордера создаёт один ордер.

### E. Риск и стадии

1. Пробой дневной или максимальной просадки → счёт FAILED, позиции закрыты по метке, лимитки отменены, уведомление.
2. Цель достигнута при 3+ торговых днях и без открытых позиций → счёт PASSED (в тике или при смене дня 00:00 UTC).
3. `/risk` и `/dashboard` показывают границы просадки, прогресс к цели и торговые дни.

### F. Funded

1. `/funded` — заявка на funded для PASSED-счёта; повторная заявка ничего не дублирует.
2. Админ → Approve → создан счёт FUNDED_SIM, исходный ушёл из очереди, трейдеру уведомление.
3. Дашборд funded-счёта: «FUNDED», «FUNDED · SIMULATED EXECUTION», без цели прибыли, строка «Available for payout».
4. Админ → Reject другого счёта → счёт ушёл из очереди, повторной заявки нет.

### G. Выплаты и KYC

1. Прибыль на funded-счёте → `/profile` → выплата не больше 80 % прибыли → REQUESTED; больше доступного — ошибка.
2. Админ: Approve и «Mark paid» с подписью транзакции при неподтверждённом KYC → 409 KYC_REQUIRED.
3. Админ: KYC Verify → «Mark paid» → PAID, в балансе списание (сумма × 100 / 80), трейдеру уведомление, на `/transparency` выросли выплаты.
4. Отклонить выплату → REJECTED, доступная сумма вернулась.

### H. Админка

1. Метрики: покупки, выручка, активные счета, доля прошедших, funded, выплаты.
2. При ширине 1280 все кнопки в очередях видны целиком; кошельки сокращены, полный адрес при наведении.
3. Возврат из «Recent purchases» с подписью транзакции → покупка REFUNDED, счёт FAILED, ордера отменены, уведомление.

### I. Безопасность

1. API без входа (например, `POST /api/orders`) → 401.
2. Чужой счёт → 404; админские API под обычным пользователем → 403.
3. Больше 5 запросов в секунду к `/api/auth/*` → 429; больше 10 в секунду к `/api/orders` → 429.
4. Тело `POST /api/orders` больше 16 КБ → 413.
5. Гео-блок (только с Cloudflare): VPN в США → редирект на `/blocked`, API → 451; заголовок `x-vercel-ip-country: US` от клиента ни на что не влияет.

### J. Сервер

1. `/api/health` → `ok`, `worker.ok: true`, `payments: enabled` при заданном `TREASURY_WALLET`.
2. Остановить воркер → health через 30–90 с отвечает 503 `degraded`; после рестарта снова `ok`.
3. В `deploy/backups/` появился дамп базы.
