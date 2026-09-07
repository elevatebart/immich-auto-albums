# syntax=docker/dockerfile:1
# Two targets: `cli` is the monthly run, the default `full` adds the UI.
FROM node:22-slim AS core
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM core AS ui
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./
RUN npm run build

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS ui-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS cli
LABEL org.opencontainers.image.source="https://github.com/elevatebart/immich-auto-albums"
# /data holds config.toml and receives the logs, CSVs and plan dumps.
ENV NODE_ENV=production \
    CONFIG=/data/config.toml \
    OUT=/data \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=core /app/dist ./dist
COPY package.json config.example.toml config.schema.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint
VOLUME /data
# Runs as root on purpose: the DSM task is root and /data is a NAS share.
ENTRYPOINT ["entrypoint"]
CMD ["preview"]

FROM cli AS full
COPY --from=ui-deps /app/server/node_modules ./server/node_modules
COPY --from=ui /app/server/build ./server/build
COPY server/package.json ./server/
EXPOSE 3000
