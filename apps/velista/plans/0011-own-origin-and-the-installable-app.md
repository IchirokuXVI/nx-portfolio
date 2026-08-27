# 0011. velista on its own origin, and the app you can install

> Prerequisite reading: `0001` sections 5 and 8 (the extraction contract, and D3 on why
> installability is origin scoped), `0002` sections 5.0 and 5.3 (the mark, and the asset
> emission failure that decides how icons ship here), and the two plans that unblocked
> this one, `libs/shared/localization/rokutranslator/plans/0005-app-owned-translator.md`
> and `apps/shell/plans/0003-app-owned-locale-routing.md`.
>
> This is **not** a page plan. It draws no screen. It moves an app to a hostname and
> turns on the two files that make a website an app you can keep on a home screen.
>
> It supersedes `plans/backlog/0001-own-origin-and-pwa.md`, which was the design and is
> now deleted. Section 2 records where that document turned out to be wrong, since three
> of its unknowns have since been settled by reading the code rather than guessing.

## 1. Purpose

Give velista **its own hostname**, serve the app from it directly, and ship the web app
manifest and service worker that make it installable on a phone.

`velista.ichirokuxvi.com` in production, `velista.staging.ichirokuxvi.com` in staging. One
host or the other per environment, never both, exactly as `ichirokuxvi.com` and
`staging.ichirokuxvi.com` already work.

This is the moment velista stops being a portfolio piece and becomes a product. Everything
in plans `0003` through `0010` was built to be moved, and this is the move.

### 1.1 Why the origin, and not just a manifest

velista **can** be installed from a path today. iOS Add to Home Screen needs only a
manifest, and Chrome's install flow is satisfied by a service worker with a fetch handler.
Since plan `0003` put the locale below the mount, `scope: /velista/` is even a valid prefix
covering every language, which `/{locale}/velista` never could be.

So this plan is not what makes velista installable. It is what makes an install worth
having, and four things a path cannot give:

1. **Its own storage.** localStorage, IndexedDB, cookies and cache are per origin. On the
   portfolio's origin velista shares all of them with the portfolio, which is a poor place
   to keep session tokens.
2. **A service worker that can precache.** The strongest argument, and the least obvious.
   Section 1.2.
3. **Store publishing.** A Trusted Web Activity verifies ownership with a Digital Asset
   Links file at `/.well-known/assetlinks.json` on the **origin root**, and it opens that
   origin. A path inside a portfolio cannot be packaged.
4. **One canonical URL**, which for a product people are asked to install is not nothing,
   and which section 3 D5 turns from a nicety into a requirement.

### 1.2 The precaching problem, which the origin dissolves

On the portfolio's origin the page and its code come from **different hosts**. The document
is served by the shell at `staging.ichirokuxvi.com`, while velista's JavaScript, CSS and
translation chunks are fetched from `mfe.staging.ichirokuxvi.com`. A service worker can only
be registered from, and only control, its own origin, so it would have to be served by the
*shell's* container. `@angular/service-worker` generates `ngsw.json` from velista's own build
output, listing hashed paths relative to that build, and those files live on the other host.
The worker could not precache them by hash. What is left is a hand written worker caching
almost nothing, which is most of the point of a PWA gone.

On its own origin the document and every asset come from one place, `ngsw.json` describes
files the worker can actually see, and the package works the way it is documented to.

## 2. What the backlog document got wrong

Three of its unknowns were checked against the code while writing this plan.

**The blockers are cleared, and one of them says so itself.** The backlog listed plan `0005`
(app owned translator) as a hard block, on the grounds that `RokuTranslator.init()` was
called only in `apps/shell/src/app/app.config.ts`, so an app outside the shell would have no
initialized translator. That is fixed: `provideRokuTranslator` creates and initializes an
instance per app injector, velista installs it through `VELISTA_TRANSLATION_PROVIDERS`, and
`0005`'s own status note ends with "`apps/velista/plans/backlog/0001-own-origin-and-pwa.md`
is unblocked". `0003` is done too.

