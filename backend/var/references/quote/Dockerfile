FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# See backend/.npmrc for why this is disabled.
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# prisma generate only reads the schema; it never connects to this URL, but
# prisma.config.ts requires DATABASE_URL to resolve. The real value is
# provided at runtime via docker-compose.yaml / the deployment environment.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm exec prisma generate --config apps/quote/src/modules/db-client/prisma.config.ts
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY register-paths.js ./

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "-r", "./register-paths.js", "-r", "./dist/apps/quote/src/tracing.js", "dist/apps/quote/src/main.js"]
