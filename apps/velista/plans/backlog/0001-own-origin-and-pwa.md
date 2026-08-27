# 0001: velista on its own origin, and the PWA that unlocks

> **Status: backlog. Not scheduled for development.**

## Goal

Give velista its own hostname, `velista.ichirokuxvi.com` in production and
`velista.staging.ichirokuxvi.com` in staging, serve the app directly from it, and ship the
web app manifest and service worker that make it installable on a phone.

One host or the other, never both: the environment decides which name exists, exactly as
it decides `ichirokuxvi.com` against `staging.ichirokuxvi.com` today.

This supersedes the assumption in plan `0001` section 5 that every micro frontend lives at
`mfe.<env>.ichirokuxvi.com/<app>`. That stays true for the portfolio's remotes; velista
becomes the exception because it is a product rather than a portfolio piece.

## Blocked on

1. `libs/shared/localization/rokutranslator/plans/0005-app-owned-translator.md`
2. `apps/shell/plans/0003-app-owned-locale-routing.md`

**The first is a hard block, not a preference.** `RokuTranslator.init()` is called in
exactly one place in the workspace, `apps/shell/src/app/app.config.ts`. Serve velista on
its own origin today and the shell never runs, so nothing initializes the translator and
every `t()` throws `RokuTranslator not initialized`. An app cannot leave the shell while
the shell owns its translator.

## Correcting plan 0001 section 5

That section concluded the remote phase is "not installable and not publishable". The
second half is right. The first half is too strong, and the correction matters because it
changes what this plan is *for*.

velista **can** be installed from a path. iOS Add to Home Screen needs only a manifest, and
Chrome's install flow is satisfied by a service worker with a fetch handler. What a path
could not give was a usable `scope`, and after plan `0003` even that objection is gone:
with the locale below the mount, `scope: /velista/` is a valid prefix covering every
language, where `/{locale}/velista` could never be covered by any prefix at all.

So plan `0003` alone delivers an installable, correctly scoped PWA on the shell's origin.
This plan is not what makes velista installable. It is what makes velista **its own
product**, and the four things below are what a path genuinely cannot provide.

## What the origin actually buys

1. **Store publishing.** A Trusted Web Activity verifies ownership with a Digital Asset
   Links file at `/.well-known/assetlinks.json` on the **origin root**, and the TWA opens
   that origin. A path inside the portfolio cannot be packaged.
2. **Its own storage.** localStorage, IndexedDB, cookies and cache are per origin. On the
   shell's origin velista shares all of them with the portfolio, which is a real hazard for
   an app holding session tokens.
3. **A service worker that can precache.** The important one, and the reason a path based
   PWA would have been a hollow one. See below.
4. **A shorter URL**, which for a product people are asked to install is not nothing.

## The precaching problem, which the origin dissolves

Worth writing down because it is the strongest technical argument and it is not obvious.

On the shell's origin the page and its code come from **different hosts**: the document is
served by the shell at `staging.ichirokuxvi.com`, while velista's JavaScript, CSS and i18n
JSON are fetched from `mfe.staging.ichirokuxvi.com`. A service worker can only be
registered from, and only control, its own origin, so it would have to be served by the
*shell's* container. Angular's `@angular/service-worker` generates `ngsw.json` from
velista's own build output, listing hashed asset paths relative to that build, and those
assets live on the other host. The worker could not precache them by hash. The result is a
hand rolled worker caching almost nothing, which is most of the point of a PWA gone.

On its own origin the document and every asset come from one place, `ngsw.json` describes
files the worker can actually see, and `@angular/service-worker` works the way it is
documented to. Note that it is not currently a dependency of this workspace.

## One image, one container

A module federation remote build emits `remoteEntry.mjs`, the chunks **and** `index.html`
into a single `dist/apps/velista`. So one image serves both roles:

- `velista.ichirokuxvi.com/` serves `index.html`, the standalone app
- `velista.ichirokuxvi.com/remoteEntry.mjs` serves the shell's remote

