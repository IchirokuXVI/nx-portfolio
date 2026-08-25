# Luna Shopper auth image (plan 0002, section 3).
#
# A long running Node process: primarily a NATS microservice, exposing only a
# small HTTP health port. Multi stage: build with the shared builder image, run
# the pruned output on a slim node runtime. All config is runtime environment;
# secrets (DB URL, JWT private key, OAuth, SMTP) arrive as Kubernetes Secrets.
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
# `npm install` rather than the `npm ci` the other four services use. The mailer
# drags in an optional CSS inlining chain (juice, posthtml-parser) that nx 22.7's
# prune-lockfile misplaces: the root lockfile nests entities@2.2.0 under
# posthtml-parser/node_modules/dom-serializer, and the pruned copy moves it under
# htmlparser2, where dom-serializer can no longer reach it. `npm ci` refuses that
# tree outright ("Missing: entities@2.2.0 from lock file") and --omit=optional
# does not help, because the tree is validated before anything is omitted.
# `npm install` repairs the one bad branch and still takes every other version
# from the pruned lockfile. Restore `npm ci` once the pruner is fixed upstream.
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the health port comes from PORT at runtime.
EXPOSE 3002

# Exec form so Node is PID 1 and receives SIGTERM directly; Nest's shutdown hooks
# close the broker subscriptions and the database pool before exit.
CMD ["node", "main.js"]