**The document title is already solved.** The backlog listed it as missing work. It is not:
`libs/velista/feature-shell/src/lib/routes.ts:136` already carries
`title: localizedTitle('app-title')` on the app's parent route, resolved through velista's
own translator. That is precisely the shape `0005` D10 chose because it survives the app
leaving the shell, and it needs no change here.

**TLS needs no chart change, confirmed rather than assumed.** The backlog asked somebody to
check. `k8s/helm/templates/gateway/gateway.yaml.tpl` builds its `$hosts` set by ranging over
`.Values.apps`, emits one HTTPS listener per distinct host with a `certificateRefs` secret
named after it, and the `cert-manager.io/cluster-issuer` annotation on the Gateway makes
cert-manager provision each missing secret. Adding a host to `apps` is genuinely sufficient.

One thing the backlog did not know to worry about is section 3 D2, which is a real trap in
the standalone route table rather than a correction to the document.

## 3. Decisions

### D1. One image, two roles

A module federation remote build emits `remoteEntry.mjs`, the chunks **and** `index.html`
into a single `dist/apps/velista`. So one image serves both:

- `velista.ichirokuxvi.com/` serves `index.html`, the standalone app.
- `velista.ichirokuxvi.com/remoteEntry.mjs` serves the shell's remote.

No second build target, no second Dockerfile, no duplicated deploy. The existing nginx
config already sets `Access-Control-Allow-Origin: *` on static assets, so a cross origin
fetch of `remoteEntry.mjs` keeps working unchanged.

A service worker at the new origin's root does not interfere with that. A worker controls
pages in its scope and the fetches those pages make; the shell's page is on another origin,
so its request for `remoteEntry.mjs` never passes through velista's worker.

### D2. The mount is an argument to one route factory, not a literal in two files

This is the trap. `apps/velista/src/app/app.routes.ts` currently loads `remoteRoutes` from
`remote-entry/entry.routes.ts`, and that route states `data: { mountPath: '/velista' }`,
which is what `localeGuard` reads to find the locale segment. So the standalone build, which
is mounted at nothing, would inherit the mounted build's mount and the guard would look for
the locale one segment too far in. Every URL would be rewritten wrongly on first navigation.

Overriding `APP_BASE_PATH` in `appConfig` does not fix it, because the guard deliberately
does not read that token. `0003` and `0005` D7 both record why: a guard resolves against the
closest environment injector Angular has created by the preactivation phase, and a route's
own `providers` injector is not reliably one of them, so the mount reaches the guard through
route `data` and only through route `data`.

**One function, called twice with a different mount.** A new
`apps/velista/src/app/app-root-route.ts` exports `appRootRoute(mount: string): Route`
carrying `providers`, `data.mountPath` and the `loadChildren` into `feature-shell`.
`entry.routes.ts` calls it with `'/velista'`; `app.routes.ts` calls it with `''`. The two
modes then differ by one argument and cannot drift, and the `APP_BASE_PATH` override rides
in the same providers array so the mount is written once per mode rather than twice.

### D3. velista's own port serves the standalone app, and CLAUDE.md gets a carve out

`apps/velista/src/app/remote-entry/entry.ts` has a deliberately empty template, so
`http://localhost:4205` renders nothing. That rule exists because a remote served on its own
port lacks the shell's global styles and renders differently from production.

**velista is the one app that rule stops applying to**, and for a specific reason rather than
convenience: velista draws its own chrome and owns its own token scope inside `AppLayout`
(`0001`, the extraction contract, items 1 and 4), so it does not borrow a single style from
the shell. Its own port is not a degraded view of production. Once this plan lands it *is*
production.

`RemoteEntry` is referenced only by `bootstrap.ts`; the shell never touches it. So this is a
change to the standalone case alone. A new `AppRoot` with `<router-outlet>` becomes the
bootstrap component, `RemoteEntry` is deleted with it, and `CLAUDE.md` gains a sentence
saying velista is a standalone app that is also exposed as a remote, so the blank page rule
still reads true for the other three.

### D4. Service worker registration is standalone only, never in `appProviders`

`provideServiceWorker(...)` goes in `apps/velista/src/app/app.config.ts` and nowhere else.

