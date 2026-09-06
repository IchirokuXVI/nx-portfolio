# 0071: the app waits until it can reach the backend

> **The app finds out whether the backend is there by trying to use it.** There is no
> moment at startup where velista asks. Every screen fires its own request, and the
> first one that gets no answer trips `ConnectionState` and covers the app with the
> blocking screen from `0003` section 3.1.
>
> That is late in three separate ways. A page renders, draws its skeletons and then
> disappears behind a screen, which reads as the app breaking rather than as the app
> waiting. An action a user already tapped is in flight before anybody knows the
> server is unreachable, and on the landing page that action creates an account. And a
> deployment that has retired this build says so on the first request, which is
> whichever request the user's first tap happened to send.
>
> This plan gives the app one thing it does not have: an answer to "can I reach the
> backend" that arrives before the app acts, and a screen for the seconds while that
> answer is outstanding.
>
> Prerequisite reading: `0003` section 3.1, `0004` sections 3.2 and 8, `0001` D6, and
> `0034` for the version half, which `0072` builds on.

## 1. What happens today

Three services already exist, and this plan adds a fourth thing rather than replacing
any of them.

- **`ConnectionState`** (`libs/velista/platform/src/lib/connection-state.ts`) holds one
  `offline` signal, computed from `navigator.onLine` and from requests that came back
  with no response at all. It does no HTTP, which is what lets `ui` read it without
  importing `data-access` (`0004` section 3.2).
- **`ConnectionRecovery`** (`libs/velista/data-access/src/lib/connection-recovery.ts`)
  polls `GET /health/ready` while `offline` is true, and reloads the page through
  `ReloadBlocker` once the probe succeeds.
- **`AppLayout`** (`libs/velista/ui/src/lib/layout/app-layout.ts`) renders
  `lib-connection-lost` over the outlet when `offline` is true. The page behind keeps
  its state, so a deferred reload does not lose a half typed field.

What none of them does is ask a question at startup. `ConnectionState.offline` starts
false, which is a guess, and the guess is right most of the time and silently wrong on
a cold start in a shop basement. `ConnectionRecovery` only wakes up once something
else has already failed.

The backend needs no change for any of this:

- `GET /health/live` and `GET /health/ready` already exist on the gateway
  (`libs/luna-shopper/platform/src/lib/health/health.module.ts`), carry `@SkipThrottle()`,
  and are excluded from the OpenAPI document on purpose.
- `MinClientVersionGuard` is registered as an `APP_GUARD`
  (`apps/luna-shopper-backend/gateway/src/app/app.module.ts`), so it runs for the health
  routes as well. A probe therefore comes back with `x-min-client-version` on it, and
  comes back **refused** with `client_too_old` when this build is below the floor. One
  request answers both questions this plan cares about.

## 2. Decisions

**D1. The startup answer is a state with four values, and it is a new thing, not a
rewrite of `offline`.** `BackendReadiness` holds `'connecting' | 'ready' | 'unreachable'
| 'too-old'`. `ConnectionState` keeps exactly the job it has, and becomes one of the
inputs to the new state rather than a second answer screens have to reconcile. Nothing
that reads `offline` today changes: the sockets, the room registry and the token store
all keep reading the transport level fact, which is what they actually want.

Two booleans that both mean "can we talk to the server" will disagree, and the one that
is wrong strands somebody. There is one state, and everything that draws a screen reads
it.

**D2. The probe does not block bootstrap.** An `APP_INITIALIZER` that waits for the
answer delays the landing page as well, which is precisely the screen that must appear
at once. The gate is a **cover** decided during rendering, so the app starts, the
router runs, and the locale guard settles the language while the probe is in flight.

**D3. The cover holds the outlet rather than sitting over it.** `AppLayout` creates
`<router-outlet>` only when the current route may render. A cover drawn over a live
outlet leaves the page below constructed, which means its resolvers run and its
requests go out on behalf of a user who has been told to wait. `lib-connection-lost`
stays over the outlet, because there the page below is already alive and worth
preserving. The startup screen replaces it, because there is nothing behind it yet.

