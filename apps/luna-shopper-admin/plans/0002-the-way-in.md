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

## 3. Where the token lives

**In memory only.** A signal in a root provided service, and nowhere else.

Not `localStorage`, not `sessionStorage`, not a cookie the app can read. A token in web storage
survives a tab close, is readable by anything running on the origin, and outlives the session it
belongs to. Holding it in memory means closing the tab ends the session, which is the behaviour
this whole design is aiming at, and reloading the page means signing in again, which is acceptable
for a tool with one user and a fifteen minute token.

The consequence for `0003` is worth stating now: a reload is a new session and the form state it
was protecting is gone. `0003`'s overlay exists precisely so that the common case, expiry while
working, never becomes a reload.

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

## 6. After a successful login

- The token is stored in memory.
- `GET /v1/admin/auth/me` supplies the identity shown in the app chrome and the environment name and
  colour that `0001` section 6 introduced. From here on that call is authenticated, and the
  unauthenticated environment read `0001` used is only for the login screen itself.
- The app navigates to its landing route, which at this point is the placeholder page from `0001`.

## 7. Tests

- Submitting valid credentials stores a token and navigates away.
- Each of section 2's four outcomes renders its own message, and the wrong-password case renders
  the same text for an unknown username as for a wrong password.
- The token never reaches `localStorage` or `sessionStorage`, asserted directly.
- The interceptor attaches the header to gateway requests and to nothing else.
- With dev auto login reported unavailable, the screen is shown; with it available, it is skipped.
- Specs are zoneless. `whenStable` hangs under fake timers, so drain microtasks instead, and jsdom
  has neither `PointerEvent` nor `scrollIntoView`.

## 8. Exit criteria

- An admin created by `0071`'s command can sign in and reach the landing page.
- A wrong password, a throttle, a lockout and a disabled account each produce their own message.
- Closing the tab ends the session.
- Development skips the screen, and only because the server said it may.

## 9. Out of scope

- Refreshing, idling, warning, and the re-authentication overlay: `0003`.
- Signing out deliberately, which arrives with the app chrome in `0004`.
