# 0178: one client image for every deployment

> Velista is a product that anyone can deploy (owner decision of 2026-11-02). The server
> images already take their configuration at start. The client image does not. Three URLs
> are compiled into the bundle by `DefinePlugin`: `apps/velista/webpack.prod.config.ts`
> defaults `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL` and `VELISTA_APP_URL` to
> `https://api.velista.app`, `https://rt.velista.app` and `https://velista.app`, and CI
> overrides them per environment from `BUILD_ENV_STAGING` and `BUILD_ENV_PRODUCTION` in
> `k8s/units/velista/unit.env` (`stage-unit.yml:234`, `release-unit.yml:207`). So the owner
> builds the client twice, once per environment, and a self hoster who pulls the published
> image gets a page that talks to the owner's API. The homelab deployment already shows
> the defect: `values.homelab.yaml` serves the same published image under
> `velista.ichirokuxvi.com`, and that page calls `api.velista.app`.
>
> This plan makes the three URLs runtime facts. The image reads them from its environment
> at container start and serves them as a small `config.json`, which `main.ts` reads before
> it bootstraps. The image refuses to start without them. It also stops carrying two other
> things that belong to one deployment: the owner's `assetlinks.json` (generated at start
> from one variable) and the `/velista` portfolio mount in `nginx.conf` (one variable,
> empty by default). The Android identifiers move to one place each. The shell of the
> portfolio embeds `MFE_BASE_URL` at build time by design and is not this plan's concern.
>
> Paths are written as they are today. Docs `0003` renames the project to `velista-client`,
> the directory to `apps/velista-client`, the libraries to `libs/velista-client/*`, the
> alias to `@velista/client/*`, and moves this directory to `apps/velista-client/plans`.
> Files this plan creates are named under the new paths. Docs `0003` also renames the e2e
> projects and the gate directory this plan touches: `velista-e2e` is `velista-client-e2e`,
> `velista-luna-e2e` is `velista-stack-e2e`, `k8s/e2e/velista-luna` is
> `k8s/e2e/velista-stack`, and the keys `LUNA_GATEWAY_URL` and `LUNA_REALTIME_URL` are
> `VELISTA_GATEWAY_URL` and `VELISTA_REALTIME_URL` (`DEFAULT_LUNA_*` becomes
> `DEFAULT_VELISTA_*`). Commands and target states below use those names; the context
> describes today.
>
> Prerequisite reading: velista `0014` (why the URLs became build arguments), `0165` (the
> two addresses, D2 the nginx rewrite, D3 the mount read from `<base>`, D4 no worker under
> a mount), `0166` and `0167` (the runtime axis, the Android project, D1 the WebView origin,
> D5 the App Links file), `0177` (Google sign in on Android), `0013` and `0033` (the service
> worker, `APP_STANDALONE_ORIGIN`), k8s `0014` to `0016` (`unit.env`, `BUILD_ENV_*`, the
> gates), k8s `0015` D6 (the portfolio route to velista). In the code:
> `apps/velista/webpack.config.ts`, `webpack.prod.config.ts`, `src/environments/*`,
> `src/main.ts`, `src/nginx.conf`, `src/Dockerfile`, `src/index.html`,
> `src/app/app-providers.ts`, `src/app/document-mount.ts`, `ngsw-config.json`,
> `capacitor.config.ts`, `scripts/build-android.mjs`, `android/app/build.gradle`,
> `public/.well-known/assetlinks.json`, `k8s/helm/common/templates/_app.tpl`,
> `k8s/helm/velista/values*.yaml`, `k8s/e2e/velista-luna/*`.
>
> **Build order.** Step 2 of the series: after docs `0003` (the rename) is merged, in
> parallel with docs `0004`, backend `0240` to `0243`, k8s `0020` and k8s `0021`. Two edges
> matter. Backend `0242` gives the admin app the same mechanism, and `BUILD_ENV_*` of the
> velista unit can be emptied only when both plans are merged, because the admin build reads
> the gateway key from it today (section "Target state", item 9). k8s `0019` D7 decides
> whether the portfolio keeps serving velista under `/velista`: A keeps the mount, B (its
> recommendation) replaces it with a 301 redirect from the portfolio host to the velista
> host, shipped in a portfolio pull request before the cutover, C drops it. This plan makes
> the mount a variable; the owner's values set it to `/velista` only while the portfolio
> chart's `externalRoutes` entry exists, and leave it empty under B or C. k8s `0020`
> (Compose) and `0021` (the chart on any cluster) consume the variables this plan defines.
> The series order, as every plan of the series states it: docs `0003` first, alone, after
> the pull request gate; then in parallel docs `0004`, backend `0240` to `0243`, velista
> `0178`, k8s `0020` and `0021` (backend `0242` after velista `0178` for the admin
> mechanism, k8s `0020` after backend `0241` for the generated files); k8s `0019` after docs
> `0003` and backend `0240`, in the same rollup to `main` as `0240`; docs `0005` last, with
> docs `0006` read from the start.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write Angular code. This plan
touches no UI apart from one plain text refusal, so `design-taste-frontend` is not needed.

