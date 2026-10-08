# -----------------------------------------------------------------------------
# Integration image.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see the CI workflow
# -----------------------------------------------------------------------------

# Pinned by DIGEST, not only by tag: `24-alpine` moves under our feet, and a
# rebuild of the same release must give the same image. Dependabot (docker
# ecosystem, see .github/dependabot.yml) proposes the new digest when the tag
# moves, so security updates still arrive — as a reviewed PR.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

# dumb-init: handles signals (SIGTERM) correctly for a graceful shutdown.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install the PROD dependencies first (better build cache). `npm ci` ONLY: the
# lockfile is committed and must be in sync with package.json — a silent
# fallback to `npm install` would ship versions nobody reviewed instead of
# failing the build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./

# The only writable location allowed at runtime, owned by the user the
# container runs as: a volume created from this path inherits its owner, and a
# root-owned /data is a volume the `node` user cannot write to.
ENV NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
