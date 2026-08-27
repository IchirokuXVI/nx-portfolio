# 0012 Per environment API configuration

Velista is the only frontend in this workspace that talks to a backend, which makes it the
only one whose image is not environment agnostic. Today it has no way to be told which
backend to talk to, and a second defect means the production image is not built as a
production build at all.

Both have to be fixed before Velista can be smoke tested against a staging cluster.

## 1. Three separate defects

### 1.1 The production image is a development build

`apps/velista/src/Dockerfile` ends its builder stage with:

```dockerfile
ARG NODE_ENV=development
RUN npx nx build ${NX_APP} --configuration=${NODE_ENV}
```

so the Angular build configuration is whatever `NODE_ENV` says, and `NODE_ENV` arrives as a
docker build argument from `project.json`. Every other Angular app sets it. `shell`,
`odontogram`, `damoclesSword` and `landingV2` all carry

```json
"production": { "buildArgs": { "NODE_ENV": "production" } }
```

**Velista's `production` configuration has no `buildArgs` block at all.** The
`@portfolio/docker:build` executor injects only `NX_APP` and `TARGET_REGISTRY`
(`tools/docker/src/executors/build/build.ts:59-60`) plus anything named in `forwardEnv`, so
nothing supplies `NODE_ENV` and the Dockerfile default wins. The image published as
`nx-portfolio/velista:latest` is built with `--configuration=development`.

That single missing key causes everything a development build implies:

- **`fileReplacements` never applies**, so the bundle ships `environment.ts`, whose API
  config is `http://localhost:3000` and `http://localhost:3001`. The production image points
  at the user's own machine.
- No optimization, no minification, source maps included, and the unbundled chunk layout
  that `k8s/README.md` already warns fires hundreds of requests.
- Budgets are not enforced, so the size regression that would normally fail a build passes.
- **The service worker never registers.** `app.config.ts` gates it on
  `enabled: !isDevMode()`, and a development build makes `isDevMode()` true. So the PWA that
  `apps/velista/plans/0013` just shipped, the installable app and its offline behaviour,
  would be silently absent from the deployed image, and the `serviceWorker` build option that
  emits `ngsw-worker.js` and `ngsw.json` does not run in that configuration either. Plan 0013
  and this one therefore have to land together: the own origin move is what makes velista
  installable, and this missing build argument is what would have stopped anyone from
  installing it.

Velista also lacks `forwardEnv: ["BUILDER_TAG"]`, which every other app has. It happens not
to matter in CI, where the builder is published as `latest` and the Dockerfile defaults to
`latest`, but it is the same omission and should be closed with it.

### 1.2 The realtime URL points at the wrong host

`apps/velista/src/environments/environment.prod.ts:14-15`:

```ts
gatewayBaseUrl: 'https://api.ichirokuxvi.com',
realtimeBaseUrl: 'https://api.ichirokuxvi.com',
```

`k8s/helm/values.yaml` routes `luna-shopper-backend-realtime` on `rt.ichirokuxvi.com`, not
`api.`. So every socket and SSE connection would be attempted against the REST gateway,
which does not serve them. This is wrong in production, not only in staging, and it is a
one word fix that no test catches because nothing asserts the two constants against the
chart.

### 1.3 There is no staging value for either URL

Both URLs are literals in a file selected by `fileReplacements`, and there is exactly one
production file. CI builds every app with `--configuration production`, so a staging Velista
image would carry production URLs even after 1.1 is fixed. CORS then rejects the call,
because `values.yaml` allows only `https://ichirokuxvi.com` as a production origin, so the
failure is at least loud rather than silent cross environment traffic.

## 2. Approach: build arguments, not a third configuration

Two ways to give one app two backends.

**A `staging` build configuration** with its own `fileReplacements` to an
`environment.staging.ts`. Idiomatic Angular, and wrong here: the Angular configuration name
is bound to `NODE_ENV` by the Dockerfile, so `--configuration staging` means `NODE_ENV=staging`
inside the builder, which is a lie to every tool that reads it. It also forces CI to
special case Velista's configuration while every other app builds with `production`.

**Build arguments**, which is what the shell already does. `apps/shell/webpack.prod.config.ts`
reads `process.env.MFE_BASE_URL` with a production default, and
`apps/shell/project.json:65` forwards it through
`forwardEnv: ["BUILDER_TAG", "MFE_BASE_URL", "MFE_REMOTE_URLS"]`. Both CI workflows already
set that variable per environment. Velista's two URLs are the same kind of value reaching the
same kind of build, so they should arrive the same way.

Take the second. It keeps one production configuration for every app, it reuses plumbing that
is already proven in CI, and it means the staging and production images differ only in two
baked strings rather than in build semantics.

## 3. Work

### 3.1 Fix the build configuration

`apps/velista/project.json`, bringing it in line with every sibling:

```json
"options": {
  "imageName": "nx-portfolio/velista",
  "forwardEnv": ["BUILDER_TAG", "LUNA_GATEWAY_URL", "LUNA_REALTIME_URL"]
},
"configurations": {
  "development": {
    "versionTags": ["dev"],
    "buildArgs": { "NODE_ENV": "development", "BUILDER_TAG": "dev" }
  },
  "production": {
    "pushToRegistry": true,
    "versionTags": ["latest"],
    "buildArgs": { "NODE_ENV": "production" }
  }
}
```

