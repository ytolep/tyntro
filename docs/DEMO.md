# Демо-стенд props-v2

Дата: 9 октября 2026.

## Запуск

Демо работает на отдельной базе `props_test_demo` и не трогает рабочие данные.

```sh
# 1. База и данные
docker compose exec -T db psql -U props -d props -c "CREATE DATABASE props_test_demo"
export DATABASE_URL=postgresql://props:props@localhost:54339/props_test_demo
DATABASE_URL=$DATABASE_URL BOTS=40 CMDS_PER_TICK=8 SEED=7 node --import tsx scripts/bot-load.ts
ADMIN_WALLET=<кошелёк админа> node --import tsx prisma/seed.ts
DEMO_TRADER_WALLET=<кошелёк трейдера> npx tsx scripts/demo-shape.ts
node --import tsx scripts/check-ledger.ts     # должно быть «Нарушений: 0»

# 2. Сайт и воркер (сборка npm run build с NEXT_PUBLIC_SOLANA_CLUSTER=devnet)
export NEXT_PUBLIC_SOLANA_CLUSTER=devnet TREASURY_WALLET=<казна> \
  USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU PAYMENTS_RPC_URL=https://api.devnet.solana.com
npx next start -p 3300 & npx tsx src/worker/index.ts &
```

Откуда данные:
- **40 счетов ботов** торгуют на записанных ценах Phoenix через настоящий код исполнения и воркера: сделки, лимитки, комиссии, один FAILED. Учёт проверен: нарушений 0.
- **`scripts/demo-shape.ts`** доводит три счёта до PASSED проводкой ADJUST с пометкой `demo:`, потому что за минуты торговли три торговых дня не наступают. Один счёт проходит настоящими функциями одобрения funded и запроса выплаты и отдаётся кошельку трейдера.
- **Покупок в демо нет:** счета ботов созданы напрямую, поэтому выручка в админке $0. Реальная оплата проверяется сценарием `scripts/devnet-real.ts`.

## Сценарий показа

Скриншоты лежат в `docs/demo/`.

| Шаг | Кто | Экран | Что показать |
|---|---|---|---|
| 1 | Гость | `/` — `01-landing` | Предложение, цены, блок прозрачности |
| 2 | Гость | `/checkout` — `02-checkout-guest` | Полная сводка правил, согласие, вход вместо ошибки |
| 3 | Гость | `/rules` — `03-rules` | Правила с примерами расчёта просадки |
| 4 | Гость | `/transparency` — `04-transparency` | Казна on-chain, funded-счета |
| 5 | Гость | `/leaderboard` — `05-leaderboard` | Рейтинг по реальным сделкам |
| 6 | Трейдер | `/dashboard` — `06-dashboard-trader` | Equity, floors, цель, торговые дни, статус риска |
| 7 | Трейдер | `/terminal` — `07-terminal-trader` | Живые данные Phoenix через WebSocket: Mark, Index, 24h, OI, funding, стакан, доступная маржа |
| 8 | Трейдер | `/history`, `/trader-score` — `08`, `09` | История сделок и Trader Score |
| 9 | Трейдер | `/funded`, `/profile` — `10`, `11` | Funded-счёт, доступно к выплате, запрос выплаты, блок KYC |
| 10 | Трейдер | Колокольчик — `12-notifications` | Уведомления о PASSED и одобрении funded |
| 11 | Админ | `/admin` — `13-admin` | Метрики, очередь funded, очередь выплат с KYC, возвраты |
| 12 | Гость | Терминал на телефоне — `14-mobile-terminal` | Вкладки Chart, Order book, Trade |

Вход в Phantom: переключи кошелёк на Solana Devnet, подключи кошелёк трейдера или админа и нажми «Sign in».

## Ошибки, найденные на демо

| # | Где | Проблема | Статус |
|---|---|---|---|
| D1 | Админка, очередь funded | Уже одобренный счёт остаётся в очереди с кнопкой «Approve funded»: очередь не исключает счета с funded-наследником | Исправлено (w8-D1): очередь исключает счета с решением в AuditLog |
| D2 | Админка, очередь выплат | Колонка действий не помещается в таблицу, кнопка Approve обрезана | Исправлено (w8-D1): кошельки сокращены, дата переносится |
| D3 | Дашборд funded-счёта | Funded-счёт показан как челлендж: баннер «Challenge · virtual capital» и цель прибыли 12 % | Исправлено (w8-D3): стадия по phase FUNDED_SIM, без цели прибыли |
| D4 | Профиль, выплаты | Суммы без разделителей разрядов: «$100000.00» | Исправлено (w8-D4): formatUsd в профиле и истории |
| D5 | Дашборд | График equity пустой, если снимков меньше двух: нужен понятный пустой график | Исправлено (w8-D3): пустое состояние при <2 снимках |
