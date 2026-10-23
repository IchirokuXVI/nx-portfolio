> **PR:** [#809](https://github.com/IchirokuXVI/nx-portfolio/pull/809)

# 0165: velista leaves the shell

> Asked for by the owner on 2026-10-23: "velista needs to be separated from my portfolio
> app (still kept in the monorepo, it won't be a remote anymore and it will still live at
> ichirokuxvi.com/velista and velista.app). For local development, it won't be available by
> compiling the shell, domain.tld/velista only applies for ichirokuxvi.com, not for local
> development."
>
> This plan supersedes decision D5 of `0013` (a redirect from the portfolio to the new
> origin). The owner's words today are that velista still lives at both addresses, so the
> gateway serves it at both. Section 3 D1 records the alternative so he can overrule it.
>
> Prerequisite reading: `0013` (the own origin, the one route factory, the service worker
> split), `apps/shell/plans/0002-retire-the-landing-remote.md` (the precedent for taking a
> remote out of the shell), `apps/shell/plans/0003-app-owned-locale-routing.md` (why the
> mount reaches the locale guard through route `data`), `k8s/plans/0007` (the bundle is
> built outside Docker) and the `Docker & CI/CD` section of `CLAUDE.md`.

## Brief for the agent

### Objective

Turn velista into a plain standalone Angular app in this monorepo. The shell no longer
declares it as a remote and no longer routes `/velista`. In both clusters the Gateway
serves velista's own image at `ichirokuxvi.com/velista` (one label down in staging) and at
`velista.app`. In local development velista is served on its own port only, and the shell's
`/velista` is the landing page's not found page.

Use the `nx-portfolio-angular-developer` skill for the Angular work and `antislop` with
`antislop-code` for every comment you write or rewrite.

### Context

Every statement below was read on `dev` at `63f740d8`.

- **velista is already dual mode.** `apps/velista/src/app/app-root-route.ts` exports
  `appRootRoute(mount)`. `app.routes.ts` calls it with `''` for the own origin and
  `remote-entry/entry.routes.ts` calls it with `'/velista'` for the shell. `main.ts` does
  `import('./bootstrap')`, the module federation convention, and `bootstrap.ts`
  bootstraps `AppRoot` with `appConfig`. `app.config.ts` holds the router and the service
  worker registration (`enabled: !isDevMode()`).
- **The remote wiring** is `apps/velista/module-federation.config.ts` (exposes
  `./Routes`), `withModuleFederation(...)` in `apps/velista/webpack.config.ts` and
  `webpack.prod.config.ts`, the `velista/Routes` alias in `tsconfig.base.json` (line 137),
  `'velista'` in `remotes` of `apps/shell/module-federation.config.ts`, `REMOTE_NAMES` in
  `apps/shell/remote-urls.ts`, the `path: 'velista'` entry of
  `apps/shell/src/app/app.routes.ts`, and `serve.dependsOn: ['shell:serve']` in
  `apps/velista/project.json`.
- **The mount is read in about 80 files of `libs/velista`** as `APP_BASE_PATH`
  (`_basePath`), to build in-app URLs, redirects and guards. `install-page.ts` line 95
  treats `_basePath !== ''` as "mounted under the portfolio" and offers the own origin
  (`APP_STANDALONE_ORIGIN`, which is `environment.appUrl`). `share-sheet.ts` lines 245 to
  257 build the share link from `APP_STANDALONE_ORIGIN` and fall back to
  `window.location.origin`. `impersonation-session.ts` line 270 builds a document URL
  from the base path. None of this changes meaning in this plan: see D3.
- **How `ichirokuxvi.com/velista` works today.** The shell's HTTPRoute (`path: /` on the
  portfolio host) serves the shell's `index.html` for every path. The shell router lazy
  loads `velista/Routes`, whose `remoteEntry.mjs` it fetches from `https://velista.app`
  because the workflows bake `MFE_REMOTE_URLS=velista=https://velista.app` into the shell
  build. There is no Gateway match for `/velista` on the portfolio host.
