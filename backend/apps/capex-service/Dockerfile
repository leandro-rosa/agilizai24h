# Build context is the REPOSITORY ROOT — the pnpm workspace keeps a single
# lockfile there, and this service compiles the @app/* libs from
# backend/common/nest-libs alongside its own source.
FROM node:24-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/apps/capex-service/package.json backend/apps/capex-service/
COPY backend/common/nest-libs/ backend/common/nest-libs/
RUN pnpm install --filter @agiliz/capex-service... --frozen-lockfile

FROM deps AS build
COPY . .
# prisma generate only reads the schema to emit the client — it never connects,
# so a dummy URL is enough and real credentials are neither needed nor wanted
# at build time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @agiliz/capex-service exec prisma generate
RUN pnpm --filter @agiliz/capex-service build

FROM build AS dev
WORKDIR /repo/backend/apps/capex-service
EXPOSE 3000
CMD ["pnpm", "start"]

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/apps/capex-service/package.json backend/apps/capex-service/
RUN pnpm install --filter @agiliz/capex-service... --frozen-lockfile --prod && pnpm store prune

COPY register-paths.js ./
COPY --from=build /repo/backend/apps/capex-service/dist backend/apps/capex-service/dist
COPY --from=build /repo/backend/apps/capex-service/prisma backend/apps/capex-service/prisma
COPY --from=build /repo/backend/apps/capex-service/generated backend/apps/capex-service/generated

RUN addgroup -S app && adduser -S app -G app
USER app

# cwd is the app folder: register-paths.js resolves @app/* against <cwd>/dist,
# and Node's upward node_modules walk reaches this package's own dependencies.
WORKDIR /repo/backend/apps/capex-service
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "-r", "../../../register-paths.js", "dist/apps/capex-service/src/main.js"]