`appProviders` is spread into **both** the standalone bootstrap and the route the shell
lazy loads. Registration there would make the *portfolio's* page register velista's worker
on the *portfolio's* origin, where `ngsw-worker.js` does not exist. The result is a 404 on
every shell page load and, if it ever did resolve, a worker scoped to the wrong origin.

`app.config.ts` already documents itself as the standalone half of the pair, which makes it
the correct and the only correct home.

Related: nothing shared may inject `SwUpdate`. Under the mounted build there is no worker,
so any service that assumes one is broken in one of its two modes. Section 6.4 keeps update
handling in `AppRoot`, which exists only standalone.

### D5. The portfolio's `/velista` becomes a redirect to the new origin, in release 2

The backlog left this open. It is decided here, and it is the decision worth re-confirming
after release 1 has been on a phone for a few days.

Two live copies of one app on two origins means two sessions, two storage areas and two
installs, and a user who signs in on one and finds themselves signed out on the other has
hit a defect they cannot diagnose. The Google flow makes it sharper still: the gateway
redirects to a **single** configured frontend URL, so supporting two origins means carrying
the origin through the OAuth `state`, which is an open redirect waiting to be written. That
flow is designed and not yet built (`0009` section 5.6), so deciding now costs nothing and
deciding later costs a migration.

So velista gets one canonical origin, and `/velista` on the portfolio redirects to it.

**What this does not do.** It does not retire the remote. The module federation wiring, the
exposed `./Routes`, the shared singleton entry and the shell's remote URL all stay in place
and keep working; reverting the redirect is one route. Actually removing velista from
`module-federation.config.ts` touches six configs, `module-federation.shared.ts` and CI, and
belongs to its own plan if it is ever wanted. The portfolio keeps a case study page about
velista, which is the portfolio's job, and links out to the product.

### D6. Manifest icons ship as files in `apps/velista/public`, never through the bundler

`0002` section 5.3 records that emitting a brand SVG as a build asset **fails the velista
production build**:

```
Can't handle conflicting asset info for sourceFilename
  while analyzing module asset/resource|.../velista-mark.svg for concatenation
```

That failure is about a TypeScript `import` of the file, which puts it through webpack's
`asset/resource` rule and into the concatenated module graph. Files sitting in
`apps/velista/public` are copied by the Angular assets glob and never enter that graph at
all, so the failure has no way to occur. The manifest references them by URL, and no
component learns a filename.

This also means `0002` section 5.3's deferred `BrandAssetResolver` is still deferred and
still not needed. Nothing in this plan resolves a brand filename at runtime.

### D7. `theme_color` and `background_color` are Night's ground, not the amber

`#0a0c14`, which is `--app-ink-950` (`10 12 20` in `_primitives.scss`) and also the ink the
app icon is drawn in.

The manifest takes one colour and the app has two themes, so it has to match one of them.
Night is the default (`theme-store.ts` falls back to Night unless the device asks for
light), the amber is an **action** colour rather than a surface, and an amber status bar
above a near black app reads as a rendering bug. The splash screen behind the icon takes the
same value for the same reason.

### D8. Nothing from the gateway is cached. No `dataGroups` at all

velista is a live collaborative list. A cached response is a wrong response with a
convincing delivery. The service worker precaches the app shell and its assets and passes
every `api.*` request straight through.

This is also why the offline queue stays out of scope, per section 10: an app that caches no
data has nothing to reconcile, and a queue is a design problem rather than a configuration
flag.

### D9. The existing `mfe.*/velista` Helm entries **move**, they are not duplicated

Each entry in `values.yaml` `apps` produces a Deployment, a Service and an HTTPRoute. Adding
a second velista entry would run the same image twice on two hostnames, which is D5's
two origin hazard rebuilt in the cluster.

So the two existing entries change `host` and `path` in place. `mfe.ichirokuxvi.com/velista`
stops existing, which makes the shell's remote URL change mandatory rather than optional and
removes any half migrated state. `httproute.yaml.tpl` needs no change: a `path: /` entry
emits no rewrite filter, which is exactly what a host root wants.

## 4. Part A: the standalone app

