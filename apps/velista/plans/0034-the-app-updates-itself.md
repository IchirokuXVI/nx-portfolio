# 0034: The app updates itself

## 1. What is wrong today

velista is an installed PWA served by the Angular service worker, and plan 0013
section 6.4 already decided the polite half of updating: when a new version is ready,
reload on the next completed navigation rather than in the middle of a screen. That
part works. Two things around it do not.

**The app almost never asks.** `SwUpdate` checks for a new version at exactly two
moments: when the worker registers, which is once per app load, and when something
calls `checkForUpdate()`. Nothing calls it. So the only check velista performs is at
a cold start, and a cold start is the thing an installed PWA does least: the window is
backgrounded and resumed for days at a time. A user can sit on a bundle from three
releases ago and the app has no idea, because it has not asked since the day it was
opened.

**Nothing connects a moving backend to a stale client.** The gateway is URI versioned
(`/v1/...`, backend plan 0004 section 4), which protects the *shape* of a route: a v2
that wants a different body is a different URL, and an old client keeps talking to the
v1 it knows. What versioning does not do is retire anything. A client old enough to
predate a route, a required field, or a semantic change to an existing one keeps
sending requests that parse and mean the wrong thing, and there is no channel through
which the server can say so. The API version protects the request; nothing protects
the client.

This plan closes both, and adds the release time switch that makes the polite reload
impolite when it needs to be.

## 2. Decisions

**D1. The check is periodic and on resume, not only at registration.** Two triggers:
the document becoming visible, and a thirty minute floor while it stays visible. The
first is the one that matters, because resuming a backgrounded window is how an
installed app is actually opened; the second is for a window left in the foreground.
A check is one conditional GET of `ngsw.json`, so the cost of asking is nil and the
cost of not asking is unbounded.

**D2. Every automatic reload goes through `ReloadBlocker`.** It already exists, in
`libs/velista/platform`, and it exists for precisely this hazard: plan 0001 D6 gives
the app no offline queue, so a reload over an open sheet or an unsent field is
unrecoverable data loss. `AppRoot` currently calls `document.location.reload()`
directly, which bypasses it and also touches a browser global outside `BrowserFacade`,
against plan 0001 D2. Waiting for the next `NavigationEnd` was a reasonable proxy for
"the user is between screens", but it is only a proxy: `ReloadBlocker` asks the
components that actually hold unsaved state, and it defers rather than cancels, so
nothing is lost by asking. The navigation trigger stays, as the thing that *proposes*
the reload; the blocker decides when it happens.

**D3. `appData` carries one field, `critical`, and it is a release time switch.**
On `VERSION_READY` the app reads `latestVersion.appData`. When `critical` is true the
reload is proposed at once rather than waiting for a navigation, still through
`ReloadBlocker`. This is the answer to "I shipped a request body change and I do not
want to wait for the user to navigate". Its resting value is false and a release that
forgets to set it back is merely more eager than it needed to be, which is the right
direction for a mistake to fail in.

`appData` deliberately does **not** carry a version string. `ngsw-config.json` is
static JSON read by the `ngsw-config` CLI, so a version in it is hand maintained and
will drift from the version the build actually was. One source for the version
identity, and it is D4.

**D4. The client states its version in a request header, decided in the interceptor.**
`x-client-version`, from a build time constant, on every gateway request.
`gateway-interceptor.ts` opens with "Every outgoing header is decided here. Nothing is
set at a call site", and this is a header, so it goes there and nowhere else.

The value comes from `process.env.VELISTA_APP_VERSION` substituted by the `DefinePlugin`
in both webpack configs, which is the mechanism already carrying `LUNA_GATEWAY_URL`
and `LUNA_REALTIME_URL` into `environment.ts` and `environment.prod.ts`, and which
`velista-env-substitution.spec.ts` already asserts the two files agree about. CI sets
it to the same string it passes as `DOCKER_IMAGE_TAG`. Unset, it is `0.0.0-dev`.

