# Деплой PROPS на свой сервер

Один Linux-сервер, Docker, без сторонних сервисов. Состав комплекта:

| Файл | Назначение |
| --- | --- |
| `deploy/docker-compose.prod.yml` | прод-стек: db, migrate, web, worker, caddy, backup |
| `deploy/Caddyfile` | HTTPS (Let's Encrypt) и реверс-прокси на web |
| `deploy/backup.sh` | цикл бэкапов: `pg_dump -Fc` раз в сутки + ротация |
| `deploy/restore.sh` | восстановление БД из дампа с подтверждением |
| `deploy/local-check.sh` | локальная проверка стека (localhost, curl) |
| `.env.production.example` | шаблон env со всеми переменными и комментариями |

Существующие `Dockerfile` и `docker-compose.yml` (dev) не используются прод-стеком
по содержимому: prod-стек берёт тот же `Dockerfile` (сборка), но свою композицию
сервисов.

## 1. Требования к серверу

- Linux x86_64 (проверено на Ubuntu 22.04+ / Debian 12), 2 vCPU, 4 GB RAM,
  20 GB диска (образы + бэкапы).
- Docker Engine 24+ с плагином compose v2
  (`curl -fsSL https://get.docker.com | sh`).
- Открытые наружу порты: **22 (SSH), 80 и 443** — и только они (§7).
- Домен с A-записью на IP сервера (для сертификата Let's Encrypt).
- Опционально: ключ платного Solana RPC (например Helius) — публичный
  `api.mainnet-beta.solana.com` имеет жёсткие лимиты.

## 2. Первый запуск

Из корня репозитория на сервере:

```sh
cp .env.production.example .env.production
$EDITOR .env.production      # DOMAIN, пароль БД, APP_DOMAINS, ADMIN_WALLET...
chmod 600 .env.production

docker compose --env-file .env.production \
  -f deploy/docker-compose.prod.yml up -d --build
```

Что происходит:

1. **db** поднимается, создаёт базу в volume `pgdata`;
2. одноразовый **migrate** применяет `prisma migrate deploy` и сидирует
   матрицу челленджей (плюс ADMIN из `ADMIN_WALLET`, §3);
3. **web** стартует после успешного завершения migrate; порт 3000 открыт
   только внутри сети стека;
4. **worker** (риск-тик 1 с, проверки оплат 15 с, смена дня 00:00 UTC);
5. **caddy** ждёт здорового web, получает сертификат Let's Encrypt
   для `DOMAIN` (80/443) и проксирует трафик на web;
6. **backup** сразу снимает первый дамп, дальше — раз в сутки (§5).

Проверка:

```sh
docker compose --env-file .env.production -f deploy/docker-compose.prod.yml ps
curl https://ваш-домен/api/health     # {"status":"ok","db":"up",...}
docker compose --env-file .env.production -f deploy/docker-compose.prod.yml \
  logs -f caddy web
```

Мониторинг воркера: `/api/health`. Воркер раз в 5 с обновляет строку
`WorkerHeartbeat` (`id='main'`): времена последнего завершённого тика риска,
проверки оплат и смены дня. `/api/health` отвечает `200 {status:'ok', db, worker:{ok,
lastTickAgeMs, lastPaymentsCheckAgeMs}}`, пока тик свежее 30 с и проверка оплат
свежее 90 с; старее — `503 {status:'degraded'}` (нет строки — тоже 503), так
healthcheck/мониторинг видит зависание или падение воркера. Контейнер **web** в
`deploy/docker-compose.prod.yml` проверяет `?scope=web` (только БД): падение
воркера не рестартует web — страницы и API работают, рестартовать нужно воркер
(`docker compose ... restart worker`, причину — в `logs worker`).

Caddy хранит сертификаты в volume `caddy_data`: перевыпуск автоматический,
при `down` (без `-v`) ничего не теряется. **В проде никогда не используйте
`down -v`** — это удалит базу и сертификаты.

## 3. Назначение админа (ADMIN_WALLET и seed)

При каждом запуске `migrate` сид делает upsert: кошелёк из `ADMIN_WALLET`
получает роль `ADMIN` (доступ к `/admin`, `/api/admin/*`). Укажите его
в `.env.production` до первого запуска.

Если стек уже работает и нужно назначить/сменить админа — один SQL
(сид нового кошелька не добавит, env читается только в migrate):

```sh
docker compose --env-file .env.production -f deploy/docker-compose.prod.yml \
  exec db psql -U props -d props \
  -c 'UPDATE "User" SET "role"='"'"'ADMIN'"'"' WHERE "walletAddress"='"'"'<КОШЕЛЁК>'"'"';'
```

После этого войдите на сайте этим кошельком (SIWS) — роль подхватится из БД.

## 4. Обновление версии

```sh
git fetch --tags && git checkout vX.Y.Z    # нужный тег/коммит
docker compose --env-file .env.production \
  -f deploy/docker-compose.prod.yml up -d --build
```

Пересборка образа + рестарт сервисов; `migrate` применит новые миграции
автоматически (одноразовый сервис). Даунтайм — секунды (web перезапускается
после миграций). Перед обновлением с изменениями схемы имеет смысл снять
ручной дамп (§5). Откат: `git checkout` предыдущего тега и тот же `up -d
--build`; если применённые миграции несовместимы назад — восстановить дамп
из §5.

## 5. Бэкап и восстановление

Автоматически: сервис **backup** раз в сутки выполняет `pg_dump -Fc` в
`deploy/backups/props-ГГГГММДДTЧЧММSSZ.dump`, удаляет дампы старше
`BACKUP_RETENTION_DAYS` (по умолчанию 14). Логи: `... logs backup`.

Ручной дамп / проверка содержимого:

```sh
docker compose --env-file .env.production -f deploy/docker-compose.prod.yml \
  run --rm backup pg_dump -Fc -f /backups/props-manual.dump
docker compose --env-file .env.production -f deploy/docker-compose.prod.yml \
  run --rm backup pg_restore -l /backups/props-manual.dump   # листинг
```

Копию дампов держите не на том же сервере (rsync/scp по крону — вне
этого комплекта).

Восстановление (переписывает БД!) — интерактивно, с подтверждением
`RESTORE`, остановкой web/worker и контрольным дампом текущего состояния:

```sh
deploy/restore.sh                       # самый свежий дамп
deploy/restore.sh deploy/backups/props-20260101T030000Z.dump
```

## 6. Чек-лист перехода devnet → mainnet

- [ ] `TREASURY_WALLET` — адрес **мультисига Squads** (рекомендуем 2-of-3),
      созданного заранее; подставлен в `.env.production`. Пустое значение —
      покупки просто отключены (checkout вернёт ошибку).
- [ ] `USDC_MINT` = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC
      mainnet; дефолт, менять не нужно).
- [ ] `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta` — уже дефолт кода и сборки,
      ничего пересобирать не нужно (см. комментарий в
      `.env.production.example`: NEXT_PUBLIC_* инлайнятся при сборке).
- [ ] `APP_DOMAINS` = ваш домен; `TRUSTED_IP_HEADER=cf-connecting-ip` за Cloudflare
      (без Cloudflare — `x-forwarded-for`), `TRUSTED_PROXY_COUNT=1`.
- [ ] `SOLANA_RPC_URL` — платный RPC для стабильности подтверждений.
- [ ] Стек перезапущен с новым env: `docker compose ... up -d` (compose
      пересоздаст контейнеры с новыми переменными).
- [ ] **Тестовая покупка за реальные деньги**: минимальный тариф — SPRINT
      $5K = **цена из `src/lib/pricingConfig.ts`** (сейчас тестовая, $1 USDC). Кошелёк с этой суммой USDC (+ немного SOL на газ) →
      checkout на сайте → оплата Solana Pay → статус покупки `PAID`
      в течение ~15–60 с (воркер проверяет раз в 15 с) → челлендж виден
      в дашборде.
- [ ] **Зачисление на казну**: баланс USDC мультисига вырос на сумму покупки —
      проверьте на explorer.solana.com (адрес `TREASURY_WALLET`) или на
      странице `/transparency`. Подпись транзакции сохраните.
- [ ] Тестовый челлендж закройте вручную (refund через мультисиг или
      пометьте возврат по внутренней процедуре), чтобы не мешал отчётности.

## 7. Чек-лист безопасности

- [ ] Наружу открыты **только 22, 80, 443**:

  ```sh
  sudo ufw default deny incoming && sudo ufw allow OpenSSH \
    && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp \
    && sudo ufw allow 443/udp && sudo ufw enable
  ```

  5432 (db) и 3000 (web) наружу не публикуются вовсе — только внутренняя
  сеть стека (см. `deploy/docker-compose.prod.yml`: у db нет `ports`,
  у web — только `expose`).
- [ ] SSH только по ключу: `PasswordAuthentication no`,
      `PermitRootLogin prohibit-password` в `/etc/ssh/sshd_config`,
      затем `sudo systemctl reload ssh`.
- [ ] Обновления ОС автоматически: `sudo apt install unattended-upgrades
      && sudo dpkg-reconfigure -plow unattended-upgrades`; Docker Engine —
      штатным apt при плановых обновлениях сервера; приложение —
      пересборкой (§4).
- [ ] `.env.production` — права 600, никогда не коммитится (в .gitignore).
- [ ] Бэкапы копируются за пределы сервера (§5).
- [ ] Ключи/фразы мультисига Squads хранятся по своей политике (2-of-3,
      распределённое хранение) — сервер их не видит: приложение платит
      только на адрес казны.

## 8. Гео-блок (страны)

Блокировка стран (`BLOCKED_COUNTRIES`) на своём сервере работает только когда
перед ним стоит **Cloudflare** (бесплатный план; DNS-записи домена включены
через проксирование — «оранжевое облако»). Страну клиента присылает Cloudflare
в `cf-ipcountry`, и приложение доверяет только этому заголовку
(`GEO_COUNTRY_HEADER=cf-ipcountry`, см. `.env.production.example`). Caddy
(`deploy/Caddyfile`) удаляет `x-vercel-ip-country` из всех входящих запросов
и `cf-ipcountry` / `cf-connecting-ip`, пришедшие не из сети Cloudflare, —
подделать страну нельзя.

Без Cloudflare страна клиента неизвестна — блок не срабатывает (пропускает
всех). Проверка, что подделка не влияет (из незаблокированной страны):

```sh
curl -i -H 'x-vercel-ip-country: US' https://ваш-домен/api/health
# 200 (заголовок срезается Caddy), а не 451/redirect на /blocked
```

## 9. Локальная проверка стека (без сервера и домена)

`deploy/local-check.sh` поднимает полный стек под проектом
`props-local-check` с `DOMAIN=localhost`: Caddy выпускает локальный
сертификат своего CA, наружу публикуются нестандартные порты 8080/8443
(80/443 не трогаются). База одноразовая.

```sh
deploy/local-check.sh
# ... сборка, --wait до здорового web, затем:
# curl -k https://localhost:8443/api/health → {"status":"ok","db":"up",...}
# в конце стек убирается: down -v --remove-orphans (только свой проект)
```

Код возврата скрипта = код curl: 0 значит `/api/health` ответил 200.
