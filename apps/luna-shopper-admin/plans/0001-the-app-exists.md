# 0001 The app exists

`luna-shopper-admin` is a new Angular application: the back office for the luna-shopper backend.
This plan creates it, wires it into everything a deployable app in this workspace has to be wired
into, and stops. It renders one page saying which environment it is talking to, and nothing else.

**It is not a micro-frontend.** No module federation config, no `remote-entry`, no exposed
`./Routes`, and no entry in the shell's `remotes` list. The shell does not know it exists and must
not learn.

## 1. The name, and why it is not `velista-admin`

The back office administers **luna-shopper**, the backend. velista is one interface consuming that
backend, and there could be twenty more. An admin tool named after one consumer would be named
after the wrong thing.

So the project is `luna-shopper-admin`, its libraries live under `libs/luna-shopper-admin/*` as a
new scope, and its image is `nx-portfolio/luna-shopper-admin`.

The **host is still `admin.velista.app`**, which is the one place the naming does not follow. That
record already exists and the domain is the one the operator will type. It is a deliberate mismatch
between the project name and the hostname, recorded here so nobody later "fixes" one to match the
other.

## 2. It renders on its own origin

Every other remote in this workspace has an empty `RemoteEntry` template and shows a blank page on
its own port, on purpose, because a remote without the shell's global styles renders differently
from production.

None of that applies. This app is served from its own origin, draws all of its own chrome, borrows
nothing from the shell, and is never mounted anywhere. So it follows velista's standalone shape:
`AppRoot` with a real `<router-outlet>`, routes from `app.routes.ts`, no mount path, and no
`appRootRoute(mount)` factory because there is only one mode to serve.

## 3. Locale is not in the URL

velista and the four remotes route as `/{mount}/{locale}/{rest}` and install `localeGuard`. This
app does neither.

The only thing the locale segment buys is a shareable URL that opens in a stated language, and
there is nothing here to share: one operator, one browser, no links sent to anyone. The cost of
carrying it is a guard, a route table shaped around it, and a redirect on every cold load.

So: **no `:locale` segment, no `localeGuard`, and no `APP_BASE_PATH`.** The chosen locale lives in
`localStorage` and is changed inside the app, if a second locale is ever added.

**Strings are still keyed.** `provideRokuTranslator` with a single `en` namespace per library,
`TranslationSource` descriptors composed in `apps/luna-shopper-admin/src/app/translation-providers.ts`
exactly as the other apps do it. English is the only locale that exists and hard coding the text
would cost almost nothing today and a rewrite later, so the keys go in from the first component.

Note that the testing translator does not interpolate, so specs assert on component inputs rather
than rendered text for any `{{interpolated}}` string.

## 4. What it does not need

- **No service worker and no PWA.** `provideServiceWorker` appears nowhere. It is an internal tool
  on a desktop and a phone browser, not something anybody installs.
- **No realtime.** Harvest run progress is polled (`plans/0006`), which is what backlog `0001`
  section 6.6 already settled as phase one. No socket, no `LUNA_REALTIME_URL`.
- **No shell, no module federation, no `MFE_BASE_URL` or `MFE_REMOTE_URLS`.**

And one thing it may do that the remotes may not: **`@angular/core/rxjs-interop` is allowed here.**
The `NG0203` hazard is specific to a secondary entry point being bundled once per remote under
module federation. This app is not federated and holds its own injector, so `toSignal` and
`takeUntilDestroyed` behave normally.

## 5. Project wiring

**`apps/luna-shopper-admin/project.json`**, mirroring velista's:

- `build` with `@nx/angular:webpack-browser`, output `dist/apps/luna-shopper-admin`, a
  `customWebpackConfig`, `production` and `development` configurations, budgets.
- `serve` on **port 4206**.
- `build:docker` with `"executor": "@portfolio/docker:build"`, `dependsOn: ["build"]`,
  `imageName: "nx-portfolio/luna-shopper-admin"`, `forwardEnv: ["BUILDER_TAG"]`, and
  `"context": "dist"`, with the same `development` and `production` configurations every other app
  has.
- `lint`, `test`.
- **No `dependsOn: ['shell:serve']`.** velista, damoclesSword and landingV2 carry it so that
  serving a remote also boots its host. This app has no host.