The Dockerfile needs `ARG LUNA_GATEWAY_URL` / `ARG LUNA_REALTIME_URL` in the builder stage
and matching `ENV` lines, so the values reach the webpack process rather than stopping at
docker.

Expect the first true production build to surface problems that a development build has been
hiding: budget failures, and anything depending on development only behaviour. Treat that as
the point of the change rather than as a regression.

### 3.2 Inject the URLs at build time

`environment.prod.ts` reads from `process.env`, which webpack replaces with literals at
compile time:

```ts
export const environment: { production: boolean; api: AppApiConfig } = {
  production: true,
  api: {
    gatewayBaseUrl: process.env['LUNA_GATEWAY_URL'] as string,
    realtimeBaseUrl: process.env['LUNA_REALTIME_URL'] as string,
  },
};
```

and `webpack.prod.config.ts` gains a `DefinePlugin` with the production hosts as defaults, so
a build with neither variable set produces exactly today's intended production image:

```ts
new DefinePlugin({
  'process.env.LUNA_GATEWAY_URL': JSON.stringify(
    process.env.LUNA_GATEWAY_URL || 'https://api.ichirokuxvi.com'
  ),
  'process.env.LUNA_REALTIME_URL': JSON.stringify(
    process.env.LUNA_REALTIME_URL || 'https://rt.ichirokuxvi.com'
  ),
})
```

Note the corrected `rt.` host in the realtime default, which is defect 1.2.

`process.env` does not exist in a browser, so the `DefinePlugin` substitution is not a
convenience here, it is load bearing: without it the bundle throws at startup. Add a spec
that builds the production configuration and asserts the emitted bundle contains no literal
`process.env`, because the failure is otherwise only visible at runtime in the deployed app.

### 3.3 Set them in CI

`.github/workflows/docker-ci.yml` already exports `STAGING_MFE_BASE_URL` and passes
`MFE_BASE_URL` to the build step. Add the two beside it:

```yaml
env:
  DOCKER_IMAGE_TAG: staging
  MFE_BASE_URL: ${{ env.STAGING_MFE_BASE_URL }}
  LUNA_GATEWAY_URL: https://api.staging.ichirokuxvi.com
  LUNA_REALTIME_URL: https://rt.staging.ichirokuxvi.com
```

`release.yml` sets the production pair alongside `PROD_MFE_BASE_URL`. Both are ignored by
every app except Velista, exactly as `MFE_BASE_URL` is ignored by every app except the shell.

### 3.4 Assert the URLs against the chart

The reason 1.2 survived is that two files have to agree and nothing checks that they do. Add
a spec that reads `k8s/helm/values.yaml`, finds the routed Luna services, and asserts the
production defaults in `webpack.prod.config.ts` match their `host` values. It fails the day
someone renames a host, which is the only day it matters.

## 4. What else is environment specific

Answering the broader question, because Velista is not obviously the only one.

- **`shell`** bakes `MFE_BASE_URL` for the three remotes on the micro-frontend host, and
  `MFE_REMOTE_URLS` for velista, which since `apps/velista/plans/0013` is served from its own
  origin that no base URL can produce. Both are already set per environment in both workflows,
  so there is nothing to do here. It is worth noting the direction, though: that pair tells
  the **shell** where velista is, and says nothing about where velista thinks the backend is.
  This plan is the other half of that, and the two are independent.
- **`odontogram`, `damoclesSword`, `landingV2`** are environment agnostic. They call no
  backend and bake no host.
- **`libs/shared/environments`** exports `BACK_API_DOMAIN: 'https://ichirokuxvi.com'` with
  `BACK_API_PATH: '/api'`, consumed through `OwnApiUrlResolver` by
  `libs/odontogram/data-access/src/lib/odontogram/odontogram-api.ts`. No `/api` route exists
  in `values.yaml` for any host, so this points at an endpoint that is not served and has
  presumably been dead since before the Gateway API migration. Out of scope here, but it is a
  second hardcoded production host in the workspace and it should either be wired to
  something or deleted rather than left to be discovered again.
- **`apps/odontogram/project.json:122`** sets `publicHost: https://mfe.ichirokuxvi.com/odontogram`
  under its `serve` target, not `build`. It affects only `nx serve odontogram --configuration
  production`, which nothing in CI runs. Harmless, and noted so the next search for hardcoded
  hosts can dismiss it quickly.

## 5. Verification

- `npx nx build velista --configuration production` succeeds, including budgets.
- The built bundle contains `https://api.ichirokuxvi.com` by default, and
  `https://api.staging.ichirokuxvi.com` when `LUNA_GATEWAY_URL` is set.
- No occurrence of `process.env` survives in the emitted bundle.
- The production image is a production build: check that `main.*.js` is minified and that the
  output is not the multi hundred chunk development layout.
- `ngsw-worker.js` and `ngsw.json` are present in the built output, and the deployed app
  registers the worker. That is the check that proves plan 0013's PWA actually survives the
  trip into the image, and it fails today.
- End to end, the staging Velista reaches `api.staging.ichirokuxvi.com` and is accepted by
  CORS, which is the assertion that ties this plan to `k8s/plans/0002`.
