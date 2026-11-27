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
# dependencies, nothing else.
FROM node:22-alpine AS image-service-root
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# Packed as a `docker save` archive. The manager hands it to the clients through Nomad, so they
# need no registry or internet access to start the image service.
FROM image-service-root AS image-service-package
COPY --from=image-service-root / /rootfs/
COPY tools/pack-image-service.js ./tools/
RUN node tools/pack-image-service.js /rootfs /image-service

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=web /app/web/build ./web/build
COPY --from=image-service-package /image-service ./image-service
# A writable default for DRIVER_HUB_DATA_DIR, so a named volume works without host preparation.
RUN mkdir /data && chown node:node /data
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
