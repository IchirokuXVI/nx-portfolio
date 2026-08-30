# @portfolio/docker

A local Nx plugin, not a library: it is never imported by application code. It
provides the executors behind every app's `build:docker` target.

| Kind | Name | Does |
| --- | --- | --- |
| Executor | `@portfolio/docker:build` | shells out to `docker buildx build` |
| Executor | `@portfolio/docker:push` | pushes the built tags; runs after `build` when `pushToRegistry: true` |
| Generator | `@portfolio/docker:application` | scaffolds a Dockerfile into a new app |

**It is project agnostic.** It knows nothing about micro-frontends or this repo. The
only build args it injects itself are `NX_APP` (the project name) and
`TARGET_REGISTRY` (the resolved registry). Everything project specific arrives as an
ordinary `buildArgs` entry, or through the `forwardEnv` option, which lists env var
names to forward as build args when they are set.

Its own operational config comes from options with generic `DOCKER_*` env fallbacks:
`DOCKER_REGISTRY`, `DOCKER_USERNAME` / `DOCKER_PASSWORD` / `DOCKER_SKIP_LOGIN`,
`DOCKER_IMAGE_TAG` (comma separated, overrides `versionTags`), and the cache options
`cache` / `cacheMode` / `cacheScope` (`DOCKER_BUILD_CACHE`, `DOCKER_BUILD_CACHE_MODE`,
`DOCKER_BUILD_CACHE_SCOPE`; backends `local`, `gha`, `registry`).

```sh
nx test docker                                        # unit tests
nx run <project>:build:docker --configuration=production
```

See the Docker & CI/CD section of [`CLAUDE.md`](../../CLAUDE.md) for how the workflows
drive it.
