FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]

FROM base AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone server.js binds to $HOSTNAME if set, and Docker auto-sets
# HOSTNAME to the container ID — without this override it only listens on the
# container's external IP, not loopback, which breaks the healthcheck below.
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
