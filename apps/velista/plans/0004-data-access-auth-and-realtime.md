# 0004 Data access, auth, and realtime

> Prerequisite reading: `0001` (D5 library layout, D6 data and auth posture, the
> extraction contract) and `0003` (the first page that consumes this layer).
>
> This is **not** a page plan, so it does not follow the section 9 template in `0001`.
> It is the layer every page plan from `0003` onward depends on, and it is deliberately
> written before `0003` is built so that the home page is the first consumer of a settled
> contract rather than the place the contract gets invented.
>
> Every backend fact in this document was verified against the source on 2026-08-26 and is
> cited by file and line. Where the plans and the code disagreed, the code won and the
> disagreement is recorded rather than quietly resolved.

## 1. Purpose

Define how the Velista client talks to the backend, holds identity, and stays live: the
transport, the error model, the token lifecycle, the realtime connection, and where state
lives.

Two of those are worth more than the rest, because they are the ones that cost the most to
change later: **which library is allowed to make a request** (rule D1, section 2) and
**nothing crossing the network boundary without being mapped into a type this app owns**
(rule D4, section 4.1). Both are boundary rules, and a boundary is cheap to draw once and
expensive to draw again.

Nothing here is a screen. The deliverable is a set of services, tokens, and rules that
`feature-home` and every feature library after it consume without knowing whether they are
talking to a real gateway or an in-memory fake.

Four things the backend owes this layer are collected in section 11. None of them block
frontend work, because of section 9, and none of them are this plan's to build.

## 2. The question this plan settles: who makes the request

### 2.1 The rule

> **Rule D1. A `feature-*` library requests. A `ui` library never does.**
>
> A routed container in `feature-*` injects the data tokens, owns the page's state, and
> passes plain values down. A component in `ui` receives `input()` and emits `output()`.
> It has no data service, no HTTP, no realtime subscription, and no knowledge that a
> backend exists.

This restates `0001` section 7, which already says `models` and `ui` must not import
`data-access`. It is repeated here with its reasoning, because the reasoning is what makes
a rule survive contact with a deadline, and because **the rest of this workspace does the
opposite**, so the pattern a developer would reach for is the wrong one.

### 2.2 Why the damoclesSword pattern does not transfer

`libs/damoclesSword/ui/src/lib/section-news/section-news.ts:24` injects `NEWS_SERVICE` and
fetches in `ngOnInit`. `libs/damoclesSword/ui/src/lib/contact-form/contact-form.ts:35`
injects `CONTACT_SERVICE` and submits. That is a `ui` library making requests, and in that
app it is fine: damoclesSword is a read only marketing site where each section owns one
independent query, nothing arrives unbidden, and two components never show the same record.

Velista breaks all four of those assumptions:

- **The same record appears twice on one screen.** In `0003` a zone is rendered by the
  resume card and by its zone card. If each fetches for itself there are two copies of one
  zone, and a realtime `zone.updated` reaches whichever component happens to be listening.
  One owner per screen is what keeps a single source of truth.
- **Data arrives without being asked for.** `0001` D6 requires that every screen showing
  shared data can receive an update it did not initiate. A component that owns its own
  fetch owns a fetch lifecycle, not a subscription lifecycle, and retrofitting the second
  onto the first is where the bugs live.
- **The page is a state machine, not a stack of independent sections.** `0003` section 3
  lists ten states, and section 4 says the page component holds no logic beyond choosing
  which of them to render. Self fetching children cannot participate in that: each resolves
  on its own schedule, so the loading state becomes a field of separate spinners instead of
  the skeleton layout `0003` explicitly asks for, and the page level error state never
  fires because the failure was swallowed three components down.
- **Mutations must funnel through one place.** `0001` D6 promises that an offline queue can
  be added later without touching a component, which is only true if components never call
  a mutation directly. `0003` also requires a visible failure path on every mutation, and
  that is a page level concern: the component that failed is often not the component that
  should show it.

Two further reasons that have nothing to do with correctness today and everything to do
with `0001`:

- **Extraction and SSR.** A component whose inputs are plain values renders on a server
  with no HTTP layer at all. A component that fetches in `ngOnInit` needs the whole
  transport stack stood up before it can be rendered or tested.
- **Testing and design review.** `0002` and `0003` both require every state to be checked
  in both themes at 320px and at 200% zoom. Driving an input driven component into its
  error state is one line. Driving a self fetching component into its error state means
  mocking a service, which is why in practice those states go unchecked.

### 2.3 What a container looks like

Each route in the table in `0001` section 6.2 gets exactly one container in its `feature-*`
library. The container is the only thing in the app that injects a data token.

```ts
// libs/velista/feature-home/src/lib/home-page/home-page.ts
@Component({
  selector: 'lib-home-page',
  imports: [/* ui components only */],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly _zones = inject(ZoneStore);
  private readonly _session = inject(SessionStore);

  /** One derived signal. The template chooses a state and renders it, nothing more. */
  readonly state = computed(() =>
    selectHomeState(this._session.identity(), this._zones.myZones())
  );
}
```

`selectHomeState` is a **pure function** in `feature-home`, not a method, because `0003`'s
acceptance criteria require unit tests over the state selection logic and a pure function
is the cheapest thing in the world to test exhaustively.

### 2.4 The cost, and what pays for it

Rule D1 is not free. It buys correctness with prop drilling: a value needed five levels
down is threaded through five components, and the container grows.

Three things keep that from becoming the problem it usually is, and they are requirements,
not suggestions:

1. **The view model is assembled once, in the container**, as a `computed` shaped like the
   page rather than like the API. A zone card receives one `ZoneCardVm`, not eight separate
   inputs. `libs/velista/models` owns those view model types, which is exactly what `0001`
   section 7 means by "the mapping from contract DTOs to what components consume".
2. **The tree is shallow.** `0003`'s anatomy is at most three levels deep. Phone screens do
   not nest far, so the drilling this rule causes is genuinely small.
3. **If a container exceeds roughly 150 lines, extract a facade** into the same feature
   library, not into `ui`, and not into `data-access`. A facade is page shaped; a store is
   domain shaped. See section 7.1.

### 2.5 The one exception, stated precisely so it cannot be widened

A `ui` component may inject a service that is **ambient and not data**: the translator
(`RokuTranslatorService`, already used by every `ui` library here), the router, and the
platform services in section 3. It may never inject anything that reads or writes backend
state.

The test for whether something is ambient: **would two instances of this component disagree
about it?** Two components asking the translator for the active locale always agree. Two
components fetching a zone can disagree, and that is the whole problem.

## 3. A fourth library: `platform`

### 3.1 The problem

`BrowserFacade` currently lives in `libs/velista/data-access/src/lib/browser-facade.ts`.
Two of its consumers are `ui` components:

- `ConnectionLostComponent` (`0003` section 4) reads the `onLine` signal. It is listed as
  living in `ui` and being shared by every page, and in practice it is rendered by
  `AppLayout`, which is already in `libs/velista/ui`.
- The theme override (`0002` section 12) is "a persisted user override behind an injectable
  storage facade", and the theme lives in `ui`.