### Objective

One `velista-client` image serves any deployment. At container start the image reads
`VELISTA_GATEWAY_URL`, `VELISTA_REALTIME_URL` and `VELISTA_APP_URL`, refuses to start when
one is missing or malformed, and writes `config.json` into its web root. `main.ts` fetches
that file before `bootstrapApplication`, and `APP_API_CONFIG` and `APP_STANDALONE_ORIGIN`
read the result. The production bundle carries no URL. Development keeps its `.env`
values through the same loader. The image also generates `.well-known/assetlinks.json`
from `VELISTA_ANDROID_APP_LINKS` and renders the portfolio mount from
`VELISTA_MOUNT_PATH`. The Helm chart derives the three URLs from the hosts it already
composes, the gate compose files set them, and `unit.env` stops passing client URLs to
`nx build`.

### Context

Every statement below was read in the checkout on 2026-11-03.

- **How the URLs reach the code today.** `environment.ts` and `environment.prod.ts` read
  `process.env['LUNA_GATEWAY_URL']`, `['LUNA_REALTIME_URL']`, `['VELISTA_APP_URL']` and
  `['VELISTA_APP_VERSION']`; the `DefinePlugin` of each webpack config substitutes them.
  `app-providers.ts:158` binds `{ provide: APP_API_CONFIG, useValue: environment.api }` and
  line 177 binds `APP_STANDALONE_ORIGIN` to `environment.appUrl`. Every library reads the
  backend through `ApiUrl` (`libs/velista/data-access/src/lib/api-url.ts`), including the
  realtime socket (`realtime-socket.ts:427`, `this._urls.realtime('/')`). No library reads
  an environment file.
- **The `useValue` trap.** `main.ts` imports `appConfig` statically, which imports
  `app.routes.ts`, `app-root-route.ts` and `app-providers.ts`. The `appProviders` array is
  built at import time, before any `await` in `main.ts`. A `useValue: environment.api`
  therefore captures whatever the object holds at import. A runtime value must reach the
  two providers through `useFactory`.
- **The version stays a build fact.** `VELISTA_APP_VERSION` names the image, is the same in
  every deployment of that image, and is sent as `x-client-version` (velista `0034` D4).
  It stays in the `DefinePlugin`.
- **The index markup.** `velista-index-markup.spec.ts` holds the two `sub_filter` literals
  of `nginx.conf` (`<base href="/">` and the manifest link) to the built document, and
  asserts the source document has no `<script>`. The service worker prefetches
  `/index.html` and checks it against the hash in `ngsw.json` (`ngsw-config.json`, group
  `app`). An `index.html` rewritten at container start no longer matches that hash.
- **The service worker and unknown files.** `ngsw-config.json` lists no `*.json` in an
  asset group, and has no `dataGroups`. A request for `config.json` passes through to the
  network today, so it fails offline.