No second build target, no second Dockerfile, no duplicated deploy. The shell keeps
mounting velista at `/velista` from the new host, and the same artifact is what a visitor
gets directly.

The existing nginx config already sets `Access-Control-Allow-Origin: *` on static assets,
so the shell's cross origin fetch of `remoteEntry.mjs` keeps working unchanged.

A service worker at the new origin's root does not interfere with the shell's use of the
remote: a worker controls pages in its scope and the fetches those pages make, and the
shell's page is on a different origin, so its request for `remoteEntry.mjs` never passes
through velista's worker.

## What is left in the standalone bootstrap

Most of it exists. `bootstrap.ts`, `app.config.ts` and `app.routes.ts` are all written, and
`appConfig` already spreads `appProviders`, so the standalone injector gets the same
providers the mounted one does. What is missing:

1. **An outlet.** `apps/velista/src/app/remote-entry/entry.ts` has a deliberately empty
   template, so the app renders nothing on its own port. Standalone needs a root component
   with a `<router-outlet>`. Keep the empty `RemoteEntry` for the mounted case rather than
   giving it an outlet, or the "a remote served on its own port shows a blank page" rule in
   CLAUDE.md quietly stops holding for every other remote.
2. **`APP_BASE_PATH: ''`.** The token already exists and is already documented as taking
   `''` in the standalone build.
3. **The translator's `init`**, which arrives with plan `0005`.
4. **The document title**, which the shell's `RokuTitleStrategy` supplies today and will
   not on another origin. Settled in `0005` D10: each app sets its own title, which is the
   only one of the three options that works at all once velista leaves the shell.

## Infrastructure

1. **DNS.** One A record per environment pointing at the same MetalLB IP as everything
   else, `46.62.204.230`.
2. **Helm.** A `host: velista.ichirokuxvi.com, path: /` entry in `values.yaml` `apps`,
   plus the staging pair. `httproute.yaml.tpl` needs no change: a root path route emits no
   rewrite filter, which is what a host root wants.
3. **TLS.** The `Gateway` needs a listener and certificate for the new hostnames. The chart
   already drives this from the `apps` list and the `letsencrypt-prod` ClusterIssuer, so
   confirm rather than assume that adding a host is sufficient.
4. **The shell's remote URL.** `apps/shell/webpack.prod.config.ts` hardcodes every remote
   as `${mfeBaseUrl}/<name>`. velista's tuple becomes its own host instead. Since the shell
   bakes this at build time and is already environment specific, the staging and production
   shells simply carry different values, which is the existing pattern rather than a new
   one. `MFE_REMOTE_URLS` exists as a build arg in the Dockerfile for exactly this shape of
   override and is currently unread by the prod config; wiring it is an alternative to
   hardcoding.

## The PWA itself

- Manifest with `scope: "/"`, `start_url: "/"`, `display: "standalone"`, the brand name
  from `AppBrand`, and the theme colors from the design tokens.
- Icons at 192px and 512px plus a maskable variant. Plan `0002` section 13 deferred every
  document level brand asset to exactly this phase, so this is where that debt is paid.
- `@angular/service-worker` added, with a caching strategy that is deliberate about the
  gateway: app shell and assets precached, API responses not.
- The offline queue that plan `0004` section 1089 deferred becomes possible here. It is not
  required by this plan and should be its own.

## Open questions

1. **Does the Google OAuth redirect survive an installed window?** Raised by Daniel on
   2026-08-26 and recorded as plan `0004`'s open question 1. It cannot be answered without
   a PWA to test, and this is that PWA. Note the two fallbacks that plan already lists, in
   preference order, if a standalone window sends the user to a browser tab and does not
   bring them back.
2. **Does the shell keep mounting velista at all** once it has its own home, or does
   `/velista` on the portfolio become a redirect to the new origin? Keeping both means one
   app at two URLs, with two installs and two storage areas, which is a real user facing
   wrinkle rather than a tidiness question.
3. **Store target.** Plan `0001` section 408 assumes Play Store via TWA. Still the cheap
   path, still unconfirmed.