**D4. Landing renders while connecting, and it is the only route that does.** The route
says so with `data: { rendersWhileConnecting: true }` in
`libs/velista/feature-shell/src/lib/routes.ts`. Angular's default data inheritance is
`emptyOnly`, so the two entry sheets under landing, which carry their own `data`, do not
inherit the flag. That is the behaviour we want: a deep link straight into
`/{locale}/zones/new` waits, because that screen creates a group.

**D5. A held action is `aria-disabled`, never `disabled`.** A disabled button swallows
its own click, so the sentence explaining why it is disabled can never be triggered by
the thing the user pressed. The four landing actions keep their handlers, keep their
place in the tab order, and answer a press with a message instead of an act.

**D6. The probe reads a 503 as not ready, and `ConnectionState` keeps reading it as
reachable.** They answer different questions and the difference is deliberate. A 503
proves the network works, which is why `reportReachable` clears the failing flag and an
ordinary rollout does not strand a running app behind the blocking screen (`0004`
section 8). For the startup gate a 503 means the gateway cannot serve the app, so the
state is `unreachable` and the app waits. Only a 2xx is `ready`.

**D7. The probe has its own deadline, because `HttpClient` has none.** A socket that is
opened and never answered produces no error and no timeout, so without this the app sits
on the startup screen forever with nothing retrying behind it. Every attempt is bounded
at **8 seconds**, and a timeout is treated as no response.

**D8. Three seconds is wall clock from the app starting, not from the current attempt.**
A per attempt timer resets on every retry, so the escape text would appear late or never
on exactly the connection that needs it. One timer, started once.

**D9. The retry button reaches `data-access` through a counter in `platform`.** `ui`
cannot import `data-access` (`0004` section 3.2, rule D1), so `BackendReadiness` exposes
`retryRequested`, a counter that the probe watches. A counter and not a boolean, for the
reason `AppResumed` counts resumes: a request to retry is an edge, and an edge cannot be
read back out of a boolean by something that missed it.

**D10. The probe is sent with `SKIP_AUTH`.** Otherwise the interceptor refreshes the
token first and the startup answer costs two serial round trips, the first of which is a
refresh sent at the exact moment the backend is least likely to answer. `0067` is the
plan about what a refresh in that window used to cost. `ConnectionRecovery.probe` gains
the same context in this plan, for the same reason.

**D11. Once the answer is `ready`, the startup probe stops and the running app is owned
by the services that already own it.** `ConnectionState` and `ConnectionRecovery` handle
losing the connection later, unchanged. `BackendReadiness` moves to `unreachable` when
`offline` turns true after startup, so there is still one state for screens to read, but
no second poller is introduced.

**D12. No offline mode.** "Continue offline" is out of scope and is named in section 10
with what it would need.

## 3. The state: `BackendReadiness`

New, in `libs/velista/platform/src/lib/backend-readiness.ts`, provided in root, holding
state and no HTTP.

```ts
export type ReadinessState = 'connecting' | 'ready' | 'unreachable' | 'too-old';
```

| Signal             | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `state()`          | The four values above. Starts `connecting`.                |
| `settledAt()`      | When the first answer arrived, or `null`.                  |
| `slow()`           | True once 3 seconds have passed with no first answer (D8). |
| `retryRequested()` | A counter the probe watches (D9).                          |

Transitions, and every one of them is written by `StartupProbe` except the last:

| From          | Event                                     | To            |
| ------------- | ----------------------------------------- | ------------- |
| `connecting`  | probe answers 2xx                         | `ready`       |
| `connecting`  | probe answers `client_too_old`            | `too-old`     |
| `connecting`  | no response, timeout, or any other status | `unreachable` |
| `unreachable` | a later probe answers 2xx                 | `ready`       |
| `ready`       | `ConnectionState.offline` turns true      | `unreachable` |
| `too-old`     | nothing                                   | `too-old`     |

`too-old` is terminal within a document, which is `0072`'s subject: the way out of it is
a new bundle and a reload, not another probe.

The `slow` signal is a `setTimeout` started in the constructor, not a computed over a
clock, so it costs one timer for the life of the app and fires once.

## 4. The probe: `StartupProbe`

New, in `libs/velista/data-access/src/lib/startup-probe.ts`. It makes the request, so it
lives here and writes into `platform`, which is the same split `ConnectionRecovery` and
`ConnectionState` already are. Provided by the app layer and started with
`provideEnvironmentInitializer` in `apps/velista/src/app/app-providers.ts`, beside the
initializers that already start `ConnectionRecovery`, `AppUpdates` and `InstallStore`:
nothing injects it, so nothing would construct it.

