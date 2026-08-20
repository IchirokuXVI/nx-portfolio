ARG NODE_ENV=development
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY
ARG NX_APP
# Base URL where the shell loads its remotes from. Baked into the bundle at build
# time, so staging and production builds differ only by this value.
ARG MFE_BASE_URL
# Alternative to MFE_BASE_URL: an explicit per-remote URL map (name=url,...), used
# when each remote lives on its own origin/port (the local "port" mode).
ARG MFE_REMOTE_URLS

# Use the builder image to build the microfrontend app. BUILDER_TAG selects which
# base image tag to build FROM (latest by default; overridable via the docker
# executor's PORTFOLIO_BUILDER_TAG environment variable).
FROM ${TARGET_REGISTRY}nx-portfolio/builder:${BUILDER_TAG} AS builder
ARG NODE_ENV=development
ENV NODE_ENV=$NODE_ENV
ARG NX_APP
ARG MFE_BASE_URL
ENV MFE_BASE_URL=$MFE_BASE_URL
ARG MFE_REMOTE_URLS
ENV MFE_REMOTE_URLS=$MFE_REMOTE_URLS
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}

# Use the local-http-server image as the base for serving the app
FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
ARG NX_APP
COPY --from=builder /app/dist/apps/${NX_APP} /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
