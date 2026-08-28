ARG NODE_ENV=development
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY
ARG NX_APP

# Use the builder image to build the microfrontend app. BUILDER_TAG selects which
# base image tag to build FROM (latest by default; set per build:docker configuration
# in project.json, or forwarded from a BUILDER_TAG env var via the target's forwardEnv).
FROM ${TARGET_REGISTRY}nx-portfolio/builder:${BUILDER_TAG} AS builder
ARG NODE_ENV=development
ENV NODE_ENV=$NODE_ENV
ARG NX_APP

# The backend this image talks to (plan 0014). velista is the only frontend in the
# workspace with a backend, so it is the only one whose image is not environment
# agnostic. Both are baked into the bundle at build time by a DefinePlugin in
# webpack.prod.config.ts, exactly as the shell bakes MFE_BASE_URL, so the staging
# and production images differ only in two strings rather than in build semantics.
#
# The ARG/ENV pair is what carries them: `forwardEnv` in project.json puts them on
# the docker build as arguments, and only an ENV makes them visible to the webpack
# process below. With neither set the DefinePlugin's production defaults apply.
ARG LUNA_GATEWAY_URL
ARG LUNA_REALTIME_URL
ENV LUNA_GATEWAY_URL=$LUNA_GATEWAY_URL
ENV LUNA_REALTIME_URL=$LUNA_REALTIME_URL

RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}

# Use the local-http-server image as the base for serving the app
FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
ARG NX_APP
COPY --from=builder /app/dist/apps/${NX_APP} /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