- **The chart already knows how to mount an app under a path.**
  `k8s/helm/templates/gateway/httproute.yaml.tpl` renders one HTTPRoute per `apps`
  entry, with a `PathPrefix` match on `.path` and a `URLRewrite` `ReplacePrefixMatch: /`
  whenever `.path` is not `/`. The three remaining remotes use it under `mfe.<domain>`.
  `charts.host` in `_helpers.tpl` composes a host from `hostPrefix` and `baseDomain`,
  with `hostOverrides` and an explicit `host` above it.
- **CI.** `.github/workflows/docker-ci.yml` builds the affected apps inside the builder
  container with `-e MFE_BASE_URL`, `-e MFE_REMOTE_URLS="$STAGING_MFE_REMOTE_URLS"`
  (`velista=https://staging.velista.app`), the two Luna URLs and `VELISTA_APP_VERSION`.
  The `e2e-frontend` job runs `k8s/e2e/portfolio-frontend/compose.yml` behind an nginx
  reverse proxy (`k8s/e2e/portfolio-frontend/nginx.conf`), adds
  `staging.ichirokuxvi.com mfe.staging.ichirokuxvi.com staging.velista.app` to
  `/etc/hosts`, asserts that each `remoteEntry.mjs` is reachable (including
  `https://staging.velista.app/remoteEntry.mjs`, lines 478 to 483) and runs the affected
  e2e projects with `E2E_BASE_URL=https://staging.ichirokuxvi.com`. The
  `e2e-velista-luna` job already reaches velista at `VELISTA_BASE_URL=https://staging.velista.app`.
  `.github/workflows/release.yml` does the same build with
  `PROD_MFE_REMOTE_URLS: velista=https://velista.app`.
- **e2e projects.** `apps/velista-e2e` (Playwright) reads `BASE_URL || E2E_BASE_URL ||
  http://localhost:4200`, starts `nx serve shell` as its web server, and its specs visit
  `/velista/en`, `/velista/es`, `/velista/en/auth/login` (`landing.spec.ts`,
  `mount.spec.ts`, `startup-gate.spec.ts`). `apps/shell-e2e/src/e2e/locale-redirect.cy.ts`
  lists `'velista'` in `APP_MOUNTS`. `apps/velista-luna-e2e` reads `VELISTA_BASE_URL`
  and contains no `/velista/` URL.
- **The landing links to velista through the shell router.**
  `libs/landing-v2/data-access/src/lib/project/projects-memory.ts` lines 70 to 73 build
  `appLink` as `/${appSlug}/${locale}` and `project-card.html` line 64 and
  `detail-page-shell.html` line 23 render it with `[routerLink]`. `projects-memory.spec.ts`
  lines 75 to 83 pin `/velista/en`. The copy in `libs/landing-v2/ui/assets/i18n/en.json`
  lines 101 and 103 (and the Spanish equivalents) says "The same build runs on its own
  origin and as a micro-frontend inside this site."
- **Dev tooling.** `tools/dev/ng-slot.sh` writes `apps/shell/.env` with a
  `MFE_REMOTE_URLS` that names velista (line 638), serves the shell with
  `--skipRemotes "odontogram,damoclesSword,landingV2,velista"` (line 776), exports
  `NG_VELISTA_URL` and `E2E_BASE_URL` (the shell) in the slot descriptor (lines 617 to
  620) and prints velista as "own origin" (line 673). `tools/dev/README.md` documents it.
  `k8s/e2e/luna-shopper-backend/luna-slot.sh` and `compose.apps.yml` allow the shell
  origin in `CORS_ORIGINS` with a comment that says the shell mounts velista as a remote.
- **The shared nginx config** `apps/docker/local-http-server/src/nginx-static-app.conf`
  explains the `remoteEntry.mjs` no cache rule with velista and the shell as the example
  (lines 26 to 47). The three remaining remotes still emit that file, so the rule stays.
