# Luna Shopper gateway image (plan 0002, section 3).
#
# A long running Node process, unlike the workspace's other apps, which are static
# bundles served by nginx. No build time config is baked in; every value comes from
# the runtime environment.
#
# There is no build stage. `nx build` and `nx prune` run outside, once for the whole
# workspace, and their output directory arrives here as the entire build context
# because `build:docker` sets `"context": "dist"`. That directory already holds the
# bundle, the pruned package.json and the pruned lockfile, which is exactly what the
# install below needs. Compiling in here instead gave every image its own empty Nx
# cache; see k8s/plans/0007.
#
# The base is pinned by digest rather than by the `node:24-slim` tag, so the runtime
# is identical until someone changes this line on purpose. Bump it deliberately with
# `docker buildx imagetools inspect node:24-slim --format '{{println .Manifest.Digest}}'`.
ARG NX_APP

FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ARG NX_APP
ENV NODE_ENV=production
WORKDIR /app

# The built bundle plus the pruned manifest and lockfile, then only production deps
# from that lockfile. The `node` user (uid 1000) ships with the base image; the
# process runs non root.
COPY --chown=node:node . ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the listening port comes from PORT at runtime.
EXPOSE 3000

# Exec form so Node is PID 1 and receives SIGTERM directly. Nest's shutdown hooks
# (enableShutdownHooks) then drain in flight work and close broker/DB connections
# before exit, which is what makes the rolling update in section 6 lossless.
CMD ["node", "main.js"]