- **The Android app does not load the remote document.** `capacitor.config.ts` sets
  `webDir: '../../dist/apps/velista'` and `server.hostname` to the host of
  `VELISTA_APP_URL`. The WebView serves the bundle from the APK under that hostname (0167
  D1). A `config.json` that nginx writes at start never reaches the APK. The Android build
  must put the file into the bundle before `cap sync`. `build-android.mjs` already holds
  the owner's two flavors' hosts in `HOSTS` and lets the environment override them.
- **Android identifiers.** `capacitor.config.ts` has `appId: 'app.velista'`.
  `android/app/build.gradle` has `namespace = "app.velista"`, `applicationId
  "app.velista"`, a `staging` flavor with `applicationIdSuffix ".staging"`, and
  `manifestPlaceholders = [appLinkHost: ...]` per flavor with the owner's two hosts.
  `AndroidManifest.xml` reads `${appLinkHost}`. The Java package of `MainActivity` and
  `VelistaGooglePlugin` is `app.velista`, which is what `namespace` must keep.
  Capacitor reads `appId` when `cap add` creates the native project; `cap sync` does not
  rewrite `applicationId` in Gradle (confirm against `@capacitor/cli` 8.5, the installed
  version).
- **The Google client id is already runtime.** The Android sign in gets `serverClientId`
  from the answer of `POST /v1/auth/google/nonce` (`auth-api.ts:353-377`,
  `google-sign-in.ts:144-149`), which the server fills from its `googleClientId`. Nothing
  in the client names a Google client. No server change is needed for it.
- **`assetlinks.json`** names `app.velista` with the release key and the Play signing key,
  and `app.velista.staging` with the release key only. `velista-asset-links.spec.ts`
  asserts those literals. Both clusters serve both statements today, although each APK
  verifies against one host (`appLinkHost`).
- **The mount.** `nginx.conf` writes `/velista` five times: the `map $request_uri
  $app_base` regex and its value, `location ^~ /velista/` with its `rewrite`, and
  `location = /velista` with its `return 302`. `document-mount.ts` reads any mount from
  `<base>`, and `appRootRoute(mount)` accepts any mount. The worker is off whenever the
  mount is not empty (`app.config.ts`). The portfolio chart's `externalRoutes` entry
  (`k8s/helm/portfolio/values.yaml`, `path: /velista`, `keepPrefix: true`) is the only
  caller of the mount.
- **The manifest.** `public/manifest.webmanifest` has `id`, `start_url` and `scope` all
  `"/"`, relative, with no domain and no mount; nginx drops the manifest link under a
  mount (0165 D2). Nothing in it is deployment specific.
- **The chart.** `common.apps` (`k8s/helm/common/templates/_app.tpl`) renders one container
  per `apps` entry with no `env`. `charts.host` composes a host from `hostPrefix`,
  `baseDomain`, `hostOverrides` and `host`. The routed services are the entries of
  `lunaShopperBackend.services` with `routed: true`, `hostPrefix: api` (role `gateway`)
  and `hostPrefix: rt` (role `realtime`). Helm replaces a list on merge, so an environment
  file cannot change one field of one `apps` entry.
- **The base image** is `nginx:latest` (`apps/docker/local-http-server/src/Dockerfile`).
  Its `/docker-entrypoint.sh` runs every executable `/docker-entrypoint.d/*.sh` before
  `nginx` under `set -e`, so a script that exits non zero stops the container.
- **`BUILD_ENV_*`.** `unit.env` of velista carries only the three client URLs. One
  `nx run-many -t build` builds every image of the unit with them, so the admin build reads
  `LUNA_GATEWAY_URL` from the same list (`apps/luna-shopper-admin/webpack.prod.config.ts`).
  `tools/deploy/units.mjs` lists both keys in `REQUIRED_KEYS` and not in `MAY_BE_EMPTY`.
- **Development.** `tools/dev/ng-slot.sh:214` writes `LUNA_GATEWAY_URL LUNA_REALTIME_URL
  VELISTA_APP_URL` into `apps/velista/.env`. Docs `0003` renames the two `LUNA_*` keys to
  `VELISTA_GATEWAY_URL` and `VELISTA_REALTIME_URL`; keep that one set of three names across
  `.env`, the container environment, the Android build and the chart.
