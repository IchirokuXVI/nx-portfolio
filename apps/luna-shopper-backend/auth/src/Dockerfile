# Luna Shopper auth image (plan 0002, section 3).
#
# A long running Node process. No build time config is baked in; every value comes
# from the runtime environment, including the JWT keys.
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

COPY --chown=node:node . ./
# `npm install` rather than the `npm ci` the other four services use. The mailer
# drags in an optional CSS inlining chain (juice, posthtml-parser) that nx 22.7's
# prune-lockfile misplaces: the root lockfile nests entities@2.2.0 under
# posthtml-parser/node_modules/dom-serializer, and the pruned copy moves it under
# htmlparser2, where dom-serializer can no longer reach it. `npm ci` refuses that
# tree outright ("Missing: entities@2.2.0 from lock file") and --omit=optional
# does not help, because the tree is validated before anything is omitted.
# `npm install` repairs the one bad branch and still takes every other version
# from the pruned lockfile. Restore `npm ci` once the pruner is fixed upstream.
#
# Verified still necessary on 2026-08-29, against both npm 10 (node:22-slim) and
# npm 11 (node:24-slim): both reject the pruned tree, so this is the pruner and
# not the Node bump.
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the health port comes from PORT at runtime.
EXPOSE 3002

# Exec form so Node is PID 1 and receives SIGTERM directly; Nest's shutdown hooks
# close the broker subscriptions and the database pool before exit.
CMD ["node", "main.js"]