**D5. The gateway has one knob, `MIN_CLIENT_VERSION`, and it is empty by default.**
Empty means the whole mechanism is off: no header is advertised, no request is
refused, and both clusters behave exactly as they do today. Production sets it when
there is a version worth retiring. Two knobs, one to advertise and one to enforce,
would be two things to get right for one decision, and the decision is a single
number: the oldest client this deployment is willing to serve.

**D6. Only versions that parse as semver participate.** A development build is
`0.0.0-dev` and a staging build is whatever the staging tag is; neither is meaningfully
ordered against a release. So a client whose own version does not parse never considers
itself stale, and a request whose `x-client-version` does not parse is never refused.
The floor is opt in on the server *and* unenforceable against a client that has not
opted into being comparable, which is what stops a mistyped `MIN_CLIENT_VERSION` from
bricking a fleet that was never the target.

**D7. The server signal triggers a check. It never triggers a reload by itself.**
This is the loop guard, and it is the most important decision here. If the app reloaded
because the server said it was old, and the new bundle were not actually reachable yet,
it would reload into the same old bundle, be told the same thing, and reload again,
forever, with no way for the user to escape. Not hypothetical: the deploy that moves
the floor and the deploy that ships the frontend are different rollouts, and a client
that reaches a moved floor before the new `ngsw.json` is a normal few seconds of every
release. So the server signal calls `checkForUpdate()`, and the reload happens on
`VERSION_READY` and only there, which by definition means a new version is downloaded
and sitting in the cache. No new version means no reload, and the app keeps running.

**D8. The floor is advertised in a response header, and CORS has to be told.** The
gateway sets `x-min-client-version` on every response it serves while the knob is set.
velista is cross origin from it (`velista.app` calling `api.velista.app`), and
`main.ts` calls `enableCors({ origin, credentials: true })` with no `exposedHeaders`,
so a browser can read only the CORS safelisted response headers and would never see
this one. That is the same trap that put `retryAfterSeconds` in the problem document
body rather than in `Retry-After` (velista `models/problem.ts`). Here the body is the
wrong place, because the advisory belongs on every response and not on every DTO, so
the header is the right shape and `exposedHeaders` is the price.

**D9. A client below the floor is refused with 426 and a new code, `client_too_old`.**
The advertised header is the braces and the refusal is the belt. The header pulls a
stale client forward on its next request; the refusal is what makes "cannot keep
sending old shaped requests" a guarantee rather than a strong likelihood, for the case
where an old client is actively dangerous rather than merely behind.

It costs no new UI, which matters because plan 0013 section 6.4 closed with "No new UI,
no toast, no prompt. Adding one is a design decision with a mock, and this plan draws
no screens", and that is still true. `client_too_old` is an ordinary `ErrorCode`, so it
travels the existing problem document path, gets a catalog message in both locales, and
every page that already switches on `code` renders it the way it renders every other
error. The update check fires alongside, so in the normal case the app has reloaded
itself before the user has finished reading.

## 3. The client version

`apps/velista/src/environments/environment.ts` and `environment.prod.ts` grow one
field beside `api`:

```ts
export const environment: {
  production: boolean;
  version: string;
  api: AppApiConfig;
} = {
  production: false,
  version: process.env['VELISTA_APP_VERSION'] as string,
  api: { ... },
};
```

Both webpack configs gain the matching `DefinePlugin` entry, defaulting to
`DEV_APP_VERSION = '0.0.0-dev'` in `webpack.config.ts` and to the same value in
`webpack.prod.config.ts`, because a production build with the variable unset is a
local production build and is not a release. `velista-env-substitution.spec.ts` covers
that both files define every key the environment files read, so it picks this up with
no change beyond the constant it compares against.

The app provides it as `APP_VERSION`, a new `InjectionToken<string>` in
`@portfolio/velista/models`, bound in `appProviders` next to `APP_API_CONFIG`. The
libraries read the token and never the environment file, which is extraction contract
item 6 (plan 0001) applied to one more value.

