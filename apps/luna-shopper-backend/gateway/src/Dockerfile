# Luna Shopper gateway image (plan 0002, section 3).
#
# A long running Node process — a new image shape for this repo, whose other apps
# are static bundles served by nginx. Multi stage: build the service with the
# shared builder image, then run the pruned output on a slim node runtime. No
# build time config is baked in; every value comes from the runtime environment.
ARG NODE_ENV=production
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY
ARG NX_APP

# ---- Build stage: reuse the repo builder image (full workspace + deps) ------
FROM ${TARGET_REGISTRY}nx-portfolio/builder:${BUILDER_TAG} AS builder
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ARG NX_APP
# Build the service bundle, then prune a production package.json + lockfile
# (and any workspace libraries) next to it for a reproducible runtime install.
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV} \
  && npx nx prune ${NX_APP}

# ---- Runtime stage: slim long running Node process --------------------------
FROM node:22-slim AS runtime
ARG NX_APP
ENV NODE_ENV=production
WORKDIR /app

# Copy the built bundle + pruned manifest/lockfile, then install only production
# deps from the lockfile. The `node` user (uid 1000) ships with the base image;
# the process runs non root.
COPY --from=builder --chown=node:node /app/dist/apps/${NX_APP}/ ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the listening port comes from PORT at runtime.
EXPOSE 3000

# Exec form so Node is PID 1 and receives SIGTERM directly. Nest's shutdown hooks
# (enableShutdownHooks) then drain in flight work and close broker/DB connections
# before exit, which is what makes the rolling update in section 6 lossless.
CMD ["node", "main.js"]
