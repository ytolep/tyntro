#!/usr/bin/env bash
# Восстановление БД прод-стека из дампа deploy/backups/props-*.dump.
# Запускать на сервере из любого каталога:  deploy/restore.sh [файл_дампа]
# Без аргумента берётся самый свежий дамп. Подробности — docs/DEPLOY.md §5.
#
# Осторожно: pg_restore --clean --if-exists ПЕРЕЗАПИСЫВАЕТ текущие данные.
# Скрипт останавливает web/worker, снимает контрольный дамп текущей БД
# (pre-restore-*.dump) и требует явного подтверждения.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.production}"
compose=(docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.prod.yml)

[ -f "$ENV_FILE" ] || { echo "Нет ${ENV_FILE} — см. docs/DEPLOY.md §2" >&2; exit 1; }

# Дамп: аргумент или самый свежий в deploy/backups.
dump="${1:-$(ls -1t deploy/backups/props-*.dump 2>/dev/null | head -n 1 || true)}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "Дамп не найден: ${dump:-<дампов нет>}" >&2
  exit 1
fi

safety="pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "Стек:"
"${compose[@]}" ps
echo
echo "Восстановление : $dump"
echo "Контрольная копия текущей БД: deploy/backups/$safety"
echo "Это перезапишет БД; web и worker будут остановлены."

printf 'Введите RESTORE для подтверждения: '
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Отменено."; exit 1; }

# web/worker держат соединения с БД — на время восстановления останавливаем.
# Если скрипт прервётся до конца: docker compose ... start web worker — вручную.
"${compose[@]}" stop web worker

# Контрольная копия текущего состояния ДО восстановления (в общий каталог бэкапов).
"${compose[@]}" run --rm --no-deps backup pg_dump -Fc -f "/backups/$safety"

# Восстановление (PG* env уже настроены в сервисе). --clean --if-exists удаляет
# существующие объекты перед созданием; схема приезжает вместе с данными.
"${compose[@]}" run --rm --no-deps backup pg_restore --clean --if-exists \
  "/backups/$(basename "$dump")"

"${compose[@]}" start web worker
echo "Готово. Проверка: curl https://\$DOMAIN/api/health и логи web/worker."
