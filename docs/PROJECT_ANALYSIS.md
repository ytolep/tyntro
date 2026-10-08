# PROPS — анализ проекта и стратегия лидерства в экосистеме Solana

Дата анализа: 7 октября 2026.
Основа: полное чтение кодовой базы (28 коммитов, ~4 200 строк TypeScript), прогон `npm run typecheck`, `npm test` и `npm run build` на Node 26, а также исследование рынка perp-DEX на Solana, крипто-проп-фирм и регуляции.

---

## TL;DR

**Что это.** PROPS — прототип крипто-проп-фирмы «по модели FTMO» на Solana: пользователь покупает оценочный челлендж ($23–$799) за виртуальный счёт $5K–$100K, торгует бессрочными фьючерсами по живым ценам Phoenix Trade в локальном симуляторе, и при выполнении правил (цель прибыли, лимиты просадки) должен получить «funded»-счёт с реальным капиталом и 80 % сплитом прибыли.

**В каком состоянии.** Честный локальный прототип уровня «демо для инвестора». Хорошо сделан слой рыночных данных (валидация, fail-closed, 31 тест). Всё, что касается денег, пока не работает или работает неправильно: нет аутентификации (один захардкоженный demo-пользователь), нет оплаты, риск-движок считает просадку только при закрытии позиции, PnL завышен на величину плеча, лимитные ордера исполняются браузером клиента, funded-режим — заглушка с HTTP 503. README сам об этом предупреждает.

**Вердикт по бизнесу.** Идея «проп-фирма с прозрачным on-chain исполнением на Solana» имеет реальную нишу, но это бизнес с тяжёлым регуляторным хвостом и низким барьером входа в части «продажа челленджей». Лидерство в экосистеме достижимо не за счёт симулятора (его сделают все), а за счёт того, чего у конкурентов нет: верифицируемого on-chain исполнения funded-счетов с программно-принуждаемыми лимитами риска. Это сложнее, дороже и требует другого стека, чем сейчас.

---

## 1. Что это за проект

### 1.1 Идея в одном абзаце

Классическая модель проп-фирмы (FTMO, FundedNext, Breakout) перенесённая в крипту и привязанная к Solana: трейдер платит фиксированную плату за «экзамен» на виртуальном капитале; фирма зарабатывает на плате за экзамен (большинство не проходит) и на доле прибыли тех, кто прошёл и торгует реальным капиталом фирмы. Отличие PROPS от web2-конкурентов — котировки и (в планах) исполнение берутся с децентрализованной биржи Phoenix Trade на Solana, а не с CEX или MT5.

### 1.2 Продуктовая матрица (из `src/lib/pricingConfig.ts`)

| План | Цель прибыли | Дневная просадка | Макс. просадка (статическая) | Сплит | Мин. дней | Цена $5K / $10K / $25K / $50K / $100K |
|---|---|---|---|---|---|---|
| SPRINT | 9 % | 3 % | 3 % | 80 % | 3 | $23 / $39 / $99 / $199 / $369 |
| CORE | 10 % | 3 % | 6 % | 80 % | 3 | $49 / $89 / $219 / $399 / $799 |
| APEX | 12 % | 3 % | 5 % | 80 % | 3 | $39 / $69 / $149 / $299 / $549 |

Плечо ограничено 5x, экспозиция предупреждается при > 3.5x от equity. Статический floor просадки привязан к стартовому капиталу и не подтягивается за прибылью.

### 1.3 Что реально реализовано

| Модуль | Файлы | Состояние | Комментарий |
|---|---|---|---|
| Лендинг, выбор челленджа, checkout | `src/app/page.tsx`, `challenges`, `checkout`, `components/ChallengePicker.tsx` | Работает | Checkout **не берёт деньги**: просто создаёт счёт в БД. |
| Каталог рынков Phoenix | `src/lib/marketData/catalog.ts`, `markets.ts` | Работает, протестирован | Живой список ~90 perp-контрактов с `perp-api.phoenix.trade`, кэш 30 с, fail-closed при недоступности. |
| Снапшоты L2 + mark price | `src/lib/marketData/server.ts`, `orderBookValidator.ts`, `types.ts` | Работает, протестирован | Проверка идентичности рынка, монотонности слота, возраста данных ≤ 30 с через `getBlockTime` на RPC. Никаких «подставных» цен. |
| Свечи и график | `candleServer.ts`, `candles.ts`, `components/TradingViewChart.tsx` | Работает | Lightweight Charts v5 + `/v1/candles_v2`, до 300 баров, обновление 10 с. |
| Клиентский поллинг | `MarketDataStore.tsx`, `pollMarket.ts`, `adapters/*` | Работает, протестирован | REST-поллинг 2.5 с с backoff, отмена при смене рынка. WebSocket нет. |
| Симулятор исполнения | `src/lib/execution/simulated.ts` | Работает с дефектами | Market/Limit, усреднение позиции, частичное закрытие, флип. См. §2.2. |
| Риск-движок | `src/lib/riskEngine.ts` | Чистая функция, корректна | Но вызывается только при закрытии позиции и при ручном «reset day». |
| Режимы счёта CHALLENGE/FUNDED | `execution/policy.ts`, `execution/phoenix.ts`, `docs/account-modes.md` | Работает, протестирован | Funded = заглушка, всегда HTTP 503 `PHOENIX_FUNDED_NOT_CONNECTED`. Намеренно. |
| Дэшборд, риск, история, профиль | `src/app/dashboard`, `risk`, `history`, `profile` | Работает | Читают один эндпоинт `/api/accounts/active`. |
| Trader Score | `src/lib/traderScore.ts`, `app/trader-score/page.tsx` | Декорация | Формула есть, но страница подставляет **захардкоженные** входы (win rate 72 %, Sharpe 1.9 и т.д.). |
| Лидерборд | `app/leaderboard/page.tsx` | Мок | Пять вымышленных трейдеров в константе. |
| Админка | `app/admin/page.tsx`, `api/admin/reset-day` | Мок + опасно | Метрики «142 evaluations, $1.45M funded» вымышлены. Эндпоинт сброса дня **без авторизации**. |
| Кошелёк Solana | `components/SolanaWalletContextProvider.tsx`, `Navigation.tsx` | Косметика | Подключение Phantom/Solflare работает, но ни на что не влияет: пользователь всегда `trader@project.io`. |
| Платежи, выплаты, KYC | — | Отсутствуют | Таблица `Payout` в схеме есть, кода нет. |

### 1.4 Архитектура и поток данных

```
Браузер (Next.js client components)
  │  poll 2.5s  /api/phoenix?action=snapshot        ──► server.ts ──► perp-api.phoenix.trade (REST)
  │  poll 10s   /api/phoenix?action=candles                        └─► Solana RPC getBlockTime (возраст данных)
  │  poll 30s   /api/phoenix?action=markets         ──► catalog.ts
  │  poll 3s    POST /api/orders CHECK_LIMIT_ORDERS ──► simulated.ts ──► Prisma/SQLite
  │  on click   POST /api/orders OPEN/CLOSE/CANCEL  ──► policy.ts → simulated.ts | phoenix.ts (503)
  │  on load    GET  /api/accounts/active           ──► riskEngine.evaluateRisk (read-only)
  └  admin      POST /api/admin/reset-day           ──► ручной «00:00 UTC»
```

Ключевое наблюдение: **сервер не имеет собственного «тика»**. Всё, что должно происходить во времени (исполнение лимиток, переоценка позиций, проверка просадки, смена торгового дня), инициируется либо кликом пользователя, либо `setInterval` в его вкладке, либо кнопкой в админке.

### 1.5 Текущий стек

| Слой | Сейчас | Актуальность на 10.2026 |
|---|---|---|
| Фреймворк | Next.js 14.2 (App Router), React 18.3 | Две мажорные версии позади (Next 16, React 19) |
| Стили | Tailwind 3.4, кастомный CSS | Tailwind 4 вышел |
| ORM/БД | Prisma 5.10 + **SQLite**, деньги в `Float` | Prisma 7; SQLite однопользовательский |
| Solana | `@solana/web3.js` 1.98, wallet-adapter 0.15 | web3.js v1 в режиме поддержки; новые проекты идут на `@solana/kit` |
| Биржа | `@ellipsis-labs/phoenix-sdk` 2.x (spot), REST perp-api | Spot-SDK подключён, но spot-рынки не сконфигурированы, ветка мёртвая |
| Графики | lightweight-charts 5.0, recharts 2.15 | OK |
| Тесты | `node:test` + tsx, 5 файлов, 31 тест | OK для прототипа |
| Деплой | не описан; `next start` локально | — |

### 1.6 Что подтверждено прогоном

| Проверка | Результат |
|---|---|
| `npm run typecheck` | Чисто, 0 ошибок (strict mode) |
| `npm test` | 31 / 31 проходят, ~3 с; интеграционные тесты режимов счёта поднимают временную SQLite |
| `npm run build` | Успешно, 17 маршрутов, терминал 107 KB first-load JS |
| `npm audit --omit=dev` | Есть high-severity уязвимости в транзитивных зависимостях (устаревшие Next 14 / web3.js 1.x) |
| ESLint | Не настроен (README честно это указывает) |

История git: 28 коммитов вида «Add <папка>» за одну сессию. Это импорт готового кода, а не эволюция. Реальная история разработки и решений отсутствует.

---

## 2. Аудит кода

### 2.1 Сильные стороны

1. **Философия «не выдумывать данные»** проведена последовательно: нет mock-цен, пустые поля тикера остаются `null`, устаревшие снапшоты отбрасываются, перекрёстный стакан отклоняется, а не «чинится». Для финансового продукта это правильная культура.
2. **Fail-closed граница funded-режима** (`execution/policy.ts`, `execution/phoenix.ts`): клиент не может подменить режим, PASSED не конвертируется в реальные деньги, админ-инструменты не трогают funded-счета. Это покрыто интеграционными тестами.
3. **Слой рыночных данных** компактен и защищён: коалесинг запросов, проверка монотонности слота, независимая проверка возраста через `getBlockTime`, сохранение исходных единиц Phoenix (tick/lot) без догадок про decimals.
4. **Документация честная**: README и `docs/account-modes.md` прямо перечисляют, что не готово. Это редкость.
5. Код компактный, без лишних абстракций; типизация строгая.

### 2.2 Критические дефекты в деньгах и риске

Ниже то, что README не называет или называет вскользь. Каждый пункт блокирует реальный запуск.

**D1. PnL завышен на величину плеча.** `src/lib/execution/simulated.ts:142` считает `realizedPnL = pos.quantity * pnlFactor * pos.leverage`, при этом `quantity` — это USD-номинал ордера (`sizeUsd`), а терминал показывает `marginRequired = sizeUsd / leverage` (`src/app/terminal/page.tsx:235`). Либо размер — номинал, и тогда PnL = номинал × движение цены без умножения на плечо; либо размер — маржа, и тогда «Margin Required» показан неверно, а экспозиция (`currentExposure += size`) занижена. Та же формула продублирована в UI (`terminal/page.tsx:766`). При 5x трейдер проходит 10 %-ную цель на 2 %-ном движении.

**D2. Риск оценивается только при закрытии позиции.** `evaluateRisk` вызывается в двух местах: при `CLOSE_POSITION` и при чтении `/api/accounts/active`. После открытия `currentEquity` приравнивается к `currentBalance` (`simulated.ts:188`, `simulated.ts:360`), а `Position.unrealizedPnL` и `currentMarkPrice` не обновляются никогда. Трейдер может сидеть в позиции с –50 % нереализованного убытка и не быть «провален», пока сам не закроет. Для проп-фирмы это равнозначно отсутствию риск-движка: правило дневной просадки по equity, которое обещает UI («includes unrealized open PnL»), не выполняется.

**D3. Ликвидация не наступает.** `liquidationPrice` вычисляется и показывается, но флаг `isLiquidated` никогда не передаётся в `evaluateRisk`. Цена может пройти уровень ликвидации без последствий.

**D4. Частичное закрытие и флип теряют PnL.** В `executeFillAndAggregatePosition` противоположный ордер уменьшает `quantity` позиции, но реализованный PnL по закрытой части не рассчитывается и не зачисляется на баланс (`simulated.ts:291–295`). При этом `currentExposure` увеличивается на размер уменьшающего ордера (`simulated.ts:352`), хотя экспозиция должна уменьшаться. Флип закрывает старую позицию с нулевым PnL.

**D5. Лимитные ордера исполняет браузер.** `terminal/page.tsx:145` раз в 3 с шлёт `CHECK_LIMIT_ORDERS`. Закрыл вкладку — лимитки не исполняются; открыл две вкладки — гонка. В цикле обработки (`simulated.ts:86–109`) все сработавшие ордера используют один и тот же устаревший объект `account`, поэтому обновления баланса/экспозиции затирают друг друга (lost update). Транзакций и идемпотентности нет.

**D6. Торговый день не наступает сам.** `tradingDaysCount` и `dayStartEquity` меняются только кнопкой «Trigger 00:00 UTC Reset» в админке. Без оператора условие `minTradingDays` невыполнимо, а дневной floor никогда не пересчитывается.

**D7. Нет аутентификации и авторизации.** Все API ищут `db.user.findFirst({ email: 'trader@project.io' })`. Любой запрос к `/api/admin/reset-day` или `/api/checkout` действует от имени demo-пользователя. Подключённый кошелёк не связан с аккаунтом.

**D8. Деньги во `Float`.** Вся схема Prisma хранит балансы, цены и PnL в `Float`. Для расчёта проходных/провальных порогов на границе (equity = 9 400.00) двоичная ошибка решает судьбу челленджа.

**D9. Несогласованные комиссии.** Открытие 0.035 % (`simulated.ts:244`), закрытие 0.05 % (`simulated.ts:143`); реальные `takerFee/makerFee` из метаданных Phoenix есть в каталоге, но не используются.

