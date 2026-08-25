# 0001 Luna Shopper frontend: overview and architecture

> Paths are repo relative. Never use relative imports across lib boundaries, use the
> `@portfolio/<scope>/<lib>` aliases. **Commit locally only, never push** (CLAUDE.md
> git workflow). This plan set covers the **frontend** only. The backend plan set lives
> in `apps/luna-shopper-backend/plans/` and is not repeated here.

## 1. Goal

Ship the Luna Shopper client: a phone first, installable, collaborative shopping list
app that talks to the existing `luna-shopper-backend` gateway over REST and to the
realtime service over WebSocket or SSE.

This document is the index and the architecture record for the whole frontend. It fixes
the decisions that every later page plan depends on. **Every page gets its own numbered
plan with an approved mock before any of it is built** (see section 9).

## 2. Naming

The product name **is not final**. "Luna Shopper" is the working technical name. That
constraint is load bearing and shapes several decisions below, so state it once here:

> **Rule N1.** The product name must never be hardcoded in a component, a CSS token, a
> route path, a class name, a translation key, or an asset filename. It appears only as
> **values** in one brand configuration object and in the translation JSON files. Renaming
> the product must be a change to data, never a refactor.

Technical identifiers, which are internal and stay stable across a rename:

| Thing | Value | Why |
| --- | --- | --- |
| Nx project / module federation name | `lunaShopper` | MF names must be valid JS identifiers, so no hyphen is allowed |
| App directory | `apps/luna-shopper-frontend` | Mirrors `apps/luna-shopper-backend` |
| e2e project | `lunaShopper-e2e`, directory `apps/luna-shopper-frontend-e2e` | Matches `landingV2-e2e` |
| Routes alias | `lunaShopper/Routes` | Matches the other remotes |
| Library directory | `libs/luna-shopper-frontend/*` | See D5 |
| Library alias | `@portfolio/luna-shopper-frontend/<lib>` | See D5 |
| Dev port | **4205** | 4200 shell, 4201 landing, 4202 odontogram, 4203 damoclesSword, 4204 landingV2 |

## 3. D1: ship as a shell remote now, as a standalone app later

**Decision: build it as a module federation remote of `shell`, but write every line of it
so that it does not know the shell exists.**

The app will eventually move to its own repository and its own domain. That is not a
someday maybe, it is required by two hard goals (SSR and app store publishing) that
cannot be met inside the portfolio shell at all. See D2 and D3 for why. So the remote
phase is explicitly a **staging phase**, and the cost of leaving it must stay near zero.

### 3.1 The extraction contract

These rules are what make the later move a bootstrap and deploy change rather than a
rewrite. They are binding on every page plan in this set.

1. **The app owns its own chrome.** It renders its own header, navigation, and footer
   inside its own layout component. It never relies on anything the shell draws, and it
   never styles anything outside its own host element.
2. **All logic lives in `libs/luna-shopper-frontend/*`.** `apps/luna-shopper-frontend`
   holds only bootstrap, module federation config, providers, and the remote entry. When
   the app is extracted, the libraries move unchanged and only the thin app shell is
   rebuilt.
3. **No shell imports.** The remote may import from `@portfolio/shared/*` (icons,
   localization, environments) and from `@portfolio/luna-shopper/contracts`. It must
   never import from `apps/shell` or from another remote's libraries.
4. **Its own theme tokens.** It does not inherit the portfolio's dark and gold system.
   Tokens are defined on the app's own root element, not on `:root`, so the shell's
   global styles cannot leak in and the app's tokens cannot leak out. See `0002`.
5. **Routing is relative.** The app never constructs an absolute URL that assumes the
   `/<locale>/luna-shopper` prefix. A single injectable base path token supplies it, and
   the standalone build supplies an empty one.
6. **Its own API configuration.** Backend base URLs come from the app's own environment
   surface, not from assumptions baked into shared portfolio code.

### 3.2 What extraction will then require

Recorded so the eventual move is not a surprise: a new repository or workspace, an SSR
build target and a Node host to run it, a PWA manifest and service worker at the origin
root, a domain plus certificate plus reverse proxy entry, a Digital Asset Links file for
the store wrapper, and a CI pipeline. None of that is frontend code, which is the point.

## 4. D2: SSR is not achievable in the remote phase

The question was whether SSR can be enabled for one remote while the rest of the
portfolio stays as it is. **It cannot, and the reason is structural rather than a
configuration gap.**

In module federation the **host** produces the document. A remote is code the host loads
at runtime into a page the host already rendered. If `shell` is client rendered, then
nothing inside `lunaShopper` can be server rendered, whatever that remote's own build
does.

This is confirmed by the toolchain actually installed in this workspace. In Nx 22.7.2,
`node_modules/@nx/angular/src/generators/remote/schema.json` documents its `ssr` option as:

> "Whether to configure SSR for the Producer (remote) application to be consumed by a
> Consumer (host) application **using SSR**."

So a remote's SSR support exists only to serve an SSR host. Nx does support Angular
module federation with SSR, but the supported shape is "SSR host plus server builds for
the remotes it renders", never "one SSR remote under a client rendered host".

### 4.1 What enabling it would actually cost

Turning `shell` into an SSR host is a portfolio wide change, not a Luna change:

- `shell` becomes a Node process instead of static files behind nginx, which changes the
  Dockerfile, the Helm deployment, the probes, and the reverse proxy for the **whole**
  portfolio.
- `landing`, `odontogram`, `damoclesSword`, and `landingV2` all have to become SSR safe,
  because the host renders their shell too. Any module scope use of `window`, `document`,
  or `localStorage` becomes a server crash.
- The `RokuTranslator` singleton, which is shared across every remote, has to become
  request scoped on the server or locale state leaks between concurrent requests. That is
  a real redesign of a package every app depends on.

That is a large, high risk change to four working applications to benefit one that is
leaving anyway.

### 4.2 Decision

**SSR is deferred to the standalone phase, where it is straightforward** (a plain Angular
application with `@angular/ssr`, no federation involved). Nothing in the remote phase may
make that harder, so the following are binding now:

- Never touch `window`, `document`, `navigator`, or `localStorage` at module scope or in
  a constructor. Access them behind a small injectable browser facade, or guard with
  `isPlatformBrowser`, from day one.
- Do not use `setTimeout` or `setInterval` for anything that affects rendered output.
- Keep data loading in resolvers or in services that return observables or signals which
  can be awaited during a server render, rather than firing from `ngAfterViewInit`.
- Treat every browser only API as an injected dependency. This is cheap now and is the
  entire cost of SSR readiness later.

### 4.3 Is SSR even worth it for this product

Worth saying plainly, because it affects how much the above matters: for an **installed**
PWA, SSR contributes close to nothing, since the shell is served from the cache and the
user is authenticated. SSR earns its keep on the **public, unauthenticated surface**: the
marketing content, an invite or share link opened from a phone message, and search
indexing. So the realistic end state is SSR or prerendering for the public routes and a
client rendered authenticated app. The page plans should record which routes are public
for exactly this reason, and every page doc carries a "public or authenticated" field.

## 5. D3: PWA and app store publishing also require the standalone phase

The goal is an installable app that can be published to a store. Both are **origin
scoped**, which the remote phase cannot satisfy:

- A **service worker** controls a scope under one origin. Registered from
  `ichirokuxvi.com/en/luna-shopper`, its scope sits inside the portfolio origin and it
  shares that origin's storage, cookies, and cache with the portfolio.
- A **web app manifest** describes an app whose `start_url` and scope are the portfolio's,
  so an install prompt would install "the portfolio", not this product.
- **Play Store publishing via a Trusted Web Activity** verifies ownership with a Digital
  Asset Links file served from the **origin root**, and the TWA opens that origin. A
  path inside a portfolio site cannot be published as a standalone app.

**Decision.** The remote phase is a real, usable, phone shaped web app but is **not
installable and not publishable**. Installability, offline support via a service worker,
and store packaging move to the standalone phase and are out of scope for every plan in
this set. What the remote phase **does** do is build the app so that turning those on is
purely additive: a mobile first layout, touch sized targets, an offline tolerant data
layer, and no assumption that the network is present. See D7.

## 6. D4: routing

Locale first, like every other app here (CLAUDE.md "Locale-first routing"). The app mounts
at `/<locale>/luna-shopper` and all of its own routes are relative to that.

### 6.1 A route ordering trap in the shell

`apps/shell/src/app/app.routes.ts` currently ends its `:locale` children with an
empty path route that loads `landingV2/Routes`, followed by a wildcard. An empty path
route with `loadChildren` is **not terminal**: Angular will hand the remaining segments to
landingV2's own route table. So a `luna-shopper` route appended after it would never be
reached, and the user would land on landingV2's not found page instead.

> **The `luna-shopper` route must be inserted before the empty path `''` entry**, next to
> `odontogram` and `damoclesSword`. The scaffolding plan will call this out again with the
> exact diff, and the e2e suite must cover `/<locale>/luna-shopper` resolving to this app,
> so a future route reshuffle cannot silently break it.

### 6.2 Route table

Deep links matter here, because sharing a list or a zone invite is a core product action,
and because those links are what a store wrapper will open later.

| Route | Page | Access | Plan |
| --- | --- | --- | --- |
| `''` | Home | Public, adaptive by auth state | `0003` |
| `zones/:zoneId` | Zone detail, its lists | Authenticated, zone member | later |
| `zones/:zoneId/members` | Members and roles | Authenticated, manager | later |
| `lists/:listId` | Shopping list, the main screen | Authenticated, list access | later |
| `lists/:listId/lines/:lineId` | Line detail and comments | Authenticated, list access | later |
| `join/:code` | Join a zone from a shared code or link | Public, adaptive | later |
| `auth/login`, `auth/register`, `auth/verify` | Credentials flows | Public | later |
| `account` | Profile, upgrade a temporary account, delete | Authenticated | later |
| `settings` | Locale, theme, density | Any | later |

Numbers are assigned when each page plan is written, in build order, so this column is
filled in as the set grows.

## 7. D5: library layout

New scope: **`libs/luna-shopper-frontend/*`**, alias `@portfolio/luna-shopper-frontend/<lib>`.

It is deliberately **not** folded into the existing `libs/luna-shopper/` scope, which holds
backend libraries (`contracts`, `platform`, `test-fixtures`). Two reasons: `platform` is
NestJS specific and must never be reachable from browser code, and keeping the whole
frontend under one directory makes the eventual extraction a directory move.

| Library | Type | Contents |
| --- | --- | --- |
| `models` | types | View models, form models, and the mapping from contract DTOs to what components consume |
| `data-access` | services | Gateway HTTP clients, auth and token store, realtime client, offline queue, DI tokens |
| `ui` | presentational | Layout shell, theme tokens, and every dumb component, plus the i18n namespace |
| `feature-home` | routed | The home page (`0003`) |
| `feature-zones`, `feature-lists`, `feature-auth`, `feature-account` | routed | One per area, added as their plans land |

`models` and `ui` must not import `data-access`. Feature libraries compose the other three.
Note that `@nx/enforce-module-boundaries` is configured permissively in this workspace
(`onlyDependOnLibsWithTags: ['*']`), so lint will **not** catch a violation of this. It is
a review responsibility.

### 7.1 The contracts seam

The frontend imports `@portfolio/luna-shopper/contracts` for enums and message shapes, so
that `ZoneRole`, `LineStatus`, `MembershipStatus` and friends are defined exactly once
across the whole product. This is the reason the backend rename in plan `0014` deliberately
left the libraries alone.

**Import enums and types only.** Never import the NATS message patterns, the ajv schema
registry, or anything that pulls a Node dependency into a browser bundle. The frontend
speaks to the gateway over REST, so the NATS layer is not its business. When the app is
extracted, `contracts` becomes a published package or a copied types file, and keeping the
import surface to plain enums and interfaces is what keeps that cheap.