- **`module-federation.shared.ts`** says "all five configuration files import it". After
  this plan four do (the shell and three remotes). `luna-shopper-admin` has no module
  federation config.

### Target state

- `nx build velista` produces a plain Angular bundle with no `remoteEntry.mjs` and no
  `mf-manifest.json`. `nx build shell` lists three remotes.
- `http://localhost:4205/en/home` renders velista. `http://localhost:4200/velista/en`
  renders the landing's not found page.
- In a cluster, `https://<portfolio host>/velista/en/home` and
  `https://<velista host>/en/home` both render velista from the velista deployment. The
  first registers no service worker and offers no install. The second is unchanged.
- The e2e-frontend gate proves the portfolio path from the compose stack, and velista-e2e
  runs against velista's own origin.
- Every file that said velista is a remote says what is true now.

### Scope

Two work packages, one pull request. Package A owns the application code, package B owns
the cluster, the gates, the scripts and the documentation. The file lists are in section 4.
Neither package edits a file that the other owns. The plan file itself is committed by
package A.

### Constraints

- No new dependency. Keep `@nx/angular:webpack-browser` and the custom webpack configs
  (the `?raw` SVG rule, the `DefinePlugin`). Do not move velista to the esbuild
  application builder in this plan.
- Keep `appRootRoute(mount)`, its spec and the meaning of `APP_BASE_PATH`. See D3.
- Do not add a port override to any `project.json`. Do not edit `package-lock.json`.
- Comments and prose in files use no dashes as punctuation.
- Only make the changes this plan names. A file that mentions the remote and is not in
  section 4 is edited only to stop it saying something false.

### Action boundaries

- Proceed with every edit, build, test and e2e run in the worktree.
- Stop and report before deleting any file not named in section 4, before adding a
  dependency, and before any change to the Luna backend or its database.

### Progress evidence

Report when a package is complete, with the output of the commands in section 5. Ground
each completion claim in a tool result.

## 1. Purpose

velista is a product with its own domain. The shell still composes it as a remote, which
costs a shared singleton rule, a `remoteEntry.mjs` that the shell fetches cross origin, a
`dependsOn` that boots the shell for every `nx serve velista`, a `MFE_REMOTE_URLS` entry in
two workflows and a locale guard that runs under two mounts. The owner wants the coupling
gone and both addresses kept.

## 2. What stays true

- velista stays in the monorepo, under `apps/velista` and `libs/velista`.
- `velista.app` and `staging.velista.app` serve the app exactly as today, service worker
  and manifest included.
- `ichirokuxvi.com/velista` and `staging.ichirokuxvi.com/velista` keep serving the app.
  What changes is who serves the document: the velista pod through the Gateway, not the
  shell through module federation.
- The Luna backend and its `CORS_ORIGINS` do not change. The portfolio origin stays in the
  list because the app under `/velista` still calls the API from that origin.
- Sessions, storage and installs stay per origin, as they are today.

## 3. Decisions

### D1. The Gateway serves velista under the portfolio path. No redirect.

`0013` D5 planned a redirect from `/velista` to the own origin, to avoid two sessions on two
origins. The owner said today that velista still lives at both addresses, and the two
origin state is what exists today, so this plan keeps it and changes only the server of
the document.

**For the owner to overrule:** a redirect is one `RequestRedirect` filter in the same
HTTPRoute and would delete D2, D3 and D4 from the app. If he prefers the redirect, say so
and the rest of this plan still holds.

### D2. velista's own nginx serves the portfolio path, and the document arrives with its base

The HTTPRoute for the portfolio mount matches `/velista` and forwards the request with the
prefix kept (`keepPrefix: true` on the mount, D6). The pod's nginx owns the prefix. A
`location ^~ /velista/` rewrites the request to the file it names, so `/velista/main.<hash>.js`
becomes `/main.<hash>.js`, and the usual fallback serves `index.html` for a route. The document
must then say where it is, so nginx rewrites two tags on the way out with `sub_filter`, and
only for a request that carried the prefix: `<base href="/" />` becomes `<base href="/velista/" />`,
and the manifest link is removed. A request on the own origin passes through with neither
change. `$request_uri` decides, because it is the URI as the request arrived, before the
rewrite.

