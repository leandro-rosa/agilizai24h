# Build context is the REPOSITORY ROOT, not this folder — the pnpm workspace
# keeps a single lockfile at the root, so an app-scoped context cannot install.
# See docker-compose.yml for the matching `context:`/`dockerfile:` pair.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# Copy only what the resolver needs first, so dependency layers survive
# source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/apps/site/package.json frontend/apps/site/
RUN pnpm install --filter @agiliz/site... --frozen-lockfile

FROM base AS dev
WORKDIR /repo
COPY . .
WORKDIR /repo/frontend/apps/site
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm --filter @agiliz/site build

FROM nginx:alpine AS prod
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /repo/frontend/apps/site/dist /usr/share/nginx/html
COPY frontend/apps/site/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