Both need `BrowserFacade`, and rule D1 plus `0001` section 7 forbid `ui` from importing
`data-access`. As the plans stand they contradict each other.

### 3.2 The resolution

Add `libs/velista/platform`, alias `@portfolio/velista/platform`: a small library for
services that wrap the **runtime environment** rather than the **backend**.

| Layer | Library | May import |
| --- | --- | --- |
| 1 | `models` | nothing in this scope |
| 2 | `platform` | `models` |
| 3 | `ui` | `models`, `platform` |
| 3 | `data-access` | `models`, `platform` |
| 4 | `feature-*` | all of the above |

`ui` and `data-access` stay siblings that cannot see each other, which is the property rule
D1 depends on. `platform` is what they are allowed to share.

### 3.3 What moves, and what does not

| Moves to `platform` | Stays in `data-access` |
| --- | --- |
| `BrowserFacade` | `ApiUrl` |
| `ThemeStore` (`0002` section 4.5, moved here when the two plans merged) | Every gateway client |
| `StorageKeys` and the storage namespace | `TokenStore` and `SessionStore` |
| `ConnectionState` (section 8) | The realtime client |
| `ReloadBlocker` (section 8) | The stores and the mutation choke point |
| `decodeJwtExpiry` (section 5.2) | |

The move is cheap right now: `BrowserFacade` landed with the scaffolding and, verified
across `libs/velista`, has **zero** dependents outside its own spec. It gets expensive the
moment `data-access` fills up, which is what this plan does to it.

`APP_KEY` also moves, from `libs/velista/ui/src/lib/app-locales.ts` to `models`. It is a
plain technical identifier, it already namespaces persisted state (`roku-locale:{appKey}`),
and `platform` needs the same namespace for the token store while sitting below `ui`. `ui`
keeps re-exporting it so `feature-shell`'s import is unaffected.

**Why `platform` and not `util`.** Nx's `util` convention is for stateless helpers. These
are injectable, stateful, singleton services wrapping the environment, and naming the
library for what it holds keeps someone from filing a date formatter next to the browser
facade.

## 4. The boundary: mapping and transport

### 4.1 Rule D4: nothing crosses the boundary unmapped

Decided by the user on 2026-08-26, and it governs everything else in this section.

> **Rule D4. Every value that arrives from the network is mapped into a type this app owns
> before it reaches a store, a container, or a component.** That covers HTTP response
> bodies, realtime event payloads, and problem documents alike. A frontend model that
> happens to be field for field identical to the backend's is fine and expected. What
> matters is that it is **ours**: when the backend model changes, the frontend one does not
> have to.

Three things it buys:

1. **A backend change becomes one failing mapper instead of twenty runtime surprises.** If
   `MyZoneView` gains, renames, or drops a field, the mapper is the only thing that has to
   move, and every consumer keeps compiling against the same frontend type.
2. **Nothing off the wire is trusted.** The mapper is where a missing field becomes a
   default, an unrecognised enum value becomes a defined fallback rather than a crash, and a
   `null` the type promised was impossible stops being a template's problem three levels
   down. This app talks to a service being built in parallel, from a phone that may be
   running a bundle cached days ago, so "the response does not match the type" is an ordinary
   event and not somebody else's bug.
3. **Extraction gets cheaper.** `0001` section 7.1 says the contracts library becomes a
   published package or a copied types file when the app leaves. With mapping at the
   boundary, contract types are referenced from exactly one directory.

What it looks like in practice:

- **`libs/velista/models` owns a type per domain object the app renders**, plus its own
  enums and unions. It does not re-export a contract type under a new name, because that is
  the same coupling with extra steps.
- **`libs/velista/data-access` owns a mapper per type**, `toZone`, `toList`, `toLine`, next
  to the client that calls the endpoint. Stores hold mapped types. **Nothing downstream of a
  mapper imports from `@portfolio/luna-shopper/contracts`.**
- **A mapper takes `unknown`, not the contract type.** Typing the parameter as the DTO
  asserts precisely the thing this rule exists to stop assuming. The contract type is
  documentation inside the mapper and the shape the fixtures are built to, never a guarantee
  about a byte stream.
- **Unrecognised enum values are mapped, not passed through.** `ZoneStatus`,
  `MembershipStatus`, `ZoneRole`, `LineStatus`, `LineApprovalStatus` and `UserKind` each get
  a frontend union with a defined fallback. A `ZoneStatus` this build has never heard of
  renders as the plain non tappable card `0003` open question 2 already asks for, rather
  than as an unstyled string or a thrown error.
- **Realtime payloads go through the same mappers.** They carry the same view types
  (section 6.5), and an event is exactly as untrusted as a response body. This is the half
  of the rule that is easiest to forget, because an event does not look like a request.
- **The mapping is one way.** Request bodies are built from explicit request types
  (section 4.10), so a mapped object is never sent back to the server.

**A consequence worth stating, because it retires a problem this plan was carrying.** Once
the app owns its own enums, it no longer needs the backend's **runtime** values, only its
**types**, and `import type` is erased at compile time. So the `ajv` weight described in 9.3
does not reach the bundle, and backend item 1 in section 11 drops from a blocker to hygiene.
Rule D4 pays for itself before a line of it is written.

### 4.2 The gateway surface, as it actually is

Verified against `apps/luna-shopper-backend/gateway`. Facts that shape the client:

- **No global prefix**, and **URI versioning** with no default version
  (`libs/luna-shopper/platform/src/lib/versioning/versioning.ts:14`), so every route is
  literally `/v1/...`. Default port 3000, which is what `environment.ts` already assumes.
- **There is no `@Public()` decorator in the codebase.** Auth is opt **in** per controller
  via `@UseGuards(JwtAuthGuard)`, so an unguarded route is open. Three guard states matter
  to the client: guarded, open, and `OptionalJwtAuthGuard`, which is its own hazard and gets
  section 5.5 to itself.
- **`GET /health/ready` is unversioned and open**
  (`libs/luna-shopper/platform/src/lib/health/health.module.ts:64`). Section 8 uses it.

What `0003` and the pages immediately after it need:

| Call | Auth | Returns |
| --- | --- | --- |
| `POST /v1/auth/register`, `/login`, `/refresh`, `/verify-email` | open | `AuthTokens` |
| `POST /v1/auth/upgrade` | bearer | `AuthTokens` |
| `POST /v1/zones` | **optional** | `{ tokens?: AuthTokens; data: ZoneView }` |
| `POST /v1/zones/join` | **optional** | `{ tokens?: AuthTokens; data: MembershipView }` |
| `GET /v1/zones?cursor&limit&order` | bearer | `Paginated<MyZoneView>`, `order` in `name\|joined\|recent` |
| `GET /v1/zones/:zoneId/lists` | bearer | `Paginated<ListView>` |
| `GET /v1/lists/:id/lines` | bearer | `Paginated<LineView>`, `order` in `position\|created\|updated` |
| `POST /v1/lists/:id/lines`, `PATCH /v1/lines/:id`, `POST /v1/lines/:id/status` | bearer | `LineView` |
| `DELETE /v1/account` | bearer | `{ userId, deleted }` |

