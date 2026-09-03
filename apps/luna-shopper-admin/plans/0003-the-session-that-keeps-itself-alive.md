> **PR:** [#184](https://github.com/IchirokuXVI/nx-portfolio/pull/184)

# 0003 The session that keeps itself alive

The token from `0002` lasts fifteen minutes. This plan decides what happens for the fifteenth
minute onward, and the answer has two halves: **while you are working it never expires, and when it
does expire you do not lose anything.**

There is no refresh token anywhere in this design. A token renews itself while it is still valid,
and once it is dead it is dead. That is the entire session model, and it holds no long lived
credential at any point.

Depends on `0002` and on `apps/luna-shopper-backend/plans/0071`, which provides
`POST /v1/admin/auth/refresh`.

## 1. The rule

- **Active** means the operator has interacted recently. While active, the token is renewed before
  it expires, indefinitely, whether or not they are navigating or making requests.
- **Idle** means they have not. An idle session is allowed to run down, and it warns before it
  does.
- **Expired** means re-authenticate in place. It does not mean go back to the login screen and lose
  what you were doing.

Renewing while nothing is being requested is the deliberate part. A session that only refreshes on
API traffic dies while an operator is filling in a long form, which is exactly when losing it costs
the most.

## 2. Idle, defined so it works on a phone

Activity is real interaction: pointer, key, touch and scroll. Not a timer, and not the mere
existence of an open tab.

Two things a desktop-only reading of this gets wrong:

- **The tab may not be visible.** A backgrounded tab must not hold a session open, so the keepalive
  is gated on `document.visibilityState` as well as on recent input. A phone in a pocket is the
  case this exists for, and it is precisely the situation the fifteen minute token is protecting
  against.
- **The OS freezes and thaws pages.** A mobile browser can suspend a page for an arbitrary period
  and resume it with timers that did not fire. On resume the app **verifies** its token rather than
  assuming it survived: check the expiry it already knows, and if in doubt refresh once. Trusting a
  timer that was asleep produces a session that believes it is alive and 401s on the next click.

## 3. The warning

When the session is idle and **one fifth of the token's lifetime remains** (three minutes of
fifteen), a warning appears: the session is about to end, and any interaction keeps it.

Dismissing it or touching anything counts as activity and renews. Ignoring it lets the token
expire, which is section 5.

The fraction is configurable alongside the TTL rather than hard coded at three minutes, because
`0071` makes the TTL configurable and a fixed warning would be nonsense against a development token
that lasts a day.

## 4. Refresh is single-flight

A keepalive timer and 401 retries will both want to refresh, sometimes at the same moment. Without
a guard that is several concurrent refresh calls.

**One refresh may be in flight; everything else awaits the same promise.** This matters less here
than in a rotating refresh token design, where concurrent rotation invalidates itself, but it still
produces duplicated requests and interleaved token writes, and it is three lines to prevent.

## 5. Expiry does not go back to the login screen

When the token expires, the app raises a **re-authentication overlay** over whatever is on screen.
Nothing unmounts, nothing navigates, no component is destroyed, and no form state is serialized or
restored, because none of it was ever touched.

This is the reason for the whole approach. The alternative, navigating to the login route and
preserving form data in a service, needs per form state capture and replay for every screen in the
app, and it would be wrong somewhere. An overlay needs none of it.

On success the overlay dismisses and the app is exactly where it was, including a half filled form.

### 5.1 It must not leave anything readable behind it

The overlay is **opaque**. Not translucent, not blurred.

A blur reads as obscured while remaining legible to a phone camera and trivially removable in
devtools, which is the worst combination: it feels safe and is not. The threat being addressed is
somebody looking at an unattended screen, and an opaque cover answers it completely.

Two further requirements, both easy to miss:

- **Focus is trapped in the overlay.** Otherwise tabbing walks the cursor into the covered form's
  inputs and a screen reader reads out the content the overlay exists to hide.
- **The covered content is still in the DOM**, and someone with devtools can read it. That is the
  accepted residual. Removing it means destroying the components and holding form state outside
  them, which is the machinery this design exists to avoid. It is recorded here as a known limit,
  not an oversight: the threat model is a glance at a screen, not an attacker at the keyboard.

## 6. Requests that were in flight

A request that 401s during expiry must be **queued and retried after re-authentication**, not
failed.

Without this, an operator presses save, the token has just expired, they re-authenticate, the
overlay dismisses, and the save they made silently never happened. The form still shows their
edits, so nothing looks wrong until much later.

The interceptor from `0002` section 4 is replaced:

1. A 401 pauses the request rather than failing it.
2. If a refresh can be attempted (the token is expired but the session is not abandoned), it
   happens once, single-flight, and the queue drains against the new token.
3. If refresh fails, the overlay is raised, and the queue drains after a successful
   re-authentication.
4. If the operator abandons the overlay, the queued requests fail, and the app returns to the login
   screen having lost the work. This is the one path that loses anything and it requires a
   deliberate choice.

Non-idempotent requests are retried here. That is safe for this surface because the retry happens
against a request that was rejected at the guard, before any handler ran, so nothing was applied
the first time.

## 7. Signing out

An explicit sign out clears the token, drops any queued requests, and returns to the login screen.
Since there is no refresh token and no server side session record, there is nothing to revoke: the
token simply stops being held, and it expires on its own shortly after.

## 8. Tests

- An active session outlives its token, with no request traffic other than the refreshes.
- An idle session warns at the configured fraction and expires if ignored.
- Activity during the warning renews and dismisses it.
- A hidden tab does not renew.
- Two simultaneous triggers produce exactly one refresh call.
- A request that 401s is retried and succeeds after re-authentication, asserted by its side effect
  rather than by the absence of an error.
- Abandoning the overlay fails the queue and returns to login.
- The overlay traps focus and renders opaquely.
- Fake timers throughout; `whenStable` hangs under them, so drain microtasks instead.

## 9. Exit criteria

- Working continuously never ends the session.
- Walking away warns, then ends it.
- Expiry never navigates away and never loses a form.
- No credential outliving the access token is stored anywhere.

## 10. Out of scope

- Anything the session protects: `0004` onward.
- Surfacing `0071`'s failed login records, which waits for a dashboard.
