# Luna Shopper harvester image (plan 0038, section 4.1; plan 0002, section 3).
#
# A long running Node process. No build time config is baked in; every value comes
# from the runtime environment, including the two switches that decide whether it
# fetches anything at all (HARVEST_ENABLED, MERCADONA_ENABLED), both off by
# default.
#
# Built in its **minimal form**: HTTP and JSON only, no Chromium and no OCR
# engine, so it is not yet the largest image in the system. Backlog 0001's leaflet
# OCR and browser driven adapters are the things that would change that, and the
# adapter boundary is where that decision belongs, per adapter.
#
# There is no build stage. `nx build` and `nx prune` run outside, once for the
# whole workspace, and their output arrives here as the entire build context
# because `build:docker` sets `"context": "dist"`.
#
# The base is pinned by digest rather than by the `node:24-slim` tag, so the
# runtime is identical until someone changes this line on purpose. Bump it with
# `docker buildx imagetools inspect node:24-slim --format '{{println .Manifest.Digest}}'`.
ARG NX_APP

FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ARG NX_APP
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node . ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

USER node

# Documentation only; the health port comes from PORT at runtime.
EXPOSE 3005

# Exec form so Node is PID 1 and receives SIGTERM directly. That matters more here
# than in the other services: SIGTERM aborts every in flight run, which flushes
# what was already fetched instead of discarding tens of minutes of work.
CMD ["node", "main.js"]