Why the server and not a script in the document. A script that changes the `<base>` element
runs after the browser's preload scanner has read the markup. The scanner requests
`main.<hash>.js` against the original base, which under the portfolio is the shell's root, and
every cold load costs two 404 requests to the shell before the real loads start. A document
that arrives with the right base has no race, and the manifest link is gone before anything
can fetch it.

Why the manifest link goes. `manifest.webmanifest` says `scope: "/"` and `start_url: "/"`,
which resolve against the manifest URL. Under the portfolio that is the portfolio's root, and
a browser that offered to install "velista" from that page would install a shortcut to the
portfolio.

The config is `apps/velista/src/nginx.conf`, a copy of the shared `nginx-static-app.conf` plus
the location and the two filters. It travels in the bundle as a build asset, because the
docker context is `dist/apps/velista` and nothing else, and the Dockerfile moves it into place.
A change to the shared file is mirrored here by hand; the file says so at the top.
`velista-index-markup.spec.ts` asserts that the two literals the filters match appear in the
built `index.html` exactly once each, so a change in how Angular writes the tags fails a test
and not a deploy.

One consequence is deliberate: `velista.app/velista/en` also works, as a mounted copy with no
worker, because the rewrite keys on the path and not on the host. Nobody is given that URL and
nothing depends on it.

### D3. The app keeps `APP_BASE_HREF` at `/` and reads its mount from the document

Angular's `Location` reads the `<base>` element unless `APP_BASE_HREF` is provided. If it
read `/velista/` it would strip the prefix from every router URL, the route table would
have to mount at `''` under the portfolio, and the 80 files that build URLs from
`APP_BASE_PATH` would each need a second source of truth for document level navigations.

So `app.config.ts` provides `{ provide: APP_BASE_HREF, useValue: '/' }`, and the route
table becomes `[appRootRoute(documentMount())]`, where `documentMount()` is a small pure
function in `apps/velista/src/app/document-mount.ts` that reads the `<base>` element's
`href` and returns `'/velista'` for `/velista/` and `''` for `/`. The router then sees
`/velista/en/home` under the portfolio and `/en/home` on the own origin, exactly the two
cases `appRootRoute` already handles, and `APP_BASE_PATH`, `data.mountPath`, the locale
guard, `install-page.ts`, `share-sheet.ts` and `impersonation-session.ts` keep their
meaning without an edit. `app-root-route.spec.ts` keeps both mounts. `document-mount.spec.ts`
covers the two values and a missing `<base>` (which returns `''`).

`remote-entry/entry.routes.ts` and its spec are deleted. The mount is now a runtime fact of
the document, not a build.

### D4. No service worker under the portfolio

`ngsw.json` lists its files from the root of the build (`/main.<hash>.js`), and a worker
registered from `ichirokuxvi.com/velista/ngsw-worker.js` would resolve them against the
portfolio's root and fail its first manifest check. The registration becomes
`enabled: !isDevMode() && documentMount() === ''`, next to the existing comment in
`app.config.ts`, which gains the reason. `0013` D4 (register in `app.config.ts` only) still
holds and is now the only reason the file exists apart from the router.

### D5. The bootstrap collapses into `main.ts`

The `import('./bootstrap')` boundary existed so module federation could negotiate shared
modules before the app ran. `main.ts` now bootstraps `AppRoot` with `appConfig` directly
and `bootstrap.ts` is deleted. `velista-env-substitution.spec.ts`, `velista-bundle.spec.ts`
and `velista-api-hosts.spec.ts` keep passing; `velista-bundle.spec.ts` is the one most
likely to name a chunk file and must be read before the build is judged.