- **The gates.** `k8s/e2e/velista-luna/compose.yml` and `k8s/e2e/portfolio-frontend/compose.yml`
  run the published velista image with no environment. `gate.sh` checks the portfolio path
  and the own origin with curl (0165 D7) and runs `velista-e2e` and `velista-luna-e2e`
  against `https://staging.velista.app`. The velista-e2e stubs match the gateway by suffix
  (`apps/velista-e2e/src/support/gateway.ts`).

### Target state

1. `webpack.prod.config.ts` defines `process.env.VELISTA_APP_VERSION` and nothing else.
   `DEFAULT_VELISTA_GATEWAY_URL`, `DEFAULT_VELISTA_REALTIME_URL` (today
   `DEFAULT_LUNA_GATEWAY_URL` and `DEFAULT_LUNA_REALTIME_URL`) and `DEFAULT_VELISTA_APP_URL`
   are gone. `environment.prod.ts` reads no URL from `process.env`. No bundle file under
   `dist/apps/velista-client` contains `velista.app`.
2. `apps/velista-client/src/runtime-config.ts` exports `loadRuntimeConfig(fallback)`. It
   fetches `config.json` relative to the document base, maps the answer from `unknown`
   (rule D4) into `{ gatewayUrl, realtimeUrl, appUrl }`, strips one trailing slash, and
   accepts only absolute `http` or `https` URLs. A valid file wins over the fallback. With
   no valid file it uses the fallback when all three fallback values are present (the
   development build). With neither it rejects with an error that names the missing keys.
3. `main.ts` awaits `loadRuntimeConfig`, writes the result into `environment.api` and
   `environment.appUrl`, then bootstraps. On rejection it writes one plain sentence into
   `<app-velista-root>` ("This Velista deployment is not configured.") and does not
   bootstrap. The `environment` object keeps its exported shape. `app-providers.ts` binds
   `APP_API_CONFIG` and `APP_STANDALONE_ORIGIN` with `useFactory`, so no provider captures
   the object before the load. No library file changes.
4. `index.html` carries `<link as="fetch" crossorigin href="config.json" rel="preload" />`
   (in the attribute order prettier writes). The fetch in item 2 uses the default cache
   and credentials modes, so the browser reuses the preloaded response.
   `velista-index-markup.spec.ts` asserts the preload once in the source and in the build,
   and still asserts no `<script>`.
5. `ngsw-config.json` gains a `dataGroups` entry for `/config.json` with the `freshness`
   strategy, a timeout of a few seconds and a long `maxAge`, so an installed app boots
   offline with its last config and an online app sees a changed config on its next load.
   `nginx.conf` lists `config.json` in the no cache location beside `index.html`.
6. The image refuses to start without its configuration. A POSIX `sh` script installed as
   `/docker-entrypoint.d/40-velista-client.sh` validates `VELISTA_GATEWAY_URL`,
   `VELISTA_REALTIME_URL` and `VELISTA_APP_URL` (present, absolute `http` or `https`, no
   quote, space or backslash), `VELISTA_MOUNT_PATH` (empty or one `/segment` of
   `[A-Za-z0-9._-]`) and `VELISTA_ANDROID_APP_LINKS` (item 7). On any failure it prints
   one line per problem, naming the variable, and exits 1. On success it writes
   `/var/www/html/config.json`.
7. `VELISTA_ANDROID_APP_LINKS` holds zero or more statements separated by spaces, each
   `<package>=<fingerprint>[,<fingerprint>...]`. Each package must match a Java package
   name and each fingerprint the SHA-256 form `([0-9A-F]{2}:){31}[0-9A-F]{2}`. Empty means
   no file: `/.well-known/assetlinks.json` answers 404 and App Links do not verify for that
   deployment. Otherwise the script writes the JSON array with one
   `delegate_permission/common.handle_all_urls` statement per package.
   `apps/velista-client/public/.well-known/assetlinks.json` is deleted from the repository.
