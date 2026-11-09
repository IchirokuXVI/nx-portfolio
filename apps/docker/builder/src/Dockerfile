# syntax=docker/dockerfile:1-labs
#
# The whole workspace, with dependencies installed, as an image.
#
# CI no longer uses this. Since k8s/plans/0007 the app images copy a bundle that was
# built outside them, so nothing is `FROM` this image any more and neither workflow
# builds it. It stays for the local full stack (k8s/README.md), which wants the
# workspace and its dependencies in one place. Refresh it by hand when that flow needs
# it, with `npx nx run docker/builder:build --configuration=development`.
#
# Pinned by digest rather than by the `node:24` tag so the image is reproducible until
# someone changes this line on purpose. Bump it with
# `docker buildx imagetools inspect node:24 --format '{{println .Manifest.Digest}}'`.
FROM node:24@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40
WORKDIR /app
# Copy only dependency files first to leverage Docker cache
COPY --parents **/package*.json .
RUN npm ci
# Now copy the rest of the application code
COPY . .
