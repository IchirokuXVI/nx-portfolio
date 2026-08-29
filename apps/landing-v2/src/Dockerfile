# Serves a bundle that was built before this image.
#
# There is no build stage. `nx build` runs outside, once for the whole workspace, and
# the finished `dist/apps/<project>` arrives here as the entire build context because
# `build:docker` sets `"context": "dist"`. Compiling in here instead gave every image
# its own empty Nx cache, so the shared libraries were rebuilt once per app; see
# k8s/plans/0007.
ARG BUILDER_TAG=latest
ARG TARGET_REGISTRY
# Injected by the docker executor. Unused here, but declared so buildx does not warn
# about a build arg nothing consumed.
ARG NX_APP

# BUILDER_TAG selects which base image tag to build FROM: latest by default, `dev`
# from the development configuration in project.json, or a forwarded BUILDER_TAG.
FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}
ARG NX_APP
COPY . /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
