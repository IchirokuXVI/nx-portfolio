# Luna Shopper harvester image (plan 0038, section 4.1; plan 0002, section 3).
#
# A long running Node process. No build time config is baked in; every value comes
# from the runtime environment, including HARVEST_ENABLED, the switch that decides
# whether it may start a run at all, off by default. Which chains it may fetch is
# not an environment variable: it is a row per chain in its own database.
#
# **It carries Chromium** since plan 0090, and that is the largest single thing
# in it: the browser and its shared libraries add roughly 400 MB to an image that
# was tens of megabytes. That is a build time cost, a pull time cost and a
# patching surface, and it is paid because carrefour.es sits behind Cloudflare
# and Cloudflare refuses every framework free client this workspace owns on the
# TLS handshake. `libs/luna-shopper/carrefour/src/lib/carrefour.client.ts` holds
# the measurement. Backlog 0001's leaflet OCR is the other thing that would grow
# this image, and it has not been picked up.
#
# Only Chromium is installed, never the other two engines, and it is installed
# into a path outside a home directory so the unprivileged `node` user can run
# it. `npm ci` runs as root here, so a browser left in root's cache would be
# unreadable at runtime and the first run would fail with a missing executable.
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
# Outside every home directory, so the browser one user installs is the browser
# another user runs. Playwright reads this on install and again at launch.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# The install below is the one that fetches a browser, and it fetches exactly
# one. Without this the `playwright` package's own postinstall downloads all
# three engines, which is most of a gigabyte nothing here will ever open.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY --chown=node:node . ./
RUN npm ci --omit=dev && npm cache clean --force

# Chromium and the system libraries it links against. `--with-deps` is what
# pulls the second set in, and a browser without them starts and then dies on a
# missing shared object, which reads as a crash rather than a missing package.
RUN npx --yes playwright install --with-deps chromium \
  && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH" \
  && rm -rf /var/lib/apt/lists/*

USER node

# Documentation only; the health port comes from PORT at runtime.
EXPOSE 3005

# Exec form so Node is PID 1 and receives SIGTERM directly. That matters more here
# than in the other services: SIGTERM aborts every in flight run, which flushes
# what was already fetched instead of discarding tens of minutes of work.
CMD ["node", "main.js"]
