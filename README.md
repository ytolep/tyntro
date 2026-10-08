# PROPS v2

Проп-трейдинг платформа: челленджи с оплатой в USDC (Solana Pay), серверный риск-движок
(тик раз в секунду), симулятор исполнения на ценах Phoenix, funded-стадия и выплаты.
Next.js 14 (App Router) + Prisma 6 + PostgreSQL 17. Деньги и цены — только `Prisma.Decimal`.

## Быстрый старт (docker compose)

Поднимает db, разовые миграции+сид (сервис `migrate`), web на http://localhost:3000 и worker:

```sh
cp .env.example .env        # при желании заполните ADMIN_WALLET и пр.
docker compose up -d --build
curl http://localhost:3000/api/health   # {"status":"ok","db":"up","version":"..."}
```

Один образ (Node 22-alpine, multi-stage, `next build` standalone) используется тремя сервисами:

| Сервис   | Команда                                                  |
|----------|----------------------------------------------------------|
| `migrate`| `prisma migrate deploy && node --import tsx prisma/seed.ts` (разовая) |
| `web`    | `node server.js` (порт 3000)                             |
| `worker` | `./node_modules/.bin/tsx src/worker/index.ts`            |

Если порт 54339 на хосте занят другим checkout'ом, поднимите базу на другом порту:
`DB_PORT=54340 docker compose up -d --build` (порт нужен только тестам и psql с хоста).

## Запуск локально (без docker)

```sh
npm ci
docker compose up -d db                     # postgres на localhost:54339
cp .env.example .env                        # DATABASE_URL уже указывает туда
npx prisma migrate deploy && npm run seed
npm run dev                                 # web на http://localhost:3000
npm run worker                              # воркер в отдельном терминале
```

## Переменные окружения

| Переменная        | Обязательна | По умолчанию | Где используется |
|-------------------|-------------|--------------|------------------|
| `DATABASE_URL`    | да          | —            | Prisma (web, worker, seed, тесты) |
| `TREASURY_WALLET` | для checkout/воркера платежей | — | `src/lib/payments/config.ts` — кошелёк приёма USDC |
| `SOLANA_RPC_URL`  | нет         | `https://api.mainnet-beta.solana.com` | рыночные данные Phoenix, проверка оплат |
| `USDC_MINT`       | нет         | mainnet USDC `EPjFW…TDt1v` | проверка переводов (devnet-тесты подменяют) |
| `TAKER_FEE_RATE`  | нет         | `0.0005`     | тик риска: комиссии симулятора (`src/worker/riskTick.ts`) |
| `ADMIN_WALLET`    | нет         | —            | seed создаёт пользователя с ролью ADMIN |
| `DB_PORT`         | нет         | `54339`      | хост-порт postgres в docker compose |
| `PORT`, `NODE_ENV`| нет         | `3000`, —    | standalone-сервер web |

Тесты читают `.env.test` (база `props_test` на 54339, создаётся `docker/initdb/01-props-test.sql`).

## Роли: как назначить ADMIN

Роль хранится в `User.role` (`USER` | `ADMIN`), вход — подпись кошельком Solana (SIWS).
Чтобы стать админом: положите адрес своего кошелька в `ADMIN_WALLET` и выполните сид
(он идемпотентен, upsert):

```sh
ADMIN_WALLET=<ваш-адрес> docker compose up migrate   # или локально:
ADMIN_WALLET=<ваш-адрес> node --env-file=.env --import tsx prisma/seed.ts
```

После входа этим кошельком API админки (`/api/admin/*`) пустит по сессии с ролью ADMIN.

## Health и мониторинг воркера

`GET /api/health` проверяет только web+БД (`SELECT 1`) и возвращает версию; живость
воркера он **не** проверяет — это осознанно (без новых таблиц под тики). Воркер жив, если:

1. `docker compose logs -f worker` — JSON-строки `{"ts":...,"level":"info","msg":"worker запущен"}`
   и отсутствие повторяющихся `"level":"error"`; цикл внутри воркера сам ловит и логирует
   ошибки итераций, а `restart: unless-stopped` перезапускает упавший процесс.
2. Свежесть тиков можно проверить по данным: воркер пишет `EquitySnapshot` при переоценке
   открытых позиций —
   `SELECT max("timestamp") FROM "EquitySnapshot";` на активных счетах должен быть
   не старше пары секунд. Пусто — нет открытых позиций, смотрите логи.

## CI

`.github/workflows/ci.yml`: typecheck → тесты (postgres-service на 54339, база `props_test`,
схему тесты пересоздают сами через `prisma db push --force-reset`) → `npm run build`.

## Команды

```sh
npm run dev        # dev-сервер
npm run worker     # воркер (тик риска 1с, проверка смены дня 30с)
npm test           # node:test + tsx, база props_test из .env.test
npm run typecheck  # tsc --noEmit
npm run build      # next build (standalone)
npm run seed       # сид матрицы челленджей + опциональный ADMIN
```