**Pagination** is `{ items: T[]; nextCursor: string | null }`
(`libs/luna-shopper/contracts/src/lib/pagination.ts:6`). `limit` is validated to `[1, 100]`
and **out of range is a 400**, not a clamp
(`libs/luna-shopper/platform/src/lib/pagination/page-query.dto.ts:19`); the default page
size is 20. The cursor is opaque and carries the chosen `order`, so a client must not vary
`order` mid page. A malformed cursor restarts from the beginning rather than erroring.

**Two gaps the client cannot work around.** There is no route that lists a zone's members,
so `MembershipView`s only ever arrive as the result of a member action or as a realtime
event. And `ListView` and `LineView` carry **no timestamps**, although `LIST_ORDERS` and
`LINE_ORDERS` offer `created` and `updated` ordering. Anything wanting "last updated" as
displayed text has to derive it from realtime events it observed, not from the record.

### 4.3 One interceptor

> Every outgoing header is decided in one place. Nothing is set per call site.

A functional interceptor registered by the app layer with
`provideHttpClient(withFetch(), withInterceptors([gatewayInterceptor]))`. `withFetch` because
the standalone phase wants it and it costs nothing now.

In order:

1. **Scope check.** The interceptor is global, so it first confirms the request is going to
   the gateway origin from `ApiUrl`. A bearer token must never be attached to a third party
   URL, and this is the only thing standing between the app and that mistake.
2. **`Authorization: Bearer <accessToken>`**, unless the request carries the anonymous
   marker (an `HttpContextToken`) used by login, register, and refresh.
3. **`Accept-Language`** from `RokuTranslatorService.getLocale()`. The backend resolves this
   with q weighting and keeps only the primary subtag
   (`libs/luna-shopper/platform/src/lib/localization/locale.ts:25`), and it is what makes
   the error catalog come back translated.
4. **`x-correlation-id`**, minted client side. See 4.6.
5. **`traceparent`** when backend `0016` lands. See 4.7.
6. **On error**, map to a typed failure, handle 401 by refreshing once (section 5.4), and
   report a no response failure to `ConnectionState` (section 8).

### 4.4 Errors: problem details to typed failures

The backend returns real RFC 7807 with `Content-Type: application/problem+json`
(`libs/luna-shopper/platform/src/lib/errors/problem-details.ts:16`):

```ts
{ type, title, status, code, detail?, message, correlationId, errors? }
```

`code` is one of seven values (`errors/error-codes.ts:12`): `validation_failed`,
`unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal`. It is a
`const` object plus a union type, not a TS `enum`.

**These types must be re-declared in `libs/velista/models`, not imported.** They live in
`@portfolio/luna-shopper/platform`, which pulls Nest, pino, and `node:crypto`, and is never
safe in a browser bundle. That is forced by the backend's layout, not a choice, and it is
the one place in this app where duplicating a backend type is correct.

The interceptor maps every failure to one of two classes:

| Class | When | Carries |
| --- | --- | --- |
| `GatewayError` | a problem document came back | `code`, `status`, `correlationId`, `detail`, `serverMessage`, `fieldErrors` |
| `NetworkError` | no response at all | the client minted `correlationId`, the operation name |

Nothing else is thrown out of `data-access`. A container switches on `code`, never on a
status number scattered through the app.

This is rule D4 applied to the error path, and it needs saying because an error body is the
one most likely to arrive malformed: a proxy, a gateway timeout page, or an unhandled
exception can all produce a non JSON body with an HTTP status. A response that is not a
valid problem document becomes a `GatewayError` with `code: 'internal'` and the client minted
correlation id, never an attempt to read `.code` off whatever came back.

### 4.5 Why the server's `message` is not what the user reads

`ERROR_CATALOG` (`libs/luna-shopper/platform/src/lib/errors/error-catalog.ts:16`) holds
exactly **one generic message per code**. Every 409 in the product reads "That request
conflicts with the current state." The specific reason, "that email is already registered",
exists only in `detail`, which is untranslated developer text.

So:

- **`message` is a fallback, not the copy.** The app owns a translation key per (code,
  operation) pair, so joining with a code that is already used says so, and creating a zone
  with a taken name says something else, even though both are a 409 carrying identical text.
- **`detail` is never rendered.** It goes into the support copy blob alongside the
  correlation id, and nowhere else.
- **`errors` (validation only) is used for its keys, not its strings.** The field names tell
  the form which control to mark; the messages are class-validator English and would appear
  untranslated next to translated copy.

This is worth stating loudly because the obvious implementation, printing `message`, looks
correct in a demo and is nearly useless in the product.

### 4.6 Correlation: the client mints the id

The backend honours an inbound `x-correlation-id`
(`libs/luna-shopper/platform/src/lib/context/correlation.middleware.ts:37`) and mints one
otherwise. It returns the id in the **body** of a problem document and in **no response
header at all**, which was verified by grep rather than assumed.

Therefore the client mints a UUID per request and sends it. Two reasons, and the second is
the one that matters:

- The id the user copies is then the id in the backend logs, with no round trip needed to
  learn it.
- **On a network failure there is no body**, so a server minted id would not exist for
  exactly the failure the user is most likely to be reporting. `0003` promises a copyable
  reference on its error state, and this is what makes that promise keepable in the case
  where the request never arrived.

The last handful of request ids are kept in memory with their operation names, so the
support copy action can include recent context rather than one id.

### 4.7 `traceparent`, deferred

`0001` D6 records this: backend plan `0016-tracing-and-metrics.md` is written and **not
implemented**, and its trace tree starts one hop late unless the browser emits
`traceparent`. When `0016` lands this is a few lines in step 5 of an interceptor that
already exists. The correlation id stays exactly as it is. Nothing is built now.

### 4.8 Rate limits are part of the UI contract

A global 120 per minute bucket
(`libs/luna-shopper/platform/src/lib/throttling/throttler-config.ts:27`), overridden per
route:

| Route | Limit |
| --- | --- |
| `POST /v1/auth/register` | 3 per minute |
| `POST /v1/auth/login` | 5 per minute |
| `POST /v1/auth/verify-email` | 3 per 10 minutes |
| `POST /v1/zones`, `POST /v1/zones/join` | 10 per minute |
| `POST /v1/auth/refresh` | exempt (`@SkipThrottle()`) |

`rate_limited` gets its own copy and its own treatment: the action disables itself rather
than letting the user hammer a button that cannot succeed. This matters most on the join
code screen, where a wrong code is a normal outcome and three wrong guesses is a normal
session.

### 4.9 Never send a property the backend did not ask for

The global validation pipe runs with `forbidNonWhitelisted: true`
(`libs/luna-shopper/platform/src/lib/validation/validation-pipe.ts:12`), so an unrecognised
property is a **400**, not silently stripped.

> Spreading a view model into a `PATCH` body is therefore a bug, not a shortcut. Request
> bodies are built from explicit request types in `models` that mirror the DTOs, and a
> partial update sends only the fields that changed.

### 4.10 CORS in development, and the trap in it

The gateway calls `enableCors` only when `CORS_ORIGINS` is non empty
(`gateway/src/main.ts:31`), with `credentials: true`.