**D10. Публичный Solana RPC в горячем пути.** Каждый некэшированный снапшот делает `getBlockTime` к `api.mainnet-beta.solana.com` (`server.ts:11, 97`). Публичный эндпоинт лимитирует запросы и возвращает `null` для свежих слотов, что превращается в «Market data unavailable». С сотней пользователей это упадёт.

### 2.3 Архитектурные ограничения

- **SQLite + один Next.js процесс.** Нет фоновых воркеров, нет очередей, нет cron. Любая «серверная» логика живёт внутри HTTP-запроса.
- **REST-поллинг везде.** 2.5-секундные снапшоты на клиента при тысяче пользователей — 400 req/s на сервер и далее в Phoenix API с коалесингом по символу. Без WebSocket/gRPC стрима терминал не будет ощущаться «живым».
- **Монолит страниц.** `terminal/page.tsx` — 1 010 строк в одном компоненте с `any`-типизацией данных аккаунта.
- **Мёртвые ветки.** Spot-путь в `server.ts` недостижим: каталог возвращает только perp. SDK `@ellipsis-labs/phoenix-sdk` и `@solana/web3.js` используются по сути только для `getBlockTime`.
- **Вводящие в заблуждение числа в UI.** Лидерборд, админ-метрики и Trader Score показывают вымышленные значения без пометки «demo». Для продукта, который продаёт доверие, это репутационный риск уже на этапе демо.

### 2.4 Оценка зрелости

| Область | Оценка (0–5) | Комментарий |
|---|---|---|
| Рыночные данные | 4 | Готово к продакшену после замены RPC и добавления стрима |
| Симулятор исполнения | 1 | Математика денег неверна (D1, D4), нет транзакций |
| Риск-движок | 1 | Формулы верны, но не запускается тогда, когда нужно (D2, D3, D6) |
| Аутентификация/безопасность | 0 | Отсутствует |
| Платежи/выплаты/KYC | 0 | Отсутствуют |
| Funded-исполнение на Phoenix | 0 | Намеренная заглушка |
| UI/UX | 3 | Выглядит как продукт, тёмная тема, терминал узнаваем |
| Тесты | 3 | Хорошее покрытие там, где есть; нет тестов на математику PnL |
| Документация | 4 | Честная и конкретная |

Итог: **это прототип для демонстрации концепции, около 15–20 % пути до MVP, который можно показать первым платящим пользователям.** Самая ценная часть — слой рыночных данных и дисциплина «fail-closed»; самая слабая — всё, что считает деньги.

---

> Продолжение отчёта (разделы TL;DR, 1–2 — в `draft-part1.md`). Все факты и цифры — из исследовательских заметок от 2026-10-07 с указанием дат и источников; конфликты данных помечены явно.

---

## 3. Экосистема Solana: где мы играем

