# Luna Shopper assistant image (plan 0039; plan 0002, section 3).
#
# A long running Node process holding one credential nothing else in the system
# needs, and no database connection at all. Every value comes from the runtime
# environment, including GEMINI_API_KEY, which is deliberately allowed to be
# empty: a cluster with no key deploys, boots, and answers 501 on the assistant
# route (plan 0026's rule, applied here in section 11).
#
# The smallest image in the system, and it stays that way as long as the model
# provider is reached over HTTP rather than through an SDK: the client is Node's
# global fetch, so nothing is vendored for it.
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
EXPOSE 3006

# Exec form so Node is PID 1 and receives SIGTERM directly; Nest's shutdown hooks
# close the broker subscriptions before exit. A turn in flight is a request to a
# third party and an awaited socket, so there is nothing here to flush.
CMD ["node", "main.js"]
