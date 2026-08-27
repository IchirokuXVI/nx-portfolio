# 0001 Velista frontend: overview and architecture

> Paths are repo relative. Never use relative imports across lib boundaries, use the
> `@portfolio/<scope>/<lib>` aliases. **Commit locally only, never push** (CLAUDE.md
> git workflow). This plan set covers the **frontend** only. The backend plan set lives
> in `apps/luna-shopper-backend/plans/` and is not repeated here.

## 1. Goal

Ship the Velista client: a phone first, installable, collaborative shopping list
app that talks to the existing `luna-shopper-backend` gateway over REST and to the
realtime service over WebSocket or SSE.

This document is the index and the architecture record for the whole frontend. It fixes
the decisions that every later page plan depends on. **Every page gets its own numbered
plan with an approved mock before any of it is built** (see section 9).

## 2. Naming

The product is named **Velista** (decided 2026-08-25). It comes from *velero*, a sailing
boat: a *velista* is the person sailing it. "Luna Shopper" is the discarded earlier working
title and survives only as an internal codename in directory and Nx project names.

Rule N1 stays in force even though the name is now settled, because its value was never
only about this rename:

> **Rule N1.** The product name must never be hardcoded in a component, a CSS token, a
> route path, a class name, a translation key, or an asset filename. It appears only as
> **values** in one brand configuration object and in the translation JSON files. Renaming
> the product must be a change to data, never a refactor.

The name has already changed once. Keeping it out of the code costs nothing and means a
second change, or a different name per market, stays a data edit. It also keeps the
codename and the product name from being confused for one another.

### 2.1 Rule N2: the UI says "group", the code says "zone"

The domain object the backend calls a **Zone** is called a **group** in English and a
**grupo** in Spanish everywhere a user can read it. The backend word means nothing to
someone opening a shopping list app.

> **Rule N2.** This is a **translation layer decision only**. Nothing in the code changes
> name: the API paths stay `/v1/zones`, the contract types stay `ZoneView`, `ZoneRole` and
> `MembershipStatus`, the enums keep their values, the routes stay `zones/:zoneId`, and
> component and service names keep saying zone. The word "group" exists **only as values in
> the translation JSON**.

Two consequences worth internalising, because both are easy to get wrong:

- **Never rename a code symbol to match the UI word.** A `GroupCardComponent` talking to
  `ZoneService` about a `MyZoneView` is exactly the confusion this rule is meant to prevent.
  The component is `ZoneCardComponent` and it renders a translated label.
- **Never build the user facing word by string concatenation** in a way that assumes English
  grammar. "group" and "grupo" differ in gender agreement in Spanish, so phrases like "your
  groups" and "no groups yet" are whole translation keys, not a noun glued to a prefix.

If the user facing word changes again later, it is a change to two JSON files and nothing
else. That is the entire point of keeping it out of the code.

Technical identifiers, which are internal and stay stable across a rename:

| Thing | Value | Why |
| --- | --- | --- |
| Nx project / module federation name | `velista` | MF names must be valid JS identifiers, so no hyphen is allowed |
| App directory | `apps/velista` | Named for the product, not the backend |
| e2e project | `velista-e2e`, directory `apps/velista-e2e` | Matches `landingV2-e2e` |
| Routes alias | `velista/Routes` | Matches the other remotes |
| Library directory | `libs/velista/*` | See D5 |
| Library alias | `@portfolio/velista/<lib>` | See D5 |
| Dev port | **4205** | 4200 shell, 4201 landing, 4202 odontogram, 4203 damoclesSword, 4204 landingV2 |

