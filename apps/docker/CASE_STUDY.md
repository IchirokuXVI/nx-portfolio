# Docker & Kubernetes — Case Study (Infrastructure)

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed. This covers the whole build/deploy
> foundation: the custom Nx docker plugin, Dockerfiles, CI/CD, and k3s/Helm.

## The custom Nx docker plugin (`tools/docker`, `@portfolio/docker`)

**Q: Why write your own Nx docker plugin (build/push executors + generator) instead of an off-the-shelf one like `@nx-tools/nx-docker`?**
A:

**Q: The `build` executor shells out to `docker buildx build` with a local cache keyed by a hash of the image name, and auto-injects `NX_APP` / `TARGET_REGISTRY` / `NODE_ENV` build args. Walk through why it's built that way (the cache swap dance, the mapped build contexts project/root/dockerfile).**
A:

**Q: The `push` executor and `pushToRegistry` flow — how images get tagged and pushed, and how the registry is configured (`PORTFOLIO_DOCKER_REGISTRY`, skip-login)?**
A:

**Q: The `application` generator scaffolds a Dockerfile into a new app. What does it set up and why have a generator for it?**
A:

## Dockerfiles

**Q: How is an Angular app containerized (multi-stage build → static serve via nginx)? Walk through a per-app Dockerfile.**
A:

**Q: The `type:static-docker` vs `type:dynamic-docker` tags — what's the distinction and how does CI use it?**
A:

**Q: The `builder`, `reverse-proxy`, `certbot`, `local-http-server` docker apps — what does each do?**
A:

## CI/CD (`.github/workflows/docker-ci.yml`)

**Q: The pipeline computes affected projects against the *last successful commit on the branch* (via `gh run list`) rather than the previous commit. Why, and what problem did that solve?**
A:

**Q: Why run tests *inside the builder docker image* (`docker run … builder:latest npx nx run-many -t test`) rather than on the runner directly?**
A:

**Q: Walk through the build order: main builder → affected static-docker apps → test → build:docker → deploy. Why that sequence?**
A:

## Kubernetes / Helm deploy

**Q: You deploy to a k3s cluster via `helm upgrade` over SSH after rsync'ing `k8s/`. Why k3s + this rsync/SSH approach instead of GitOps (ArgoCD/Flux) or a managed cluster?**
A:

**Q: How is the Helm chart structured (app deployment/service templates, the reverse-proxy templates, the LoadBalancer IP-address pool)?**
A:

**Q: TLS: how do the reverse-proxy + certbot pieces get and renew Let's Encrypt certs (the init-container certs, the deploy hook)?**
A:

**Q: How does the reverse-proxy route traffic to the shell + remotes, and how does that mirror the local `compose.yml` / reverse-proxy setup?**
A:
