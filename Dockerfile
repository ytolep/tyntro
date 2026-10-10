# syntax=docker/dockerfile:1
# Один образ для web (node server.js), worker (tsx) и миграций (prisma migrate deploy).
# Node 22-alpine, multi-stage; web работает на standalone-выходе next build.

# ---- deps: полный node_modules из lockfile + сгенерированный Prisma-клиент (musl)
# --ignore-scripts: нативные аддоны кошельковых зависимостей (usb, utf-8-validate)
# не нужны серверному рантайму (ws имеет JS-фолбэк, Ledger — браузерный WebUSB);
# Prisma-клиент генерируется явно следующей командой.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Вложенные peer-копии @types/react@19 (от @solana-пакетов) конфликтуют с
# @types/react@18 приложения. Локальная установка (npm 11) их не ставит —
# удаляем и в образе. Правильное лечение — overrides в package.json (см. отчёт агента J).
RUN npm ci --ignore-scripts && npx prisma generate \
  && find node_modules -mindepth 2 -path '*/node_modules/@types/react' -type d -exec rm -rf {} +

# ---- builder: next build со standalone-выходом
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
ENV NEXT_TELEMETRY_DISABLED=1
# Фейковый URL: на сборке к БД не подключаемся, но клиенту нужна переменная.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* инлайнятся в браузерный бандл и CSP (next.config.js) при сборке —
# приходят build-аргументами из compose (.env.production). Пусто → дефолты кода (mainnet).
ARG NEXT_PUBLIC_SOLANA_CLUSTER=
ARG NEXT_PUBLIC_SOLANA_RPC_URL=
ARG NEXT_PUBLIC_SUPPORT_EMAIL=
ARG NEXT_PUBLIC_BRAND_NAME=
ENV NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME
RUN npx next build

# ---- runner: web + worker + prisma CLI в одном образе
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0
# Web: standalone-сервер Next (server.js + минимальные node_modules).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Полные node_modules поверх standalone-сабсета: для воркера (tsx) и prisma CLI
# (migrate deploy). Версии совпадают с lockfile, слияние безопасно.
COPY --from=deps /app/node_modules ./node_modules
# Воркер и миграции: исходники (worker читает src/lib), схема, tsconfig для алиасов @/.
COPY src ./src
COPY prisma ./prisma
COPY tsconfig.json package.json ./

EXPOSE 3000
CMD ["node", "server.js"]