> **The frontend was renamed to `velista` on 2026-08-25, and the backend was deliberately
> left alone.** So `apps/velista` sits next to `apps/luna-shopper-backend`, and the
> frontend libraries `libs/velista/*` sit next to the backend's `libs/luna-shopper/*`.
>
> That asymmetry is intentional, not an oversight mid rename. The two are separate
> deployables that share exactly one thing, `@portfolio/luna-shopper/contracts`, and
> renaming the backend is a large job touching image names, Helm keys, CI and migrations
> that buys nothing. The frontend rename was done now precisely because no file of it
> existed yet, which is the only moment it is free.
>
> **Consequence to remember:** in this repo `luna-shopper` now means *the backend*, and
> `velista` means *the frontend*. Anything still saying `luna-shopper` in a frontend
> context is a leftover and should be fixed, with one exception, the contracts import.

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
2. **All logic lives in `libs/velista/*`.** `apps/velista`
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
   `/<locale>/velista` prefix. A single injectable base path token supplies it, and
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
nothing inside `velista` can be server rendered, whatever that remote's own build
does.

This is confirmed by the toolchain actually installed in this workspace. In Nx 22.7.2,
`node_modules/@nx/angular/src/generators/remote/schema.json` documents its `ssr` option as:

> "Whether to configure SSR for the Producer (remote) application to be consumed by a
> Consumer (host) application **using SSR**."

So a remote's SSR support exists only to serve an SSR host. Nx does support Angular
module federation with SSR, but the supported shape is "SSR host plus server builds for
the remotes it renders", never "one SSR remote under a client rendered host".

### 4.1 What enabling it would actually cost

Turning `shell` into an SSR host is a portfolio wide change, not a Velista change:

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
  `ichirokuxvi.com/en/velista`, its scope sits inside the portfolio origin and it
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
purely additive: a mobile first layout, touch sized targets, and every mutation funnelled
through one place in `data-access` so an offline queue can be slotted in behind it without
touching a component. See D6, which also covers the deliberately minimal, temporary
handling of connection loss in the meantime.

## 6. D4: routing

Locale first, like every other app here (CLAUDE.md "Locale-first routing"). The app mounts
at `/<locale>/velista` and all of its own routes are relative to that.

### 6.1 A route ordering trap in the shell

`apps/shell/src/app/app.routes.ts` currently ends its `:locale` children with an
empty path route that loads `landingV2/Routes`, followed by a wildcard. An empty path
route with `loadChildren` is **not terminal**: Angular will hand the remaining segments to
landingV2's own route table. So a `velista` route appended after it would never be
reached, and the user would land on landingV2's not found page instead.

> **The `velista` route must be inserted before the empty path `''` entry**, next to
> `odontogram` and `damoclesSword`. The scaffolding plan will call this out again with the
> exact diff, and the e2e suite must cover `/<locale>/velista` resolving to this app,
> so a future route reshuffle cannot silently break it.

### 6.2 Route table

Deep links matter here, because sharing a list or a zone invite is a core product action,
and because those links are what a store wrapper will open later.

Route paths keep the word `zones` per rule N2, even though the page is called a group in
the interface.

| Route | Page | Access | Plan |
| --- | --- | --- | --- |
| `''` | The front door | Public, anonymous only | `0003`, `0007` |
| `home` | The dashboard | Authenticated | `0003`, `0007` |
| `zones/:zoneId` | Group detail, its lists | Authenticated, zone member | `0010` |
| `zones/:zoneId/members` | Members and roles | Authenticated, zone member; governance is staff only | `0010` |
| `lists/:listId` | Shopping list, the main screen | Authenticated, list access | later |
| `lists/:listId/lines/:lineId` | Line detail and comments | Authenticated, list access | later |
| `zones/new`, `home/zones/new` | Name a group, as a sheet over the page beneath | Public / authenticated | `0008` |
| `zones/join`, `home/zones/join` | Enter a join code, as a sheet | Public / authenticated | `0008` |
| `join/:code` | Join a zone from a shared code or link | Public, adaptive | `0008` |
| `auth/login`, `auth/register` | Sign in and register | Public, anonymous only | `0009` |
| `auth/upgrade` | Turn a guest account into a real one, in place | **Guest only** | `0009` |
| `auth/verify` | Consumes an email confirmation token | Public | `0009` |
| `auth/callback` | Consumes the token pair the backend redirects back with after Google | Public | `0009`, blocked on the backend |
| `account` | Profile, upgrade a temporary account, delete | Authenticated | `0013` |
| `settings` | Locale, theme, density | Any | later |