### D6. The chart gains `mounts` on an `apps` entry

An entry may carry an optional `mounts` list. Each mount is `{ name, hostPrefix, path }`
and renders one more HTTPRoute, named `<entry name>-<mount name>`, on the host that
`charts.host` composes for the mount (so `hostPrefix: ''` is the portfolio root in both
clusters, and `hostOverrides` applies by the mount's `name` if an environment ever needs
it). The route uses the same `PathPrefix` match and the same `backendRefs` as the
entry's own route, and the same `URLRewrite` unless the mount keeps its prefix. The velista entry in `values.yaml` gets:

```yaml
mounts:
  - name: portfolio
    hostPrefix: ''
    path: /velista
    keepPrefix: true
```

A mount may set `keepPrefix: true`, and the route then emits no `URLRewrite` filter. The
velista mount does, because its pod owns the prefix (D2). Other mounts strip by default, like
the entry routes.

Gateway API ranks a longer path prefix above `/`, so the shell's route on the same host
never sees `/velista`. The portfolio host already has its HTTPS listener and certificate.
The local values files (`values.local.yaml`, `values.localhost.yaml`,
`values.localhost-mfe.yaml`) have no velista entry and stay that way: the owner said the
portfolio path is a cluster fact, not a development one. `values.homelab.yaml` inherits the
entry and gains `<domain>/velista` for free.

`helm template` with `values.staging.yaml` must render the new route, and
`provision-release.sh --check` must still pass its render.

### D7. The compose gate proves the portfolio path with a request, not a browser

`k8s/e2e/portfolio-frontend/nginx.conf` gains, in the `staging.ichirokuxvi.com` server
block, a `location /velista/` and a `location = /velista`. The two locations proxy to
`http://velista:80` with the path kept, which is what the HTTPRoute does.
The `e2e-frontend` job replaces its `https://staging.velista.app/remoteEntry.mjs` check with
two curls: `https://staging.ichirokuxvi.com/velista/en` must answer 200 with a body that
contains `app-velista-root`, and the first `src="..."` of that body, resolved under
`/velista/`, must answer 200 with a JavaScript content type. The curls also assert the
rewritten base and the absent manifest link under the portfolio, and the untouched pair on
the own origin. That is the whole contract of D2 tested from outside the image. The `remoteEntry.mjs` loop keeps the other three remotes.

### D8. velista-e2e runs against velista's own origin

`apps/velista-e2e/playwright.config.ts` reads `VELISTA_BASE_URL || http://localhost:4205`,
the same variable `velista-luna-e2e` reads, and its web server becomes `nx serve velista`
waiting on port 4205. Every `/velista/<locale>` in its specs loses the prefix.
`mount.spec.ts` keeps asserting that the own origin corrects a bare `/` and a wrong first
segment to a locale. The `e2e-frontend` job passes `VELISTA_BASE_URL: https://staging.velista.app`
beside `E2E_BASE_URL`. `tools/dev/ng-slot.sh` exports `VELISTA_BASE_URL` in the slot
descriptor beside `NG_VELISTA_URL`, with the same value. `shell-e2e` drops `'velista'` from
`APP_MOUNTS`, because the shell no longer owns that mount.

### D9. The landing opens velista with a document navigation

The shell router has no `/velista` route any more, so a `routerLink` to `/velista/en` would
render the landing's not found page. The `Project` model gains a way to say that a link
leaves the shell: `projects-memory.ts` marks velista's `appLink` as external, and
`project-card.html` and `detail-page-shell.html` render an external link as a plain
`<a [href]>` (same tab, no `target`), and every other project as the `routerLink` it is
today. The URL stays `/velista/<locale>`: it is environment agnostic, it works in both
clusters through D6, and in local development it is the landing's not found page, which is
the behaviour the owner described. `projects-memory.spec.ts` asserts both the URL and the
external flag.