**`apps/luna-shopper-admin/src/Dockerfile`**, copied from velista's: no build stage, `FROM
${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}`, `COPY . /var/www/html/`. The
bundle is built once outside by `nx build` and arrives as the whole context.

**`tsconfig`**: the leaf tsconfig must include `types/**/*.d.ts`, or asset imports do not typecheck.
Every project in this workspace needs it and a new one is where it gets forgotten.

**Assets**: any SVG is inlined with `import('./x.svg?raw')` and `DomSanitizer`. Importing an SVG for
its URL breaks the production build. Before adding an icon, check `libs/shared/ui`, which already
holds a set of them as standalone components, and export an existing one rather than adding a
second copy of the same glyph.

## 6. The environment colour comes from the server

Development, staging and production each render the app in a different accent colour, so an
operator cannot mistake which database they are about to write to.

**The colour is derived from what the API reports, not from a build time constant.** This is the
whole point of the feature: the failure being guarded against is believing you are in staging when
you are in production, and a compile time value is exactly what is wrong in that scenario, whether
from a stale cache, a mis tagged image, or a bundle served from the wrong host. A colour that comes
from `GET /v1/admin/auth/me` always matches the backend actually being talked to and cannot lie
about it.

The environment name also goes in the document `<title>`, so it appears in the browser tab and in
any screenshot pasted into a bug report.

Until `0002` there is no token and no `me` call, so this plan renders the colour from the
unauthenticated part of the same response, or from a small public `GET /v1/admin/environment`. The
one thing it may not do is read it from `environment.ts`.

## 7. The gateway URL, and why this image is environment specific

The app talks to the same gateway as velista, on different routes. It needs `LUNA_GATEWAY_URL`, and
it gets it the way velista does: a `DefinePlugin` in `webpack.prod.config.ts` reading
`process.env.LUNA_GATEWAY_URL` at build time, with a default of `https://api.velista.app`.

That makes this the **second** image in the workspace that is not environment agnostic, and both CI
workflows need a line for it beside velista's:

- `.github/workflows/docker-ci.yml` already defines `STAGING_LUNA_GATEWAY_URL` and passes it with
  `docker run -e` on the builder container. The admin build needs the same.
- `.github/workflows/release.yml` does the same with `PROD_LUNA_GATEWAY_URL`.

It needs no `LUNA_REALTIME_URL`, per section 4.

## 8. Deployment

- **`k8s/helm/values.yaml`**, one new entry under `apps`:
  `name: luna-shopper-admin`, `image: ghcr.io/ichirokuxvi/nx-portfolio/luna-shopper-admin`,
  `hostPrefix: admin`, `path: /`. `path: /` emits no rewrite filter, which is what a host root
  wants.
- **`hostOverrides`** in both `values.production.yaml` and `values.staging.yaml`, putting it on
  `admin.velista.app` and `admin.staging.velista.app`, since it belongs on velista's domain rather
  than under `baseDomain` like the portfolio apps.
- **`corsOrigins`** in both environment values files gains the new origin. It currently lists two
  per environment and will list three.
- **DNS is already created** for the production name. Staging needs its own A record: a wildcard on
  `*.velista.app` does not cover it and `values.staging.yaml` says so explicitly. cert-manager
  cannot solve an HTTP-01 challenge for a name that does not resolve, so the record has to exist
  before the first deploy of this entry.

The app is **public**. Restricting it at the `HTTPRoute` was considered and parked in
`k8s/plans/backlog/0001`.

## 9. Serving it locally

`tools/dev/ng-slot.sh` and its `.ps1` twin know five apps by name and must learn a sixth:

- `APPS=(shell odontogram damoclesSword landingV2 velista luna-shopper-admin)`
- `DEFAULT_PORT[luna-shopper-admin]=4206`
- `SLOT_OFFSET[luna-shopper-admin]=6`, so slot 1 serves it on 42006

Because it has no shell dependency, `ng-slot.sh --up --apps luna-shopper-admin` must start it
alone, without booting the shell or any remote. That is the normal way to work on this app, and it
is roughly a gigabyte of RAM rather than the three or four a full front end slot costs.

It needs a backend, and it shares one like everything else: `--backend-slot <n>` points it at a
luna slot that is already listening rather than starting a seventh Nest service set.

Do not add a port override to `project.json` to dodge a collision. Use a slot.

## 10. Exit criteria

- `npx nx build luna-shopper-admin` and `npx nx run luna-shopper-admin:build:docker` both succeed.
- `npx nx lint luna-shopper-admin` and `npx nx test luna-shopper-admin` pass.
- `ng-slot.sh --up --apps luna-shopper-admin` serves it on 4206 (slot 0) without starting the shell.
- The page renders its environment name and colour, sourced from the API.
- `helm template` with each environment values file renders the new app, its host and its route.
- `provision-release.sh --check` passes for both environments.

## 11. Out of scope

- Logging in: `0002`.
- Keeping a session alive: `0003`.
- Any list, form or entity screen: `0004` onward.
