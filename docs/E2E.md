# E2E: сквозной сценарий полного пути

`scripts/e2e.ts` — сквозной прогон всего пути трейдера против **поднятого** приложения
(web `next start` на порту 3100 + воркер отдельным процессом, общая Postgres из
`docker compose` сервиса `db`, отдельная база `props_e2e`). Печатает `PASS/FAIL` по
шагам; **код выхода 0 — только если все шаги PASS**.

## Что проверяет

| №   | Шаг                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | Вход трейдера: генерация ed25519-ключа → `/api/auth/nonce` → подпись SIWS → `/api/auth/verify` → httpOnly-cookie, роль USER |
| 02 | `POST /api/checkout/create` SPRINT $5K: покупка PENDING, сумма $23 из прайс-матрицы, reference-ключ, корректный Solana Pay URL |
| 03 | Оплата: подтверждение напрямую `checkPendingPayments` с фейковым RPC (см. ниже) → `GET /api/checkout/status` = PAID |
| 04 | Счёт создан: ACTIVE/CHALLENGE, DEPOSIT-проводка 5000, баланс = Σ проводок |
| 05 | `POST /api/orders` OPEN SOL-PERP LONG $500 ×1 по живой цене Phoenix → FILLED, позиция OPEN |
| 06 | `POST /api/orders` CLOSE позиции → FILLED, позиция CLOSED, баланс = Σ проводок |
| 07 | [тестовый приём] ADJUST до цели +9 % (5450) → счёт PASSED |
| 08 | Вход админа вторым ключом (роль ADMIN через `ADMIN_WALLET`/seed) |
| 09 | `POST /api/admin/funded/approve`: PASSED → новый счёт FUNDED_SIM/ACTIVE, DEPOSIT 5000, AuditLog FUNDED_APPROVED, исходный счёт остаётся PASSED |
| 10 | [тестовый приём] ADJUST +600 на funded: прибыль, баланс = Σ проводок |
| 11 | `POST /api/payouts/request` 300 USDC → REQUESTED, остаток доступного 180 (= 600×80 % − 300) |
| 12 | [тестовый приём] `POST /api/admin/payouts/decide` PAID с фейковой подписью → проводка PAYOUT −375 (300×100/80), баланс 5225, AuditLog PAYOUT_PAID |
| 13 | Итог: покупка PAID, челлендж PASSED, funded ACTIVE, ledger обоих счетов сходится с балансами |
| 14 | Без cookie `POST /api/orders` → 401 |
| 15 | Чужой счёт (админ на счёте трейдера) → 404 |
| 16 | `cf-ipcountry: US` → 451 (гео-блок middleware) |

После каждого изменения денег проверяется инвариант плана §5: **баланс счёта равен
сумме его проводок LedgerEntry** (точное сравнение `Prisma.Decimal`).

## Тестовые приёмы (реальный USDC не тратится)

Скрипт выполняет ровно тот же код, что и продакшен, но три места подменены —
каждое помечено `[тестовый приём]` в коде `scripts/e2e.ts`:

1. **Оплата.** Вместо реального перевода USDC скрипт вызывает ту же функцию воркера
   `checkPendingPayments({ rpc })` (`src/worker/payments.ts`), передав фейковый
   `SolanaRpc`: `getSignaturesForAddress` возвращает подпись, `getParsedTransaction` —
   транзакцию с инструкцией `transfer` USDC на ATA казны из `TREASURY_WALLET`.
   Дальше работают настоящие `verifyUsdcTransfer` → `confirmPurchase` (PAID +
   TradingAccount + DEPOSIT идемпотентно, под `withAccountLock`).
2. **PASSED и прибыль.** Естественный PASSED требует `minTradingDays` = 3 дня
   (`src/lib/core/risk.ts`, `passed`) — e2e столько не ждёт. Счёт доводится до
   цели **прямой проводкой ADJUST** в тестовой базе (`adjustTo` в скрипте:
   LedgerEntry ADJUST + правка кэша баланса/статуса одной транзакцией). Инвариант
   «баланс = Σ проводок» при этом сохраняется. Так же создаётся прибыль на funded.
3. **PAID по выплате.** `txSignature` для `decide` — случайный base58-ключ:
   перевода не было, подпись лишь фиксируется в записи Payout и AuditLog.

## Запуск

Нужны: поднятый `db` этого репозитория (порт 54339), Node 22+. Чужие контейнеры не трогаем;
база `props_e2e` создаётся в общем Postgres рядом с `props`/`props_test`.

```sh
cd <корень checkout>

# 1) своя база для e2e (идемпотентно) + схема
docker exec props-v2-db-1 psql -U props -d postgres -c "CREATE DATABASE props_e2e" 2>/dev/null || true
DATABASE_URL=postgresql://props:props@localhost:54339/props_e2e npx prisma db push

# 2) сборка и запуск web (порт 3100) и worker — три окна/фоновых процесса
npm run build
DATABASE_URL=postgresql://props:props@localhost:54339/props_e2e \
TREASURY_WALLET=CgtQNP9GxkUirydqFCQxyDbaYtXoYwaRfJC3pVdaAEGN \
PORT=3100 npm start
DATABASE_URL=postgresql://props:props@localhost:54339/props_e2e \
TREASURY_WALLET=CgtQNP9GxkUirydqFCQxyDbaYtXoYwaRfJC3pVdaAEGN \
npm run worker

# 3) сценарий (TREASURY_WALLET и USDC_MINT обязаны совпадать с web/worker)
BASE_URL=http://localhost:3100 \
DATABASE_URL=postgresql://props:props@localhost:54339/props_e2e \
TREASURY_WALLET=CgtQNP9GxkUirydqFCQxyDbaYtXoYwaRfJC3pVdaAEGN \
npx tsx scripts/e2e.ts; echo "EXIT=$?"
```