Most of it exists. `bootstrap.ts`, `app.config.ts` and `app.routes.ts` are all written, and
`appConfig` already spreads `appProviders`, so the standalone injector gets what the mounted
one gets.

| File | Change |
| --- | --- |
| `apps/velista/src/app/app-root.ts` | **new.** The bootstrap component: `<router-outlet />`, nothing else. It draws no chrome, because `AppLayout` in `feature-shell`'s parent route already owns all of it |
| `apps/velista/src/app/app-root-route.ts` | **new.** `appRootRoute(mount: string): Route`, per D2. Holds `providers`, `data.mountPath` and the `loadChildren`, and binds `APP_BASE_PATH` to the mount it was given |
| `apps/velista/src/app/remote-entry/entry.routes.ts` | `remoteRoutes = [appRootRoute('/velista')]`. The long docblock about why providers ride on this route moves to the factory |
| `apps/velista/src/app/app.routes.ts` | `appRoutes = [appRootRoute('')]`. No longer reaches into `remote-entry` |
| `apps/velista/src/app/remote-entry/entry.ts` | **deleted**, with `RemoteEntry`, per D3 |
| `apps/velista/src/app/app-providers.ts` | `APP_BASE_PATH` comes out of the shared list and into the factory. `APP_MOUNT_PATH` keeps its `useExisting`, so it follows for free |
| `apps/velista/src/bootstrap.ts` | Bootstraps `AppRoot` |
| `apps/velista/src/index.html` | Root element becomes `<app-velista-root>`. Manifest and icon tags land here in Part C |
| `apps/velista/src/app/app-root-route.spec.ts` | **new.** The one thing worth a spec: `appRootRoute('')` yields `data.mountPath === ''` and an `APP_BASE_PATH` of `''`, and `appRootRoute('/velista')` yields `/velista` for both. That is D2's trap, asserted |
| `apps/velista/src/app/app-providers.spec.ts` | Drops its `APP_BASE_PATH` case, which now belongs to the factory spec |
| `CLAUDE.md` | The carve out sentence from D3 |

`localeGuard` needs nothing. Given `mountPath: ''` it settles `/{locale}/{rest}`, which is
the same rule landingV2 already runs under.

## 5. Part B: the origin

### 5.1 DNS

Two A records at `46.62.204.230`, the same MetalLB address everything else uses:
`velista.ichirokuxvi.com` and `velista.staging.ichirokuxvi.com`.

**This is manual and it gates everything after it.** cert-manager cannot solve an HTTP-01
challenge for a name that does not resolve, so the Helm upgrade will sit with a pending
certificate until the records exist and propagate.

### 5.2 Helm

`k8s/helm/values.yaml`, per D9:

```yaml
  - name: velista
    env: production
    image: ghcr.io/ichirokuxvi/nx-portfolio/velista
    host: velista.ichirokuxvi.com
    path: /
```

and the staging pair with `velista.staging.ichirokuxvi.com`. Nothing else in the chart
changes: the Gateway listener and its certificate follow from the `apps` list (section 2),
and the route emits no rewrite filter at `path: /`.

### 5.3 The shell's remote URL

`apps/shell/webpack.prod.config.ts` hardcodes every remote as `${mfeBaseUrl}/<name>`, so
velista's tuple has to leave the base and name its own host.

**Read `MFE_REMOTE_URLS` rather than hardcoding.** `apps/shell/webpack.config.ts` already
parses it (a comma separated `name=url` map, first `=` wins) and already documents it as the
per remote override for exactly this shape. `apps/shell/src/Dockerfile` already declares the
build arg, and `apps/shell/project.json` already forwards it. The whole mechanism exists and
is unread by the production config, which is the one line to fix.

Lift `parseRemoteUrls` into a small shared module both webpack configs import, then have
`webpack.prod.config.ts` apply the map over its base derived tuples, same precedence the dev
config uses. CI then supplies the value rather than the repository hardcoding a hostname
twice:

- `.github/workflows/docker-ci.yml`: `MFE_REMOTE_URLS: velista=https://velista.staging.ichirokuxvi.com`
- `.github/workflows/release.yml`: `MFE_REMOTE_URLS: velista=https://velista.ichirokuxvi.com`