## 4. The client: `AppUpdates`

A new service in `libs/velista/platform`, provided through
`VELISTA_PLATFORM_PROVIDERS` and started by a `provideEnvironmentInitializer` in
`appProviders`, exactly like `ConnectionRecovery`: nothing injects a listener, so
without an initializer nothing would construct it.

It owns four things.

1. **The schedule (D1).** On construction, when `SwUpdate.isEnabled`, a
   `visibilitychange` listener and a thirty minute `setInterval`, both released on
   `DestroyRef`. A plain `setInterval` rather than an rxjs `interval`, because the
   worker registers with `registerWhenStable:30000` and a repeating rxjs timer that
   the framework can see is a good way to make an app that is never stable.

2. **The proposal (D2, D3).** On `VERSION_READY`, read `latestVersion.appData`. If it
   says `critical`, call `ReloadBlocker.reloadWhenIdle()` now. Otherwise arm a flag and
   call it on the next `NavigationEnd`. On `unrecoverable`, reload immediately through
   `BrowserFacade.reload()` and not through the blocker: the cached state is already
   broken, so there is nothing left to protect and a stuck blocker would strand the
   user in an app that cannot work.

3. **The server driven check (D7).** A public `checkNow()` the interceptor calls. It is
   idempotent under concurrency (a check already in flight is not started again) and it
   does nothing at all when there is no enabled worker, which is every development build
   and every run under the shell.

4. **Nothing else.** It draws no UI and it exposes no state to a template.

`AppRoot` loses all of its update handling. It goes back to what its own comment says
it is, an outlet and nothing more, and the behaviour moves to a service that both run
modes reach and that a spec can drive without a component fixture.

## 5. The client: reacting to the server

In `gateway-interceptor.ts`, in the places that already exist:

- **`decorate`** adds `x-client-version` from the injected `APP_VERSION`.
- **The response tap** reads `x-min-client-version` and, when the app's own version
  parses as semver and is lower, calls `AppUpdates.checkNow()`.
- **The error path** treats a `client_too_old` the same way, then lets the error
  continue to the caller unchanged.

Both reactions are a call to `checkNow()` and nothing more, per D7.

`ERROR_CODES` in `libs/velista/models/src/lib/problem.ts` gains `client_too_old`. That
file is the hand kept copy of the backend's codes and says so.

## 6. The gateway

**A new code.** `CLIENT_TOO_OLD: 'client_too_old'` in `error-codes.ts`, mapped to
`HttpStatus.UPGRADE_REQUIRED` in `ERROR_STATUS`, a message in both locales in
`ERROR_CATALOG`, and a `ClientTooOldException` in `domain-exception.ts`. Adding a code
rather than reusing one is what that file asks for.

**A global guard**, `MinClientVersionGuard`, registered as an `APP_GUARD` in the
gateway's `AppModule` beside `ProblemThrottlerGuard`. A guard rather than middleware
because a `DomainException` thrown inside Nest's execution context reaches
`GlobalExceptionFilter` and renders as a problem document, which is the whole point,
and one thrown from Express middleware does not reliably do either. It reads the floor
from config once, and per request it sets `x-min-client-version` on the response and
refuses when the caller identified itself as older. With no floor configured it returns
true before touching anything.

**Config.** `MIN_CLIENT_VERSION` in `gatewayValidationSchema`, `Joi.string().allow('')
.default('')`, validated as semver when non empty so a typo fails the process at boot
rather than silently retiring nobody, and `minClientVersion` on `GatewayConfig`.

**CORS.** `exposedHeaders: ['x-min-client-version']` on the `enableCors` call in
`main.ts` (D8).

**The document.** A new error code and a new response status change the generated
OpenAPI, so `npx nx run luna-shopper-backend-gateway:openapi` runs and the diff is
committed, per the workspace rule.

## 6b. Getting both values into a cluster