> The origin to allow in development is **`http://localhost:4200`, the shell**, not
> `http://localhost:4205`. Velista runs as a remote inside the shell's page, so the browser's
> origin is the shell's. Port 4205 serves the remote's bundles and is never the document
> origin. `0001` section 3 is the reason this is easy to get wrong.

The realtime gateway is separately permissive (`origin: true, credentials: true`,
`realtime/src/app/socket/realtime.gateway.ts:49`) and needs no configuration.

## 5. Identity and auth

### 5.1 Three states

`0001` D6: anonymous, temporary, registered, and the temporary state is a first class
product state. `UserKind` is `TEMPORARY | REGISTERED`
(`libs/luna-shopper/contracts/src/lib/enums/auth.enums.ts:11`); anonymous is the absence of
a token and has no backend representation.

`SessionStore` in `data-access` exposes one signal that every page reads:

```ts
type Identity =
  | { kind: 'anonymous' }
  | { kind: 'temporary'; userId: string }
  | { kind: 'registered'; userId: string };
```

### 5.2 What the backend actually returns, and what it does not

```ts
interface AuthTokens { userId: string; kind: UserKind; accessToken: string; refreshToken: string }
```
(`libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts:43`.)

**There are no expiry fields on the wire.** No `expiresIn`, no `expiresAt`, no `tokenType`.
The access token is an RS256 JWT with `exp` inside it, default TTL 15 minutes
(`auth/src/app/config/app-config.ts:46`). The refresh token is opaque, 32 random bytes,
default TTL 30 days, stored hashed.

So the client decodes the access token's payload for `exp`. That is a base64url decode and
a `JSON.parse`, no library and no new dependency, and it lives in `platform` because it
needs `atob`.

> It reads `exp` **to schedule a refresh, and for nothing else.** The client never decides
> anything about authorization from a token it did not verify. The server verifies the
> signature on every request; a tampered `exp` buys an attacker a failed request.

### 5.3 Token storage

Both tokens go to `localStorage` through the platform storage facade, namespaced with
`APP_KEY` in the same shape as the existing `roku-locale:{appKey}`.

The namespace is required, not tidiness: while the app is a remote it shares an origin with
the entire portfolio, so an unnamespaced key collides with the shell and the other remotes.
Extraction gives the app its own origin and the namespace becomes harmless.

**Why `localStorage` and not memory or `sessionStorage`, stated with its cost.** For a
temporary user the refresh token **is** the account. `0001` D6: "a temporary user's token is
the only proof of their identity, so losing it loses their data." Memory or session storage
would delete a guest's groups when they close the tab, which destroys the "start without an
account" flow that the whole home page is built around.

The cost is real: a token in `localStorage` is readable by any script that achieves XSS on
this origin, and today that origin is the whole portfolio. What keeps it acceptable for now
is that the app renders no user supplied HTML and never uses `innerHTML`, and that
`0003`'s guest banner exists precisely to move people off this footing. **The correct long
term fix is an httpOnly refresh cookie**, which is a backend change and is recorded in
section 11 as a suggestion rather than a requirement.

### 5.4 Refresh: rotating, single use, and therefore single flight

`POST /v1/auth/refresh` revokes the presented token and issues a new pair
(`auth/src/app/tokens/token.service.ts:85`). Replaying a spent refresh token is a 401.

> Two requests that 401 at the same moment must not both refresh. The first would succeed
> and the second would present a token that the first just revoked, and the user would be
> signed out in the middle of a working session. This is not a rare race: `0003` loads
> zones and subscribes to realtime on the same tick.

`TokenStore` therefore holds **one in flight refresh**. Every caller that needs a fresh
token awaits the same promise, and the result is applied once. On failure the session is
cleared and the app goes anonymous.

Refresh is also **proactive**: before sending, if `exp` is within a small skew (60 seconds
is the starting value), refresh first. That turns most 401 retries into no retries at all,
which matters mainly because of the next section.

### 5.5 Rule D3: never call an optional auth route with a stale token

`OptionalJwtAuthGuard` swallows token errors and falls through to anonymous
(`gateway/src/app/auth/jwt-auth.guard.ts:23`). `POST /v1/zones` and `POST /v1/zones/join`
use it, and when they see no valid identity they **mint a new temporary user**
(`gateway/src/app/zones/zone.controller.ts:53`).

Put those two facts together with a 15 minute access token:

> A guest who leaves the app open for twenty minutes and then taps "Create a group" gets a
> **brand new guest account**. Their previous groups still exist and they now have no
> credential that reaches them, because a guest has no email and no password to sign back
> in with. The app has silently destroyed their data, and it did so to the exact users who
> have the least protection.

> **Rule D3. Before any call to an optional auth route, if a token exists it must be
> valid.** Refresh first if it is expired or near expiry. If the refresh fails while the
> stored identity was `TEMPORARY`, that is the "your guest account is gone" case: tell the
> user before creating a second one. Never mint a new guest silently over the top of an old
> one.

Implementation: the two optional auth calls go through a method that awaits
`ensureFreshToken()` before building the request, and the proactive refresh in 5.4 covers
everything else. Section 11 records a suggestion that the backend reject an expired token on
these routes rather than treating it as anonymous, which would remove the hazard entirely
rather than requiring every client to remember it.

### 5.6 The temporary user handshake

`POST /v1/zones` and `POST /v1/zones/join` return `{ tokens?, data }`. **`tokens` is present
only when a temporary user was just minted**; an already authenticated caller gets the key
omitted. The client persists `tokens` whenever it appears and ignores its absence.

After that the identity is `TEMPORARY`, which is what raises `0003`'s guest banner.
`POST /v1/auth/upgrade` converts in place, taking the user id from the token and never from
the body (`gateway/src/app/auth/auth.controller.ts:64`), and returns a fresh pair.

One gap worth knowing before the account plan is written: the NATS contract has a Google
branch for upgrade (`auth.messages.ts:121`) but **no HTTP route populates it**, so
"link Google to my guest account" is not reachable today. Upgrading a guest means email and
password.

### 5.7 Google: owned by the backend, no Google code in the frontend

**Decided by the user on 2026-08-26.** No Google libraries and no Google script in the
frontend. The backend owns the whole exchange, and the app renders its own button following
Google's branding guidelines, using the `google` icon already assigned to
`libs/velista/ui` by `0002` section 9.

The flow as it must work:

1. The app navigates the browser to `GET /v1/auth/google`, which 302s to Google
   (`gateway/src/app/auth/google.controller.ts:22`).
2. Google returns to `GET /v1/auth/google/callback`.
3. The callback **redirects back to the app with the token pair in the URL fragment**.
4. The app's `auth/callback` route reads the fragment, persists the tokens, clears the
   fragment with a history replace through `BrowserFacade`, and continues to wherever the
   user was going.

**Step 3 does not exist yet.** The callback currently returns `AuthTokens` as a JSON body
(`google.controller.ts:31`), so a browser completing the flow today lands on a page of JSON.
This is recorded as a backend requirement in section 11.

Two details that are the frontend's business:

- **The fragment, not the query string.** A fragment is never sent to a server, so the
  tokens stay out of access logs, out of `Referer` headers, and out of anything a proxy
  records. It is cleared immediately so it does not survive in session history.