The shell is already environment specific, so this is the existing pattern rather than a new
one. It also keeps working after D5's redirect lands, which is what makes reverting that
redirect a one line change.

**Ordering.** The Helm route moves and the shell must be rebuilt in the same release, or the
portfolio's `/velista` breaks until the next shell build. Staging gets this for free:
editing `webpack.prod.config.ts` puts the shell in the affected set, so CI rebuilds it in
the same run that deploys the chart. `release.yml` builds every app anyway.

### 5.4 nginx

`apps/docker/local-http-server/src/nginx-static-app.conf` is shared by every app image, so
the change has to be harmless to the other four. Adding one location block for files only
velista emits satisfies that: the others 404 there today and will 404 there after.

```
location ~* ^/(ngsw\.json|ngsw-worker\.js|manifest\.webmanifest)$ {
  add_header 'Cache-Control' 'no-cache' always;
  try_files $uri =404;
}
```

`index.html` should get the same treatment. A hashed bundle can be cached forever; the
document that names which hashes are current cannot, and that is true for every app in the
fleet rather than just this one.

The Angular worker already appends a cache busting parameter when it checks `ngsw.json`, so
this is belt and braces rather than the only line of defence. It is cheap and the failure it
prevents is an app frozen on an old version with no way for a user to force an update.

## 6. Part C: the PWA

### 6.1 The manifest

`apps/velista/public/manifest.webmanifest`, a static file rather than anything generated:

```json
{
  "name": "Velista",
  "short_name": "Velista",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0a0c14",
  "background_color": "#0a0c14",
  "icons": [ ... ]
}
```

`name` and `short_name` duplicate `AppBrand`, which is rule N1's one unavoidable exception:
a manifest is read by the operating system before any JavaScript runs, so it cannot be
composed from a provider. `0002` section 5.1's rename procedure grows a fifth step, and this
plan is where that gets written into it.

`start_url: "/"` and not `/en` or `/en/home`. The locale guard inserts a supported locale
into a locale-less URL, which is what makes the root a legitimate entry point, and it picks
the right language for the device rather than freezing the language of whoever installed it.
This also answers `0007` open question O1, which explicitly parked itself until "the
standalone build and the web app manifest land, since that is when a start URL has to be
written down". It is written down: the root, and the guard decides the rest.

### 6.2 Icons

Into `apps/velista/public/`, per D6, generated from
`libs/velista/ui/assets/brand/velista-app-icon.svg`:

| File | Purpose |
| --- | --- |
| `icons/icon-192.png` | Manifest, `any` |
| `icons/icon-512.png` | Manifest, `any`, and the store listing |
| `icons/icon-maskable-512.png` | Manifest, `purpose: "maskable"` |
| `apple-touch-icon.png` (180) | iOS Add to Home Screen, which does not read the manifest reliably |
| `favicon.ico` | Already there. Regenerated from the same source so the three do not drift |

The maskable variant is not the same image at another size. Android crops it to a shape it
chooses, so the boat has to sit inside the middle 80% with the amber running to every edge.
The existing tile is full bleed amber with the boat filling it, so this is a scaled inset
rather than a redraw.

`0002` section 5.0 says the mark **degrades by dropping detail, not by shrinking it**: at
small sizes the three scribbles become one bolder stroke. That applies to the favicon and is
worth checking at 192 before assuming a straight export is fine.

### 6.3 The service worker

`@angular/service-worker` is **not currently a dependency** and is added at `^21` to match
`@angular/core@21.2.6`.

It works with this workspace's module federation build, which was worth verifying rather
than assuming. `@nx/angular:webpack-browser` carries `serviceWorker` and `ngswConfigPath` in
its schema, and the underlying browser builder runs `augmentAppWithServiceWorker` over each
output path **after** webpack has finished
(`@angular-devkit/build-angular/src/builders/browser/index.js:278`). It is a post build pass
over `dist`, so the custom federated webpack config is invisible to it.

`apps/velista/project.json`, production configuration only, so a development build keeps its
fast rebuild and nothing stale is ever served on port 4205:

```json
"serviceWorker": true,
"ngswConfigPath": "apps/velista/ngsw-config.json"
```

`apps/velista/ngsw-config.json`:

- An **app** asset group, `installMode: prefetch`, globbing `/index.html`,
  `/manifest.webmanifest`, `/*.css`, `/*.js` **and `/*.mjs`**. The `.mjs` glob is not in the
  CLI's default config and is required here: module federation emits `remoteEntry.mjs` and
  `.mjs` chunks, and a default config would silently leave them uncached.
- An **assets** group, `installMode: lazy` with `updateMode: prefetch`, for
  `/icons/**`, `/*.ico`, `/*.png`, `/*.svg`.
- **No `dataGroups`**, per D8.
- `navigationUrls` keeps the default and excludes anything with a file extension, so a deep
  link like `/en/zones/abc` falls back to `index.html` while a missing asset still 404s.

The translation chunks need no entry of their own. `VELISTA_UI_TRANSLATIONS` loads them with
`import('../../assets/i18n/${locale}.json')`, which webpack turns into ordinary lazy chunks,
so the `/*.js` glob already covers them. That is worth knowing before somebody adds an asset
group for an `assets/i18n` folder that does not exist in `dist`.

### 6.4 Updates

velista talks to a moving backend, so a client frozen on a cached shell is a real hazard
rather than a cosmetic one. But an app that reloads under the user while they are typing a
list item is worse.

In `AppRoot`, and only there, per D4:

- Register with `registrationStrategy: 'registerWhenStable:30000'`, the default, which keeps
  the worker out of the critical path of first paint.
- On `SwUpdate.versionReady`, activate the update and set a flag. Reload on the **next**
  completed navigation rather than immediately, so an update never interrupts a screen the
  user is working on and always lands between them.
- On `SwUpdate.unrecoverable`, reload at once. There is nothing to protect: the cached state
  is already broken.

No new UI, no toast, no prompt. Adding one is a design decision with a mock, and this plan
draws no screens.

## 7. Build order

Two releases, deliberately. Release 1 is verifiable on a phone before release 2 makes a
decision that is awkward to walk back.

**Release 1: staging, both copies live.**

1. Part A, the standalone app. Ends with `nx serve velista` rendering the app on 4205 and
   the shell still mounting it at `/velista`. Both modes green, both spec suites passing.
2. Part C, the manifest, the icons and the worker. Verified against a local production
   build served over a LAN address with a self signed certificate, or over `localhost`,
   which counts as a secure context.
3. DNS for `velista.staging.ichirokuxvi.com`.
4. Part B on staging: the Helm entry, `MFE_REMOTE_URLS` in `docker-ci.yml`, the shared
   `parseRemoteUrls` lift, the nginx block.
5. Install it on a phone from `velista.staging.ichirokuxvi.com`. Fly through the flows in
   `0008`, `0009` and `0010` from the installed window. Turn the radio off and confirm the
   shell still opens and the app says the connection is gone rather than showing a browser
   error page.

**Release 2: production, and one canonical URL.**

6. DNS for `velista.ichirokuxvi.com`, the production Helm entry, `MFE_REMOTE_URLS` in
   `release.yml`.
7. D5: `/velista` on the portfolio redirects to the new origin, both environments.

Each numbered step is its own commit. Step 7 is its own commit above all, since reverting it
is the rollback for the whole decision.

## 8. Acceptance criteria

- [ ] `npx nx serve velista` renders the app at `http://localhost:4205`, and the shell at
      `http://localhost:4200/velista/en` still renders the same app.
- [ ] `appRootRoute('')` produces `data.mountPath === ''` and `APP_BASE_PATH === ''`, proven
      by a spec and not by inspection. This is D2 and it is the criterion most likely to
      catch a silent regression.
- [ ] Hitting the standalone origin at `/` lands on a locale, in the device's language when
      it is one of the two supported, and `/en/home` deep links directly.
- [ ] `dist/apps/velista` after a production build contains `ngsw.json`, `ngsw-worker.js`,
      `manifest.webmanifest` and the icon set, and `ngsw.json` lists `remoteEntry.mjs` and
      every `.mjs` chunk.