Neither half of this does anything until a deploy supplies it, so both are wired
where every comparable value is already wired rather than left as a manual step.

**The client version.** Both workflows pass `VELISTA_APP_VERSION` into the container
that builds the bundles, beside `LUNA_GATEWAY_URL` and the rest. `release.yml` passes
the release version, which is the same string the images are tagged with, so a running
client reports the version of the image serving it and a floor is expressed in the same
numbers a rollback is. `docker-ci.yml` passes the literal `staging`, which does not
parse, so by D6 the staging fleet is never compared against anything and never refused.

**The floor.** `lunaShopperBackend.config.minClientVersion` in `values.yaml`, empty,
rendered into the existing ConfigMap as `MIN_CLIENT_VERSION` and referenced from the
gateway's env only. Neither environment file overrides it, so both clusters deploy with
the mechanism off and turning it on is a values change and a `helm upgrade` rather than
a new image. `provision-release.sh --check` renders the chart and asserts every
`configMapKeyRef` it names exists, so the ConfigMap entry and the env reference cannot
drift apart unnoticed.

## 7. Tests

- `app-updates.spec.ts`: checks on visibility and on the interval; no check without an
  enabled worker; a critical `VERSION_READY` reloads without waiting for a navigation
  and a non critical one waits; a reload held by a `ReloadBlocker` fires on release;
  `unrecoverable` reloads immediately; `checkNow()` does not stack concurrent checks.
- `gateway-interceptor.spec.ts`: the header is sent; a lower advertised floor triggers
  a check; an equal or absent one does not; an unparseable client version never
  triggers one; a `client_too_old` triggers a check and still rejects with the error.
- `min-client-version.guard.spec.ts`: off with no floor; header set when configured;
  refuses an older client with 426 and `client_too_old`; allows an equal or newer one;
  allows a request with no header and one whose header does not parse (D6).
- `app-config.spec.ts`: the new variable defaults to empty and rejects a non semver
  value.
- `velista-env-substitution.spec.ts`: already asserts that every `process.env` read in
  an environment file has a matching `DefinePlugin` entry, so it covers the new
  variable with no change beyond the two explicit lists it also keeps.
- `app-version.spec.ts` and `client-version.spec.ts`: the same table of cases either
  side of the forced duplication, weighted towards the inputs whose answer must be
  "no opinion". Those are the ones where a bug locks a fleet out rather than merely
  delaying an update.

`AppRoot` has no spec and needs none once this lands: it is a component with an outlet
and an empty class, and everything that was worth asserting about it moved into
`app-updates.spec.ts`, where it can be driven without a fixture.

## 8. Build order

1. The version constant: environment files, both webpack configs, the `APP_VERSION`
   token, the binding in `appProviders`. Nothing reads it yet.
2. `AppUpdates` with the schedule and the proposal, `AppRoot` emptied, `appData` in
   `ngsw-config.json`. This alone closes the first gap and is worth shipping on its own.
3. The gateway: code, exception, guard, config, CORS, regenerated OpenAPI.
4. The interceptor's two reactions. Last, because it is the half that is useless until
   both sides of it exist.
5. The wiring in section 6b: `VELISTA_APP_VERSION` in both workflows, and
   `minClientVersion` through the chart. Without these the feature ships inert, every
   deployed build calling itself `0.0.0-dev` and no way to set a floor short of
   editing the chart.

## 9. What this deliberately does not do

- **No UI.** Plan 0013 section 6.4 still holds: a screen is a design decision with a
  mock. `client_too_old` renders through the existing error path.
- **No realtime enforcement.** The socket does not carry `x-client-version` and the
  realtime service reads no floor. A stale client is caught on its next REST call,
  which for this app is immediate, and adding a second enforcement point for a
  transport that carries no request bodies buys nothing.
- **No push.** Nothing runs while the app is closed, and Web Push is not an update
  channel.
- **No version negotiation.** The floor is a floor. The gateway does not adapt its
  responses to older clients, which is what URI versioning is already for.