- **One request**: `GET /health/ready` through `ApiUrl.gateway`, with `SKIP_AUTH` (D10)
  and an 8 second deadline (D7). The same URL `ConnectionRecovery` already probes.
- **Backoff while unanswered**: 1s, 2s, 5s, then every 10s. The attempts stop at the
  first answer of any kind.
- **Retries** also fire when `retryRequested()` changes and when `AppResumed.resumes()`
  changes while the state is not `ready`. A resume is the moment a phone comes back onto
  a working network, and it is already counted for us.
- **It reports nothing to `ConnectionState` itself.** The request goes through
  `gatewayInterceptor`, so a failure with no response already calls
  `reportNetworkFailure` and a success already calls `reportReachable`. A second report
  here would be two things writing one flag.

Because the interceptor sees the probe like any other gateway call, the `too-old`
answer needs one small addition there: the branch that already recognises
`client_too_old` and calls `AppUpdates.checkNow()` also calls
`BackendReadiness.reportTooOld()`. The branch that reads the advertised
`x-min-client-version` header is **not** changed, and section 5 of `0034` still
describes it correctly. A header is the server saying this build is old. A refusal is
the server saying it will not serve it, and only the second one is worth a screen.

## 5. What each screen does

### 5.1 The landing page acts held

`libs/velista/feature-landing/src/lib/landing-page/landing-page.html` renders during
`connecting` (D4). What changes is `lib-auth-actions`
(`libs/velista/ui/src/lib/home/auth-actions.ts`), which gains one input:

```ts
readonly held = input(false);
```

When held, each of the four buttons carries `aria-disabled="true"` and a class that
renders it quiet, and each handler emits nothing and instead sets one message (D5). The
message is a `role="status"` line under the actions, so a screen reader announces it
when it appears rather than only when focus reaches it.

Two messages, and which one shows is `BackendReadiness.slow()`:

- Before three seconds: `startup.actions.connecting`.
- After three seconds: `startup.actions.slow`, which says what is wrong rather than
  asking for more patience.

The landing page passes `held` from `state() !== 'ready'`. That covers `unreachable` as
well, which is right: the actions cannot work either way, and the blocking screen for a
connection lost mid session is unchanged and still appears over the top.

### 5.2 Every other page waits

`AppLayout` decides, and it is the only place that does:

```
@if (rendersNow()) {
  <router-outlet />
} @else {
  <lib-startup-screen ... />
}
```

`rendersNow()` is true when `state() === 'ready'`, or when the deepest activated route
carries `rendersWhileConnecting` and the state is `connecting`. The route data is read
from the router rather than passed down, because `AppLayout` is the parent of every page
and no page can tell it something before it has been created.

`lib-startup-screen` is a new panel in `libs/velista/ui/src/lib/home/state-panels.ts`,
beside the three whole screen states that already live there and built the same way: it
takes its copy as inputs and reads no keys of its own. It draws the brand mark, one
line, and after three seconds a second line and a **Try again** button which calls
`BackendReadiness.requestRetry()`.

There is no spinner. A stalled spinner is the most common way an app says "I have
frozen" when what it means is "I am waiting", and the three second line says the true
thing instead.

### 5.3 Losing the connection later

Unchanged. `lib-connection-lost` still renders over the outlet on `offline`, and
`ConnectionRecovery` still reloads the page when the connection returns. The only
difference is that `BackendReadiness.state()` reports `unreachable` while that is true,
so one signal answers "can the app work" from startup to the end of the session.

## 6. Copy

New keys under `startup` in `libs/velista/ui/assets/i18n/en.json` and `es.json`, beside
the existing `connection` block.

| Key                          | English                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `startup.connecting`         | Connecting                                                       |
| `startup.slow.title`         | This is taking longer than usual                                 |
| `startup.slow.body`          | velista cannot reach the server yet. Keep waiting, or try again. |
| `startup.slow.retry`         | Try again                                                        |
| `startup.actions.connecting` | Connecting. This will work in a moment.                          |
| `startup.actions.slow`       | velista cannot reach the server. Try again in a moment.          |

