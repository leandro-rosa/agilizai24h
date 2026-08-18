# Build context is the REPOSITORY ROOT, not this folder — the pnpm workspace
# keeps a single lockfile at the root, so an app-scoped context cannot install.
# See docker-compose.yml for the matching `context:`/`dockerfile:` pair.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# Copy only what the resolver needs first, so dependency layers survive
# source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/apps/admin/package.json frontend/apps/admin/
RUN pnpm install --filter @agiliz/admin... --frozen-lockfile

FROM base AS dev
WORKDIR /repo
COPY . .
WORKDIR /repo/frontend/apps/admin
EXPOSE 3000
CMD ["pnpm", "dev", "-H", "0.0.0.0"]

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm --filter @agiliz/admin build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone server.js binds to $HOSTNAME if set, and Docker auto-sets
# HOSTNAME to the container ID — without this override it only listens on the
# container's external IP, not loopback, which breaks the healthcheck in
# docker-compose.yml.
ENV HOSTNAME=0.0.0.0

# In a monorepo the standalone bundle keeps the workspace's directory shape
# (pinned by outputFileTracingRoot in next.config.ts): server.js sits at
# frontend/apps/admin/, while its node_modules are symlinks pointing up into
# the pnpm virtual store at the bundle root (node_modules/.pnpm). Copy the tree
# whole — flattening it breaks every one of those symlinks and the server dies
# with "Cannot find module 'next'".
COPY --from=build /repo/frontend/apps/admin/.next/standalone ./
COPY --from=build /repo/frontend/apps/admin/.next/static ./frontend/apps/admin/.next/static
# NOTE: no `public/` COPY — this app has no public/ directory. The previous
# Dockerfile copied one unconditionally, which would have failed the prod build.

EXPOSE 3000
CMD ["node", "frontend/apps/admin/server.js"]
