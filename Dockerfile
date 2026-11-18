# ResAN: web (Next.js) + API (Fastify) en una sola imagen, servidas por un único puerto.
#   /api/*  -> API (incluido el WebSocket /api/ws)
#   resto   -> web Next.js (proceso interno en 127.0.0.1:3100)

# --- 1. Compilación ---
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
# Primero solo los manifiestos para aprovechar la caché de dependencias
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# La web llama a la API en su mismo dominio
ENV NEXT_PUBLIC_API_URL=/api
RUN pnpm --filter @resan/web build

# --- 2. Dependencias de producción de la API ---
FROM node:22-bookworm-slim AS api-deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --prod --frozen-lockfile --filter "@resan/api..."

# --- 3. Imagen final ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 HOST=0.0.0.0 \
    API_PREFIX=/api WEB_UPSTREAM=http://127.0.0.1:3100 WEB_PORT=3100
WORKDIR /app
# API: dependencias de producción + código fuente (se ejecuta con tsx)
COPY --from=api-deps /app /app
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
# Web: servidor autocontenido de Next.js
COPY --from=build /app/apps/web/.next/standalone /app/web
COPY --from=build /app/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=build /app/apps/web/public /app/web/apps/web/public
COPY docker/start.mjs /app/start.mjs
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/start.mjs"]
