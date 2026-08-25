# Luna Shopper core image (plan 0002, section 3).
#
# A long running Node process: primarily a NATS microservice, exposing only a
# small HTTP health port. Multi stage: build with the shared builder image, run
# the pruned output on a slim node runtime. All config is runtime environment;
# the database URL and JWT public key arrive from Kubernetes Secrets/ConfigMaps.
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

COPY --from=builder --chown=node:node /app/dist/apps/${NX_APP}/ ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the health port comes from PORT at runtime.
EXPOSE 3003

# Exec form so Node is PID 1 and receives SIGTERM directly; Nest's shutdown hooks
# close the broker subscriptions and the database pool before exit.
CMD ["node", "main.js"]
