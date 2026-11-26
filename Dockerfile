FROM docker:29-cli AS docker-tools

# The web frontend is built separately with the toolchain its lockfile was made with (npm >= 11);
# only its static output enters the runtime image.
FROM node:26-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci && npm cache clean --force
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=web /app/web/build ./web/build
# A writable default for DRIVER_HUB_DATA_DIR, so a named volume works without host preparation.
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0
CMD ["node", "src/main.js"]

FROM base AS builder
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

FROM base AS runtime