`TREASURY_WALLET` — любой валидный base58-адрес (деньги на него реально не уходят:
подтверждение оплаты — фейковый RPC, выплата — фейковая подпись). `BLOCKED_COUNTRIES`
не задавать — дефолт включает US (нужен для шага 16). Прогон можно повторять: каждый
запуск создаёт новые кошельки и покупку; для чистой базы пересоздать `props_e2e`
(`DROP DATABASE props_e2e` + шаги 1–2).

## Прогон 2026-10-10 (Next.js 16.4.0, React 19, Prisma 6.19.3)

Все 16 шагов PASS, `E2E RESULT: PASS`, код выхода 0 (web — `.next/standalone/server.js` на :3111, воркер рядом, база `props_e2e_w10`, цены Phoenix live). Сценарий обновлён под уже действующие правила: шаг 02 передаёт согласие с текущими версиями документов (K2), шаг 12 перед PAID верифицирует KYC трейдера через `POST /api/admin/kyc` (Q2).

## Вывод прогона (2026-10-09, web Next.js 14.2.35 на :3100, worker рядом, цены Phoenix live)

```text
PROPS e2e → http://localhost:3100 (база postgresql://props:***@localhost:54339/props_e2e)
кошельки: трейдер 5gZ5bJTLLGs7hyQBtaMhzj4tgE3tB66BdH1nT2ekU7sw, админ C5nxNcs8kZcPnYo5LK6U7bbaeBHqUHjVnRQCPPboiGm7
PASS 01 вход трейдера: nonce → подпись → verify (cookie, роль USER)
PASS 02 POST /api/checkout/create: покупка SPRINT $5K ($23), PENDING + Solana Pay URL
{"level":"info","msg":"purchase confirmed","purchaseId":"0cea2ae6-6da4-4925-9579-461495fae9f5","accountId":"5d68cc68-9ca4-4f26-8b7b-00ee5c3ad1a8"}
{"level":"info","msg":"payments cycle","paid":1,"expired":0}
PASS 03 оплата: подтверждение напрямую checkPendingPayments с фейковым RPC (USDC не тратится)
PASS 04 счёт создан: ACTIVE/CHALLENGE, DEPOSIT 5000, баланс = Σ проводок
     открытие по метке Phoenix $106.03, комиссия $0.174790455
PASS 05 OPEN SOL-PERP LONG $500 x1 по живой цене Phoenix → FILLED, позиция открыта
PASS 06 CLOSE позиции → FILLED, позиция закрыта, баланс = Σ проводок
     [тестовый приём] ADJUST force-passed: баланс → 5450.00
PASS 07 [тестовый приём] ADJUST до цели +9 % (5450) → счёт PASSED
PASS 08 вход админа вторым ключом (роль ADMIN через ADMIN_WALLET/seed)
PASS 09 POST /api/admin/funded/approve: PASSED → новый счёт FUNDED_SIM, аудит
     [тестовый приём] ADJUST funded-profit: баланс → 5600.00
PASS 10 [тестовый приём] ADJUST +600 на funded: прибыль 5600, баланс = Σ проводок
PASS 11 POST /api/payouts/request: запрос выплаты 300 USDC → REQUESTED, доступно 180
PASS 12 [тестовый приём] админ PAID с фейковой подписью → PAYOUT −375, баланс 5225, аудит
     челлендж PASSED (5450.00), funded FUNDED_SIM ACTIVE (5225.00), выплата 300.00 PAID
PASS 13 итог: статусы (PAID/PASSED/ACTIVE) и ledger обоих счетов сходятся
PASS 14 без cookie POST /api/orders → 401
PASS 15 чужой счёт (админ на счёте трейдера) → 404
PASS 16 cf-ipcountry: US → 451 (гео-блок)
E2E RESULT: PASS — все шаги зелёные
EXIT=0
```

Строки `purchase confirmed` / `payments cycle` — это лог самой функции
`checkPendingPayments` (`src/worker/payments.ts`), вызванной в процессе скрипта:
видно, что подтверждение идёт тем же кодом, что и в воркере.

## Наблюдения (приложение не менялось)

- **Однократный 503 на первом прогоне (шаг OPEN).** Самый первый запрос рыночных
  данных после старта процесса иногда отвечает 503 MarketDataError — гонка прогрева
  кэша снапшотов в `src/lib/marketData/server.ts` (`getMarketSnapshot`: свежесть
  слота/«данные ушли назад» при параллельном первом чтении). Повторный прогон и все
  последующие запросы проходят; прямое обращение к `/api/phoenix?symbol=SOL-PERP`
  сразу после сбоя — 200. Тело ошибки в первом прогоне не логировалось скриптом
  (теперь шаги печатают тело ответа при статусе ≠ 200). Устойчивого воспроизведения
  нет — в `docs/E2E.md` фиксируется как наблюдение, не как дефект.
- `next start` печатает предупреждение
  `does not work with "output: standalone"` (`next.config.js`), но обслуживает API
  корректно (все шаги прошли). Для продакшена используется `node server.js` из
  standalone-сборки (см. docker-compose, сервис `web`).