## 8. D6: data, auth, and offline posture

Recorded here because every page plan depends on it. The detail belongs to the
`data-access` plan, which comes after the first page mocks are approved.

- **Transport.** REST to the gateway. All calls carry the bearer token and an
  `Accept-Language` matching the active locale, because the backend localizes error
  messages. Errors come back as RFC 7807 problem documents with a correlation id, so the
  UI has a stable error code to switch on and an id worth surfacing in a support copy
  action rather than a raw message.
- **Identity.** Three states the UI must handle everywhere: anonymous, **temporary** user
  (minted by creating or joining a zone, holds a real token, has no credentials), and
  registered. The temporary state is a first class product state, not an edge case, and
  the home page is where it is most visible. A temporary user's token is the only proof of
  their identity, so losing it loses their data, which the UI has to communicate without
  nagging.
- **Realtime.** WebSocket to the realtime service with SSE as the fallback, joining zone
  and list rooms. Presence and live updates are core to a collaborative list. Every screen
  that shows shared data must be built to receive an update it did not initiate.
- **Concurrency.** The backend is last write wins with a `version` column for
  reconciliation. The UI updates optimistically and reconciles when the realtime event
  arrives, and must show when a change was overwritten by someone else.
- **Offline.** No service worker in this phase, but the data layer is written as if there
  will be one: queued mutations, an explicit connection state in the UI, and no screen that
  breaks when a request is in flight or has failed. A shopping list is used in a
  supermarket, where signal is bad. This is a product requirement, not a nicety.

## 9. How the page plans work

The rule for this project: **every page is mocked, documented, and planned before it is
built.** Each page gets one numbered plan in this directory containing, in this order:

1. **Purpose.** What the user is trying to do, in one paragraph.
2. **Mock.** A link to the approved visual mock, plus which artboards it contains.
3. **States.** Every state the page can be in, each one mocked or explicitly described:
   loading, empty, error, offline, and the auth states that change the page.
4. **Anatomy.** The regions of the page, top to bottom, with the component that renders
   each and which library it lives in.
5. **Data.** The gateway calls and realtime subscriptions, with the contract types.
6. **Localization.** The translation keys the page introduces, English and Spanish.
7. **Accessibility and input.** Touch targets, focus order, labels, and what has to work
   one handed on a phone.
8. **Acceptance criteria.** A checklist specific enough to test against.
9. **Out of scope.** What this page deliberately does not do yet.

A page plan is not ready for development until its mock is approved.

## 10. Plan index

| Plan | Subject | Status |
| --- | --- | --- |
| `0001` | This document: overview and architecture | Written |
| `0002` | Design system and theming | Written |
| `0003` | Home page | Written, mock pending approval |
| later | App and library scaffolding | Not written |
| later | Data access, auth, and realtime | Not written |
| later | One plan per remaining page, in build order | Not written |

Scaffolding is deliberately **not** plan `0002`. Nothing is generated until enough of the
design is settled that the shape of the libraries is known, which is the point of doing
the mocks first.

## 11. Open questions

1. **Product name.** Everything is built to survive a rename (rule N1), so this does not
   block. It does need an answer before anything is published or submitted to a store.
2. **Spanish and English only?** Assumed yes, matching landingV2 and the backend error
   catalog. Say so if a third locale is expected, because it changes nothing structurally
   but does change the translation workload per page.
3. **Store target.** Play Store via TWA is assumed, since it is the cheap path from a PWA.
   iOS App Store does not accept a plain web wrapper, and reaching it means Capacitor or a
   native shell, which is a much larger decision. It does not affect this phase but should
   be settled before the standalone phase.
4. **Does the public marketing surface live here at all**, or on the portfolio as a
   project page? If Luna keeps a marketing page, it is the one route that genuinely wants
   SSR, and it may be better served as a prerendered page than as part of the app.