- **`auth/callback` is a new route**, and `0001` section 6.2's table does not have it. It is
  public and it is the only route in the app whose job is to consume a URL rather than
  render a page.

**The PWA caveat, recorded honestly because the user raised it.** From an installed PWA in
standalone display mode, a top level navigation to an external origin opens outside the app
window on most platforms: a Custom Tab on Android, a Safari view controller on iOS.
Returning to an in scope URL usually hands control back to the PWA on Android and is less
reliable on iOS. This may force a change, and the fallbacks in order of preference are
recorded now so the decision is cheap later:

1. The callback renders a small page that `postMessage`s the tokens to an opener popup.
   Keeps the app's page state and stays inside the PWA, but popups are blocked in some in
   app browsers.
2. Google Identity Services in the browser, which is the option the user has ruled out for
   now and which would reverse the "no Google code in the frontend" decision.

Nothing else in this plan depends on which is chosen. The app's side is "receive a token
pair from somewhere and persist it" in all three.

### 5.8 Guards

- `authenticatedGuard` sends an anonymous user to `auth/login` carrying a return URL.
- **It must wait for the session to be restored from storage before it decides.** A guard
  that runs before the token is read out of `localStorage` bounces a signed in user to the
  login screen on every reload, and it does it intermittently, which is the worst kind of
  bug to be handed later. The session bootstrap resolves before the first guarded navigation.
- Public and adaptive routes (home, `join/:code`, `auth/callback`) take no guard and read
  `SessionStore` themselves. `0003`'s home page is adaptive by design, not unguarded by
  omission.

## 6. Realtime

### 6.1 Transport

**Socket.IO**, confirmed from `@nestjs/platform-socket.io` plus the gateway declaration at
`realtime/src/app/socket/realtime.gateway.ts:49`. There is no `path` or `namespace` option,
so it is the default `/socket.io` path on the realtime origin, default port 3001, which is
what `environment.ts` already assumes.

> **This plan adds exactly one runtime dependency: `socket.io-client`**, matching the
> server's `socket.io ^4.8.3`. It is the only new package in the whole plan.

An **SSE fallback exists** and works: `GET /v1/zones/:id/stream` and
`GET /v1/lists/:id/stream` (`realtime/src/app/sse/sse.controller.ts:39,50`), authenticated
by a `?token=` query param because `EventSource` cannot set headers. Both transports are fed
by one in process relay (`relay/event-relay.service.ts:26`), so **the payloads are
identical**.

**Decision: build the Socket.IO transport behind a `RealtimeClientI` interface, and do not
build the SSE transport yet.** `0001` D6 names SSE as the fallback, and it stays the plan,
but a second transport with no evidence that the first one fails is speculative work. The
interface costs nothing, the payloads are identical, and adding the SSE implementation later
is a new class behind the same token.

### 6.2 Connecting, and a failure mode with no error event

Connect with `io(realtimeBaseUrl, { auth: { token } })`. The handshake auth object is the
first thing the server checks (`realtime.gateway.ts:184`), ahead of an `Authorization`
header and a query param.

On an invalid token the server calls `client.disconnect(true)` (`realtime.gateway.ts:85`)
and **emits nothing**. The client therefore cannot tell an auth rejection from a dropped
network, and Socket.IO's default behaviour on an unexplained disconnect is to reconnect,
which against an expired token is an infinite loop against the server.

Two rules follow:

- **Ensure a fresh access token before connecting and before every reconnect**, using the
  same `ensureFreshToken()` as rule D3. This removes the common cause.
- **If two consecutive connects fail while holding a token that was fresh when sent, stop
  and report degraded**, rather than reconnecting forever. Realtime being down is not the
  same as the app being offline: `0003`'s blocking screen is for a lost network, and a
  realtime service that will not accept us must not trigger it.

### 6.3 Rooms, acknowledgements, and refcounting

Rooms are `zone:{zoneId}` and `list:{listId}`
(`contracts/src/lib/messages/realtime.messages.ts:12`). The client sends `zone.subscribe`,
`zone.unsubscribe`, `list.subscribe`, `list.unsubscribe`, and the four presence messages,
each **acknowledged with `{ ok: boolean }`** (`realtime.gateway.ts:31`).

- **`{ ok: false }` means the server refused, usually authorization.** It is not retried. It
  is surfaced, because a zone whose room was refused will silently never update and looking
  live while being stale is worse than looking broken.
- **Subscriptions are refcounted.** Two containers can both want zone X. Subscribe on the
  transition to one, unsubscribe on the transition to zero, with a short grace period so a
  navigation away and back does not churn a room.
- **Every subscription is re-issued on `connect`.** Socket.IO rooms are per connection and
  server side, so a reconnect silently leaves the client in no rooms at all. Forgetting this
  produces an app that works until the first network blip and then goes quietly stale, which
  is exactly the failure this whole layer exists to prevent.

### 6.4 A long lived socket and a 15 minute token

The token is verified once, at handshake. A socket opened with a valid token keeps working
past that token's expiry until the connection drops.

The correct behaviour is the boring one: **do not reconnect when a refresh happens.**
`TokenStore` is the source of truth and the socket reads it at connect time, so the next
reconnect naturally uses the current token. Tearing down a healthy connection every fifteen
minutes would cost a full resubscribe cycle for no benefit.

### 6.5 Events into stores

Twenty four server to client events (`contracts/src/lib/events/realtime.events.ts:7`).
Grouped by the store that applies them:

| Store | Events |
| --- | --- |
| `ZoneStore` | `zone.updated`, `zone.deleted`, `zone.markedForDeletion`, `zone.ownershipChanged`, `member.joined`, `member.approved`, `member.rejected`, `member.kicked`, `member.banned`, `member.roleChanged`, `merge.requested`, `merge.approved`, `merge.rejected` |
| `ListStore` | `list.created`, `list.updated`, `list.deleted`, `list.accessChanged`, `line.added`, `line.updated`, `line.reordered`, `line.deleted`, `comment.added` |
| `PresenceStore` | `presence.zoneUpdated`, `presence.listUpdated` |

**Every payload here is mapped before it is stored** (rule D4, 4.1). An event is not more
trustworthy than a response body; it is less, because it arrives from a connection that was
authenticated once, minutes ago, and it is not correlated with anything the app asked for. A
payload that does not map is dropped and counted, never written into a store half formed.

Three payloads are not the shape their name suggests, and each has burned someone before:

- `member.rejected` is `{ id, userId }`, **not** a `MembershipView`.
- `line.reordered` is `{ listId, orderedLineIds }`, a permutation rather than a set of rows.
- `line.updated` also fires for approval and status changes
  (`core/.../lists/line.service.ts:119,139,150`), so there is no separate "status changed"
  event to listen for.

`zone.markedForDeletion` connects to `0003` open question 2: the page must not crash on a
zone in that state, and renders it as a plain non tappable card until it gets a real
treatment.

### 6.6 The zone room gives list traffic for free

List scoped events are broadcast to **both** `list:{listId}` and `zone:{zoneId}`
(`realtime/src/app/consumer/jetstream.consumer.ts:182`). Two consequences, one good and one
to keep an eye on:

- **Home subscribes to zone rooms only** and still receives `list.created`, `line.added`,
  and the rest for those zones. That is what makes `0003`'s live counts cheap, and it is
  worth knowing before someone subscribes to every list on the home screen to get them.
- **A user in a busy zone receives every line event for every list in it**, on a phone
  connection, whether or not that list is on screen. If that turns out to hurt, the fix is a
  backend one, a coarser zone level summary event, not a client side filter that has already
  paid the bytes.

### 6.7 Presence is advisory

Presence is held in memory in a single replica
(`realtime/src/app/presence/presence.service.ts:22`). It is correct with one replica and
wrong the moment the service scales, and nothing in the deployment prevents that.

`0003` puts presence on the resume card. **The UI treats presence as advisory**: it may
under report, it is never used to gate an action, and nothing destructive is ever guarded by
"nobody else is here".

## 7. State: stores, optimistic mutation, and reconciliation

### 7.1 Stores live in `data-access`, page facades live in `feature-*`

Two different things, and conflating them is the most likely way this design gets misbuilt.

| | Domain store | Page facade |
| --- | --- | --- |
| Lives in | `data-access` | the `feature-*` library that owns the route |
| Shaped like | the domain (zones, lists, lines) | one screen |
| Lifetime | the app session | the route |
| Owns | the cache, realtime application, version reconciliation | composing a view model from stores |
| How many | one per domain | one per page, and only if the container outgrows itself |

**Why the store is not in the feature library**, which is the tempting placement: realtime
events arrive for a room regardless of which page is mounted. A store owned by
`feature-home` is destroyed when the user opens a list, so the room is left and rejoined on
every navigation, the cache is thrown away, and going back re-fetches everything. On the
connection `0001` D6 describes, that is the difference between an app that feels instant and
one that does not.

### 7.2 Optimistic update and reconciliation

`0001` D6: the backend is last write wins with a `version` column, the UI updates
optimistically, and it must show when a change was overwritten by someone else. `LineView`
carries `version` (`contracts/src/lib/messages/list.messages.ts:48`); `ZoneView` and
`ListView` do not, so this applies to lines, which is where concurrent editing actually
happens.

The store holds, per record, the server copy and any pending local overlay. Reads see the
overlay applied. Three outcomes:

1. **The mutation succeeds** and the response carries a `version` at least as high as the
   pending one. Drop the overlay, keep the server copy, announce nothing.
2. **The mutation fails.** Drop the overlay. The record snaps back and the failure surfaces
   through the page's visible failure path, never silently.
3. **A realtime event arrives for a record with a pending overlay.** The event wins for
   fields the overlay does not touch. For a field the overlay does touch, the overlay is kept
   until its own request resolves, and if the request then returns an older version the user
   is told their change was overwritten.

Case 3 is what produces the "someone else changed this" message, and it is the only place in
the app where two writers are reconciled, which is precisely why it belongs in one store
rather than in every component.

### 7.3 The mutation choke point

> **Rule D2. Every write goes through one method in `data-access`.**

`0001` D6 promises an offline queue can be added later without touching a component. That is
only true if there is exactly one function all writes pass through. A single `Mutations`
service owns the overlay lifecycle in 7.2, and every domain client's write methods call it
rather than calling `HttpClient` directly.

The queue is out of scope (`0001` section 5). The choke point is not, and it is worth
building now because retrofitting one across every call site later is the expensive version
of this decision.

## 8. Connection loss

`0001` D6 and `0003` section 3.1: one blocking screen, an automatic reload when the
connection returns, no queue and no cached content behind it. Both plans record it as
deliberately weak and temporary. Nothing here changes that; this is only the wiring.

`ConnectionState` lives in `platform` and is fed from three places:

| Input | From |
| --- | --- |
| `BrowserFacade.onLine` | the `online` and `offline` window events, already built |
| A request that got no response | the interceptor, step 6 |
| The realtime client losing its socket | section 6.2, and only as corroboration |

The interceptor's report is what makes this work at all. `navigator.onLine` describes the
network interface, so a phone attached to a captive portal reports `true` while nothing
reaches the internet, which is a completely ordinary situation in a supermarket.

`ConnectionState` sits in `platform` while the **reporting** happens in `data-access`, which
the layering in 3.2 allows. That split is what lets `AppLayout` in `ui` render the blocking
screen without importing `data-access`.

**Coming back is not the `online` event.** For the same captive portal reason, regaining the
interface does not mean regaining the backend. Before reloading, confirm with one cheap
request to `GET /health/ready`, which is unversioned and unguarded
(`libs/luna-shopper/platform/src/lib/health/health.module.ts:64`).

> **The test is "did any HTTP response come back", not "was it a 200".** That endpoint
> returns 503 when a dependency is unhealthy or during a graceful shutdown, and a 503 proves
> the network works perfectly well. Treating a 503 as still offline would strand the user on
> the blocking screen through an ordinary backend deploy, which is the opposite of what this
> screen is for.

**The reload guard.** `0003` section 3.1 requires that the reload never discards what
someone typed. A `ReloadBlocker` registry in `platform` takes a registration from any open
dialog or dirty form, and the reload waits until it is empty. The quiet "Reload now" button
from `0003` bypasses nothing: it goes through the same guard.

## 9. In-memory implementations and DI tokens

The workspace convention (`nx-portfolio-angular-developer`, non negotiable 2) is that every
data domain ships an in-memory implementation behind a DI token, so the app runs and every
test passes with no backend. Velista keeps it, with one adjustment.

Use the shared primitives from `@portfolio/shared/data-access`: `serviceToken` to declare
the token with the memory implementation as its default factory, and `provideService` to
bind a different implementation at the app injector.

```ts
export const ZONE_SERVICE = serviceToken<ZoneServiceI>(
  'ZONE_SERVICE',
  () => inject(ZoneMemory)
);
```

**The adjustment: do not use `ApiConsumer` or `OwnApiUrlResolver`.** Both resolve URLs from
`@portfolio/shared/environments`, which describes the portfolio's backend, and extraction
contract item 6 says this app reads its own environment surface. Velista already has
`ApiUrl` for exactly this. An API implementation injects `ApiUrl`.

### 9.0 Rule D5: the app injector owns the app's services

> **Rule D5. A service that depends, directly or transitively, on anything the app
> layer provides must be provided by the app layer too. It may not be
> `providedIn: 'root'`.**

Added by plan `0005`, after the whole of this section turned out to be inert at
runtime. It is short, and the reason it is not obvious is worth keeping.

`providedIn: 'root'` is not a fallback, it is a statement about **where the service
lives**: there is one of me and I live at the top. Under module federation the top is
the **shell's** injector. This app is lazy loaded into it, so everything `appProviders`
supplies necessarily sits in a child injector below. Angular creates a root scoped
service in the root injector and resolves that instance's own dependencies from there,
so it cannot see anything below it. Lookup only ever walks up.

What that cost, before it was found:

- `ThemeStore` could not see `APP_BRAND`, so `AppLayout` threw `NG0201` and the app
  rendered nothing at all under the shell.
