> **PR:** [#202](https://github.com/IchirokuXVI/nx-portfolio/pull/202)

# 0008 When the gateway does not answer

Every screen in this app is a view of one backend. `0001` reads the environment before anything
renders. `0002` signs in against it, and `0003` keeps the session alive against it. `0004` onward
list and edit rows from it. All of that assumes the gateway answers.

This plan decides what the app does when it does not. The answer has two halves. **Before you are
signed in, say so instead of offering a login that cannot work.** **Once you are signed in, cover
the screen rather than lose it.**

Depends on three plans: `0001` for the environment read, `0002` for the login screen and the
interceptor, and `0003` for the overlay and the session that outlives the outage.

## 1. One question, one probe

The app asks the gateway one thing here: **is anything answering?**

The probe is `GET /health/live` on the gateway origin. It is unauthenticated, it is exempt from the
rate limiter, and it costs the server nothing, so a client is allowed to ask it repeatedly.

The question is whether the network path and the process exist. It is not whether every dependency
behind them is warm, so the probe reads `/health/live` rather than `/health/ready`.

**The probe succeeds only on a 2xx, inside five seconds.** Everything else is a failure. That
includes a 502 from a proxy in front of a restarting gateway, and a 500 from a gateway that cannot
answer its own liveness check. A server that cannot say it is alive is not a server the operator
can work against. Telling those two apart buys nothing and costs a second state to render.

The answer is one signal, `down`, and the whole feature is what the app draws when it is true.

## 2. What counts as "did not answer"

Only a request that produced **no response at all**:

- A transport failure. Angular reports these as status 0: a refused connection, a DNS failure, a
  blocked or misconfigured cross origin request.
- A timeout. `fetch` has no timeout of its own, so a gateway that accepts a connection and never
  answers hangs forever and nothing ever fails. The interceptor gives every gateway request
  **thirty seconds**, which is far beyond any request this app makes and far below the operator's
  patience.

A 4xx or a 5xx is **not** this. Those prove the server answered, and the screen that made the
request already has copy for them. An app that treats a 500 as an outage covers itself over one
broken endpoint.

The interceptor is the only place that makes this judgment, so a service cannot forget to.

## 3. Before sign in: a spinner, then the truth

Today the app blocks its first render on the environment read. A failed read is swallowed into
"unknown environment", and the login screen appears anyway. Against a dead gateway that screen is a
lie: the password goes nowhere, and the operator learns nothing until they type one.

The startup sequence becomes:

1. **A spinner from the first paint.** It lives in `index.html`, inside the root element. So it is
   on screen while the bundle downloads, and again while the environment read is in flight. Angular
   replaces it when the root component renders. A component cannot do this: the app initializer
   that holds the environment read finishes before any component exists.
2. The environment read runs, as it does now.
3. If it answered, nothing changes. `0001` and `0002` behave exactly as they did, including an
   unreadable body still meaning "unknown environment".
4. If nothing arrived, the app probes. One probe, not a loop.
5. If the probe answers, the app carries on to the login screen. A single request that failed while
   the server is up is a blink, and a blink must not stop an operator from signing in.
6. If the probe fails too, `down` is true and the cover goes up instead of the login screen.

The autologin in `0002` section 5 is skipped while `down`, for the same reason the login screen is
covered: there is nobody to ask for a token.

## 4. After sign in: cover, never navigate

This is `0003`'s rule applied to a second cause. A session that expires does not navigate away and
does not lose a form, and neither does a server that disappears.

When a request does not answer and the probe that follows it fails, an **opaque cover** goes up over
the app exactly where it stands. Nothing unmounts, nothing navigates, no component is destroyed, and
no form state is captured or replayed, because none of it is touched. The page below is marked
`inert`, so Tab cannot walk into a covered form and a screen reader cannot be walked through it.

The cover carries, in this order:

- What happened, in one sentence: the server is not answering.
- **Do not reload the page if you have unsaved work.** Reloading throws away everything the cover
  protects. It is also the first thing a person tries on a page that looks stuck, which is why the
  cover says it out loud. The line appears only when there is a session, because a reload before
  sign in loses nothing.
- When the next automatic check happens, and how many are left.
- A retry button.

It carries **no sign out control**, unlike the re-authentication overlay. A sign out while the
server is down achieves nothing that waiting does not. Its one effect is to discard the work the
cover exists to protect.

## 5. The cover has two layers, and the outer one wins

The app can be in both states at once, and it usually will be: an outage long enough to notice is
long enough for the token to expire behind it. `0003` then raises its overlay while the server is
still gone. That overlay asks for a password, against a server that cannot check one.

So the two are stacked, and reachability is on top:

| State               | What is drawn                            |
| ------------------- | ---------------------------------------- |
| `down`              | this plan's cover, whatever else is true |
| `locked`, reachable | `0003`'s re-authentication overlay       |
| neither             | the app                                  |

This is what makes recovery read correctly with no extra machinery. The probe succeeds and the
cover comes down. The operator sees their screen exactly as they left it, or the password prompt
with their username already on it. Which one depends on whether the token outlived the outage. That
is `0003`'s question, and it stays there.

Two nudges on recovery, both because a service that gave up quietly during the outage must not stay
given up:

- The session re-decides at once. A renewal refused during the outage runs now, rather than at the
  end of its retry wait.
- An environment read that never arrived is made again, so the accent colour and the badge stop
  saying "unknown" once there is something to ask.

## 6. Retrying: ten times, then only on request

While `down`, the app probes **every two minutes, ten times**. That is twenty minutes of asking
without being asked, after which the automatic checks stop and the cover says so.

The limit exists because the alternative is a tab left open overnight, probing a dead host every two
minutes until the laptop is closed. Twenty minutes covers a deploy, a restart or a network
drop. A longer outage is one a person is already dealing with.

- **The button never runs out.** The ten are the app's budget for asking on its own. An operator who
  presses retry asked, and that is always allowed.
- **Pressing it resets the wait**, so a click one second before an automatic check does not produce
  two probes a second apart.
- **A tab that becomes visible probes**, unless the last probe is newer than one interval. A page
  hidden for an hour must not cost the operator two more minutes to learn that the server came
  back. The interval guard stops a flapping window manager from turning that into a request loop.
- **One probe at a time.** Every caller shares the one in flight, so the timer, the button and a
  failing request cannot produce three.

## 7. A request that timed out is never retried

When the cover comes down, the request that raised it stays failed. The screen that made it reports
its own failure. The operator repeats the action themselves.

This is not laziness, it is the only safe reading. A timeout says nothing about whether the server
received the request: a `POST` that timed out can be applied in full before the timeout, and a replay
then creates the row twice. `0003` retries a 401 because a 401 is the one status that proves the request
was rejected before any handler ran. A timeout proves the opposite of that: nothing.

## 8. The numbers, in one place

One policy object, overridable in a spec, beside `ADMIN_SESSION_POLICY`:

| Name                   | Default | What it decides                       |
| ---------------------- | ------- | ------------------------------------- |
| `requestTimeoutMs`     | 30000   | when a gateway request is a timeout   |
| `probeTimeoutMs`       | 5000    | when a probe is a failure             |
| `retryIntervalMs`      | 120000  | the wait between automatic probes     |
| `maxAutomaticAttempts` | 10      | how many probes the app makes unasked |

They are durations rather than fractions, unlike `0003`'s, because none of them is relative to
anything the server tells the app. How long a person tolerates a spinner does not scale with a
token lifetime.

## 9. Tests

- The environment read fails, the probe fails, and the cover is drawn instead of the login screen.
- The environment read fails and the probe answers: the login screen is shown, and no cover.
- A request with status 0 raises the cover only after its probe fails, and never on a 500.
- A request that hangs past the timeout raises the cover, and the request is aborted.
- The cover names the reload warning only when there is a session.
- The cover is opaque: no alpha colour, no blur and no opacity in its styles, as `0003` asserts of
  its own overlay.
- Ten automatic probes happen at the stated interval and then stop. The button still works after
  that.
- A probe that succeeds takes the cover down, and reveals the re-authentication overlay when the
  token died during the outage.
- The probe request does not itself raise a cover, and one probe is made however many callers ask.
- Fake timers throughout, and microtasks drained by hand: `whenStable` hangs in a zoneless spec.

## 10. Exit criteria

- A gateway that is down at startup produces an explanation, not a login form.
- A gateway that goes down under a half filled form loses nothing, and the operator is told not to
  reload.
- The app finds out on its own, within two minutes, that the server came back.
- No screen in the app has to know any of this.

## 11. Out of scope

- Retrying the failed request. Section 7.
- Any offline capability: no cache, no queue of pending writes, no service worker. This app is a
  window onto a database and is useless without one, which `0001` section 4 already settled.
- Telling apart a gateway that is down from a network that is off. The browser reports both as
  nothing arriving, `navigator.onLine` lies often enough to be worse than silence, and the operator
  does the same thing either way.