The two copy keys that say "as a micro-frontend inside this site" (`en.json` lines 101 and
103, and the Spanish equivalents) change to say that the same build runs on its own origin
and that the portfolio's gateway serves it under `/velista`. Keep the sentence length and
tone of the surrounding copy. No other landing text changes.

### D10. The slot scripts serve velista alone

`ng-slot.sh` removes `velista=...` from the `MFE_REMOTE_URLS` it writes into
`apps/shell/.env`, removes `velista` from `--skipRemotes`, and keeps velista in `APPS`, its
port, its `DERIVED_KEYS` and its `.env`. `apps/velista/project.json` loses
`serve.dependsOn`, so the `--excludeTaskDependencies` that defeats it is no longer needed
for velista but stays for the two apps that still carry it. `tools/dev/README.md` says that
`nx e2e velista-e2e` reads `VELISTA_BASE_URL` and that `/velista` under the slot's shell is
a not found page. `luna-slot.sh` and `compose.apps.yml` keep the shell origin in
`CORS_ORIGINS`; their comments stop saying the shell mounts velista as a remote and say
instead that the app under the portfolio path calls the API from the portfolio origin.

### D11. One pull request, one rollout window

The shell, velista and landingV2 are all affected, so staging rebuilds and restarts all
three. Between the new velista rolling out and the new shell rolling out, the old shell
asks `staging.velista.app/remoteEntry.mjs` for a file that no longer exists, and `/velista`
on the portfolio is broken for the length of one rollout. The Helm upgrade applies the new
HTTPRoute before the restarts, so the moment the new shell is up the path answers through
the gateway. Production builds every app at the release and has the same window. No
mitigation is built for a window of about a minute; it is recorded here as a known cost.

### D12. The title and the header

The pull request title is
`feat(velista)!: velista leaves the shell, the gateway serves it at /velista (plan 0165)`.
It is breaking because the deployment topology of three apps changes. After `gh pr create`
returns, package A writes the `> **PR:**` header above the title of this file and pushes.

## 4. Who edits what

### Package A: application code

| Path | Change |
| --- | --- |
| `apps/velista/plans/0165-velista-leaves-the-shell.md` | this file, copied in verbatim |
| `apps/velista/module-federation.config.ts` | delete |
| `apps/velista/webpack.config.ts`, `webpack.prod.config.ts` | drop `withModuleFederation` and the `mfeConfig` import; keep `composePlugins`, the `DefinePlugin` and the three asset rules; rewrite the comments that explain them in module federation terms |
| `apps/velista/src/main.ts` | bootstrap directly (D5) |
| `apps/velista/src/bootstrap.ts` | delete |
| `apps/velista/src/app/remote-entry/` | delete both files |
| `apps/velista/src/app/document-mount.ts` and its spec | new (D3) |
| `apps/velista/src/app/app.routes.ts` | `[appRootRoute(documentMount())]` |
| `apps/velista/src/app/app.config.ts` | `APP_BASE_HREF`, the service worker condition (D3, D4), comments |
| `apps/velista/src/app/app-root-route.ts` | the comment stops saying the shell lazy loads the route; the factory and its spec keep both mounts |
| `apps/velista/src/index.html` | the comment on the manifest link (D2), the comment that says the shell's document ships the viewport attribute goes |
| `apps/velista/src/nginx.conf` | new: the shared static config plus the `/velista` location and the two filters (D2) |
| `apps/velista/src/Dockerfile` | installs `nginx.conf` from the bundle (D2) |
| `apps/velista/src/app/velista-index-markup.spec.ts` | new: the filtered literals against the built `index.html` (D2) |
| `apps/velista/project.json` | remove `serve.dependsOn`; `nginx.conf` as a build asset (D2) |
| `apps/velista/src/app/*.spec.ts` that name the remote | update text or expectations only as the build requires |
| `apps/shell/module-federation.config.ts` | drop `'velista'` |
| `apps/shell/remote-urls.ts` | drop velista from `REMOTE_NAMES` and the two comments |
| `apps/shell/webpack.config.ts`, `webpack.prod.config.ts` | comments only |
| `apps/shell/src/app/app.routes.ts` | drop the `velista` entry and the comment that names `/velista` |
| `apps/shell/src/index.html` | the comment on the viewport attribute no longer cites velista's mounted build |
| `apps/shell/CASE_STUDY.md` | the sentences that say velista is a remote |
| `tsconfig.base.json` | drop `velista/Routes` only |
| `module-federation.shared.ts` | "five configuration files" becomes four, and the comment stops counting velista |
| `apps/docker/local-http-server/src/nginx-static-app.conf` | the `remoteEntry.mjs` comment names a remaining remote instead of velista |
| `libs/landing-v2/data-access/src/lib/project/projects-memory.ts`, its spec, the `Project` model, `project-card.html`, `detail-page-shell.html`, `velista-content.html` as needed | D9 |
| `libs/landing-v2/ui/assets/i18n/en.json`, `es.json` | the two copy keys (D9) |
| `apps/velista-e2e/playwright.config.ts`, `src/*.spec.ts` | D8 |
| `apps/shell-e2e/src/e2e/locale-redirect.cy.ts` | drop `'velista'` |