Nothing here mentions saving, queues or updates from other people, because there is no
offline mode to explain (D12). When one exists, that sentence arrives with it.

The Spanish is written by hand in the same register as the rest of the file, not
translated word for word.

## 7. Accessibility

- The startup screen is the only content in the outlet's place, so nothing behind it is
  reachable by tab. It does not need a focus trap, which is the bug an overlay over a
  live page would have.
- The held actions keep their tab order and their focus ring. `aria-disabled` says they
  will not act. It does not remove them (D5).
- Both messages live in a `role="status"` region, which announces politely and does not
  interrupt.
- The three second transition changes text in place. It does not move focus.

## 8. Tests

`libs/velista/platform`:

- `backend-readiness.spec.ts`: every transition in the table in section 3, `slow()`
  turning true once at three seconds under fake timers, and `retryRequested()` counting
  rather than latching.

`libs/velista/data-access`:

- `startup-probe.spec.ts`: one request at startup and no more once it answers; the
  backoff sequence, an attempt abandoned at 8 seconds counting as no response, a retry
  on a resume and on `retryRequested`, and the request carrying `SKIP_AUTH`.
- `gateway-interceptor.spec.ts` gains a case: a `client_too_old` refusal reports to
  `BackendReadiness` as well as calling `checkNow`, and an advertised floor header on a
  successful response does not.

`libs/velista/ui`:

- `app-layout.spec.ts`: the outlet is not created while connecting; it is created for a
  route carrying `rendersWhileConnecting`; `lib-connection-lost` still renders over a
  live outlet when offline.
- `auth-actions.spec.ts`: a held button emits nothing, carries `aria-disabled`, is still
  focusable, and shows the slow message after three seconds. Assert on inputs rather
  than rendered text where a string interpolates, per the testing translator's limits.

e2e:

- The existing velista suites must answer `/health/ready`. A suite that stubs the
  gateway and forgets this now sits on the startup screen, which is a slow and confusing
  failure. Add the route to the shared stub, and one spec that asserts the landing page
  is visible and its actions are held while the health route is unanswered.

## 9. Build order

1. `BackendReadiness` and its spec. Nothing reads it yet.
2. `StartupProbe`, its spec, its provider and initializer, and the `SKIP_AUTH` fix on
   `ConnectionRecovery.probe`. The state is now correct and invisible.
3. The interceptor's `reportTooOld` call.
4. `lib-startup-screen` and the copy in both locales.
5. `AppLayout`, the route data flag, and the outlet decision.
6. `lib-auth-actions` held mode and the landing page wiring.
7. e2e stub and specs.

Steps 1 to 3 are shippable on their own and change nothing a user sees.

## 10. What this deliberately does not do

- **No offline mode, and no "Continue offline" button.** The app has no request queue
  and no cached content behind the screen (`0001` D6), so a button offering to continue
  would offer a screen that cannot load anything and silently drops what is typed into
  it. It needs a queue, a conflict story for the writes in it, and cached reads. Those
  are their own plan.
- **No health call per navigation.** One answer at startup, and after that the app finds
  out the ordinary way, from its own requests.
- **No new backend endpoint and no change to the gateway.** Section 1 records why none
  is needed.
- **No dependency detail on the screen.** `/health/ready` reports which indicator failed;
  the app does not read it and does not say "the catalog database is down". That is an
  operator's answer to an operator's question.
- **No change to the sockets.** Realtime already reports through `ConnectionState`, and
  a socket that cannot open is not a reason to hold the whole app.
- **The update screen is `0072`.** This plan puts the app into `too-old` and stops there.

## 11. Acceptance criteria

1. A cold start with the backend unreachable shows the startup screen on every page
   except landing, and shows the landing page with its four actions held.
2. Pressing a held action says why, in the language the app is in, and creates nothing.
3. The escape text and the **Try again** button appear three seconds after the app
   starts, not three seconds after the current attempt.
4. A probe that never answers is abandoned at eight seconds and retried.
5. When the backend comes back, the app moves to `ready` without a reload, and the page
   that was waiting renders.
6. Losing the connection while using the app behaves exactly as it does today.
7. A build below the deployment's floor reaches the `too-old` state at startup, and does
   not sit on the connecting screen.
