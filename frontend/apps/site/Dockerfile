FROM node:24-alpine AS base
WORKDIR /app

COPY site/package*.json ./
RUN npm ci

FROM base AS dev
WORKDIR /app
COPY site .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build
WORKDIR /app
COPY site .
RUN npm run build

FROM nginx:alpine AS prod
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/site/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]