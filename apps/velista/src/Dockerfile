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
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}

# Use the local-http-server image as the base for serving the app
FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
ARG NX_APP
COPY --from=builder /app/dist/apps/${NX_APP} /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