- [ ] `ngsw.json` contains **no** `dataGroups`, and a request to `api.*` from an offline
      installed window fails rather than returning a cached body.
- [ ] Chrome offers to install from the new origin, and Lighthouse's installability audit
      passes.
- [ ] Installed on Android, the icon is not letterboxed inside a white circle, which is the
      maskable variant working.
- [ ] Installed, the status bar and the task switcher entry are `#0a0c14`, and the splash
      screen does not flash white.
- [ ] The shell's own pages register no service worker, and the browser console on
      `staging.ichirokuxvi.com` shows no `ngsw-worker.js` 404. This is D4.
- [ ] `mfe.staging.ichirokuxvi.com/velista/remoteEntry.mjs` is gone, and the shell loads it
      from the new host instead. This is D9.
- [ ] After release 2, `ichirokuxvi.com/velista` redirects to `velista.ichirokuxvi.com`.
- [ ] `npx nx lint velista`, `npx nx test velista` and `npx nx build velista` pass, and so
      do the shell's, since `app.routes.spec.ts` and the webpack config both moved.

## 9. What this does not change

Worth stating, because the surface looks larger than it is.

- **No component changes.** Not one. `AppLayout` already owns the chrome, the theme scope
  and the tokens, and everything below it reads its mount from a token it already injects.
- **No backend or environment change.** `environment.prod.ts` points at
  `api.ichirokuxvi.com` and keeps doing so from the new origin. CORS on the gateway is
  unaffected, since it was never same origin to begin with.
- **No translation change**, beyond the rename procedure gaining a step.
- **No module federation retirement.** D5.

## 10. Out of scope

- **The offline queue**, deferred by `0004` and still deferred. D8 explains why it is a
  design problem rather than a switch: an app that caches no data has nothing to reconcile.
  It is its own plan and it wants the installed app to exist first.
- **Store packaging via a TWA**, including `/.well-known/assetlinks.json`. The origin is the
  prerequisite and this plan delivers it; the packaging is separate work with a Play Console
  account attached to it.
- **SSR or prerendering the public routes**, which `0007` section 4 raised for link previews
  and search indexing. Same origin, different plan, and it changes the Docker image from a
  static nginx to a Node host.
- **Retiring velista as a remote.** D5.
- **The e2e stack.** `k8s/e2e/portfolio-frontend/compose.yml` has no velista service at all
  today and its nginx knows two hostnames. Adding velista's own host to it, and pointing
  `apps/velista-e2e/playwright.config.ts` at the new origin instead of the shell, is real
  work and it is not what this plan is about. It should be the next plan after this one,
  since until it lands velista's e2e suite tests the mounted copy that D5 turns into a
  redirect.
- **A settings screen**, `0007` O4's home for the language control. Unrelated, still unbuilt.

## 11. Open questions

**O1. Does the Google OAuth redirect survive an installed window?** Raised by Daniel on
2026-08-26 and recorded as `0004`'s open question 1. It still cannot be answered without a
PWA to test against, and step 5 of section 7 is the first moment it can be. Note that the
flow is not wired yet either way (`0009` section 5.6), so what step 5 can actually establish
is whether a standalone window returns from **any** external navigation, which is the same
question with a cheaper experiment.

**O2. What happens to the sessions that already exist on the portfolio's origin?** Storage
does not move between origins, so anybody signed in at `staging.ichirokuxvi.com/velista`
appears signed out at the new host. Today that is a handful of test accounts and the answer
is to sign in again. It is written down because the answer stops being acceptable the moment
there is a real user, and D5 lands before that is true.

**O3. Does `orientation: "portrait"` belong in the manifest?** Every mock is drawn portrait
and the app is phone first, so locking it is defensible. Against: it is an accessibility
regression for somebody with a mounted or rotated device, and no page actually breaks in
landscape. Listed in section 6.1 as portrait, and worth one deliberate look at the group
page in landscape before accepting it.

**O4. Store target.** `0001` assumes the Play Store via TWA. Still the cheap path, still
unconfirmed, and now unblocked rather than blocked.
