FROM docker:29-cli AS docker-tools

# The web frontend is built separately with the toolchain its lockfile was made with (npm >= 11);
# only its static output enters the runtime image.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci && npm cache clean --force
COPY web/ ./
RUN npm run build

# The image service Driver Hub runs on every Nomad client: Node.js, Hub's code and its
# dependencies, nothing else. It is built for every client architecture Hub supports, whatever
# the manager's own. The dependencies are plain JavaScript, so they are installed once and
# copied, and the other architecture's file system is assembled without running anything in it.
FROM --platform=$BUILDPLATFORM node:22-alpine AS image-service-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM --platform=linux/amd64 node:22-alpine AS image-service-amd64
WORKDIR /app
COPY --from=image-service-deps /app/package.json /app/package-lock.json ./
COPY --from=image-service-deps /app/node_modules ./node_modules
COPY src ./src

FROM --platform=linux/arm64 node:22-alpine AS image-service-arm64
WORKDIR /app
COPY --from=image-service-deps /app/package.json /app/package-lock.json ./
COPY --from=image-service-deps /app/node_modules ./node_modules
COPY src ./src

# Each packed as a `docker save` archive. The manager hands them to the clients through Nomad, so
# they need no registry or internet access to start the image service.
FROM image-service-deps AS image-service-package
COPY --from=image-service-amd64 / /rootfs/amd64/
COPY --from=image-service-arm64 / /rootfs/arm64/
COPY tools/pack-image-service.js ./tools/
RUN node tools/pack-image-service.js /rootfs/amd64 /image-service/amd64 amd64 && \
    node tools/pack-image-service.js /rootfs/arm64 /image-service/arm64 arm64

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=web /app/web/build ./web/build
COPY --from=image-service-package /image-service ./image-service
# A writable default for DRIVER_HUB_DATA_DIR, so a named volume works without host preparation.
RUN mkdir -p /data /run/hub-route && chown node:node /data /run/hub-route
USER node
ENV HOST=0.0.0.0
CMD ["node", "src/main.js"]

FROM base AS builder
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
# Register the Compose builder without contacting it during the image build. Without
# BUILDX_BUILDER, native/custom installations can still use their own Docker context.
RUN docker buildx create --name hub-compose --driver remote unix:///run/hub-buildkit/buildkit/buildkitd.sock

FROM builder AS runtime