8. `nginx.conf` holds no mount literal. The script renders the mount from
   `VELISTA_MOUNT_PATH`: the `map` line and the two mount locations live in snippets that
   it writes only when the mount is set, and that `nginx.conf` includes (a `map` block
   accepts `include`). With an empty mount, `/velista/en` is an ordinary route of the
   own origin and falls through to `index.html`. The two `sub_filter` directives stay as
   they are.
9. `unit.env` of velista loses `VELISTA_REALTIME_URL` and `VELISTA_APP_URL` from both
   `BUILD_ENV_*` lines. If backend `0242` is merged, the gateway key goes too, both lines
   are empty, and `units.mjs` adds `BUILD_ENV_STAGING` and `BUILD_ENV_PRODUCTION` to
   `MAY_BE_EMPTY` (the portfolio unit keeps its `MFE_BASE_URL`). If `0242` is not merged,
   the gateway key stays with a comment that names `0242` as the plan that removes it.
10. The velista chart passes the configuration. `common.apps` renders an optional `env`
    block per entry from a named template that each unit chart defines (the portfolio's
    renders nothing). The velista chart's template gives the client entry
    `VELISTA_GATEWAY_URL` and `VELISTA_REALTIME_URL` as `https://` plus `charts.host` of
    the routed service with role `gateway` and role `realtime`, `VELISTA_APP_URL` as
    `https://` plus `charts.host` of the client entry, and `VELISTA_MOUNT_PATH` and
    `VELISTA_ANDROID_APP_LINKS` from a new top level map `velistaClient` (`mountPath`,
    `androidAppLinks`, both `''` in `values.yaml`). No values file writes a client URL.
11. The owner's values reproduce today's behaviour. `values.production.yaml` sets
    `velistaClient.androidAppLinks` to `app.velista` with the release and Play keys and
    `values.staging.yaml` to `app.velista.staging` with the release key. Both set
    `velistaClient.mountPath: /velista` while the portfolio chart's `externalRoutes` entry
    exists, and leave it empty once k8s `0019` D7 option B or C has removed that entry. `values.homelab.yaml` needs no edit: its
    `hostOverrides` now reach the URLs too.
12. The gate compose files set the five variables on their velista service:
    `k8s/e2e/velista-stack/compose.yml` and, while the portfolio gate still pulls the
    velista image, `k8s/e2e/portfolio-frontend/compose.yml`, with the staging hosts and
    `VELISTA_MOUNT_PATH=/velista`. k8s `0020` sets the same five
    from `VELISTA_DOMAIN` in the Compose deploy file; this plan only states the contract.
13. Android identifiers have one place each. `capacitor.config.ts` reads `appId` from
    `VELISTA_ANDROID_APP_ID` with the default `app.velista`. `build-android.mjs` passes
    the same value to Gradle as `-PvelistaApplicationId`, and the host of the flavor's
    `VELISTA_APP_URL` as `-PvelistaAppLinkHost`. `build.gradle` reads both properties
    (defaults `app.velista` and `velista.app`), keeps `namespace = "app.velista"` and the
    `.staging` suffix, and no longer writes a host in a flavor. The script writes
    `dist/apps/velista-client/config.json` from the flavor's three URLs after `nx build`
    and before `cap sync`, through `apps/velista-client/scripts/write-runtime-config.mjs`,
    which also serves a local `serve-static` check.
14. `velista-api-hosts.spec.ts` loses the two tests that import the removed constants and
    keeps the tests that compare values files only (CORS origin, mail route, one domain).
    `velista-env-substitution.spec.ts` reflects that production substitutes only the
    version. `velista-asset-links.spec.ts` asserts the owner's statements in the two
    values files instead of the deleted file.
15. `CLAUDE.md` (Docker & CI/CD: velista's image is environment agnostic, the five
    variables) and `apps/velista-client/README.md` describe the runtime configuration.

### Scope

