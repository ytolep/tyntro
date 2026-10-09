#!/bin/sh
# Ежедневный бэкап БД прод-стека: pg_dump -Fc в /backups, ротация по дням.
# Запускается как entrypoint сервиса backup (образ postgres:17) из
# deploy/docker-compose.prod.yml; подключение к БД — через PG* env сервиса.
#
# Если скрипту переданы аргументы — exec их вместо цикла: так restore.sh
# запускает pg_restore тем же сервисом с той же конфигурацией.
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
retention="${BACKUP_RETENTION_DAYS:-14}"

echo "backup: цикл запущен (каждые ${interval}s, ротация ${retention} дн.)"
while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/backups/props-${stamp}.dump"
  if pg_dump -Fc -f "$file"; then
    echo "backup: ${file} ($(du -h "$file" | cut -f1))"
  else
    echo "backup: pg_dump не удался" >&2
    rm -f "$file"
  fi
  # Ротация: дампы старше retention дней удаляются.
  find /backups -name 'props-*.dump' -type f -mtime "+${retention}" -delete
  sleep "$interval"
done