- `ApiUrl` could not see `APP_API_CONFIG`.
- `ZoneStore` resolved `ZONE_SERVICE` in the root injector, found the token's own
  default, and quietly served `ZoneMemory` while `provideService(ZONE_SERVICE, ZoneApi)`
  sat in `appProviders` doing nothing. This is the dangerous one: it fails silently and
  looks like working software with the wrong data in it.
- `provideAppInitializer` never ran, so `ConnectionRecovery` was never constructed.
  `APP_INITIALIZER` is read once by `ApplicationInitStatus` at bootstrap from the root
  injector, and nothing ever asks a route injector for it. Use
  `provideEnvironmentInitializer`, which runs when the injector it is declared on is
  created, and is therefore correct in both the mounted and the standalone case.

**The counter-example that makes it click:** `BrandMark` injects `APP_BRAND` and always
worked. It is a component, created in the view, whose environment injector *is* the
route injector, so its lookup starts where the token actually is. Same token, same app.
The only difference is where the instance is created.

**The same mistake wearing a different costume.** `providedIn: 'root'` is not the only
way to put a provider somewhere the consumer cannot reach. `AppUiModule` registered the
translation namespace and `AppLayout` imported it, on the reasoning that a parent route
component passes its providers down to every page. A standalone component's imported
NgModule provides **that component's injector**, and a page reached by `loadComponent`
on a child route is created against the route's environment injector instead, so it
never saw them. The namespace now ships as `VELISTA_TRANSLATION_PROVIDERS` and is
installed by `appProviders`. Generally: a route's providers reach every page below it,
a component's `imports` reach that component, and neither `providedIn: 'root'` nor a
component `imports` is a way to supply a lazily loaded route.

Each library owns the list of services the app must install, `VELISTA_PLATFORM_PROVIDERS`
and `VELISTA_DATA_ACCESS_PROVIDERS`, and `appProviders` spreads them. A service that
moves is added in one place, and the app and every spec pick it up from the same place.
`apps/velista/src/app/app-providers.spec.ts` builds the child injector exactly as the
router does and asks it for each one by name, so a service added later without this rule
fails there immediately rather than in a rendering test.

Still `providedIn: 'root'`, correctly: `BrowserFacade`, `ConnectionState`,
`ReloadBlocker`, `Mutations`, `RealtimeMemory`. None of them reaches an app supplied
value, so they lose nothing by being shared and keep zero setup in tests.

### 9.1 The inventory

| Library | Provides |
| --- | --- |
| `models` | `AppApiConfig`, `APP_BASE_PATH`, `APP_BRAND`, `APP_KEY`; **the app's own domain models and enums** (`Zone`, `List`, `Line`, `Membership`, `Identity`, and the unions replacing `ZoneRole`, `MembershipStatus`, `LineStatus`, `LineApprovalStatus`, `UserKind`); the re-declared `ProblemDetails` and error codes; request body types; and the page view models |
| `platform` | `BrowserFacade`, `ThemeStore`, `ConnectionState`, `ReloadBlocker`, `StorageKeys`, `decodeJwtExpiry` |
| `data-access` | `ApiUrl`, `gatewayInterceptor`, `GatewayError` / `NetworkError`, **one mapper per model (rule D4)**, `TokenStore`, `SessionStore`, `Mutations`, `ZoneStore` / `ListStore` / `PresenceStore`, and one service pair per domain behind `AUTH_SERVICE`, `ZONE_SERVICE`, `LIST_SERVICE`, `REALTIME_CLIENT` |

The mappers are the only files in the app that reference a contract type, and they reference
it with `import type`. That is rule D4's whole enforcement surface, which is what makes it
reviewable.

### 9.2 Why the memory implementation matters more here than elsewhere

Everywhere else in this workspace it is the only implementation, so there is no temptation.
Here a real backend exists and it would be easy to skip. Three reasons not to:

- **`0003` cannot be built without it.** Section 5.2 of that plan needs summary fields that
  `MyZoneView` does not have, and the user confirmed on 2026-08-26 that the backend work has
  not landed. **This plan proceeds on the memory implementation**, which serves the summary
  shape in full so the home page is built to its approved design rather than to the API's
  current limits. The HTTP implementation is written against the same interface when the
  backend lands.
- **Every state in `0003` section 3 has to be renderable on demand.** A pending membership, a
  join request queue, and an overwritten record are one line of seed data each, against a
  meaningful amount of backend setup.
- **The unit tests resolve the token's default with no setup at all**, which is what
  `0003`'s acceptance criteria assume.

The memory implementation implements the **same interface including the realtime surface**,
emitting synthetic events on a timer, so the live update paths in section 6.5 and the
reconciliation in 7.2 are exercised without a server.

### 9.3 Importing the contracts, and why rule D4 defuses the ajv problem

`libs/luna-shopper/contracts/src/index.ts:32` does `export * from './schemas'`, and
`src/schemas/validator.ts` imports `ajv` and `ajv-formats`. `tsconfig.base.json:101` exposes
only that root barrel. So a **value** import from `@portfolio/luna-shopper/contracts` pulls a
JSON schema validator into a mobile bundle, which is what `0001` section 7.1 forbids.

**Rule D4 removes the problem rather than working around it.** Because the app owns its own
models and its own enums (4.1), it never needs a runtime value from the contracts library.
It needs the DTO shapes only as documentation at the mapper boundary, and:

> **Every contracts import in this app is `import type`.** A type only import is erased at
> compile time, so it emits no module reference at all, and `ajv` never reaches the bundle.

That turns three separate concerns into one rule:

| Concern | Before D4 | After D4 |
| --- | --- | --- |
| `ajv` in the bundle | a real risk, needing a backend change first | cannot happen, the import is erased |
| Backend renames a field | breaks wherever the DTO was used | breaks one mapper |
| Unknown enum value from a newer backend | an unstyled string or a crash | a defined fallback in the mapper |

Two things this does **not** excuse:

- The barrel should still be split, because the next person to write a plain `import` from it
  gets the validator by accident and nothing warns them. It stays as backend item 1 in
  section 11, reclassified as hygiene rather than a blocker, and it remains the backend's
  work to do.
- **`verbatimModuleSyntax` or the `@typescript-eslint/consistent-type-imports` rule should be
  enforced on this app's projects**, so a plain import of a contract type is a lint failure
  and not a silent 100KB. A rule that depends on everybody remembering is not a rule, and
  this one has a cheap mechanical check.

Measure the production bundle once after the first API implementation lands and record the
number, so the claim above is verified rather than assumed.

## 10. Testing

- **`ui` components** are tested by inputs alone, with no service mocking, which is what
  rule D1 buys. Every state in a page plan is a test case.
- **Containers** are tested against the memory implementation resolved from the token's
  default. State selection functions are tested as pure functions.
- **The interceptor** is tested with `HttpTestingController`: header presence, the scope
  check in 4.3 step 1, the problem details mapping, the single flight refresh, and the no
  response path.
- **The refresh race in 5.4 gets its own test**, firing two concurrent 401s and asserting
  exactly one refresh call. It is the failure that would otherwise be found in production.
- **Rule D3 gets its own test**: an expired token plus a call to an optional auth route must
  refresh first and must never reach the network with a stale token.