### Package B: cluster, gates, scripts, documentation

| Path | Change |
| --- | --- |
| `k8s/helm/templates/gateway/httproute.yaml.tpl` | render `mounts` (D6) |
| `k8s/helm/values.yaml` | `mounts` on the velista entry; the entry's comment describes one image at two addresses and no longer names `remoteEntry.mjs` or `MFE_REMOTE_URLS` |
| `k8s/helm/values.production.yaml`, `values.staging.yaml` | the `corsOrigins` comments stop waiting for D5's redirect |
| `k8s/helm/templates/_helpers.tpl` | only if `charts.host` needs to accept a mount |
| `k8s/e2e/portfolio-frontend/nginx.conf` | the two `/velista` locations (D7) |
| `k8s/e2e/portfolio-frontend/compose.yml` | the comment that says the shell initialises every remote container no longer counts velista among them; velista stays a service |
| `.github/workflows/docker-ci.yml` | drop `STAGING_MFE_REMOTE_URLS` and the `-e MFE_REMOTE_URLS` line if velista was its only entry; the two curls (D7); `VELISTA_BASE_URL` on `e2e-frontend` (D8) |
| `.github/workflows/release.yml` | drop `PROD_MFE_REMOTE_URLS` and its `-e` line the same way |
| `tools/dev/ng-slot.sh`, `tools/dev/README.md` | D10, D8 |
| `k8s/e2e/luna-shopper-backend/luna-slot.sh`, `compose.apps.yml`, `parallel-worktree-testing.md` | comments (D10) |
| `CLAUDE.md` | section 6 |

If `parseRemoteUrls(undefined)` or an empty `MFE_REMOTE_URLS` is not handled, package B
keeps the variable with an empty value and says so; package A does not change
`remote-urls.ts` beyond `REMOTE_NAMES`.

## 5. Acceptance

Package A, in its worktree, with `npm install` done and `package-lock.json` restored:

```sh
npx nx run-many -t lint test --projects velista,shell,landing-v2-data-access,landing-v2-ui,velista-e2e,shell-e2e
npx nx build velista --configuration production
npx nx build shell --configuration production
ls dist/apps/velista | grep -c remoteEntry        # prints 0
grep -c 'velista' dist/apps/shell/mf-manifest.json # prints 0
npx nx e2e velista-e2e                              # against nx serve velista on 4205
```

Package B, in its worktree:

```sh
helm template nx-portfolio k8s/helm --values k8s/helm/values.yaml --values k8s/helm/values.staging.yaml | grep -A 30 'name: velista-portfolio'
bash -n tools/dev/ng-slot.sh && bash -n k8s/e2e/luna-shopper-backend/luna-slot.sh
node tools/release/release-notes.mjs --check "feat(velista)!: velista leaves the shell, the gateway serves it at /velista (plan 0165)"
docker compose -f k8s/e2e/portfolio-frontend/compose.yml config > /dev/null
```

