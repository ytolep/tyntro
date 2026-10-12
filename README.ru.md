# Tyntro

**Прозрачная проп-фирма для торговли криптофьючерсами на Solana.**

[English](README.md) · **Русский**

![Solana](https://img.shields.io/badge/Solana-Pay%20%C2%B7%20SIWS%20%C2%B7%20Phoenix-9945FF?logo=solana&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![Tests](https://img.shields.io/badge/tests-221%20passing-2ea44f)
![Colosseum](https://img.shields.io/badge/Colosseum-Crypto%20World's%20Fair-ff6b00)

Tyntro позволяет любому доказать, что он умеет торговать, не рискуя своими деньгами.
Трейдер оплачивает челлендж в USDC через Solana Pay, торгует бессрочными фьючерсами
на виртуальном счёте по живым ценам [Phoenix](https://phoenix.trade), а риск-движок
раз в секунду проверяет все правила. Прошёл челлендж — счёт становится funded,
и трейдер получает 80 % прибыли.

![Главная страница](docs/demo/01-landing.jpg)

## Проблема

Проп-трейдинг — большой рынок, но трейдерам приходится верить фирмам на слово:

- Правила размыты и могут поменяться после оплаты.
- Никто не может проверить, есть ли у фирмы деньги на выплаты.
- Оплата картой недоступна во многих странах и идёт днями.
- Решения о прохождении принимаются за закрытыми дверями.

## Как это решает Tyntro

| Проблема | Tyntro |
|----------|--------|
| Правила меняются после покупки | При покупке на счёте сохраняется **хэш правил плана** (`rulesHash`). Риск-движок применяет именно эти правила. |
| Скрытые финансы | **Страница прозрачности** читает баланс USDC казны прямо из Solana и показывает funded-счета. |
| Медленная оплата только картой | **USDC через Solana Pay**. У каждой покупки уникальный reference-ключ; воркер находит перевод on-chain и сам открывает счёт. |
| Непрозрачные решения | **Риск-движок детерминирован**, логируется и покрыт тестами. Каждое изменение баланса — запись в ledger, каждое действие админа — в журнале аудита. На странице правил есть примеры расчёта. |
| «Реальный рынок» на словах | Исполнение идёт по **живым стаканам Phoenix** — on-chain DEX фьючерсов на Solana. Рейтинг строится только по реальным сделкам. |

## Почему Solana

- **Solana Pay + USDC**: оплата за секунды и копейки, без процессинга карт и чарджбэков,
  доступно трейдерам из любой разрешённой страны.
- **Вход через Solana (SIWS)**: кошелёк и есть аккаунт. Без паролей и почты.
- **Phoenix**: полностью on-chain стакан даёт честные и проверяемые цены для симулятора.
- **Публичная казна**: любой может в любой момент проверить резерв на выплаты on-chain.

| On-chain | Off-chain (сервер) |
|----------|--------------------|
| Оплаты USDC с reference-ключом на каждую покупку | Симуляция исполнения и позиции |
| Баланс казны на `/transparency` | Риск-движок (тик 1 с), ledger, журнал аудита |
| Переводы выплат и возвратов (подпись хранится в записи) | KYC, решения админа |
| Подписи кошелька для входа | Рейтинг, Trader Score |
| Рыночные данные Phoenix (чтение) | |

## Что уже работает

- Полный путь трейдера: вход → оплата USDC → торговля → PASSED → одобрение funded → прибыль → запрос выплаты.
- **221 автотест** (`node:test`) на настоящем PostgreSQL: риск-движок, исполнение,
  оплаты, выплаты, авторизация.
- **Сквозной сценарий** (`scripts/e2e.ts`) проходит весь путь на запущенном приложении.
- **Настоящая оплата в devnet** реальными кошельками и транзакциями USDC (`scripts/devnet-real.ts`).
- **Нагрузочный тест**: счета ботов торгуют на записанных ценах Phoenix, затем сверка
  ledger (`scripts/check-ledger.ts`) должна показать ноль нарушений.
- Прод-стек: Docker, Caddy с HTTPS, ежедневные бэкапы, health-проверки, CI.

## Скриншоты

| Торговый терминал | Дашборд трейдера |
|---|---|
| ![Терминал](docs/demo/07-terminal-trader.jpg) | ![Дашборд](docs/demo/06-dashboard-trader.jpg) |
| **Оплата (Solana Pay)** | **Прозрачность** |
| ![Оплата](docs/demo/02-checkout-guest.jpg) | ![Прозрачность](docs/demo/04-transparency.jpg) |
| **Funded-счёт** | **Админка** |
| ![Funded](docs/demo/10-funded.jpg) | ![Админка](docs/demo/13-admin.jpg) |
| **Рейтинг** | **Терминал на телефоне** |
| ![Рейтинг](docs/demo/05-leaderboard.jpg) | ![Мобильный](docs/demo/14-mobile-terminal.jpg) |

## Возможности

- **Челленджи.** Три плана (Sprint, Core, Apex) на виртуальные счета от $5K до $100K.
  Оплата в USDC на Solana; воркер подтверждает перевод on-chain и открывает счёт.
- **Торговый терминал.** Живые данные Phoenix по WebSocket: mark и index, статистика
  за 24 часа, открытый интерес, funding, стакан, график. Рыночные и лимитные ордера с плечом.
- **Риск-движок.** Воркер раз в секунду переоценивает открытые позиции и следит
  за дневным лимитом убытка, максимальной просадкой, ликвидацией по поддерживающей
  марже, целью по прибыли и минимальным числом торговых дней.
- **Funded-стадия и выплаты.** Одобрение funded-счёта админом, 80 % прибыли трейдеру,
  запрос выплаты с шагом KYC.
- **Публичные страницы.** Рейтинг по реальным сделкам, Trader Score, страница
  прозрачности с казной on-chain, правила с примерами расчёта просадки.
- **Админка.** Выручка и метрики счетов, очереди funded и выплат, возвраты.
- **Вход через Solana** (SIWS): кошелёк подписывает сообщение, паролей нет.
- **Точные деньги.** Все суммы и цены — `Prisma.Decimal`, никогда не `number`.

| План   | Цель по прибыли | Дневной лимит убытка | Макс. просадка | Мин. торговых дней | Доля трейдера |
|--------|-----------------|----------------------|----------------|--------------------|---------------|
| Sprint | 9 %             | 3 %                  | 3 %            | 3                  | 80 %          |
| Core   | 10 %            | 3 %                  | 6 %            | 3                  | 80 %          |
| Apex   | 12 %            | 3 %                  | 5 %            | 3                  | 80 %          |

Цены по размерам счёта — в `src/lib/pricingConfig.ts`; `npm run seed` переносит их в базу.

## Стек

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · Prisma 6.19 ·
PostgreSQL 17 · `@solana/web3.js` и wallet-adapter · lightweight-charts ·
`node:test` + `tsx` · Docker.

## Как устроено

```
браузер ──► web (Next.js, :3000) ──► PostgreSQL ◄── worker (tsx)
               │  страницы + /api/*                    │ тик риска раз в 1 с
               │  ордера, вход, оплата                 │ смена дня раз в 30 с
               ▼                                       │ проверка оплат USDC
         рыночные данные Phoenix (Solana RPC) ◄────────┘
```

| Сервис    | Команда                                                            |
|-----------|--------------------------------------------------------------------|
| `db`      | PostgreSQL 17 (порт на хосте `54339`)                              |
| `migrate` | `prisma migrate deploy && node --import tsx prisma/seed.ts` (разово) |
| `web`     | `node server.js` (Next.js standalone, порт 3000)                   |
| `worker`  | `./node_modules/.bin/tsx src/worker/index.ts`                      |

Три сервиса приложения используют один образ (Node 22 Alpine, multi-stage, `next build` standalone).

## Запуск

![Демо в терминале](docs/demo/commands.gif)

### Что нужно

- Node.js 22.12 или новее, npm
- Docker с Compose v2
- Кошелёк Solana (Phantom или аналог) для входа в браузере

### Вариант А: всё в Docker

Поднимает `db`, разово выполняет миграции и сид (`migrate`), затем `web` на
http://localhost:3000 и `worker`:

```sh
git clone https://github.com/savvax/tyntro.git && cd tyntro
cp .env.example .env               # при желании заполните ADMIN_WALLET и другие
docker compose up -d --build
curl http://localhost:3000/api/health
```

Если порт 54339 на хосте занят, поднимите базу на другом:
`DB_PORT=54340 docker compose up -d --build` (порт на хосте нужен только тестам и `psql`).

### Вариант Б: локальная разработка

```sh
npm ci
cp .env.example .env               # DATABASE_URL уже указывает на localhost:54339
docker compose up -d db            # только PostgreSQL
npx prisma migrate deploy
npm run seed                       # матрица челленджей + опциональный ADMIN
npm run dev                        # web на http://localhost:3000
npm run worker                     # риск-движок, во втором терминале
```

Без воркера торговля не работает: ордера не проходят проверку правил риска, а оплаты не подтверждаются.

### Как стать админом

Роль хранится в `User.role` (`USER` или `ADMIN`). Запишите адрес своего кошелька
в `ADMIN_WALLET` и запустите сид ещё раз (он идемпотентен, upsert):

```sh
ADMIN_WALLET=<ваш-адрес> docker compose up migrate    # или локально:
ADMIN_WALLET=<ваш-адрес> npm run seed
```

После входа этим кошельком откроются `/admin` и `/api/admin/*`.

### Тестовая оплата в devnet

Соберите web с `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`, задайте `TREASURY_WALLET`,
`USDC_MINT` (devnet USDC) и `PAYMENTS_RPC_URL=https://api.devnet.solana.com`,
переключите кошелёк на Devnet. Рыночные данные всё равно идут с Phoenix в mainnet.
Полный демо-стенд с ботами: [docs/DEMO.md](docs/DEMO.md).

## Команды

| Команда             | Что делает                                                     |
|---------------------|----------------------------------------------------------------|
| `npm run dev`       | Dev-сервер Next.js                                             |
| `npm run worker`    | Воркер: тик риска (1 с), смена дня (30 с), проверка оплат      |
| `npm run seed`      | Upsert планов и цен челленджей, опциональный ADMIN             |
| `npm test`          | Все `*.test.ts` на `node:test`, база из `.env.test`            |
| `npm run typecheck` | `tsc --noEmit`                                                 |
| `npm run build`     | Прод-сборка (standalone)                                       |
| `npm start`         | Запуск прод-сборки                                             |

Тесты работают с базой `props_test` на порту 54339 (её создаёт
`docker/initdb/01-props-test.sql`) и сами пересоздают схему через
`prisma db push --force-reset`.

Вспомогательные скрипты в `scripts/` (запуск: `npx tsx scripts/<имя>.ts`):

| Скрипт            | Назначение                                                  |
|-------------------|-------------------------------------------------------------|
| `e2e.ts`          | Сквозной сценарий против запущенного приложения             |
| `bot-load.ts`     | Нагрузка: N счетов ботов торгуют на записанных ценах Phoenix |
| `check-ledger.ts` | Сверка ledger и инвариантов, ожидается 0 нарушений          |
| `record-prices.ts`| Запись цен Phoenix для повторного прогона                   |
| `devnet-real.ts`  | Настоящая оплата USDC в devnet от начала до конца           |
| `demo-shape.ts`   | Подготовка демо-данных (пройденные и funded-счета)          |
| `manual-qa.ts`    | Автопроверки против `BASE_URL` и чек-лист ручного тестирования |
| `natural-pass.ts` | Прохождение челленджа Sprint только сделками, без ручных проводок |

## Настройка

Скопируйте `.env.example` в `.env`. Для продакшена — `.env.production.example`, там описана каждая переменная.

| Переменная                   | Обязательна | По умолчанию | Назначение |
|------------------------------|-------------|--------------|------------|
| `DATABASE_URL`               | да          | —            | Подключение к PostgreSQL для web, воркера, сида и тестов |
| `TREASURY_WALLET`            | для оплат   | —            | Кошелёк приёма USDC; без него checkout и проверка оплат выключены |
| `SOLANA_RPC_URL`             | нет         | `https://api.mainnet-beta.solana.com` | Рыночные данные Phoenix и проверка оплат |
| `PAYMENTS_RPC_URL`           | нет         | `SOLANA_RPC_URL` | RPC только для подтверждения оплат (devnet-тесты) |
| `USDC_MINT`                  | нет         | USDC mainnet | Токен, который принимается к оплате |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | нет         | —            | RPC кошелька в браузере (на этапе сборки) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | нет         | `mainnet-beta` | Кластер кошелька, если RPC не задан (на этапе сборки) |
| `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL` | нет | — | Брендинг (на этапе сборки) |
| `TAKER_FEE_RATE`             | нет         | `0.0005`     | Комиссия тейкера в симуляторе |
| `ADMIN_WALLET`               | нет         | —            | Сид создаёт пользователя ADMIN с этим кошельком |
| `APP_DOMAINS`, `APP_DOMAIN`  | в продакшене | —           | Разрешённые хосты для SIWS (CSV) и домен по умолчанию |
| `TRUSTED_IP_HEADER`, `TRUSTED_PROXY_COUNT` | нет | —, `1` | Как определять IP клиента за прокси |
| `BLOCKED_COUNTRIES`          | нет         | `US,CU,IR,KP,SY,RU,BY` | Гео-блок, коды ISO 3166 alpha-2 |
| `DB_PORT`                    | нет         | `54339`      | Порт PostgreSQL на хосте в Docker Compose |

## Проверка здоровья

`GET /api/health` проверяет базу и воркер. Воркер раз в 5 секунд пишет heartbeat;
если последний тик риска старше 30 с (или последняя проверка оплат старше 90 с при
включённых оплатах), ответ — HTTP 503 со `"status":"degraded"`.

```json
{"status":"ok","db":"up","version":"2.0.0","worker":{"ok":true,"payments":"disabled","lastTickAgeMs":3232,"lastPaymentsCheckAgeMs":null}}
```

`GET /api/health?scope=web` проверяет только базу; он для healthcheck контейнера web.

## Структура проекта

```
src/app/            страницы (terminal, dashboard, checkout, funded, admin, ...) и /api
src/lib/core/       деньги, позиции, правила риска, Trader Score
src/lib/execution/  симулятор исполнения ордеров, маржа, политика плеча
src/lib/marketData/ данные Phoenix: WebSocket-поток, свечи, стакан
src/lib/payments/   checkout через Solana Pay и проверка on-chain
src/worker/         тик риска, смена дня, проверка оплат, heartbeat
prisma/             схема, миграции, сид
scripts/            e2e, нагрузка, сверка ledger, демо
deploy/             прод-стек: Caddy (HTTPS), бэкапы, восстановление
docs/               деплой, демо, QA, ревью
```

## Деплой

Один Linux-сервер с Docker: `deploy/docker-compose.prod.yml` добавляет Caddy с
Let's Encrypt и ежедневные бэкапы `pg_dump`. Пошаговая инструкция, чек-листы
перехода devnet → mainnet и безопасности: [docs/DEPLOY.md](docs/DEPLOY.md).
Проверить прод-стек локально: `deploy/local-check.sh`.

CI (`.github/workflows/ci.yml`) на каждый push запускает typecheck, тесты на PostgreSQL 17 и сборку.

## Бизнес-модель

Трейдер платит разовый взнос за челлендж ($25–$899 в зависимости от плана и размера).
Funded-трейдер получает 80 % прибыли, фирма — 20 %. Выплаты идут из публичной казны,
поэтому резерв всегда виден.

## Планы

- Запуск в mainnet (чек-лист перехода devnet → mainnet — в [docs/DEPLOY.md](docs/DEPLOY.md)).
- Автоматические выплаты USDC с подписью казны вместо ручных переводов админа.
- Публикация хэшей правил и дневных итогов счетов on-chain, чтобы любой мог проверить решения о прохождении.
- Больше рынков Phoenix и планов.

## Перезапись GIF

GIF с терминалом сделан через [VHS](https://github.com/charmbracelet/vhs):

```sh
brew install vhs
vhs docs/demo/commands.tape        # пишет docs/demo/commands.gif
```