- **The stores** are tested by driving events in directly, with no transport: apply an event,
  apply an overlay, resolve the mutation, assert the three outcomes in 7.2.
- **The realtime client** is tested against a fake socket: acks, `{ ok: false }`, refcounting,
  and resubscription after a reconnect.
- **`BrowserFacade` and everything in `platform`** keep the existing pattern of a browser
  suite and a `PLATFORM_ID: 'server'` suite, so the SSR readiness in `0001` D2 stays true.

Run `npx nx lint` and `npx nx test` for every project touched.

## 11. What the backend owes this layer

None of these block frontend work, because of section 9. All four are recorded so they are
not rediscovered one at a time.

| # | What | Why | Status |
| --- | --- | --- | --- |
| 1 | Move `./schemas` out of the contracts root barrel into its own entry point | A value import of the barrel pulls `ajv` and `ajv-formats` into the browser bundle, against `0001` section 7.1. Rule D4 means this app never makes one, so this is now hygiene for whoever writes the next import, not a blocker | User's decision, 2026-08-26. **Backend work, reserved by the user.** See 9.3 |
| 2 | `GET /v1/account/me`, plus a global display name for a user | There is no profile endpoint at all, and `displayName` and `email` are never returned. The only human readable name is `MembershipView.username`, which is per zone, so a guest with no zones has no name | User's decision, 2026-08-26. **Backend work, reserved by the user** |
| 3 | Zone summary fields on `MyZoneView`, plus a way to read a zone's members | `0003` section 5.2. Verified absent: `contracts/.../zone.messages.ts:55` and `core/.../zones/zone.mappers.ts:33` are unchanged, and there is no members route on the gateway. No backend plan covers it | Frontend proceeds on the memory implementation |
| 4 | The Google callback must 302 back to the app with the token pair in the URL fragment, with an allowlisted return URL | `google.controller.ts:31` returns JSON, so a browser completing the flow lands on a page of JSON. See 5.7 | Required before the auth page plan ships Google |

Two suggestions, neither required:

- **Reject an expired token on the optional auth routes** rather than treating it as
  anonymous. That removes rule D3's hazard at the source instead of asking every client to
  remember it, and the silent guest account replacement in 5.5 is a data loss bug that no
  client side rule can fully close.
- **Return the correlation id as a response header on success as well as failure.** Today it
  exists only in a problem document body, so a successful request the user wants to report
  has no id at all.

## 12. Acceptance criteria

- [ ] `libs/velista/platform` exists, `BrowserFacade` and `APP_KEY` have moved into it, and
      no `ui` file imports `@portfolio/velista/data-access`.
- [ ] A review check or a lint rule catches a `ui` file importing `data-access`, since
      `@nx/enforce-module-boundaries` is permissive here (`0001` section 7) and will not.
- [ ] One interceptor sets `Authorization`, `Accept-Language`, and `x-correlation-id`, and no
      call site sets a header.
- [ ] The interceptor never attaches a bearer token to a non gateway origin, with a test.
- [ ] Every failure leaving `data-access` is a `GatewayError` or a `NetworkError`. No
      component sees an `HttpErrorResponse`.
- [ ] **Rule D4 holds.** No store, container, or component references a type from
      `@portfolio/luna-shopper/contracts`. A search for that import path outside the mapper
      directory returns nothing, and every hit inside it is an `import type`.
- [ ] Every mapper takes `unknown`, and each has a test for a missing field, a `null` in a
      non nullable position, and an enum value the app does not recognise. None of the three
      throws, and the unknown enum lands on its defined fallback.
- [ ] Realtime payloads pass through the same mappers as response bodies, with a test that
      an event carrying a malformed record is dropped rather than written into a store.
- [ ] `consistent-type-imports` (or `verbatimModuleSyntax`) is enforced on this app's
      projects, so a plain import of a contract type fails lint.
- [ ] No user facing string comes from the server's `message` field except as a last resort
      fallback, and `detail` is never rendered.
- [ ] Two concurrent 401s produce exactly one refresh call.
- [ ] Rule D3 holds: a call to `POST /v1/zones` or `POST /v1/zones/join` with an expired
      token refreshes first, and a failed refresh for a `TEMPORARY` identity warns the user
      instead of silently minting a second guest account.
- [ ] A reload with a valid stored session never lands on the login screen.
- [ ] Realtime resubscribes to every room after a reconnect, verified by dropping a fake
      socket mid test.
- [ ] A `{ ok: false }` subscription acknowledgement surfaces, and the affected data is not
      presented as live.
- [ ] Losing the network shows the blocking screen; regaining it confirms with
      `GET /health/ready` before reloading, and the reload waits on `ReloadBlocker`.
- [ ] Every domain has a memory implementation behind its token, and the whole app runs with
      no backend running.
- [ ] The memory implementation emits realtime events, so 7.2's three outcomes are reachable
      without a server.
- [ ] `socket.io-client` is the only dependency this plan adds.
- [ ] The production bundle size is measured and recorded before and after the contracts
      import, per 9.3.

## 13. Out of scope

- **Every screen.** The auth pages, the account page, and the join flow get their own plans
  and their own mocks. This plan builds the state machine and the tokens they consume, and
  nothing a user can see.
- **The SSE transport.** The seam is built, the implementation is not. See 6.1.
- **The offline queue, background sync, and the service worker**, deferred to the standalone
  phase per `0001` section 5. Rule D2 is what keeps that door open.
- **`traceparent` emission**, until backend plan `0016` lands. See 4.7.
- **The catalog and merge domains.** Both have a full gateway surface and neither has a page
  plan yet, so neither gets a client here.
- **Anything in section 11.** That work is the backend's and the user has reserved it.
- **Any locale beyond English and Spanish.**

## 14. Open questions

1. **Does the Google redirect survive an installed PWA?** Raised by the user on 2026-08-26.
   The custom button and the backend owned redirect are the decision for now, and 5.7 records
   the two fallbacks in preference order if a standalone window sends the user out to a
   browser tab and does not bring them back. This cannot be answered before there is a PWA to
   test, which is the standalone phase.
2. ~~**Is the interim ajv weight acceptable?**~~ **Answered by rule D4.** The app imports
   contract types only, `import type` is erased, and nothing from that library reaches the
   bundle. 9.3 still asks for one bundle measurement to verify the claim rather than assume
   it.
3. **`resource()` and `httpResource`, considered and not adopted.** Angular here is 21.2.6, so
   both are available, and nothing in the workspace uses either. They are a poor fit for this
   design: a resource is request scoped and re-fetches, while every store in section 7 is
   push updated by realtime and reconciled against local overlays, which is the opposite
   lifecycle. Recorded so the question is not reopened without a reason.
4. **Should presence move off single replica in memory storage** before the realtime service
   is scaled, or is advisory presence (6.7) good enough indefinitely? A product question more
   than a technical one.
5. **How long should a temporary account live?** An orphan user reaper exists
   (`auth/src/app/reaper/orphan-user-reaper.service.ts`) and the frontend does not know its
   window. `0003`'s guest banner is more or less urgent depending on the answer, and the copy
   should probably say it.