The orchestrator, on the merged branch, before the pull request: the velista and shell
builds, the three Jest projects and the e2e-frontend curls run against a local compose of
the two images if Docker is available, else the PR checks are the evidence.

## 6. `CLAUDE.md`

Package B edits these passages, and no others:

- **Repository overview.** velista leaves the list of remotes. A new bullet: velista is a
  standalone Angular app in the monorepo, served on its own origin and, in the clusters,
  under the portfolio's `/velista` path by the Gateway (plan 0165).
- **Common commands.** `velista` leaves the sentence about `dependsOn: ['shell:serve']`.
  `npx nx serve velista` serves it alone on 4205.
- **Module federation topology.** `remotes` lists three. The paragraph "velista is the
  exception, and the only one" becomes a short paragraph that says velista is not a remote
  since plan 0165, is served on its own port, and that `http://localhost:4200/velista` is
  the landing's not found page in development. The paragraph on `appRootRoute(mount)`
  says the mount is read from the document's `<base>` element at runtime (D3), and the
  service worker paragraph says the worker registers on the own origin only (D4).
- **App owned locale routing.** The example `/velista/en/home` stays, since the URL exists
  in the clusters.
- **Localization.** "all five configuration files" becomes "all four".
- **Docker & CI/CD.** The sentence "`ichirokuxvi.com/velista` still works: the shell
  mounts the remote at that path and loads it from the new origin" becomes "the velista
  entry carries a `mounts` list, and the Gateway serves the velista image under
  `/velista` on the portfolio host with the prefix stripped (plan 0165)".
  `MFE_REMOTE_URLS` stays documented only if a workflow still sets it.

## 7. Decisions left for the owner

Each is built as stated, and each is one edit to reverse.

1. Serve at both addresses rather than redirect `/velista` to the own origin (D1,
   reverses `0013` D5).
2. The portfolio keeps one session per origin, as today (D1).
3. The landing opens velista at `/velista/<locale>` with a full page load, which is a not
   found page in local development (D9).
4. No service worker and no install prompt under the portfolio path (D4, D2).
5. The compose gate proves the path with two requests, not a browser test (D7).
6. The rollout window of about a minute during the staging deploy of this change (D11).

## 8. Decisions taken during the build

Recorded after the fact so the plan says what was built.

1. `appRootRoute(mount)` consumes the mount as its route path (`path: 'velista'` under the
   portfolio, `''` on the own origin). The shell used to wrap the route in `path: 'velista'`;
   at the root of a table with `APP_BASE_HREF` at `/`, the factory has to do it itself.
2. The initial bundle budget of velista is 1.6 MB warning and 2 MB error, up from 500 kB and
   1 MB. The `import('./bootstrap')` boundary made every eager module count as async; the same
   bytes loaded before first paint then as now.
3. The landing flag is `appLinkIsExternal`, set on velista alone. The card's "View project"
   link and the detail page's live link render `<a [href]>` when it is set.
4. `velista-e2e` reads `VELISTA_BASE_URL` only. `BASE_URL` and `E2E_BASE_URL` are not read,
   because in CI the latter is the shell.
5. D2 was first built as an inline script and rebuilt server side after a browser check
   showed the preload scanner racing it (section D2 explains).
6. The `sub_filter` literals are `<base href="/">` and
   `<link href="manifest.webmanifest" rel="manifest">`, with no self closing slash. Angular
   writes both tags that way into the built `index.html`, while prettier keeps the slash in
   the source, so the source and the filters cannot share one spelling.
   `velista-index-markup.spec.ts` holds the filters to the build and the source to the
   prettier spelling; its build half is skipped where no `dist` exists, which includes the PR
   workflow, so the staging gate's curls (D7) are the check that runs on every deploy.
