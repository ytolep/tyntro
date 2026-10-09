#!/usr/bin/env bash
# Локальная проверка прод-стека (docs/DEPLOY.md §8): DOMAIN=localhost —
# Caddy выпускает локальный сертификат своего CA (curl -k); наружу публикуются
# нестандартные порты HTTP_PORT/HTTPS_PORT (по умолчанию 8080/8443), 80/443
# не трогаем. База одноразовая, в конце — down -v. Чужие контейнеры не задеты:
# стек под отдельным проектом props-local-check.
#
#   deploy/local-check.sh          # поднять, проверить, убрать
set -eu
cd "$(dirname "$0")/.."

export DOMAIN=localhost
export HTTP_PORT="${HTTP_PORT:-8080}"
export HTTPS_PORT="${HTTPS_PORT:-8443}"
export POSTGRES_PASSWORD=props-local-check
export DATABASE_URL="postgresql://props:props-local-check@db:5432/props"
# Заглушка-казна (System Program id), чтобы цикл оплат воркера не падал.
export TREASURY_WALLET=11111111111111111111111111111111

compose=(docker compose -p props-local-check -f deploy/docker-compose.prod.yml)

# Убираем стек при любом исходе (успех, ошибка up/curl, Ctrl-C).
trap '"${compose[@]}" down -v --remove-orphans' EXIT

# --wait: дождаться здорового web (через него стартует caddy).
"${compose[@]}" up -d --build --wait --wait-timeout 420

echo "curl -k https://localhost:${HTTPS_PORT}/api/health"
curl -kfS "https://localhost:${HTTPS_PORT}/api/health"
echo
echo "OK: локальная проверка стека прошла."
