# 0002 The way in

One screen: a username, a password, and a button. It is the first thing the app shows and the only
thing it shows until it succeeds.

This plan covers getting a token and holding it. Keeping it alive, noticing an idle operator, and
what happens when it expires are `0003`. The split is deliberate: signing in is small, finished,
and testable on its own, and the session machinery is the larger half that should not hold it up.

Depends on `apps/luna-shopper-backend/plans/0071`, which provides `POST /v1/admin/auth/login`,
`GET /v1/admin/auth/me` and the token they issue.

## 1. The screen

Username, password, submit. No email, no "forgot password", no "create account", and no third party
sign in button.

Every one of those absences is a decision from `0071`: there is no email column on `admin_users`,
recovery happens on the server by the person holding the server, and accounts are created by a
command. A screen offering a recovery flow that does not exist would be worse than one that offers
nothing.

**No "remember me".** The session is one short lived token, there is no refresh token, and a
checkbox promising persistence would be lying.

It must be usable on a phone. That means real `type="password"` and `autocomplete` attributes so a
password manager fills it, inputs large enough to hit, and a layout that survives a software
keyboard covering half the viewport.

## 2. Failures the screen has to say something about

`0071` gives login four distinct outcomes, and collapsing them into "login failed" makes the
lockout invisible, which is the one an operator most needs to understand.

| Outcome                    | What the screen says                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Wrong username or password | One message for both. Never "no such user", which confirms a username to whoever is guessing.         |
| Throttled                  | That there have been too many attempts and to wait, with the retry window if the response carries it. |
| Locked out                 | That the account is locked, and that it clears after a period or by an admin on the server.           |
| Disabled account           | That the account is disabled. It will not clear by waiting.                                           |

Throttled and locked out are different states from different mechanisms (one limits a source, one
protects an account) and they resolve differently, so they read differently.

**As built, this table has three rows and not four.** `0071` answers a disabled account with exactly
the same 401 as a wrong password, deliberately, so that a disabled account cannot be told apart from
a typo by whoever is guessing usernames. That reasoning is right and was not overturned to satisfy
this table, so the client has no branch for it: a disabled operator reads "that username and password
did not match". The row is left above as the record of what was intended and why it is not there.

Telling the throttle from the lockout **did** need a change, because both arrived as `rate_limited`
and were indistinguishable on the wire. Since the lockout is the outcome this section exists to keep
visible, `account_locked` was added to the backend's error codes (423, its own catalog message) and
`AdminIdentityService` raises it. It confirms nothing that the throttle does not: the count is kept
by username whether or not that username exists, so a caller only meets it for a name they have
already failed against themselves.

## 3. Where the token lives

**In `sessionStorage`, and nowhere else.** A signal in a provided service, mirrored into that one
store.

This is a revision of what this section originally said, which was memory only. The property the
design is aiming at has not changed — **closing the browser ends the session** — but memory only
bought that at the price of every reload being a new login, and a back office is a tool somebody
keeps open across a working day and reloads constantly while a rebuild lands. `sessionStorage` is
cleared when the browser closes, so it keeps the property and gives the reload back.

Not `localStorage`, which survives a browser restart and would leave a token on a disk overnight.
Not a cookie, which this app has no server of its own to set.

The limit, stated so nobody is surprised by it: `sessionStorage` is **per tab**. A reload keeps the
session and a tab opened from an existing one inherits a copy, but a brand new tab typed or
bookmarked into the address bar starts empty and asks for a password. Sharing a session between
unrelated tabs would take a `localStorage` handshake broadcasting the token between them, which is
more machinery and a wider exposure than the thing it saves.

What this changes for `0003`: a reload is **not** a new session any more, so the overlay is no
longer the only thing standing between an expiry and a re-login. It is still worth having for the
case it was designed for — expiry while working, with form state on screen — which a reload would
still lose.

## 4. The interceptor, in its first form

An HTTP interceptor attaches `Authorization: Bearer <token>` to every request to the gateway, and
does nothing else in this plan. It does not retry, does not queue, and does not refresh. A 401 here
simply clears the token and returns to the login screen.

That is a temporary shape and `0003` replaces the 401 branch entirely. It is written this way so
this plan ends in a working, coherent app rather than in half of `0003`.

## 5. Development signs in by itself

In development the app skips the screen and obtains a token automatically, so a rebuild does not
cost a login.

The dangerous half is the server's, and `0071` section 8 holds it: `ADMIN_DEV_AUTOLOGIN` rather
than `NODE_ENV`, auth refuses to boot with it on and a non local host, neither environment values
file sets it, and `provision-release.sh --check` asserts its absence.

The client half is small and must not be clever. On start, if the API reports that dev auto login
is available, the app calls the endpoint and receives a token for the configured existing admin.
**The client never decides for itself that it is in development.** It asks, and the server is
entitled to say no. A build time flag deciding to skip authentication is precisely the kind of
thing that ships wrong, and it is unnecessary: the server already knows.

The token from auto login is an ordinary admin token belonging to a real row, so audit rows written
during local work are attributable exactly as they are in production.

**How it asks**, since `0071` left no channel for the question: the unauthenticated
`GET /v1/admin/environment` that `0001` added for the accent colour grew a second field,
`devAutologin`, read from the same `ADMIN_DEV_AUTOLOGIN` the gateway already consults. One call
answers both questions the app has before it renders anything, and the client treats every way of
not being told — an unreachable gateway, a body it cannot read, a deployment predating the field —
as `false`, so the login screen is what an unanswered question produces.

## 6. After a successful login

- The token is held in a signal and mirrored into `sessionStorage` (section 3).
- `GET /v1/admin/auth/me` supplies the identity shown in the app chrome and the environment name and
  colour that `0001` section 6 introduced. From here on that call is authenticated, and the
  unauthenticated environment read `0001` used is only for the login screen itself.
- The app navigates to its landing route, which at this point is the placeholder page from `0001`.

## 7. Tests

- Submitting valid credentials stores a token and navigates away.
- Each of section 2's outcomes renders its own message, and the wrong-password case renders
  the same text for an unknown username as for a wrong password.
- The token never reaches `localStorage`, asserted directly. It **does** reach `sessionStorage`,
  and a stored session is visible on construction rather than a tick later, because the route
  guard runs during the router's first navigation.
- A stored value this build cannot use — bad JSON, a shape it does not recognise, an expiry that
  has passed — is discarded *and removed*, and a browser that refuses storage entirely still
  produces a working app.
- The interceptor attaches the header to gateway requests and to nothing else.
- With dev auto login reported unavailable, the screen is shown; with it available, it is skipped.
- Specs are zoneless. `whenStable` hangs under fake timers, so drain microtasks instead, and jsdom
  has neither `PointerEvent` nor `scrollIntoView`.

## 8. Exit criteria

- An admin created by `0071`'s command can sign in and reach the landing page.
- A wrong password, a throttle and a lockout each produce their own message. A disabled account
  produces the wrong-password one, for the reason in section 2.
- Closing the **browser** ends the session; a reload does not. (Originally "closing the tab", which
  the section 3 revision changed.)
- Development skips the screen, and only because the server said it may.

## 9. Out of scope

- Refreshing, idling, warning, and the re-authentication overlay: `0003`.
- Signing out deliberately, which arrives with the app chrome in `0004`.