2026 год полностью перетасовал Solana-perp-стек: Drift, многолетний лидер, слит на $285M 1 апреля 2026 и перезапущен как Velocity почти с нулём; GMX (GM Trade) вышел на Solana ~Q4 2025 и стал крупнейшей площадкой по объёму; Phoenix Perpetuals прошёл путь от анонса (2025-12-11) до $1.11B объёма за 30 дней. Объём Solana-perp за H1 2026 — $255.6B, +57.1% YoY против +6.4% у Hyperliquid ([CryptoBriefing](https://cryptobriefing.com/solana-record-perps-trading-volume-q2-2026/)). Но в абсолюте Hyperliquid всё равно ~6× больше всей Solana вместе взятой. Мы играем в быстрорастущем, но в шесть раз меньшем пруду.

### 3.1 Perp-DEX ландшафт

Основные объёмы/OI — DeFiLlama на 2026-10-07, кросс-чек bykaranteli.com на 2026-10-06 22:33 UTC ([bykaranteli](https://bykaranteli.com/solana-perps), [DeFiLlama per-chain](https://defillama.com/perps/chain/solana)).

| Биржа | Объём 30d / OI (2026-10-07) | Рынков | SDK | Делегирование / sub-accounts | Builder codes / fee-share |
|---|---|---|---|---|---|
| **Hyperliquid** (L1) | **$202.56B** / $8.70B OI; нормализованный $241.0B; 234 рынка (расчёт по API автора заметок: OI ≈ $13.47B — расхождение с DeFiLlama не объяснено, для кросс-сравнения берём DeFiLlama) | 234 | CLOB до 200K орд/сек, суб-секундная финальность; vaults (пулы, лидер торгует депозитами) | — (в заметках не зафиксировано) | не покрыто заметками |
| **GM Trade** (GMX Solana) | **$26.49B** / $108.8M (42% OI Solana) | 70 | not found | not found | referral-система есть, доли % — not found; в normalized-volume не входит (pool-vs-trader объём включает обе стороны/churn) |
| **Pacifica** (off-chain CLOB) | **$10.51B** / $67.3M односторонний | 77 | REST+WS+MCP, Python SDK, CCXT | API-subaccounts (dual-sig создание, свежий кошелёк), transfers main↔sub; **agent_wallet — полный подписант, scoped-правил нет** (PDA/Swig не подпишет REST) | Builder Program: пользователь утверждает `builder_code`+`max_fee_rate`, откликается в любой момент; 10M поинтов пул; аффилиаты до 40% fee-share |
| **Jupiter Perps** | **$5.71B** / $49.3M (bykaranteli: $54.5M one-sided; страница Jupiter показывает обе стороны ≈2×) | ~3+ (расширялся) | docs.jup.ag | нет (кошелёк подписывает всё) | referral = fee-rail для Swap/Trigger API, не perps; аффилиат-код без дисконта |
| **Phoenix Perp** (Ellipsis Labs) | **$1.11B** / $25.62M; нормализованный $1.08B — единственный Solana-venue в normalized-наборе | 93–94 (вкл. токенизированные акции, сырьё, FX) | **Rise SDK** `@ellipsis-labs/rise` v0.5.38 (~13.7K загрузок/нед), Rust `phoenix-rise` (MIT); REST+WS+JWT | **`position_authority`**: только ордера/стопы, не может выводить/вносить/делегировать; PDA(authority, portfolio_index, subaccount_index); cross-аккаунт: 128 позиций, 64+64 стакана на рынок; delegated onboarding | **Flight**: on-chain регистрация билдера, свой bps, аддитивно к базе, пока только taker-филлы; начисление USDC, вывод в любой момент. Referral 20%/10%, рефералу −10% на первые $100M |
| **Bullet** (ex-Zeta) | $222.5M / $2.34M | 26 | not found; network extension (ZK, Celestia DA), мейннет фев 2026 | not found | not found; комиссии 0.01% maker / 0.04% taker |
| **Velocity** (перезапуск Drift) | $1.75M / $165K | 5 | TS SDK публичный, `velocity-rs` не опубликован; USDT-сетлмент, «Backed by Tether» | delegate на subaccount: ордера/депозит/swap, **не может** выводить/закрывать/менять настройки; signed-message orders | builder codes: жёсткий протокольный кап **1%** (1000 tenth-bps), RevenueShareEscrow, сеттлмент permissionless |
| Ушедшие | Flash Trade закрыт 2026-09-16 (~3 года работы, ищет покупателя); Adrena в maintenance с 2025-11-12; legacy Drift $148.55B cumulative | — | — | — | — |

Контекст и оговорки:

- Агрегат по Solana (bykaranteli, 2026-10-06): OI **$258.4M**, 24h объём $1.2B, 274 рынка. Цепочка DeFiLlama Solana: 24h $3.572B, OI $184.81M, 30d ≈$33.3B (Pacifica помечена «Off Chain» и в цепные итоги может не входить).
- **Hyperliquid против всей Solana**: $202.6B против ~$33.6B за 30d — 6× ([DeFiLlama](https://defillama.com/protocol/hyperliquid)). При этом Solana растёт быстрее (+57.1% против +6.4% H1 2026), а Hyperliquid для проп-фирмы закрыт геополитикой: фронт-енд блокирует США, CFTC-совместимый вход оценивается в 10–12 месяцев даже при быстрых агентствах ([crypto.news](https://crypto.news/hyperliquid-policy-center-and-phantom-call-for-defi-specific-cftc-regulations/)).
- Дрейф-хак — центральное событие года для тезиса «реальный капитал на Solana DEX»: 2026-04-01, ~$285M за ~12 минут, >50% TVL, DPRK/«Лазарь» через шестимесячную соц-инженерию и **предподписанные multisig-транзакции на durable nonces** — opsec-провал, а не баг контракта ([Bloomberg](https://www.bloomberg.com/news/articles/2026-04-01/solana-based-defi-project-drift-hit-by-285-million-exploit), [TRM Labs](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist), [Chainalysis](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/)). Восстановлено $9.2M из ~$295.4M ([kryptonews, 2026-09-30](https://www.kryptonews.com/2026/09/30/drift-recovers-9-2m-of-295m-stolen-funds-as-recovery-efforts-continue/)); Tether + партнёры дали пакет поддержки до $147.5M ([BusinessWire, 2026-04-16](https://www.businesswire.com/news/home/20260416607266/en/)).
- Конфликты данных, которые мы не смогли снять: OI Hyperliquid $8.70B (DeFiLlama) vs $13.47B (расчёт по API); cumulative Phoenix $3.72B (DeFiLlama) vs ≈$2.60B (расчёт по fee-счётчикам, ~30% разница — вероятно, подсчёт сторон); сторонний агрегатор [solperps.streamlit.app](https://solperps.streamlit.app/) даёт числа, несовместимые с bykaranteli — индикативно.

### 3.2 Phoenix Trade как база проп-фирмы

Статус: анонсирован 2025-12-11 на Breakpoint (private beta), публично доступен к середине 2026 (мобильный веб без приложения — 2026-06-01, [SolanaCompass](https://solanacompass.com/news/phoenix-trade-brings-on-chain-perpetuals-to-mobile-browsers-no-app-required)); точной даты GA нет. SOL-рынок 2026-10-07: плечо до 25×, 24h $6.95M, OI $7.34M. Инсентивы: «Frontend Traders, Season 1» >$1M rewards. **Ограничение: Phoenix недоступен в США и санкционных юрисдикциях** ([docs](https://docs.phoenix.trade/index.md)) — это сразу сужает гео PROPS до не-США.

Что даёт Phoenix проп-фирме (чего нет у конкурентов):

1. **`position_authority`** — ключ только для торговли: не может вывести залог, внести его или сменить делегирование ([docs: accounts](https://docs.phoenix.trade/phoenix/collateral-and-accounts/accounts)). Это готовый примитив для funded-счетов: трейдер торгует, фирма держит деньги. Именно то, что PROPS сейчас имитирует заглушкой.
2. **Portfolio/subaccount-изоляция**: PDA(authority, portfolio_index, subaccount_index) — отдельный «книжный» риск-профиль на трейдера без создания новых кошельков; cross-аккаунт до 128 позиций.
3. **Delegated onboarding** (`build-register-ixs` / `send-register-ixs`): регистрация трейдеров интегратором, fee payer выбирается вызывающим — фабрика счетов для сотен funded-трейдеров ([docs: register](https://docs.phoenix.trade/sdk/register)).
4. **Flight builder codes**: свой bps на taker-филлах, USDC-начисление — монетизация оборота funded-книги поверх комиссий челленджей ([docs: builder-codes](https://docs.phoenix.trade/builder-codes)).
5. Комиссии taker 3.5 bps / **maker 0.5 bps** ([docs: fees](https://docs.phoenix.trade/phoenix/matching-engine/fees)) — дешевле Jupiter (0.06%+0.06%+funding-надбавки) и сопоставимо с Velocity T0; Rise SDK (TS) уже в продакшене, WS-каналы полные (`orderbook`, `traderState`, `trades`, `candles`), JWT-аутентификация.
6. Единственный Solana-venue в wash-adjusted (normalized) наборе DeFiLlama — $1.08B/30d «честного» объёма.

Слабые стороны и риск одной биржи:

| Риск | Факты |
|---|---|
| Ёмкость | OI Phoenix $25.6M против $8.7B у Hyperliquid. Наша прикидка: 200 funded-счетов × $50K equity × 3x среднего плеча ≈ $30M notional — **больше текущего OI всей биржи**. Книга маджоров глубже, TradFi-половина тонкая ([ORBIT review](https://orbitperpscreener.com/blog/phoenix-review)). |
| Молодость | Живая торговля <1 года; история объёмов из API не выгружается (нет 24h-поля, ≤~88 часовых точек статистики) — прозрачность ниже, чем у DeFiLlama-пиратов |
| Протокольный риск | Прецедент Drift: $285M за 12 минут — событие хвостового риска на Solana-perp реально; у Phoenix страхового фонда/аудитов в заметках не зафиксировано (not found) |
| Платформенный риск | Урок MetaQuotes (§4.4): зависимость 80–100 фирм от одной платформы кончилась их закрытием. Зависимость от одного venue = тот же класс риска |
| Гео | Блок США — PROPS не сможет легально продавать в крупнейший рынок проп-трейдинга, пока сидит только на Phoenix |

**Рекомендация.** Оставаться Phoenix-first — интеграция уже сделана, `position_authority` + delegated onboarding + Flight покрывают 80% уникальной механики funded-режима, и переезд ничего не даст, пока нет пользователей. Но архитектурно оформить исполнение как venue-agnostic слой (в коде уже есть `execution/policy.ts` с ветвлением) и в течение 6–12 месяцев добавить второй venue из короткого списка: **Velocity** (делегаты, maker-ребейт 0.0025%, USDT-бэкап Tether) и/или **Jupiter Perps** (глубочайшая ликвидность) — тот же список, что и в стековых заметках. Pacifica — запасной вариант с лучшими subaccounts, но off-chain матчинг и полный agent-wallet без scoped-правил ослабляют тезис «программно принуждаемый риск». Чистый Hyperliquid противоречит самой стратегии «лидерство в экосистеме Solana».

### 3.3 Инфраструктура: RPC, стримы, оракулы (цены на 2026-10-07)

| Провайдер / продукт | Что даёт | Цена |
|---|---|---|
| [Helius](https://www.helius.dev/pricing) Free | 1M credits/мес, 10 req/s, LaserStream WSS | $0 |
| Helius Developer | 10M credits, 50 req/s, gRPC **только devnet** | $49/мес |
| Helius Business | 100M credits, 200 req/s, **LaserStream gRPC mainnet**, 10 трекаемых pubkeys-млн | $499/мес |
| Helius Professional | 200M credits, 500 req/s | $999/мес; extra credits $5/M; raw shreds $1,000/мес/IP ($800 на Pro) |
| [Triton One](https://triton.one/pricing) | PAYG без тиров: RPC/unary gRPC $10 за миллион вызовов; стриминг (Yellowstone-семейство) **$0.08/GB**; shreds от $900/мес или $0.18/15 мин на IP; Preconfs Jito BAM $50/M, Harmonic max($0.0015/слот, $50/M) | депозит от $125 (стейблы) |
| [Jito](https://www.jdsupra.com/legalnews/cftc-extends-no-action-relief-for-8903561/) Bundles | 1–5 транзакций атомарно, приватно до лендинга | минимальный тип 1,000 lamports, остальное — рынок |
| Jito ShredStream | **закрыт 2026-09-05** (sunset) | — |
| [DoubleZero Edge](https://doublezero.xyz/jito-shredstream) | прямые шреды валидаторов по выделенному волокну; бенчмарк 2026-07-06: 73.5% first-seen win rate против Jito ShredStream+Turbine, p50 на 11.6 мс быстрее | $450–1,500/мес/IP ([fastshreds.com](https://fastshreds.com)) |
| [Pyth](https://www.pyth.network/blog/introducing-pyth-pro-reinventing-the-market-data-supply-chain) Crypto | оракул, крипта, обновление 1 с | **$0** |
| Pyth Crypto+ | крипта, 1 мс | $5,000/мес |
| Pyth Pro | кросс-актив, 2000+ источников, 1 мс | $10,000/мес; Pythnet выводится из эксплуатации |

Venue-native данные бесплатны: WS Phoenix (`wss://perp-api.phoenix.trade/v1/ws`), Pacifica WS, Velocity DLOB WS. Практический стек из заметок: venue-WS для цен + Yellowstone/LaserStream для состояния цепи; исполнение — RPC с sendBundle (Jito tips) или собственный «Phoenix RPC»; латеральный эдж — DoubleZero/Triton/Helius shreds.

Привязка к аудиту (ч. 1, D10): прототип ходит за `getBlockTime` на публичный `api.mainnet-beta.solana.com` в горячем пути. Минимальный апгрейд — Helius Free→Developer ($0→$49) для челлендж-стадии; gRPC mainnet ($499) понадобится только с funded-потоком. Pyth Crypto (бесплатный, 1 с) закрывает mark price для риск-движка челленджей — суб-секундные тарифы нужны, только если монетизируем скорость.

---

## 4. Конкуренты и рынок проп-трейдинга

Рамка: индустрия ~$850M выручки в 2026 (+45% YoY), ~12M покупок челленджей в год при среднем чеке ~$250, ~120–150 активных фирм (пик 220+ в 2023), топ-5 (FTMO, FundedNext, The5ers, Apex, Topstep) собирают ~62% трейдерского трафика ([Track360, 2026](https://www.track360.io/blog/prop-trading-industry-statistics-2026)). Revenue mix: 42% — комиссии челленджей, 38% — сплит-экономика, 15% — аффилиаты, 5% — white-label. Воронка: проходит 5–14% (blended 12.3%), ≥1 выплату получают ~45% funded, ~7% всех покупателей когда-либо платили, 1–3% — стабильно; 60–70% провалов — breach просадки, 30–40% неудачников покупают повторно в течение 90 дней. Конфликт: [DealPropFirm](https://dealpropfirm.com/articles/prop-firm-payout-denials) (2025-11-23) даёт пессимистичные 0.3–0.5% «когда-либо плативших» — методология мутная, цифры Track360 лучше обоснованы.

### 4.1 Ключевые крипто-проп-фирмы (мейнстрим)

Цены/правила — замеры prop-memo 2026-09-16/20 и досье ThePropExaminer/brokeranalysis 2026, если не указано иное.

| Фирма | Исполнение | Вход / $100K | Правила (цель / дневная / макс DD) | Сплит | Выплаты |
|---|---|---|---|---|---|
| **Breakout** (куплен Kraken 2025-09-04) | симуляция; funded у Payward Oceanic; Spark-челлендж на индексных продуктах Hyperliquid | $45 (5K) / Classic $800, Turbo $330 (9/3/3), Pro $545 (12/3/5) | Classic 10/3/6 статическая | 80%, +20% к fee → 90% | on-demand 24/7, USDC ERC-20, $50 min; без consistency rule, без мин. дней, без лимита времени |
| **Kraken Prop** (2026-05-27) / **Kraken Funded** (2026-07-30) | Kraken Pro / приложение | Starter $45–$800; Funded $20/$50/$90 за $1K/$5K/$10K | Funded: 12% / нет дневной / 5% | 80% | USD/USDG на счёт Kraken, «обычно <12h, гарантия 24h»; недоступно CA/IN/UK |
| **HyroTrader** (2022, Прага) | **свой Bybit-аккаунт по API** (Tealstreet/Cleo; также Binance/Bitget/OKX/Hyperliquid/dYdX); 700+ USDT-перпов | $59 (5K) / $579 | 10% / 4% / 6% статическая, мин 5 дней; альткоины <$100M mcap ≤5% баланса | 80→90% | USDT/USDC ≤12h, $100 min, fee возвращается с первой выплатой; Trustpilot 4.0 (226 отз., 14% 1★) |
| **Crypto Fund Trader** (SWISS RLCRATES AG, Zug) | MT5, Match-Trader, Bybit; «всё демо» | от $35 (промо) / Standard $660 | 2ф: 8%→5% / 5% / 10%; 1ф Accelerated 10/4/6 trailing | 80% (50–90%) | каждые 15 торговых дней |
| **FundedNext** (Дубай, 2022) | CFD + futures | $100K Stellar ~$500-класс | 8%/5%; 15% completion reward | до 95% | медиана <5h (фев 2026); **$306M cumulative (2026-05-15), счётчик $382.4M (2026-09-20); из них on-chain верифицируемо ~64%** ($225.9M из $350M заявленных, traderpayout) |
| **Hola Prime** (2024, Дубай) | CFD+futures | см. [pricing](https://brokeranalysis.com/prop-trading-firms/hola-prime/pricing/) | 4+ плана | 80%+ | **выплаты за 1 час**; Deloitte-ревью (апр 2026): 98.35% выплат <1h, ноль отказов, среднее 33m48s; 110% возврат fee; pass rate 35% (ноя 2024–май 2025) |
| **BrightFunded** (NL/Дубай) | MT5 + cTrader | $59–$949 | 2-шаг стандарт | до 90%, 100% промо | >$14M cumulative (сер. 2026) |

Экономика юнита для калибровки PROPS: AOV двухшагового челленджа $187, contribution margin 75–85%; LTV покупателя $430–490 за 24 мес (2.6 покупки/год, 55–65% выручки — повторные); healthy payout-to-revenue 40–65%; аффилиаты приводят 40–50% покупок при комиссии 10–15% ([Track360 affiliate report](https://track360.io/blog/prop-firm-affiliate-economics-report-2026)). FTMO FY2023 (единственная публичная отчётность): выручка ~$213M, выплаты $75.2M = 35.3% ([TradeInformer](https://tradeinformer.com/prop-weekly/how-much-do-alpha-capital-fundednext-fundingpips-and-e8-markets-make)).

### 4.2 On-chain / DEX проп-фирмы — прямые конкуренты

Все 22 обследованных Web3-фирмы (prop-memo, сент 2026) держат оценочную фазу в симуляции; дефолт индустрии — **B-book** (фирма — контрагент, выплаты победителям из fee-float), победители переводятся в A-book. Oфициальные условия прямо оставляют дискрецию: ToS HyperPNL §4.2 (2026-01-29) — «вы не вправе требовать исполнения вашей торговой идеи… и не можете знать, как оператор её обработал» ([prop-memo](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09), [alexfirdaus](https://alexfirdaus.com/hyperliquid-prop-firms/)). Дефолтная инфраструктура — Hyperliquid (>$190B перпов в месяц, 2026; основатель Propr в мае 2026 предсказал >100 on-chain проп-фирм на HL за 6–12 мес).

| Фирма | Инфра | Вход / топ-цена | Правила | Сплит / выплаты | Данные и репутация (дата) |
|---|---|---|---|---|---|
| **Propr** (XBorg/SwissBorg, BVI) | Hyperliquid; **гибрид A/B-book с публичной логикой роутинга** ([GitHub](https://github.com/XBorgLabs/ab-booking)) | Turbo $25 (5K)–$899; Classic $60–$1,998; Pro $45–$1,399 | Classic 10/3/6; Turbo 9/3/3; Pro 12/3/5; 2-Step 5→10/5/8 trailing | 80%; USDC on demand, медиана 38 мин; full-sweep сбрасывает DD | выручка $2.95M, выплаты $1.44M, 4,460 платных eval, **pass 15.4%** (дашборд 2026-09-09; Prop Journalist 2026-09-28 даёт 16.3% = 3,943/20,241 — расхождение дат снапшотов); $PROPR TGE 2026-08-24; TP 4.4 |
| **Hypernova** (Cayman) | HL-цены + **собственный матчинг; правила неизменяемы в контракте Arbitrum**; публичный резерв-кошелот | Tight $120 (5K)–$1,850 (200K); $100K = $400/$999/$1,350 по тирам | Tight 9/3/3; Low 10/3/6; Medium 10/4/7 — статические | 80%; USDC Arbitrum, **средняя выплата 6.0 сек**, газлес, без минимума | cumulative $1.01M, резерв $789.1K (2026-09-19); 94 funded; pass 23.2% (604/2,599) или 22.5% (723/3,210, 2026-09-28) — оба с дашборда; $3M pre-seed от Lemniscap (май 2026), $1M — в резерв; invite-only; 0 отзывов |
| **HyperPNL** (Cayman) | HL-цены, исполнение на discretion оператора, **выплаты смарт-контрактом раз/день ~3 сек** | $42 (5K) / $86 (10K) / $215 (25K) | 1-Step 10/3/5 статическая | 80%; **без KYC сейчас** | публичных данных мало; TP 4.3 |
| **SizeProp** (Cayman; pre-seed от Igloo/Pudgy Penguins, 2026-05-19) | **мульти-venue: Hyperliquid + Trade.xyz + Bybit** | Degen $19 (5K)–$580 (100K); 1-Step $999 (100K) | Degen 8/2/3; 1-Step 10/3/5 | 80%; +$350→90%, +$450→95%; USDT same-day | «>$50M funded, 150+ стран»; TP 4.4 (11% 1★) |
| **Carrot Funding** (UAE) | гTrade → Hyperliquid (миграция сент 2026, противоречия в источниках) | 2P $65–$699; 1P $75–$799 | 1P 8/4/8 + 50% best-day rule | 80%; USDC Arbitrum, «24h», min 100 USDC | официальные цифры противоречивы; TP 4.6 |
| **Investabl** | сим + **правила хешируются и локаются при покупке**; Safe multisig | $11 (1K) / $45 (5K) / $89 (10K) | 8/4/8 статическая, 3 мин дня, 50% best-day | 80%; **fee полностью возвращается с первой выплатой**; $10 min | ~168 выплат (2026-09-20); TP 4.6 |
| **Vanta / Hyper Stack** (Taoshi, Bittensor SN8) | явно 100% симуляция; Hyper Stack зеркалит реальные сделки с кошелька трейдера в сим-eval | Vanta $199/$349/$549 (25/50/100K); Hyper Stack от $59 | Vanta Classic 10/5/5; Pro 6/8 trailing, 90 дней | **60–100% выбирается при покупке**; weekly USD/USDC без капа | весь след на публичном ledger; TP 4.6 |
| **DojiFunded** | on-chain settlement | $17 (1K)–$963 (100K) | 1-Step 10/3/6 | до 90% (+20% add-on) | нулевой трек-рекорд; 0 отзывов |
| **Solana Funded** (SolaraX FZCO, Дубай) | единственная «Solana-брендовая» фирма | $759–$1,318 (100K) | **1-Step цель 45–50% (!), дневная 10%, макс 20–25%** | 90%; SOL/USDC; **KYC только после $100K** | **TP 2.5 (63% 1★)** — задержки выводов, баги исполнения → принудительные ликвидации (авг–сент 2026). Поучительная история категории |
| **FundedHive** (DIFC) / **Upscale** | USDC-выплаты «60 сек» / TON-Base-BSC | от $9.90 / $59–$1,499 | 60→99% / 10/3/6 | кап вывода **$1,000/день** / 15–50% | оба — **рейтинг Trustpilot suspended** (28% и 1★-хвосты) |

Ключевой факт для стратегии: **достоверной Solana-native проп-фирмы не существует на октябрь 2026** — единственный Solana-бренд (Solana Funded) худший в категории, вся когорта on-chain-лидеров (Propr, Hypernova, SizeProp, Hyper Stack) сидит на Hyperliquid ([prop-memo §Solana](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09)). Solana — незанятая ниша, но с обоснованием «почему пусто»: хак Drift подорвал доверие к venue-риску. VC-активность подтверждает спрос: Kraken→Breakout (2025-09-04), Hypernova $3M (Lemniscap, 2026-05-28, [The Block](https://www.theblock.co/post/402923/hyperliquid-prop-trading-platform-hypernova-crypto-funding)), SizeProp (Igloo, 2026-05-19, [Chainwire](https://chainwire.org/2026/05/19/sizeprop-raises-pre-seed-round-led-by-igloo-inc-to-build-the-infrastructure-for-crypto-prop-trading/)), PERPTools $8M (2026-10-01). Ни одной Solana-native проп-раунды не найдено — белое поле.

### 4.3 PROPS против рынка: где дешевле, дороже, жёстче

Матрица из §1.2 (SPRINT 9/3/3, CORE 10/3/6, APEX 12/3/5; все 3% дневная; 80%; мин 3 дня; плечо 5x) против референсной полосы 2026 (Breakout Classic 10/3/6 и Propr Classic 10/3/6 — именно они задают зону):

| Точка | PROPS | Рынок (min…max) | Вердикт |
|---|---|---|---|
| Вход $5K | SPRINT $23, CORE $49 | Investabl $45, Breakout $45, Kraken Funded $50, HyperPNL $42, Propr Turbo $25, SizeProp Degen $19, DojiFunded $17 | **дешевле почти всех** (справа только микро-аккаунты $11–$25) |
| $100K, план 10/3/6 | CORE $799 | Breakout $800, CFT $660, HyroTrader $579, SizeProp 1-Step $999, Hypernova $999–$1,350, Propr $1,998 | **рынок** (середина); в 2.5× дешевле Propr |
| $100K, план 9/3/3 | SPRINT $369 | Breakout Turbo $330 | **дороже на 12%** при идентичных правилах |
| $100K, план 12/3/5 | APEX $549 | Breakout Pro $545 | паритет (±$4) |
| Дневная просадка 3% | 3% | 3% у Breakout/Propr/Hypernova Tight; 4% HyroTrader/HyperPNL; 5% CFT | норма рынка |
| Макс DD статическая 3–6% | да, статическая | статическая — selling point рынка (Breakout, Hypernova) | норма; **сохранять статической обязательно** |
| Сплит 80% | 80% | 80% table stakes; 90% — платный аддон (Breakout +20% fee, SizeProp +$350), 95–100% — промо | норма; 90% упущенная монетизация — **продавать как аддон** |
| Мин дней 3 | 3 | Breakout/Kraken — 0; HyroTrader — 5 | мягче среднего, жёстче лидера |
| Плечо 5x | 5x | Kraken Prop 5x, Breakout funded 5x BTC/ETH; venue-максимумы: Phoenix SOL 25x, Velocity 20x, Jupiter до 250x (заявка MadeOnSol, проверить в приложении) | консервативно = по крейкен-норме; ниже, чем позволяют DEX |
| Комиссии симулятора | 0.035% открытие / 0.05% закрытие (D9: несогласованные, реальные fee Phoenix не используются) | жалоба №3 рынка: у Breakout 0.04%/сторона + 0.033%/день своп ≈ 0.8% round trip при 10x — 6% max DD съедаются ~7.5 кругами | **жёстче рынка**: выше реальных издержек Phoenix (taker 3.5 bps, maker 0.5 bps) |
| Прозрачность | фейковый лидерборд/админка (ч. 1, §2.3) | 4 из 22 Web3-фирм уже suspend'нуты за фейковые отзывы | текущее состояние — репутационная мина |

Чего у PROPS нет, но рынок уже сделал обязательным (чек-лист дифференциации): (a) верифицируемое исполнение — никто не делает Solana, у нас будет монополия ниши; (b) on-chain резерв/выплаты — модель Hypernova ($789K публичного резерва, 6-сек выплаты); (c) неизменяемые правила — модель Investabl (хеш при покупке), прямой ответ на жалобу №7; (d) публичный pass rate — делают только Propr и Hypernova; (e) опубликованная A/B-логика — GitHub Propr. Санк-чек юнит-экономики: медиана рыночной выплаты $1,122 (avg $1,434, Payout Junction, окт 2026); при 3%/3–6% DD и 60–70% провалов именно через breach — наши правила являются ровно тем профилем, который индустрия монетизирует, и ровно тем, что порождает жалобы №2–3. Это надо осознанно компенсировать прозрачностью подсчёта просадки (equity-based, логика открыта).

### 4.4 Уроки провалов и главные жалобы

**My Forex Funds (Traders Global Group)** — крупнейший провал категории и главный юридический прецедент. CFTC: жалоба 2023-09-01, экстренная заморозка активов, >$310M комиссий от ~135K клиентов, до 2,000 новых клиентов/день в пике. Развязка: **13–14 мая 2025 суд D.N.J. закрыл дело WITH PREJUDICE по Rule 11** — центральное «доказательство» (перевод CAD 31.5M) оказалось налоговым платежом в CRA, а CFTC знала это ≥недели до подачи; агентство sanctioned за «wilful and bad faith», 14 июля 2025 обязано оплатить >$3.1M издержек; 4 юриста + 1 следователь отправлены в отпуск ([Reuters](https://www.reuters.com/legal/government/judge-sanctions-cftc-over-agencys-conduct-my-forex-funds-case-2025-05-14/), [Quinn Emanuel](https://www.quinnemanuel.com/the-firm/publications/historic-rule-11-dismissal-and-fee-victory-against-the-commodity-futures-trading-commission/)). Юридически нерешённым осталось главное: являются ли платные сим-челленджи «retail forex»/комmodity-interest — по существу суд не высказался ни разу; после августа 2023 новых федеральных дел против evaluation-фирм нет. Уроки: (1) экспозиция определяется тем, чьих трейдеров принимаешь и как маркетишь, а не местом инкорпорации — MFF был канадским; (2) даже оправданная фирма умерла операционно — заморозка убивает бизнес быстрее вердикта.

**The Funded Trader**: остановка выплат 2024-03-28 после потери брокерского доступа и MetaQuotes; пауза всех операций; офшорный перезапуск — по собственным данным, **<2% реактировавших счетов получили выплаты к 2026**; 1,272 трейдера ждали 8+ месяцев, оценочно $10M+ невыплаченных; производный иск D'Arcangelo v. TFT (W.D. Tex., 1:23-cv-01472) дошёл до adoption R&R в 2025.

**MetaQuotes (февраль 2024)**: отзыв MT4/MT5-лицензий у True Forex Funds 2024-02-02 и далее у десятков фирм за grey-label злоупотребления → **80–100 закрытий фирм через конец 2025 (~40% пикового числа)**; миграция на cTrader/DXtrade/TradeLocker/Match-Trader; доля MT-only упала с ~85% (2023) до <30% (2026); в 2026 cTrader сам ограничил доступ US-проп-фирм (The5ers июнь, FundedNext март, Goat апрель). Урок для PROPS: **платформенная зависимость — смертельный класс риска; пермиссивные venue (DEX) структурно устойчивее, но тогда платформенный риск превращается в протокольный (Drift)** — единственное лекарство: мульти-venue (§3.2).

**Волна 2026**: GT Funded исчез в июне; ≥5 фирм закрыто/suspended за фейковые отзывы; 4 из 22 Web3-фирм с suspended-рейтингом (Crypto Fund Trader, Upscale, FundedHive, AI Prop).

Топ-жалобы трейдеров (рекуррентные 2025–2026, DealPropFirm 12-триггерный аудит + prop-memo): (1) **отказы/задержки выплат после прохода** — убийца доверия №1 (ретроактивные правила, KYC-циклы, технические оговорки, VPN-баны; Funding Ticks, декабрь 2025: сняли $21K+ прибыли, TP рухнул до 3.2); (2) споры об учёте просадки (balance vs equity, trailing vs static — Propr менял формулу дневного лосса 3× за апрель+июль 2026); (3) комиссии на notional, съедающие DD-бюджет; (4) капы на вывод (FundedHive $1K/день, Upscale 15–50%); (5) накрутка отзывов; (6) стабильность платформы в критические моменты (Solana Funded — баги → принудительные ликвидации); (7) внезапные смены правил после покупки. Для PROPS это прямой список требований: equity-based просадка на серверном тике, публичная фиксация правил (хеш), автоматические выплаты, реальные fee в симуляторе, ни одного выдуманного числа в UI.

---

## 5. Регуляция и юридические риски

> Не юридическая консультация. Картина на 2026-10-07; все ссылки — первоисточники/отраслевые обзоры из заметок.

### 5.1 Юрисдикции

| Юрисдикция | Статус проп-модели | Ключевые факты (дата) |
|---|---|---|
| **США** | рабочего федерального enforcement-шаблона против evaluation-модели нет после MFF (май 2025) | Большинство фирм не зарегистрированы (CPO/CTA/FCM/IB): лишь 1 из 7 крупных US futures-фирм зарегистрирована ([DealPropFirm](https://dealpropfirm.com/articles/are-prop-firms-regulated)); тренд — «регулируемая смежность»: Topstep Brokerage (NFA 0567079), Tradeify/Slay (NFA 0575972) как IB, Kraken→Breakout, FTMO→OANDA (закрыто 2025-12-02); 2026-05-29 CFTC нормализует перпы: DCM-листинг BTC-perp (KalshiEX BTCPERP, PR 9242-26) + классификация крипто-перпов как «foreign futures» (PR 9241-26); 2026-09-17 no-action для пассивного софта, открывающего доступ к регулируемым деривативам, вкл. перпы; вопрос «челлендж-fee = доля в пуле» юридически открыт (заявление о консультации к ноябрю 2026 — единственный блог-источник, не подтверждено) |
| **ЕС** | специализированного rulebook нет (ESMA, 2026-06-26: «не приоритет») | ESMA 2026-02-24: перпы с плечом ≈ CFD → продукт-интервенция нац. мер (плечо, предупреждения, NBP); ESMA Q&A 2293: own-account трейдинг ≠ CASP-услуга; MiCA-переход истёк 2026-07-01 — из ~1,200 VASP лишь ~210 (17%) получили CASP; **travel rule TFR на стейблкоин-выплаты трейдерам из ЕС независимо от HQ фирмы** ([WalletConnect](https://walletconnect.com/blog/mica-enforcement-is-live-what-it-means-for-prop-trading-payouts)); нац. предупреждения: FSMA (03.2024), CONSOB (07.2024, «внимание очень высокое»), ЧНБ (2024: часть услуг может требовать MiFID II-лицензию) |
| **Великобритания** | нерегулируемо-терпимо | Сим-оценки с «performance bonus» вне мандата FCA, пока нет клиентских денег; розничные CFD-капы плеча **не применяются** к проп-фирмам (потому 100:1+); crackdown на misuse of UK badge: 24 CFD-фирмы закрываются (2026); FSMA-режим крипто: dealing-as-principal становится лицензируемым, **carve-out для проп-трейдинга** (поправки 2026), окно заявок 2026-09-30–2027-02-28, режим с 2027-10-25, prudential минимум £750K для dealing-as-principal ([micahub](https://micahub.net/blog/prop-trading-market-making-licence-mica-uk-us/) — вторичный источник); выплаты трейдеру = подоходный налог |
| **ОАЭ** | самый дешёвый законный seat | VARA: проп-трейдинг собственных активов **не является лицензируемой VA-активностью**; ETD-rulebook VER20260331 (~2026-03-31) — полное деривативное регулирование для лицензируемых venue (капы плеча, suitability); меню: SPC Sharjah (быстро/дёшево, без VARA NOC), RAK, Dubai mainland NOC 4–16 недель, **DMCC 0% налог — дефолтный HQ запусков 2026**, DIFC/ADGM — институционально ([Cryptoverse Legal](https://www.cryptoverselawyers.io/crypto-proprietary-trading-firm-setup-in-the-uae/)) |
| **Сингапур** | проп-специфики нет | Лицензирование CMS по признаку «торгуете ли капитал-маркет продукты / клиентские деньги»; действий MAS против funded-фирм не найдено |
| **Прочие** | — | ASIC (07.2026): крипто-перпы «мимикрируют под CFD, уклоняясь от CFD-правил»; ФСЮАР: ODP-лицензии выдавливают мелких |

Где сидят лидеры: FTMO — Чехия (s.r.o., давление ЧНБ), FundedNext — ОАЭ + St Lucia + Коморы (брокерское плечо FNmarkets), Propr — BVI (Тортола), Apex — Техас («не регулируем»), Topstep — Чикаго + IB-аффилиаты. Стандарт индустрии post-MFF — **двухэнтитная модель**: фронт (UK/EU/Delaware) «продаёт симулированные оценки» + бэк (BVI/Cayman/DMCC) «торгует собственный капитал и платит выплаты» ([alexfirdaus](https://alexfirdaus.com/why-prop-trading-firms-operate-offshore/)). Предел щита: офшор ≠ firewall — экспозиция следует за трейдерами и маркетингом.

### 5.2 Что меняется при реальном капитале на DEX

1. **США**: пул фирменного капитала, которым торгуют не-сотрудники за сплит прибыли, — открытый CPO-вопрос («напоминает commodity pool»), обязывающего рулинга нет ни в одну сторону ([Willkie](https://complianceconcourse.willkie.com/articles/new-jersey-federal-judge-dismisses-forex-case-with-prejudice-and-awards-attorney-fees/)); FCM не нужен для собственного капитала, но fraud/registration-теории живы; FinCEN: чистый проп = «user», не MSB, однако крипто-выплаты третьим лицам (трейдерам) пододвигают к money-transmission анализу; навигация US-трейдеров на KYC-free DEX наследует US-постуру venue (Hyperliquid блокирует США — Phoenix тоже).
2. **ЕС**: own-account освобождение узкое — двусторонние потоки с ритейлом презюмируют клиентские отношения; travel rule на выплаты; обслуживание EU-трейдеров через нелицензированное брокерское плечо нарушает MiCA-пасспортизацию после 2026-07-01.
3. **Venue-риск**: Drift 2026-04-01 ($285M) + «инсайдерская» оптика Hyperliquid (окт 2025, $150–200M шорт) — регуляторно не наказано, но репутационно залипло; PropVitals рисует карту рисков крипто-пропов: insolvency (fee-float без backstop), smart-contract риск, rule-arbitrage (FX-правила на 24/7 перпах), affiliate-hype — совет трейдерам «выводите первую выплату немедленно» ([PropVitals](https://www.propvitals.com/guides/hyperliquid-prop-firms-2026/)).
4. Никто в категории не публиковал смарт-контрактный аудит (prop-memo 2026-09-20) — **первый аудит резервов/контракта выплат = доверительный ров первого хода**.

### 5.3 KYC, санкции, стоимость комплаенса

| Статья | Провайдер/суть | Цена (2026) |
|---|---|---|
| KYC | [Sumsub](https://sumsub.com/pricing/) Basic | $1.35/верификация, минимум $149/мес |
| KYC | Sumsub Compliance (AML-скрининг+мониторинг+PoA) | $1.85/верификация, минимум $299/мес; мониторинг $0.08/чек; PoA +$1.35 |
| KYC | [Persona](https://withpersona.com/pricing/) Essential | $250/мес (12 мес мин.) вкл. 500 услуг, далее $1.50/услуга |
| KYB | Ondato (корпоративные счета) | €600/проверка |
| Analytics | [TRM Labs](https://costbench.com/software/crypto-compliance/trm-labs/) | $50–500K/год, медиана контракта ~$112K (вериф. 2026-03-28) |
| Analytics | [Chainalysis](https://www.vendr.com/marketplace/chainalysis) | $50–200K/год; медиана малых сделок ~$19K/год; входные тиры: Chainalysis $60–120K / TRM $40–90K / Elliptic $40–80K / Crystal $25–60K |
| Travel rule | WalletConnect payout-rail и т.п. | поверх выплат в ЕС |

Индустриальный baseline после чисток 2024: **KYC на регистрации (не на выплате)**, раскрытие A/B-book, мультиплатформенность, объявленная юрисдикция. Оценочный комплаенс-флор малой крипто-проп-фирмы (собственная арифметика по прайс-листам): Sumsub $299/мес + $1.85/заявка + один analytics-вендор ($40–90K/год) + travel-rule тулинг ≈ **$50–100K/год до юристов и MLRO** — это треть-половина годового burn прототипа PROPS и должно быть в модели с первого дня funded-режима.

### 5.4 Рекомендуемая структура для PROPS

1. **Двухэнтитная модель**: фронт — «продаёт симулированные оценки» (UK/EU или Delaware-фронт по целевой аудитории), бэк — «торгует собственный капитал на Phoenix и платит сплиты» (DMCC как дефолт 2026: 0% налог, банковинг/процессинг, скорость; SPC — если нужен минимум затрат на старт).
2. **Гео-политика = гео Phoenix**: США и санкционные юрисдикции исключены из Т.О. с первого дня (venue сам их блокирует — синхронно и бесплатно); ЕС — только с travel-rule-рейлом выплат и пониманием ESMA-периметра (перпы≈CFD); не входить в США до появления ясности по CPO-вопросу или until регулируемой смежности (IB-паттерн Topstep).
3. KYC при регистрации (Sumsub-класс), санкционный скрининг кошельков на входе и выплате, публичная юрисдикция — это одновременно и маркетинговый актив в категории, где 4 из 22 Web3-фирм suspend'нуты за фейковые отзывы.
4. Правила челленджа фиксировать хешем при покупке (модель Investabl) — страховка от жалобы №7 и от собственных будущих «улучшений».

---


## 6. Как занять лидирующее место в экосистеме Solana

### 6.1 Позиционирование и ров (moat)

Рынок платных челленджей — ~$850 млн в 2026 г., +45 % г/г, ~12 млн покупок в год при среднем чеке ~$250 ([Track360, 2026](https://www.track360.io/blog/prop-trading-industry-statistics-2026)); при этом оценка конфликтует с трекингом реальных выплат — [Prop Firm Match](https://www.tradingview.com/news/financemagnates:dbcee565f094b:0-prop-firm-match-tracked-about-325-million-in-payouts-to-traders-in-2025/) насчитал $324,96 млн выплат по всем фирмам за 2025 г. (другая методология). Фирм осталось 120–150 (с пика 220+ в 2023), топ-5 собирает ~62 % привлечения трейдеров. Барьер входа в «продажу челленджей» низкий: микро-аккаунты от $11–$25 (Investabl $11, DojiFunded $17, SizeProp Degen $19, Kraken Funded $20, Propr Turbo $25), и основатель Propr в мае 2026 предсказал >100 on-chain проп-фирм на Hyperliquid за 6–12 месяцев. Симулятор сделают все. На Solana при этом **ниши нет вообще**: единственная «Solana-фирма» — Solana Funded — худшая по репутации в категории (Trustpilot 2.5, 63 % единиц, задержки выводов, авг–сен 2026; [prop-memo](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09)). Позиция «первая credible Solana-native проп-фирма» открыта — это и есть окно.

Главный дифференциатор — **«прозрачная on-chain проп-фирма с программно-принуждаемыми лимитами риска»**, разложенный на четыре компонента, каждый из которых закрывает конкретную боль категории (топ-жалобы 2025–2026: отказы/задержки выплат №1, споры о просадке №2, негласные комиссии №3, смена правил №7):

1. **Программно-принуждаемые лимиты.** Phoenix даёт `position_authority` — ключ, который умеет ставить/отменять ордера и стопы, но физически не может вывести залог (`docs.phoenix.trade/phoenix/collateral-and-accounts/accounts`); Velocity/Drift — делегата субсчёта (ордера, депозит, своп; без вывода); Squads V4 — permission-маски, лимиты трат, таймлоки (`docs.squads.so/main/development/reference/permissions`). Ни один конкурент не принуждает лимиты кодом: все считают риск в своём бэкофисе с дискрецией — HyperPNL ToS §4.2 (от 2026-01-29) прямо пишет: «you may have no way to know how the operator handled it» ([alexfirdaus, 2026-06-25](https://alexfirdaus.com/hyperliquid-prop-firms/)). Принуждение на уровне подписанта наполовину убирает класс споров «мне изменили просадку» и «мне не дали вывести».
2. **Верифицируемость.** Публичный резерв-кошелёк и выплаты смарт-контрактом — паттерн Hypernova (резерв $789,1 тыс. USDC на Arbitrum на 2026-09-19, выплаты ~6 сек, gasless; [prop-memo](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09)); публикация pass rate и выручки вживую — паттерн Propr ($2,95 млн выручки, $1,44 млн выплат, 15,4 % pass, 330 funded на дашборде 2026-09-09). Pass rate публикуют лишь 13 из 50 фирм ([The Prop Journalist, 2026-09-28](https://thepropjournalist.com/analysis/prop-firm-pass-rates/)) — честная метрика сама по себе дифференциатор.
3. **Неизменяемость правил.** Хэш правил в момент покупки — модель Investabl («rules hashed/locked at purchase») — против жалобы «sudden rule changes» (Propr менял формулу дневного лосса трижды за апрель+июль 2026).
4. **Аудит.** Ни одна on-chain проп-фирма в категории не публикует аудит смарт-контрактов (prop-memo 2026-09-20; alexfirdaus 2026-06-25). Первый опубликованный аудит — мгновенный доверительный moat.

Вторичные элементы рва (по убыванию отдачи):

- **Trader Score как on-chain репутация.** Сейчас это декорация с захардкоженными входами (часть 1, §1.3). Переделать в реальный on-chain след трейдера — история челленджей, просадок, выплат, привязанная к кошельку, — и получится переносимая репутация, которой нет ни у кого в категории. Это data moat: он растёт с каждым проданным челленджем и не копируется кодом.
- **Builder codes как доп. доход.** Phoenix Flight: билдер задаёт свой bps, комиссия аддитивна к базовой, сейчас собирается с taker-филлов и накапливается USDC-залогом на счёте билдера (`docs.phoenix.trade/builder-codes`); Velocity — хард-кап 1 %; Pacifica — до 40 % fee share по affiliate-программе плюс пул 10 млн поинтов для билдеров; Phoenix Referral — 20 % с прямых рефералов / 10 % со вторых уровней, рефералу скидка 10 % на комиссии. Аналог у Drift v3 («Builder Codes») уже продуктезирован. Это монетизация собственного потока funded-ордеров: фирма становится билдером собственного трафика.
- **Интеграции Jupiter/Phantom.** Быть в referral-графе Jupiter — реальный канал дистрибуции (интеграторы вешают свою комиссию, Jupiter забирает 20 % с интеграторских комиссий на Ultra: `developers.jup.ag/docs/tool-kits/referral-program`); в Phantom платного размещения не существует (not found) — канал это UX-совместимость (SIWS, списки, swap-роутинг).
- **Seeker / dApp Store.** ~150K предзаказов, отгрузка с 2025-08-05, 700+ dApps, Builder Grants с 2026-03-19, комиссий «по-эппловски» нет ([Solana Mobile](https://solanamobile.com/blog/builder-grants-are-live-the-dapp-store-crosses-700-apps-and-seeker-season-2-keeps-shipping)). Дешёвый листинг на самоселектирующуюся высокоактивную аудиторию.
- **Blinks/Actions** — шарящийся «claim challenge»-линк: adoption «steady rather than explosive», не канал, а усилитель конверсии ([MadeOnSol, 2026](https://madeonsol.com/blog/solana-blinks-actions-explained)).
- **Telegram** — 74 % пользователей TG-ботов торгуют на Solana ([CoinGecko/Dune](https://www.coingecko.com/learn/solana-telegram-trading-bots)), но комиссионный пул сжался на порядок (BONKbot: $14 млрд объёма и 520K пользователей в авг 2025 → выручка ~$63K за 30 дней в сент 2026, [DefiLlama](https://defillama.com/protocol/bonkbot)). Бот-онбординг — поверхность, не бизнес-модель.

Сплит 80 % — table stakes (стандарт 2026 — 80–90 %, 100 % на первом транше как acquisition-рычаг); конкурировать ценой и сплитом — гонка на дно. Ров строится из пунктов 1–4.

### 6.2 Модель funded-исполнения

Базовый факт: **оценочная фаза у всех — симуляция** (опрос 22 Web3-фирм, [prop-memo, 2026-09-20](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09)). Вопрос — что происходит после pass. Варианты:

| Модель | Как работает | Плюсы | Минусы | Прецеденты из заметок |
|---|---|---|---|---|
| **B-book (симуляция)** | Funded-счёт остаётся симом; фирма — контрагент; выплаты из операционной кассы; стабильных победителей переводят в A-book | Мгновенный запуск; минимум капитала; нет venue-риска; отраслевой дефолт | Каскад победителей = неплатёжеспособность (42 % выручки отрасли — фиды → зависимость от float); конфликт интересов; «discretion» в ToS порождает жалобу №1 | Почти все ритейл-фирмы ([PropTraderCheck, 2026](https://proptradercheck.com/research/a-book-b-book)); ToS Breakout/Propr/HyperPNL |
| **Копирование в мастер-счёт (mirror)** | Сделки топ-трейдеров зеркалятся на реальный счёт фирмы (или хеджируются у LP) с пониженным мультипликатором | Капсирует экспозицию победителей; классический B→A-переход | Slippage сим↔реал → новые споры о просадке; публично не документируется никем («discretion») | CFD-паттерн; описан как гибридный переход в исследовании PropTraderCheck |
| **Делегированные sub-accounts / Squads-политики** | Реальный капитал фирмы на Phoenix; трейдеру выдаётся `position_authority` (только ордера, вывод невозможен) либо session-key с лимитами; казна фирмы — Squads multisig, политика подписания с капами | Настоящее исполнение; **программно-принуждаемые лимиты** — ядро позиционирования; верифицируемость каждой сделки | Капиталоёмко (выделенный залог на каждого funded); venue-риск; операционная сложность ключей; регуляторная экспозиция шире (CPO-вопрос) | Ближайший аналог — HyroTrader (свой Bybit-аккаунт трейдера по API); паттерн custody — Squads Grid session keys / Turnkey policies |
| **Vault** | Капитал фирмы в пуле, трейдер — лидер с profit share | On-chain profit share уже готов; профит-шер прозрачен | Публичный vault — любой может войти «рядом» с трейдером; leader-fee ≠ проп-модель; на Solana это Drift Vaults, скомпрометированный хаком 2026-04-01; на Phoenix vault нет | Drift Vaults Program; [Hyperliquid vaults](https://hyperx.trade/hyperliquid/blog/hyperliquid-vaults-explained) |

Поперечный слой (не модель исполнения, а слой доверия): внутренний матчинг + неизменяемые on-chain правила + публичный резерв + смарт-контрактные выплаты — паттерн Hypernova (правила иммутабельны при открытии счёта, выплаты ~6 сек) и Propr (логика A/B-рутиинга опубликована на GitHub, живой дашборд).

**Рекомендация — поэтапный гибрид.**
- **Этап A (запуск funded):** B-book + доверительный слой Hypernova (публичный резерв, выплаты контрактом, хэш правил при покупке, публикация pass rate). Это даёт честность витрины без капиталоёмкости.
- **Этап B:** mirror стабильных победителей в мастер-счёт (B→A) — капирование экспозиции до того, как она станет угрозой float.
- **Этап C (moat-фаза):** делегированные Phoenix sub-accounts с `position_authority` для проверенных funded — капитал порциями, лимиты принуждаются программно, каждая сделка верифицируема. Параллельно включаются builder codes (§6.1).
- Vault — отдельный продукт («управляемые проп-счета»), не замена funded-модели.

### 6.3 Go-to-market

Целевые цифры: blended CAC ≤ $70 (диапазон KOL $35–70 на приведённую покупку, [Track360](https://track360.io/blog/prop-firm-affiliate-economics-report-2026)) против LTV $430–490 за 24 мес (2,4× от AOV $187; 2,6 покупки/байер/год, 55–65 % выручки — повторные) — соотношение 1:6–1:7. Ориентиры рынка: аффилиаты приводят 40–50 % покупок ($40–80 CPA или 10–25 % revshare; стоимость funded-трейдера $325–650); consumer-crypto CAC $188 ([First Page Sage](https://firstpagesage.com/seo-blog/fintech-cac-benchmarks-report/)); DeFi ~$85/юзер, кошельки ~$25 ([HypeLab](https://www.hypelab.com/blog/crypto-user-acquisition-cost-benchmarks-2026)); eToro — $632 на нового funded-аккаунт ([eToro FY2025](https://www.etoro.com/news-and-analysis/press-releases/etoro-reports-fourth-quarter-and-full-year-2025-results/)).

Каналы по приоритету:

1. **KOL/YouTube.** 41 % аффилиатских покупок категории приходит с YouTube-контента — самая «креаторозависимая» вертикаль (Track360). Тарифы: нано/микро (5–50K) $250–2 000 за видео или чистая комиссия; мид-тьир $2 000–8 000 + код на 15–25 %; топы $15–40K/мес ретейнер. Ретейнеры бьют разовые кампании: коды теряют ~50 % месячных погашений за 4–5 мес без свежего контента. EPC: YouTube $2,50–4,00; Discord/Telegram $1,80–3,00; SEO-обзоры $1,40–2,40.
2. **Собственная affiliate-программа (10–15 %).** Норма категории 10–15 % с челленджа, топ-KOL 20–25 %, агрессивные до 30 %+; критично: 45 % KOL-покупок атрибутируются **кодом скидки, а не кликом** — трекинг по кодам обязателен; платить на повторные покупки (это дороже +5–8 п.п. ставки, повторы = 55–65 % выручки); закладывать клавбеки комиссий на возвраты (2–4 % фидов).
3. **Микро-челлендж как acquisition SKU.** SPRINT $23 уже в конкурентной полосе ($11–$25) — это volume-рычаг, CORE/APEX $49–$799 — маржинальный.
4. **Экосистема Solana.** Superteam Earn-баунти ($500–1 500 USDC) — несколько тысяч долларов покупают органическое покрытие самых активных контрибьюторов; Breakpoint 2026 (Лондон, 15–17 ноября, 7–8 тыс. участников; [solana.com/breakpoint](https://solana.com/breakpoint)) + Hacker House (1–12 ноября) — естественное окно анонса/запуска; листинг в dApp Store Seeker; Blinks-шеринг челленджа; TG-бот как поверхность онбординга.
5. **Гранты — канал доверия, не GTM.** Solana Foundation финансирует public goods; проп-фирма — не естественный фит (грантов проп-фирмам не найдено). Superteam-микрогранты <$10K, решения за 48 ч. Colosseum — канал pre-seed: акселератор принимает ~0,7 % (Cohort 5: 2 857 команд → 21 инвестиция), маркетинговая цифра $250K pre-seed ([colosseum.com/frontier](https://colosseum.com/frontier)) — стоит подачи, но это капитал и сеть, не пользователи.
6. **Points/airdrop — отложить.** Прецеденты мощные (Axiom: $100 млн выручки за 129 дней, referral-лестница 30/3/2), но все победители выросли на цикле мемкоинов, который сдулся (Photon −99 % от пика; BullX приостановлен 2026-06-01) — и ни один не покупал рост платной рекламой. Поинты вводить после product-market fit; реальная цена поинтов — дильюция, а не инфраструктура (трансфер ~0,000005 SOL).

### 6.4 Дорожная карта по фазам

| Фаза | Срок (рекомендация) | Содержание | Критерии выхода |
|---|---|---|---|
| **0. Починка денег** | 4–6 нед (окт–ноя 2026) | Дефекты D1–D10 (часть 1, §2.2): математика PnL (D1, D4), переоценка риска на тике, а не на закрытии (D2, D3), серверное исполнение лимиток + идемпотентность (D5), автоматическая смена торгового дня (D6), аутентификация (D7), NUMERIC/decimal вместо Float (D8), комиссии из метаданных Phoenix (D9), платный RPC (D10) | Property-тесты математики денег зелёные (∀ fills: Σ изменений equity == Σ PnL-ног; round-trip decimal); ни одного денежного поля во Float; лимитки исполняются при закрытой вкладке трейдера |
| **1. MVP с платежами и auth** | ~3–4 мес (до Q1 2027) | Postgres + NUMERIC; SIWS + embedded-кошелёк; Solana Pay + MoonPay Commerce (2 %); KYC Sumsub при регистрации; BullMQ Job Scheduler для 00:00 UTC; Phoenix WS + LaserStream WSS вместо поллинга; Vitest + fast-check + Playwright | Анонс на Breakpoint 15–17 ноя 2026; ≥100 платящих челленджей; пройден первый цикл выплат (допустим полуручной); uptime терминала ≥ 99,5 % |
| **2. Funded на реальном капитале** | 2–3 кв 2027 | Этапы A→C из §6.2: B-book + публичный резерв + смарт-выплаты → mirror → делегированные Phoenix sub-accounts с `position_authority`; builder codes Flight; аудит смарт-контрактов (первый в категории) | Резерв-кошелёк публичен и покрывает ≥50–100 % открытых payout-обязательств; первая on-chain-верифицируемая выплата ≤24 ч; pass rate публикуется вживую |
| **3. Масштаб** | 2028 | Multi-venue routing (Velocity taker 0,035 % T0, Jupiter 0,06 %); вынос движка в Go при latency-бюджете; affiliate-платформа с кодами и повторными; 10K пользователей; опционально регулируемая смежность (IB-путь по образцу Topstep/Tradeify) | Payout-to-revenue в коридоре 40–65 %; чистая операционная маржа ≥ 20 %; CAC ≤ $70 |

Строгая последовательность обязательна: продажа челленджей до закрытия Фазы 0 — это продажа дефектного счётчика денег (D1–D4) и репутационная мина категории.

---

## 7. Рекомендуемый стек

Что **оставить**: слой рыночных данных — каталог, валидация стакана, проверка возраста слота через `getBlockTime`, fail-closed, коалесинг — единственный слой с оценкой 4/5 в части 1 (§2.4), 31 тест. Его контракт и тесты переносятся как есть; меняется только транспорт: REST-поллинг 2,5 с → WebSocket Phoenix (`wss://perp-api.phoenix.trade/v1/ws`, каналы `allMids`/`orderbook`/`candles`) для цен и LaserStream для состояния цепи.

| Слой | Сейчас | Рекомендация | Почему |
|---|---|---|---|
| Фронт | Next.js 14.2, React 18.3 | **Next.js 16.4** (React 19.3) | 14 — EOL 2025-10-26; security-поддержка 15 кончается 2026-10-21 ([endoflife.date/nextjs](https://endoflife.date/nextjs)); 16.4 вышла 2026-10-06 |
| Auth / кошельки | нет auth; web3.js 1.98 + wallet-adapter 0.15 (косметика) | **@solana/kit 8.x + ConnectorKit**, SIWS (`solana:signIn`, v1.1.0 off-chain) + embedded-кошелёк для email/passkey | web3.js v1 — maintenance-only, wallet-adapter официально «superseded» ([solana.com/docs/frontend/web3-compat](https://solana.com/docs/frontend/web3-compat)); kit — единственный путь с v1-транзакциями (4096 байт с эпохи 1035, 2026-09-15). Embedded: Para Starter $200/мес @2,5K MAU или Dynamic Growth $249 @5K; Privy Core $299; CDP $0,005/оп — дешевле всех на большом объёме |
| Solana-библиотеки | `@ellipsis-labs/phoenix-sdk` (мёртвая spot-ветка) | **`@ellipsis-labs/rise`** (v0.5.38, обновлён 2026-09-29) | Единый HTTP/WS-клиент Phoenix, билдеры инструкций, кэш метаданных; spot-SDK удалить |
| Рыночные данные | REST-поллинг 2,5/10/30 с | **Phoenix WS + Helius LaserStream WSS (Free/$49) → gRPC mainnet ($499 Business)**; альтернатива Triton PAYG | Поллинг при 1K пользователей = ~400 req/s; WS снимает rate-limit-обрывы и staleness. Triton: депозит $125, $10/M вызовов + $0,08/GB ([triton.one/pricing](https://triton.one/pricing)); Jito ShredStream закрыт 2026-09-05 → DoubleZero Edge $450–1 500/мес/IP, только если появится latency-потребность |
| Оракулы | нет (mark price из снапшотов Phoenix) | Phoenix mark price + **Pyth Crypto free (1 с)** как независимый источник | Pyth Crypto $0 достаточно для маркировки PnL; 1 мс (Crypto+ $5 000/мес) нужен только если монетизируем скорость ([pyth.network](https://www.pyth.network/blog/introducing-pyth-pro-reinventing-the-market-data-supply-chain)) |
| Движок риска/матчинга | TS, вызывается из HTTP-запросов | **TS, но в always-on сервисе с собственным тиком (Node 24 LTS)**; Go — только на реальном капитале | Для симулятора TS не доказал несостоятельности ни на тысячах пользователей; Go — «скучный продакшен-дефолт» (TX24: 5,6 мс медианы на 300K TPS); Rust — только если измеренный latency станет ограничением |
| БД | Prisma 5 + SQLite | **Postgres + NUMERIC(p,s)** (Prisma или Drizzle — ортогонально); TimescaleDB при росте истории | SQLite однопользовательский; NUMERIC «especially recommended» для денег; TimescaleDB выиграл 96 % SMB-бенчмарков у ClickHouse/Mongo |
| Кэш/очереди | нет | **Redis 8 (AGPLv3) + BullMQ v6** (Job Schedulers) | Redis 8 с 2025-05-01 Apache-совместим для SaaS; BullMQ = cron + ретраи + контроль ставок in-process; NATS добавить только при втором сервисе |
| Деньги / decimal | Float во всей схеме | **Postgres NUMERIC + decimal.js** (или целые базовые единицы) | Д8 части 1: двоичная ошибка на границе equity = 9 400,00 решает судьбу челленджа; decimal.js — тот же тип, что Prisma использует для Decimal |
| Cron | кнопка админа | **BullMQ Job Scheduler `0 0 * * *` UTC** + pg advisory locks; Vercel Cron (100 джобов) — только для лёгких задач | Серверный тик обязателен (D5, D6); длительный свип всех счетов не должен жить в serverless-крон |
| Платежи | нет | **Solana Pay (USDC, 0 процессинга) primary + MoonPay Commerce 2 % secondary**; идемпотентность Stripe-паттерном (`Idempotency-Key` + memo в референсе платежа) | **Stripe запрещён**: «funded prop trading» в списке prohibited (обновлён 2026-05-13, [stripe.com/legal/restricted-businesses](https://stripe.com/legal/restricted-businesses)); Coinbase Commerce закрыт для не-США с 2026-03-31; карты — high-risk MCC 6211 с rolling reserve 20–30 %, отложить |
| Графики | lightweight-charts 5.0 | **Оставить Lightweight Charts** (Apache 2.0) | Advanced Charts бесплатен только «for free public offering» (соглашение v.0626.FAC) — платный login-gated сервис под это не подпадает однозначно; менять только после письменного одобрения TradingView |
| Хостинг | `next start` локально | **Next 16 на Vercel + WS-шлюз/движок на Fly.io** (~$7/мес на 256 МБ, egress $0,02/ГБ, нативные WS) | Vercel WS в бете с 2026-06-22, fan-out платформа не решает; стрим цен — отдельный always-on сервис |
| Наблюдаемость | нет | Не покрыто заметками — минимум без вендоров: структурированные логи, метрики очередей BullMQ, алерты на stale-снапшоты и age слота | Заметки по APM-инструментам отсутствуют — вендора не назначаем |
| Тесты | node:test, 31 тест | **Vitest (5.x) + fast-check (property) + Playwright 1.63** | Property-тесты денежных инвариантов обязательны (Фаза 0); Playwright E2E покупки → челленджа → лидерборда на devnet-faucet |

**Инфраструктурный бюджет** (собственная арифметика по прайс-листам из заметок, окт 2026):

| Позиция | Старт (≤500 MAU) | 10K MAU |
|---|---|---|
| RPC/стрим (Helius) | $49 (Developer) | $499 (Business, gRPC mainnet) |
| Вычисления (Fly.io: app + WS-шлюз + движок) | ~$25 | $300–500 (плюс egress $0,02/ГБ на fan-out стрима) |
| Postgres | ~$3–15 (shared) | $50–150 (dedicated + TimescaleDB) |
| Redis | $0 (free tier) | $30–60 |
| Embedded-кошельки | $0 (free tiers: Privy ≤499 / Dynamic ≤1K / Para ≤1,2K MAU) | ~$500 (Para Growth @10K или Dynamic $249 + $0,05/MAU сверх 5K) |
| Custody/подписание (funded) | $0 (Squads Grid Basic ≤1K MAU) | $99–499 (Turnkey Pro / Squads Grid Pro ≤5K) |
| Оракулы | $0 (Pyth Crypto) | $0 |
| KYC (Sumsub Compliance) | $299 + $1,85/проверка | $299 + $1,85 × новых |
| **Итого/мес** | **~$80–130 без KYC; ~$380–450 с KYC при регистрации** | **~$1 800–2 600** + транзакционные (MoonPay 2 %, аффилиаты) |

---

## 8. Полноценная оценка проекта и бизнес-идеи

### 8.1 Unit-экономика: 1 000 проданных челленджей

Явные допущения (все — из заметок, источник в скобках):

| Допущение | Значение | Основа |
|---|---|---|
| Средний чек | $150 | ниже отраслевого AOV $187 — у PROPS дешёвый SPRINT-микс (Track360) |
| Pass rate | 12 % | Track360 blended 12,3 % (2025–2026); crypto-фирмы: HyroTrader 8,7–13,3 %, Propr 15,4–16,3 %, Hypernova 22,5–23,2 % |
| Funded с ≥1 выплатой | 45 % от прошедших | FPFX, 300K+ счетов, 2024; опубликованные конверсии: MFF 39,2 %, Topstep 33,3 %, Hypernova 66,7 % |
| Средняя выплата трейдеру | $1 434 | Payout Junction, avg за 30 дней (медиана $1 122), окт 2026 |
| Доля аффилиатских продаж | 50 % | Track360 40–50 % |
| Комиссия аффилиату | 15 % | норма 10–15 % |
| KOL-CAC на платную покупку | $50 | диапазон $35–70 |
| Процессинг | 1 % blended | Solana Pay ~0 % + MoonPay 2 % на ~30 % покупок |
| Возвраты/чарджбеки | 3 % фидов | 2–4 % (Track360) |
| KYC | $1,85 × 1 000 + $299/мес | Sumsub Compliance |

Модель:

| Статья | Сумма |
|---|---|
| Выручка: 1 000 × $150 | **+$150 000** |
| Сплит фирмы (20 %): 54 выплаты × $358,5 | **+$19 359** |
| Выплаты трейдерам: 1 000 × 12 % × 45 % = 54 × $1 434 | −$77 436 |
| Процессинг 1 % | −$1 500 |
| Возвраты 3 % | −$4 500 |
| Аффилиаты: 500 × $150 × 15 % | −$11 250 |
| KYC | −$2 149 |
| **Итого до KOL/инфра/команды** | **+$72 524 (~48 %)** |
| KOL: 500 платных × $50 | −$25 000 |
| **Итого до фиксированных расходов** | **+$47 524 (~32 %)** |

Сходимость с отраслью: payout-to-revenue = 51,6 % — внутри здорового коридора 40–65 % ([YourFintech, 2026](https://yourfintech.com/blog/two-metrics-every-prop-firm-must-master/)); FTMO FY2023 — 35,3 %, эмпирика FPFX — ~50 %. Итоговая маржа ~32 % до фиксированных расходов — в отраслевом коридоре чистой операционной маржи 20–40 %. Не включено (в плюс): повторные покупки (2,6 покупки/байер/год, LTV $430–490), доход builder codes на funded-потоке, апселл 90 % сплита (у конкурентов платная опция +$350…+20 % к фиду).

Чувствительность — главный вывод модели: **экономика монетизирует провалы**. При pass 23 % (уровень Hypernova) выплаты съедают ~98 % фидовой выручки и маржа схлопывается в ноль; при pass 5 % маржа максимальна. Отсюда два практических правила: (а) переход победителей в A-book (mirror, §6.2) — не опция, а условие выживания при росте качества трейдеров; (б) правила должны быть честными с первой продажи — обвинение в «rigged difficulty» (CONSOB, июль 2024: челлендж как «finance video game», устроенный на перепокупку) — это регуляторный и репутационный риск категории. Конфликт данных о воронке (Track360 5–14 % pass / ~7 % когда-либо плативших против DealPropFirm «0,3–0,5 % когда-либо плативших, средний байер теряет ~$4 000», методология неясна) сам по себе риск: при пессимистичном сценарии LTV ниже и модель сдвигается в минус — считать на собственных данных с первого дня.

### 8.2 SWOT

| | Позитив | Негатив |
|---|---|---|
| **Внутр.** | Зрелый слой рыночных данных (4/5) и культура fail-closed; честная документация; pricing-матрица уже в рыночной полосе 2026; positioning window «первая credible Solana-фирма» | Математика денег неверна (D1–D10); нет auth/платежей/KYC; Float; SQLite; REST-поллинг; UI с вымышленными метриками; история разработки отсутствует (28 коммитов одной сессии) |
| **Внешн.** | Рынок $850 млн +45 %; pass rate публикуют 13/50 фирм — честность как дифференциатор; ниша Solana пуста; инфраструктура готова (Phoenix WS/delegation, builder codes, Squads); MFF-прецедент убил US-шаблон преследования (май 2025) | >100 Hyperliquid-копий прогнозируются; топ-5 забирает 62 % привлечения; Stripe запрещён; ESMA (24.02.2026) приравнивает перпы к CFD-интервенции; venue-риск Solana (Drift $285 млн, апрель 2026); цикличность аудитории (Photon −99 %, BullX пауза) |

### 8.3 Ключевые риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Регуляторика США: CPO-вопрос для funded-модели открыт (дело MFF закрыто with prejudice 2025-05-14 без решения по существу) | средняя | критическое | Двух-entity структура (витрина + капитал), гео-фенсинг, «simulated evaluation»-дисклеймеры, мониторинг CFTC (непроверенный сигнал: консультация о challenge fees = pool interests, исход якобы к ноябрю 2026 — единственный источник) |
| ЕС: перпы ≈ CFD (ESMA 24.02.2026), travel rule на стейблкоин-выплаты EU-трейдерам независимо от HQ фирмы, MiCA-обрыв 01.07.2026 | средняя | высокое | KYC при регистрации, travel-rule-вендор (WalletConnect), верификация владения кошельком до вывода, EU-структура или гео-блок |
| Venue-риск Solana: Drift −$285 млн (01.04.2026), Flash Trade закрыт 16.09.2026, Adrena в maintenance; Phoenix молод (анонс 11.12.2025, OI $25,6 млн) | средняя–высокая | критическое на Фазе 2 | Кап экспозиции на venue; еженедельный свип прибыли в treasury-multisig; multi-venue (Velocity, Jupiter); резерв в отдельном холодном multisig |
| Каскад победителей / зависимость от float (42 % выручки отрасли — фиды) | средняя | критическое | B→A-переход (mirror), публичный резерв с покрытием обязательств, статический DD, лимит concurrent funded |
| Платежи: Stripe prohibited, high-risk MCC 6211, rolling reserve 20–30 % | высокая | среднее | Crypto-only на старте (Solana Pay + MoonPay 2 %); карты — после specialist-underwriter |
| Репутация категории: отказы выплат — жалоба №1; Solana Funded (2.5) отравляет сам бренд «Solana prop»; 4 из 22 Web3-фирм suspend-нуты за фейк-отзывы | высокая | высокое | On-chain выплаты и резерв, публикация pass rate, неизменяемые правила, аудит — ров из §6.1 |
| Копирование: Hyperliquid-когорта финансируется (Hypernova $3M от Lemniscap; SizeProp — Igloo/Pudgy Penguins) и может мультичейниться на Solana | высокая | среднее | Скорость (окно Breakpoint 2026), глубина рва (принуждаемые лимиты + аудит + репутация-как-данные), builder-code income |
| Технический: до закрытия D1–D10 продукт считает деньги неверно | высокая (до Фазы 0) | критическое | Фаза 0 с property-тестами; никаких продаж до выхода |
| AML/санкции: публичный резерв в эпоху DPRK-атак | средняя | высокое | Скрининг транзакций (вход в аналитику $40–90K/год), KYC-гейт выплат, sanctions-скрининг перед сеттлементом |
| Цикличность аудитории (мемкоин-цикл кончился) | средняя | среднее | Фиды за челленджи менее цикличны, чем trading-комиссии — сам проп-угол как хедж; но закладывать консервативный pass в модель |

### 8.4 Итоговая оценка

| Ось | 1–10 | Обоснование |
|---|---|---|
| Рынок | 7 | $850 млн, +45 % г/г, 2,1 млн funded-трейдеров — но оценка конфликтует с трекингом выплат ($325 млн за 2025), категория консолидируется, топ-5 = 62 % |
| Дифференциация | 7 | Ниша Solana реально пуста (единственный игрок — худший в категории); программно-принуждаемые лимиты + аудит + on-chain резерв — комбинация, которой нет ни у кого; но каждый элемент по отдельности копируем |
| Техническая готовность | 3 | 15–20 % пути до MVP: рыночные данные 4/5, симулятор 1/5, риск 1/5, auth/платежи 0 |
| Команда/исполнение | **н/д** | Неизвестно: 28 коммитов за одну сессию, истории разработки и решений нет (часть 1, §1.6) |
| Регуляторика | 4 | Серая зона во всех юрисдикциях; US-шаблон enforcement мёртв (MFF), но ESMA-интервенция по перпам, travel rule, запрещённый Stripe и открытый CPO-вопрос |
| Экономика | 6 | Маржа фидов 75–85 %, payout-to-revenue 40–65 %, NOM 20–40 % — проверенная машинка; но зависимость от float и монетизация провалов — структурная уязвимость |

**Вердикт: строить — но только по фазам.** Сегодня проект — 5,5/10 (прототип с неверной математикой денег в растущем рынке с пустой Solana-нишей). После Фазы 0–1 — 7/10 (продающий MVP с честным счётчиком). После Фазы 2 (on-chain резерв, принуждаемые лимиты, первый аудит в категории) — 8/10 и реальный претендент на лидерство ниши. Ставка держится на трёх условиях: закрытие D1–D10 до первой продажи, структурирование до первого funded-счёта (двух-entity, UAE/DMCC или BVI-бэкенд — самый дешёвый законный сценарий по заметкам), окно запуска — Breakpoint, 15–17 ноября 2026.

**Пять первых шагов:**
1. **Фаза 0, неделя 1–6:** починить математику денег (D1, D4), серверный тик с переоценкой риска (D2, D3, D5, D6), NUMERIC (D8), платный RPC (D10) — с property-тестами fast-check на денежные инварианты.
2. **Юрисдикция и комплаенс-минимум:** двух-entity схема, гео-фенсинг США у Phoenix (биржа сама блокирует US), KYC Sumsub при регистрации, travel-rule-процесс выплат — до первой продажи, не после.
3. **Фаза 1:** SIWS + embedded-кошельки, Solana Pay + MoonPay, Postgres, BullMQ-крон; анонс на Breakpoint (15–17.11.2026), продажи Q1 2027.
4. **Доверительный слой до первых выплат:** публичный резерв-кошелёк, хэш правил при покупке, живой pass rate на дашборде (паттерны Hypernova/Propr/Investabl).
5. **GTM-машинка:** affiliate-программа 10–15 % с трекингом по кодам и оплатой повторных, 3–5 микро-KOL на комиссионной модели, SPRINT $23 как volume-SKU; CAC-цель ≤ $70.

---

## Источники

Ключевые URL из заметок (все получены 2026-10-07, если не указано иное):

**Рынок и экономика проп-фирм:** [Track360 — статистика отрасли 2026](https://www.track360.io/blog/prop-trading-industry-statistics-2026) · [Track360 — affiliate-экономика](https://track360.io/blog/prop-firm-affiliate-economics-report-2026) · [Payout Junction](https://thetrustedprop.com/prop-firms/breakout-prop/payouts) (трекер верифицированных выплат) · [The Prop Journalist — pass rates, 2026-09-28](https://thepropjournalist.com/analysis/prop-firm-pass-rates/) · [FPFX/Finance Magnates — 7 % из 300K счетов](https://www.financemagnates.com/forex/analysis/exclusive-only-7-of-300000-prop-trading-accounts-achieved-payouts/) · [TradeInformer — выручка фирм](https://tradeinformer.com/prop-weekly/how-much-do-alpha-capital-fundednext-fundingpips-and-e8-markets-make) · [YourFintech — payout-to-revenue](https://yourfintech.com/blog/two-metrics-every-prop-firm-must-master/) · [Prop Firm Match via Finance Magnates — $325M выплат 2025](https://www.tradingview.com/news/financemagnates:dbcee565f094b:0-prop-firm-match-tracked-about-325-million-in-payouts-to-traders-in-2025/) · [DealPropFirm — отказы выплат](https://dealpropfirm.com/articles/prop-firm-payout-denials)

**On-chain проп-фирмы и модели исполнения:** [prop-memo — гид 22 Web3-фирм, 2026-09-20](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09) · [alexfirdaus — Hyperliquid-проп-фирмы, 2026-06-25](https://alexfirdaus.com/hyperliquid-prop-firms/) · [PropTraderCheck — A/B-book](https://proptradercheck.com/research/a-book-b-book) · [Hyperliquid vaults](https://hyperx.trade/hyperliquid/blog/hyperliquid-vaults-explained) · [Hypernova — The Block, $3M pre-seed](https://www.theblock.co/post/402923/hyperliquid-prop-trading-platform-hypernova-crypto-funding) · [Kraken × Breakout, BusinessWire 2025-09-04](https://www.businesswire.com/news/home/20250904012956/en/)

**Solana: биржи и инфраструктура:** [docs.phoenix.trade](https://docs.phoenix.trade/) (fees, builder-codes, accounts/delegation, websocket, referral) · [npm — @ellipsis-labs/rise](https://www.npmjs.com/package/@ellipsis-labs/rise) · [Bloomberg — взлом Drift, 2026-04-01](https://www.bloomberg.com/news/articles/2026-04-01/solana-based-defi-project-drift-hit-by-285-million-exploit) · [Chainalysis — уроки Drift](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/) · [DeFiLlama — Solana perps](https://defillama.com/perps/chain/solana) · [bykaranteli.com/solana-perps](https://bykaranteli.com/solana-perps) · [Helius pricing](https://www.helius.dev/pricing) · [Triton One pricing](https://triton.one/pricing) · [Pyth Pro](https://www.pyth.network/blog/introducing-pyth-pro-reinventing-the-market-data-supply-chain) · [Cryptobriefing — $147B Solana perps Q2 2026](https://cryptobriefing.com/solana-record-perps-trading-volume-q2-2026/)

**GTM в экосистеме Solana:** [Solana Foundation grants](https://solana.org/grants-funding) · [Colosseum](https://colosseum.com/accelerator) · [Superteam Earn](https://superteam.fun/earn/bounties/) · [Breakpoint 2026](https://solana.com/breakpoint) · [Solana Mobile — Builder Grants, 700+ dApps](https://solanamobile.com/blog/builder-grants-are-live-the-dapp-store-crosses-700-apps-and-seeker-season-2-keeps-shipping) · [Jupiter Referral Program](https://developers.jup.ag/docs/tool-kits/referral-program) · [docs.axiom.trade — referral 30/3/2](https://docs.axiom.trade/getting-started/referral-program) · [CoinGecko — TG-боты на Solana](https://www.coingecko.com/learn/solana-telegram-trading-bots)

**Стек и цены:** [solana.com/docs/frontend/web3-compat](https://solana.com/docs/frontend/web3-compat) · [anza kit releases](https://github.com/anza-xyz/kit/releases) · [ConnectorKit](https://github.com/solana-foundation/connectorkit) · [Privy pricing](https://www.privy.io/pricing) · [Dynamic pricing](https://www.dynamic.xyz/pricing) · [Para pricing](https://www.getpara.com/pricing) · [Turnkey pricing](https://www.turnkey.com/pricing) · [Coinbase CDP pricing](https://docs.cdp.coinbase.com/wallets/pricing) · [Squads permissions](https://docs.squads.so/main/development/reference/permissions) · [Squads Grid](https://developers.squads.so/grid/v1/accounts/passkeys/introduction) · [Postgres numeric](https://www.postgresql.org/docs/current/datatype-numeric.html) · [BullMQ](https://docs.bullmq.io/guide/jobs/repeatable) · [Stripe — запрещённые бизнесы, ред. 2026-05-13](https://stripe.com/legal/restricted-businesses) · [MoonPay Commerce FAQ](https://support.moonpay.com/en/articles/466267-moonpay-commerce-faqs) · [Next.js 16](https://nextjs.org/blog/next-16) · [endoflife.date/nextjs](https://endoflife.date/nextjs) · [TradingView charting-библиотеки](https://www.tradingview.com/free-charting-libraries/) · [fast-check](https://fast-check.dev/)

**Регуляция:** [Reuters — санкции CFTC по MFF, 2025-05-14](https://www.reuters.com/legal/government/judge-sanctions-cftc-over-agencys-conduct-my-forex-funds-case-2025-05-14/) · [Reuters — $3,1M издержек CFTC, 2025-07-14](https://www.reuters.com/legal/government/cftc-ordered-pay-31-million-legal-tab-my-forex-funds-case-2025-07-14/) · [ESMA — заявление по перпам/CFD, 2026-02-24](https://www.esma.europa.eu/press-news/esma-news/esma-reminds-firms-perpetuals-are-likely-within-scope-of-the-product-intervention-measures) · [ESMA Q&A 2293 — prop trading и MiCA](https://www.esma.europa.eu/publications-data/questions-answers/2293) · [WalletConnect — travel rule для проп-выплат](https://walletconnect.com/blog/mica-enforcement-is-live-what-it-means-for-prop-trading-payouts) · [CFTC PR 9242-26 — перпы на DCM, 2026-05-29](https://www.cftc.gov/PressRoom/PressReleases/pr-9242-26) · [Jones Day — IB no-action для пассивного ПО, 2026-09-17](https://www.jdsupra.com/legalnews/cftc-extends-no-action-relief-for-8903561/) · [VARA rulebooks](https://rulebooks.vara.ae/index%2ephp/rulebook/virtual-assets-and-related-activities-regulations-2023) · [FinanceFeeds — US-фирмы становятся IB](https://financefeeds.com/us-prop-firms-are-becoming-cftc-introducing-brokers-while-europe-looks-away/) · [Sumsub pricing](https://sumsub.com/pricing/) · [FinCEN/micahub — prop trading и лицензии](https://micahub.net/blog/prop-trading-market-making-licence-mica-uk-us/)

### Источники к разделам 3–5

**Perp-ландшафт Solana и Phoenix**
- [DeFiLlama: Hyperliquid](https://defillama.com/protocol/hyperliquid) · [GMX Solana](https://defillama.com/protocol/gmx-solana) · [Pacifica](https://defillama.com/protocol/pacifica-perps) · [Jupiter Perps](https://defillama.com/protocol/jupiter-perpetual-exchange) · [Phoenix Perp](https://defillama.com/protocol/phoenix-perp) · [Bullet](https://defillama.com/protocol/bullet-perps) · [Velocity](https://defillama.com/protocol/velocity) · [Solana perps chain](https://defillama.com/perps/chain/solana) · [OI API](https://api.llama.fi/overview/open-interest) · [normalized volume](https://api.llama.fi/overview/normalized-volume) — все на 2026-10-07
- [bykaranteli.com/solana-perps](https://bykaranteli.com/solana-perps) — снапшот 2026-10-06 22:33 UTC
- Phoenix: [docs (index)](https://docs.phoenix.trade/index.md) · [API](https://docs.phoenix.trade/api) · [fees](https://docs.phoenix.trade/phoenix/matching-engine/fees) · [accounts/delegation](https://docs.phoenix.trade/phoenix/collateral-and-accounts/accounts) · [builder codes (Flight)](https://docs.phoenix.trade/builder-codes) · [referral](https://docs.phoenix.trade/incentive-programs/referral-program) · [register/delegated onboarding](https://docs.phoenix.trade/sdk/register) · [Rise SDK на npm](https://www.npmjs.com/package/@ellipsis-labs/rise) · [rise-public (GitHub)](https://github.com/Ellipsis-Labs/rise-public) · [анонс перпов 2025-12-11](https://www.ellipsislabs.xyz/blog-posts/introducing-phoenix-perpetuals) · [ORBIT review](https://orbitperpscreener.com/blog/phoenix-review)
- Drift/Velocity: [Bloomberg 2026-04-01](https://www.bloomberg.com/news/articles/2026-04-01/solana-based-defi-project-drift-hit-by-285-million-exploit) · [CoinDesk](https://www.coindesk.com/tech/2026/04/02/how-a-solana-feature-designed-for-convenience-let-an-attacker-drain-usd270-million-from-drift) · [TRM Labs](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist) · [Chainalysis](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/) · [delegated accounts (docs)](https://github.com/drift-labs/drift-protocol-v2-docs/blob/master/content/protocol/getting-started/delegated-accounts.mdx) · [velocity.exchange](https://docs.velocity.exchange) · [kryptonews 2026-09-30](https://www.kryptonews.com/2026/09/30/drift-recovers-9-2m-of-295m-stolen-funds-as-recovery-efforts-continue/) · [Tether support, BusinessWire 2026-04-16](https://www.businesswire.com/news/home/20260416607266/en/)
- Прочие venue: [docs.pacifica.fi (fees, subaccounts, builder program)](https://docs.pacifica.fi/programs/builder-program) · [Jupiter perps fees](https://docs.jup.ag/user-docs/trade/perps/fees) · [JLP earn](https://docs.jup.ag/user-docs/earn/jlp/earn) · [PerpFinder: Bullet](https://perpfinder.com/perps/bullet) · [CryptoBriefing: Q2 2026](https://cryptobriefing.com/solana-record-perps-trading-volume-q2-2026/)

**Инфраструктура**
- [Helius pricing](https://www.helius.dev/pricing) · [Triton One pricing](https://triton.one/pricing) · [DoubleZero Edge](https://doublezero.xyz/jito-shredstream) + [fastshreds.com](https://fastshreds.com) · [Pyth Pro](https://www.pyth.network/blog/introducing-pyth-pro-reinventing-the-market-data-supply-chain)

**Рынок проп-фирм и конкуренты**
- [Track360: industry statistics 2026](https://www.track360.io/blog/prop-trading-industry-statistics-2026) · [affiliate economics](https://track360.io/blog/prop-firm-affiliate-economics-report-2026)
- [prop-memo: 22 Web3-фирмы, сент 2026](https://prop-memo.com/en/articles/web3-prop-firms-guide-2026-09) · [alexfirdaus: Hyperliquid prop firms](https://alexfirdaus.com/hyperliquid-prop-firms/) · [PropTraderCheck: A/B-book](https://proptradercheck.com/research/a-book-b-book) · [The Prop Journalist: pass rates](https://thepropjournalist.com/analysis/prop-firm-pass-rates/) · [DealPropFirm: payout denials](https://dealpropfirm.com/articles/prop-firm-payout-denials) · [PropVitals: HL prop risks](https://www.propvitals.com/guides/hyperliquid-prop-firms-2026/)
- Фирмы: [Breakout × Kraken, BusinessWire 2025-09-04](https://www.businesswire.com/news/home/20250904012956/en/) · [Breakout Heat Sheet авг 2026](https://www.breakoutprop.com/article/the-heat-sheet-august-2026/) · [ThePropExaminer: CFT](https://thepropexaminer.com/firms/cryptofundtrader) · [tradersweek: FundedNext $306M](https://tradersweek.com/news/fundednext-surpasses-300-million-in-total-trader-payouts) · [FinanceMagnates: Hola Prime × Deloitte](https://www.financemagnates.com/forex/analysis/hola-prime-brings-in-deloitte-to-audit-payouts-as-trust-gap-widens-across-prop-firms/) · [Lune: BrightFunded](https://lunefi.com/blog/brightfunded-payouts) · [The Block: Hypernova $3M](https://www.theblock.co/post/402923/hyperliquid-prop-trading-platform-hypernova-crypto-funding) · [Chainwire: SizeProp](https://chainwire.org/2026/05/19/sizeprop-raises-pre-seed-round-led-by-igloo-inc-to-build-the-infrastructure-for-crypto-prop-trading/) · [Cointelegraph: запуск Propr](https://cointelegraph.com/press-releases/propr-launches-onchain-prop-trading-firm-hyperliquid) · [XBorgLabs/ab-booking](https://github.com/XBorgLabs/ab-booking) · [hypernova.xyz](https://hypernova.xyz/stats)

**Регуляция**
- MFF: [компиляция CFTC](https://www.cftc.gov/media/9196/enftradersglobalgroupcomplaint082923/download) · [Reuters: dismissal 2025-05-14](https://www.reuters.com/legal/government/judge-sanctions-cftc-over-agencys-conduct-my-forex-funds-case-2025-05-14/) · [Reuters: $3.1M 2025-07-14](https://www.reuters.com/legal/government/cftc-ordered-pay-31-million-legal-tab-my-forex-funds-case-2025-07-14/) · [Willkie](https://complianceconcourse.willkie.com/articles/new-jersey-federal-judge-dismisses-forex-case-with-prejudice-and-awards-attorney-fees/)
- CFTC 2026: [PR 9242-26 (perps на DCM)](https://www.cftc.gov/PressRoom/PressReleases/pr-9242-26) · [PR 9241-26 (foreign futures/Deribit)](https://www.cftc.gov/PressRoom/PressReleases/9241-26) · [IB no-action 2026-09-17 (JD Supra)](https://www.jdsupra.com/legalnews/cftc-extends-no-action-relief-for-8903561/) · [FinanceFeeds: IB-тренд](https://financefeeds.com/us-prop-firms-are-becoming-cftc-introducing-brokers-while-europe-looks-away/)
- ЕС/UK: [ESMA perps≈CFD, 2026-02-24](https://www.esma.europa.eu/press-news/esma-news/esma-reminds-firms-of-the-product-intervention-framework-for-perpetual-futures) · [ESMA Q&A 2293](https://www.esma.europa.eu/publications-data/questions-answers/2293) · [CASP-клифф 17%](https://finance.yahoo.com/markets/crypto/articles/83-europe-crypto-firms-not-133100256.html) · [WalletConnect: travel rule для проп-выплат](https://walletconnect.com/blog/mica-enforcement-is-live-what-it-means-for-prop-trading-payouts) · [FCA: 24 CFD-фирмы](https://www.fca.org.uk/news/press-releases/twenty-four-cfd-firms-closing-crackdown-misuse-uk-authorisation) · [micahub: UK/MiCA/US-разбор](https://micahub.net/blog/prop-trading-market-making-licence-mica-uk-us/) · [FTMO→OANDA](https://ftmo.com/en/press-release/ftmo-completes-acquisition-of-oanda-from-cvc/)
- ОАЭ/прочие: [rulebooks.vara.ae](https://rulebooks.vara.ae/index%2ephp/rulebook/virtual-assets-and-related-activities-regulations-2023) · [Cryptoverse Legal: структура в ОАЭ](https://www.cryptoverselawyers.io/crypto-proprietary-trading-firm-setup-in-the-uae/) · [alexfirdaus: почему офшор](https://alexfirdaus.com/why-prop-trading-firms-operate-offshore/) · [FinanceMagnates: ASIC](https://www.financemagnates.com/forex/regulation/asic-warns-crypto-perps-now-mimic-cfds-while-dodging-its-rulebook/)
- Комплаенс: [Sumsub pricing](https://sumsub.com/pricing/) · [Persona pricing](https://withpersona.com/pricing/) · [CostBench: TRM](https://costbench.com/software/crypto-compliance/trm-labs/) · [Vendr: Chainalysis](https://www.vendr.com/marketplace/chainalysis) · [ tiers: tokenizationcompliance](https://tokenizationcompliance.com/comparisons/compliance-platform-pricing-comparison/)