In: `apps/velista` (after `0003`, `apps/velista-client`): `webpack.prod.config.ts`,
`src/environments/environment.prod.ts`, `src/environments/environment.ts` (comments),
`src/main.ts`, `src/runtime-config.ts` and its spec (new), `src/app/app-providers.ts`
(two providers), `src/index.html`, `src/nginx.conf`, the entrypoint script (new, beside
`nginx.conf`, shipped as a build asset like it), `src/Dockerfile`, `ngsw-config.json`,
`project.json` (the asset entry for the script), `public/.well-known/assetlinks.json`
(deleted), `capacitor.config.ts`, `scripts/build-android.mjs`,
`scripts/write-runtime-config.mjs` (new), `android/app/build.gradle`, the specs named in
item 14, `velista-index-markup.spec.ts`, `README.md`. `apps/velista-client-e2e` (today
`apps/velista-e2e`): one new spec.
`k8s/helm/common/templates/_app.tpl`, `k8s/helm/velista/templates/_helpers.tpl`,
`k8s/helm/portfolio/templates/` (the empty env template), `k8s/helm/velista/values.yaml`,
`values.staging.yaml`, `values.production.yaml`. `k8s/units/velista/unit.env`,
`tools/deploy/units.mjs` and its test. `k8s/e2e/velista-stack/{compose.yml,gate.sh,gate.env,nginx.conf}`,
`k8s/e2e/portfolio-frontend/compose.yml`. `CLAUDE.md`.

Out: the admin app (backend `0242`). The server's `APP_BASE_URL`, mail links and CORS
origins (backend `0243` documents them). The Compose deploy file (k8s `0020`). The
portfolio chart's `externalRoutes` and the ReferenceGrant (k8s `0019`). The manifest
(nothing in it is deployment specific). The shell's `MFE_BASE_URL`. `tools/dev/ng-slot.sh`
(its keys stay; only `0003` renames them). iOS.

### Constraints

- No URL of the owner in the production bundle, the image, or a default in code. The
  owner's hosts live in his values files and in the Android flavor table only, which are
  deployment data like `values.production.yaml` (k8s backlog `0003` decides where that data
  lives later).
- The loader runs before `bootstrapApplication`. Nothing in Angular may read
  `environment.api` or `environment.appUrl` before it resolves. No `APP_INITIALIZER`: a
  provider or an environment initializer could still construct an API client first.
- Do not use `@angular/core/rxjs-interop` in the loader (CLAUDE.md). It has no Angular
  dependency at all: plain `fetch` and a mapper.
- `index.html` stays byte identical across deployments, so the hash in `ngsw.json` holds.
  Nothing rewrites it at start. The two `sub_filter` literals stay as they are.
- The entrypoint script is POSIX `sh` (the base image is Debian `nginx`), writes JSON only
  from validated values, and never echoes a value it refused in full if it could be a
  secret (none of the five is one, but keep the habit).
- `common.apps` stays generic. The velista chart owns which env the client gets; the
  template name each unit chart defines is the only coupling.
- Mapping from `unknown` with own models (rule D4): `config.json` is a wire document.
- Prettier per file, `--end-of-line auto`, never over a directory.

### Action boundaries

Stop and ask before: touching a cluster or running `helm upgrade` against one; changing
the Play Console, the Google Cloud project or the keystore (none is needed); adding an npm
or Gradle dependency; removing the gateway key from `BUILD_ENV_*` while backend `0242` is
unmerged; changing the portfolio chart's `externalRoutes` or the ReferenceGrant (k8s
`0019`); changing `namespace` in `build.gradle` or the Java package. Deleting the committed
`assetlinks.json` is in scope once item 11 carries its statements.

### Progress evidence