Numbers are assigned when each page plan is written, in build order, so this column is
filled in as the set grows.

## 7. D5: library layout

New scope: **`libs/velista/*`**, alias `@portfolio/velista/<lib>`.

It is deliberately **not** folded into the existing `libs/luna-shopper/` scope, which holds
backend libraries (`contracts`, `platform`, `test-fixtures`). Two reasons: `platform` is
NestJS specific and must never be reachable from browser code, and keeping the whole
frontend under one directory makes the eventual extraction a directory move.

| Library | Type | Contents |
| --- | --- | --- |
| `models` | types | The app's own domain models and enums, view models, form models, and the target of the mapping from contract DTOs (`0004` rule D4) |
| `platform` | services | Wraps the runtime environment rather than the backend: browser facade, theme, connection state, storage. Added by `0004` section 3, which explains why `ui` needs it and cannot reach `data-access` |
| `data-access` | services | Gateway HTTP clients, the DTO to model mappers, auth and token store, realtime client, offline queue, DI tokens |
| `ui` | presentational | Layout shell, theme tokens, and every dumb component, plus the i18n namespace |
| `feature-home` | routed | The home page (`0003`) |
| `feature-zones`, `feature-lists`, `feature-auth`, `feature-account` | routed | One per area, added as their plans land |

`models` and `ui` must not import `data-access`. Feature libraries compose the others. The
full layering, and the reason `platform` had to exist for this rule to be workable, is in
`0004` section 3.
Note that `@nx/enforce-module-boundaries` is configured permissively in this workspace
(`onlyDependOnLibsWithTags: ['*']`), so lint will **not** catch a violation of this. It is
a review responsibility.

### 7.1 The contracts seam

The frontend imports `@portfolio/luna-shopper/contracts` for the message shapes, so that the
wire format is described in exactly one place across the whole product. This is the reason
the backend rename in plan `0014` deliberately left the libraries alone.

**Import types only.** Never import the NATS message patterns, the ajv schema registry, or
anything that pulls a Node dependency into a browser bundle. The frontend speaks to the
gateway over REST, so the NATS layer is not its business. When the app is extracted,
`contracts` becomes a published package or a copied types file, and keeping the import
surface to plain interfaces is what keeps that cheap.

> **Amended by `0004` rule D4 (2026-08-26).** This section originally said "import enums and
> types only". It is now **types only**, and the import must be a literal `import type`.
> The app declares its **own** enums in `models` and maps into them at the boundary, so
> nothing off the wire is trusted and a backend change lands in one mapper. The practical
> gain is that a type only import is erased at compile time, so the `ajv` the contracts
> barrel re-exports (`contracts/src/index.ts:32`) can never reach the bundle. See `0004`
> sections 4.1 and 9.3.

## 8. D6: data, auth, and offline posture

Recorded here because every page plan depends on it. The detail belongs to the
`data-access` plan, which comes after the first page mocks are approved.

- **Transport.** REST to the gateway. All calls carry the bearer token and an
  `Accept-Language` matching the active locale, because the backend localizes error
  messages. Errors come back as RFC 7807 problem documents with a correlation id, so the
  UI has a stable error code to switch on and an id worth surfacing in a support copy
  action rather than a raw message.

  **One HTTP interceptor owns all of that**, plus the trace header below. Every outgoing
  header is decided in one place, so nothing is set per call site and nothing is forgotten.
- **Tracing: send `traceparent` once the backend is ready for it.** Backend plan
  `0016-tracing-and-metrics.md` (written, **not yet implemented**) adds OpenTelemetry with
  W3C trace context propagated across every hop, and it explicitly means the trace to run
  from the originating HTTP request through to the realtime push another user's browser
  receives. That tree starts one hop too late unless the **browser** emits the
  `traceparent`, so when 0016 lands the interceptor should generate and send it, and the
  correlation id stays exactly as it is (0016 promises the log and event contracts do not
  change). Recorded now because it is a few lines in an interceptor that already exists,
  and a retrofit across every call site later if it is forgotten.
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
- **Connection loss: deliberately minimal, and temporary.** Decided by the user on
  2026-08-25. There is **no offline queue, no background sync, no optimistic replay and no
  service worker** in this phase. Losing the network shows **one blocking screen** saying
  the connection is gone, and the app **reloads itself when the connection returns**.
  Implementation is a `navigator.onLine` listener plus the `online` and `offline` window
  events, both reached through the injectable browser facade rather than touched directly,
  so the standalone SSR build keeps working.

  Recorded plainly so it is not mistaken for a finished design: this is **weak for the
  product's actual use case**, a shopping list used in a supermarket where signal is bad,
  and a full screen block plus a reload can lose what someone was typing. It is a
  placeholder chosen to get the app shipped, and it is the first thing the PWA work should
  replace. Two constraints keep that door open at no cost now:
  - Mutations still go through a single choke point in `data-access`, so a queue can be
    added behind it later without touching a component.
  - No screen may assume a request succeeds. Every mutation has a visible failure path.

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
| `0001` | This document: overview and architecture, plus the app and library scaffolding | **Implemented** |
| `0002` | Design system and theming | **Implemented** |
| `0003` | Home page | **Implemented**, mock approved 2026-08-25 |
| `0004` | Data access, auth, and realtime | **Implemented** except the Socket.IO transport |
| `0005` | Injector scope, and one place to declare test providers | **Implemented** |
| `0006` | Translation ownership: feature-shell composes, and waits | **Implemented** |
| `0007` | Splitting the front door from the dashboard | **Implemented** |
| `0008` | The way in: creating a group, and joining with a code | Written 2026-08-26, **mock approved** |
| `0009` | Credentials: signing in, registering, and keeping a guest account | Written 2026-08-26, mock awaiting approval |
| `0010` | The group: its lists, and the people in it | Written 2026-08-27, **mock not drawn** |
| `0011` | Seven UI defect fixes found by using the app after `0010` | Written 2026-08-27 |
| `0012` | The list: its lines, and editing them | Written 2026-08-27, mock awaiting approval |
| `0013` | The account: your name, your email, and the two ways out | Written 2026-08-27, mock awaiting approval |
| later | One plan per remaining page, in build order | Not written |

The route table in section 6.2 is the build order that remains. `0008` and `0009`
together finish the front door: once both are built, every control drawn on the
anonymous screen leads somewhere real, and what is left is the product itself, group
detail and then the shopping list. `0010` is the first half of that: it makes every
group on the dashboard tappable and gives a join request somewhere to be answered,
which is what `0008` could produce and could not resolve.

Scaffolding is deliberately **not** plan `0002`. Nothing is generated until enough of the
design is settled that the shape of the libraries is known, which is the point of doing
the mocks first.

## 11. Open questions

1. **Spanish and English only?** Assumed yes, matching landingV2 and the backend error
   catalog. Say so if a third locale is expected, because it changes nothing structurally
   but does change the translation workload per page.
2. **Store target.** Play Store via TWA is assumed, since it is the cheap path from a PWA.
   iOS App Store does not accept a plain web wrapper, and reaching it means Capacitor or a
   native shell, which is a much larger decision. It does not affect this phase but should
   be settled before the standalone phase.
3. **Does the public marketing surface live here at all**, or on the portfolio as a
   project page? If Velista keeps a marketing page, it is the one route that genuinely wants
   SSR, and it may be better served as a prerendered page than as part of the app.