- Items 1 to 3, 14: `npx nx test velista-client` passes, including
  `runtime-config.spec.ts` with these cases: a valid file wins over a complete fallback; a
  404, a non JSON answer (the dev server's HTML fallback) and a file missing a key each
  fall back when the fallback is complete; each of them rejects naming the keys when the
  fallback is empty; a relative URL, a `javascript:` URL and a URL with a trailing slash
  (accepted and stripped). `npx nx build velista-client` succeeds, and
  `grep -rl "velista.app" dist/apps/velista-client` prints nothing.
- Item 3: a spec for `appProviders` resolves `APP_API_CONFIG` after a value is written into
  `environment.api` and gets the written value (the `useValue` trap stays closed).
- Item 4: `velista-index-markup.spec.ts` passes with a built `dist/apps/velista-client`.
  In a browser on the image, DevTools shows one request for `config.json` and no
  "preloaded but not used" warning.
- Items 5 to 8: build the image (`npx nx run velista-client:build:docker`), then:
  `docker run --rm <image>` exits 1 within seconds and prints the three missing names;
  `docker run` with the three URLs and `VELISTA_ANDROID_APP_LINKS=bad` exits 1;
  with valid values, `curl localhost:<port>/config.json` returns them,
  `/.well-known/assetlinks.json` returns 404 with links empty and the expected JSON with
  links set, `/velista/en` returns `<base href="/">` with no mount and
  `<base href="/velista/">` with `VELISTA_MOUNT_PATH=/velista`. Add these checks to
  `k8s/e2e/velista-stack/gate.sh` beside the 0165 D7 curls, so the staging gate runs them.
- Item 9: `node tools/deploy/units.mjs check` passes; `node --test tools/deploy/units.test.mjs`
  passes with a case for an empty `BUILD_ENV_*`.
- Items 10 and 11: `helm template velista k8s/helm/velista -f k8s/helm/velista/values.yaml
  -f k8s/helm/velista/values.staging.yaml` renders the client Deployment with
  `https://api.staging.velista.app`, `https://rt.staging.velista.app`,
  `https://staging.velista.app`, `/velista` and the staging statement; the same with
  `values.production.yaml` and with `values.homelab.yaml` gives their hosts.
  `bash k8s/bootstrap/provision-release.sh --check --unit velista --env staging` passes its
  render. The portfolio chart renders unchanged (`helm template` diff is empty).
- Item 12: `bash k8s/e2e/velista-stack/gate.sh velista-client-e2e,velista-stack-e2e` passes
  locally against an image built from the branch (`E2E_IMAGE_PREFIX`, `E2E_IMAGE_TAG`).
- The made up domain: a new spec in `velista-client-e2e`, `runtime-config.spec.ts`, runs against a
  second velista service in the gate compose, served by the gate proxy on
  `velista.example.test` with `VELISTA_GATEWAY_URL=https://api.example.test` and
  `VELISTA_REALTIME_URL=https://rt.example.test`. It stubs the gateway routes as the other
  suites do and asserts that the first `/health/ready` request goes to
  `https://api.example.test`. Add the host to `HOSTS` in `gate.env`, to the certs loop and
  to the proxy. The spec skips unless `VELISTA_ELSEWHERE_URL` is set, so a dev server run
  of the suite is unaffected.
- Item 13: `node apps/velista-client/scripts/build-android.mjs --flavor staging` builds;
  `android/app/src/main/assets/public/config.json` holds the staging URLs;
  `apksigner verify --print-certs` and `aapt dump badging` show package
  `app.velista.staging`; a build with `VELISTA_ANDROID_APP_ID=org.example.shop` shows
  `org.example.shop.staging`. The owner installs the staging APK and signs in (owner step).

## Decisions taken in this plan

- **D1. A fetched `config.json`, preloaded, and not a script inlined into `index.html`.**
  An inline `<script>` costs no request, but the image would rewrite `index.html` at start.
  That breaks the hash the service worker checks for `/index.html` in `ngsw.json`, so the
  script would also have to recompute and patch `ngsw.json`, and an installed app would
  see a config change only one load later. It also breaks the "no `<script>`" rule of the
  markup spec and would need a hash or nonce under any future content security policy. A
  JSON file leaves `index.html` identical in every image, works the same way in the
  Android bundle (the build writes the file), and gets the right cache rule from a
  `freshness` data group. Its cost is one request on the critical path; the `preload`
  link starts it with the document, in parallel with `main.js`, so the fetch in `main.ts`
  normally finds it already answered.
- **D2. The image refuses to start, and does not serve a "not configured" page.** It is
  what the server does for a missing `*_DB_URL`: the Joi schema stops the process at boot.
  A pod that exits fails `helm upgrade --wait` and `--atomic` in staging, and a Compose
  `up` shows the message in the log. A page that says "not configured" would pass every
  health check and reach users. The plain sentence in `main.ts` remains for one case
  only: a production bundle served outside its image.
- **D3. `assetlinks.json` is generated at start from one variable.** Mounting the owner's
  file needs a volume or a ConfigMap per deployment and leaves an image that serves
  nothing useful without it; generation keeps one image and one environment variable.
  One variable of per package statements, and not two lists (`ANDROID_PACKAGE_NAMES`,
  `ANDROID_CERT_FINGERPRINTS`): two lists form a cross product, and the staging package
  would then trust the Play signing key, which it does not today. Each cluster now serves
  only the package that verifies against its host, which is what `appLinkHost` already
  says.
- **D4. The mount is a variable, empty by default.** A self hoster has no portfolio. The
  route factory and `document-mount.ts` already accept any mount, so only `nginx.conf`
  changes. The owner's values keep `/velista` while the portfolio route exists, which
  k8s `0019` D7 decides.
- **D5. One prefix for the five variables (`VELISTA_*`).** The names read the same in the
  chart, Compose, `.env` and the Android build. The generic names `APP_MOUNT_PATH` and
  `ANDROID_PACKAGE_NAMES` would collide with nothing in this image, but a single prefix
  makes a Compose file with several services readable.
- **D6. The chart derives the URLs; no values file writes one.** `charts.host` already knows
  every host, including `hostOverrides`. A second copy of the hosts in values is the drift
  that `velista-api-hosts.spec.ts` was written to catch (velista `0014` section 1.2). A
  top level `velistaClient` map holds the two plain values because Helm replaces the
  `apps` list on merge.
- **D7. The Android build stays per deployment.** An APK carries a package name, a signing
  key, a WebView hostname and an App Link host; it cannot be one artifact for every
  deployment. It gets one place for each identifier instead (item 13), and its
  `config.json` comes from the same flavor hosts the script already holds.
- **D8. No server change for the Google client id.** The nonce answer already carries it
  (velista `0177`, backend `0238`). A `GET /v1/client/config` route is not needed by this
  plan; if backend `0243` wants one for third party clients, it is that plan's design.

## Owner decisions

- **Fetch versus inline** (D1). Recommendation: the preloaded `config.json`.
- **Refusal versus a "not configured" page** (D2). Recommendation: refusal.
- **Generation versus a mounted `assetlinks.json`** (D3). Recommendation: generation from
  `VELISTA_ANDROID_APP_LINKS`, with each cluster serving its own package only. If you
  prefer both clusters to keep serving both packages, set the same value in both files.
- **The mount's future.** k8s `0019` D7 owns it and offers three options: A keeps the
  mount (the portfolio route follows the namespace rename, and docs `0005` then needs
  `PEER_NAMESPACES` because the route crosses two repositories), B replaces it with a 301
  redirect from the portfolio host to the velista host in a portfolio pull request before
  the cutover, C drops it. k8s `0019` recommends B, and this plan follows that
  recommendation: under B or C the owner's values leave `velistaClient.mountPath` empty.
  This plan works with any of the three answers, because the variable stays.
- **The variable names** (D5). Recommendation: `VELISTA_*` for all five.

## Owner steps outside the code

- None in the Play Console or Google Cloud: the package names, the signing keys and the
  Android OAuth clients stay as they are, and each host serves the same statement for its
  own package as today.
- After the first staging deploy with this plan, open
  `https://staging.velista.app/.well-known/assetlinks.json` and run
  `adb shell pm get-app-links app.velista.staging` on a phone with the staging APK; after
  the first production deploy, the same for `velista.app` and `app.velista`. Both should
  report the host as verified.
