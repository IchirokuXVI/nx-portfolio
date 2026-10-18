> **PR:** [#749](https://github.com/IchirokuXVI/nx-portfolio/pull/749)

# 0154: the share link page and the basket page answer every reader

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Seven findings of `docs/reports/2026-10-16-velista-e2e-slot1.md`
> about a person who arrives at a share link or a basket URL and is not answered: F6.5
> (major, `/s/:secret` hangs on "Checking the link" forever when the preview request fails),
> F6.4 (major, a signed in member who was removed opens a new link and is offered "Continue
> as guest" with "That did not work"), F5.4 (major, a basket URL opened signed out, or by a
> signed in non participant, reads "You are no longer on this list" with no way forward),
> F6.6 (sign in from the link loses the link), F6.7 (two contradictory banners after a
> removal or a finish), F6.8 (a guest removed by name reads after reload that the link no
> longer accepts people) and F6.9 (the dead link page has no action at all). Plus one the
> walk found and did not number: "Continue with Google" opens the email register page.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0114` (share links), plan `0009` (credential flows, and rule
> C2: a guest is never shown register), `libs/velista/feature-shopping-lists/src/lib/join-page/join-page.ts`
> and `.html`, `libs/velista/data-access/src/lib/baskets/basket-store.ts:1840-1883` (`_fail`),
> `basket-session-store.ts`, `basket-socket.ts:305-306`, `basket-page.ts:618`, `:690-731`,
> `basket-page.html:94-111`, `:202-207`, `libs/velista/data-access/src/lib/errors.ts:147-159`
> (`endedReasonOf`), `gateway-interceptor.ts:127-149`, `libs/velista/feature-shell/src/lib/auth-guards.ts:90-100`,
> `libs/velista/feature-auth/src/lib/sign-in-page/sign-in-page.ts:140-172`,
> `register-page.ts:168-170`, and
> `apps/luna-shopper-backend/core/src/app/baskets/basket-sharing.service.ts:417-466`, `:635`,
> `:664-687`, `:1218-1227`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

Every state of the share link page and of a basket that a reader cannot use is one clear
sentence with one action: retry, sign in and come back here, go home, or ask the owner. A
signed in person is never offered the guest path, and a guest is never offered register.

### Context

- **The join page has five states and no error path.** `'checking' | 'offering' | 'dead' |
  'joining' | 'failed'` (`join-page.ts:27`). `_check()` (`:135-158`) awaits `previewLink`
  (`:141`) with no try/catch and the constructor calls it with `void` (`:124`), so a
  rejection leaves `checking` on screen for good. `join()` (`:167-183`) catches everything
  and sets `failed`, and `failed` draws the guest offer plus an alert
  (`join-page.html:38-133`, alert at `:103-107`). There is no state for a signed in reader.
  "Continue with Google" calls `register()` (`:111-112`). `signIn()` and `register()`
  (`join-page.ts:190-200`) navigate with no query parameter. The `dead` branch
  (`join-page.html:25-36`) has no action, and the route sets `NO_NAV_CHROME`
  (`routes.ts:1769-1774`).
- **The interceptor passes the useful codes through.** `not_a_participant` and
  `participant_expired` reach the caller with no refresh or sign out
  (`gateway-interceptor.ts:127-149`), and `endedReasonOf()` (`errors.ts:147-159`) already maps
  them.
- **What the gateway answers.** Preview always answers 200: `joinable: false` for a missing,
  revoked or expired link (`basket-sharing.service.ts:417-419`) and for a basket that is not
  open (`:424-425`); a malformed secret takes the same path. Join answers 404 for a revoked
  or expired link, a finished basket or a malformed secret (`:460`, `:466`), and 401
  `not_a_participant` for a registered person whose row ended with `REMOVED` or
  `LINK_REVOKED` (`:664-667`, `:684-687`, the rule at `:1218-1227`).
- **Nothing in velista carries a return target.** `sign-in-page.ts:140-142` and
  `register-page.ts:168-170` go to `home` after success; the only query parameter in
  feature-auth is `email`. `authenticatedGuard` keeps the mount and the locale and drops
  the page (`auth-guards.ts:90-100`). `createAccount()` on sign in (`sign-in-page.ts:168-172`)
  would also have to carry the target on.
- **The basket page knows only "held a secret or not".** `BasketStore._fail()`
  (`basket-store.ts:1840-1883`) forgets the stored secret first (`:1858-1859`), then sets
  `revoked` with a reason when a secret was held (`:1866-1876`) and `needsJoin` otherwise
  (`:1876`). `needsJoin` draws `basket.join.dead` and `deadBody` with no action
  (`basket-page.html:202-207`). The top banner `@if (revoked())` (`:102-111`) reads the
  socket's own latch (`basket-page.ts:618`, set at `basket-socket.ts:305-306`), which is the
  doubled sentence of F5.4. A registered reader never holds a secret, so a signed in non
  participant and a removed member both land on `needsJoin` with the wrong words. After a
  reload the forgotten secret makes a removed guest `needsJoin` too (F6.8). `visitNotice`
  (`basket-page.html:94-100`, computed at `basket-page.ts:690-731`) depends only on
  `me().expiresAt` and the dismissal, so it stays over "no longer on this list" (F6.7).
- The route `shopping-lists/:basketId` has no auth guard on purpose, because a guest
  participant is signed out (`routes.ts:285-291`, `:1675-1680`).

### Target state

Share link page:

1. `_check()` catches a rejection and sets a new `unreachable` state: "We could not check
   the link" with a "Try again" button that calls `_check()` again.
2. `join()` reads the error. A 401 `not_a_participant` for a signed in reader sets a new
   `removed` state: "You were taken off this list. Ask the person who shared it to add you
   again", with "Go home". A 404 sets `dead`. Anything else sets `failed`, which keeps the
   alert but, for a signed in reader, never draws the guest offer.
3. A signed in reader never sees "Continue as guest", "Continue with Google" or "Sign in
   with email". A signed out reader never sees "Create an account" from this page (rule C2
   applies in spirit: the guest path is the way in, and an account can be made later from
   the account page). "Continue with Google" is removed until a Google sign in exists.
4. `dead` draws one action, "Open velista", which goes to the landing or home by sign in
   state. A malformed secret reads "This link is not complete" instead of "no longer
   accepting people", decided on the client by the secret's shape.
5. `signIn()` navigates to `auth/login` with a `returnUrl` query parameter that holds this
   page's path. The sign in page, after success, navigates to `returnUrl` when it is a
   relative path inside the app (starts with `/`, no scheme, no `//`), else to `home`.
   `createAccount()` on the sign in page carries the parameter on. `authenticatedGuard`
   passes the dropped page as `returnUrl` too, which fixes F4.7 (a signed out deep link
   drops the target) in the same move.

Basket page:

6. `_fail()` reads the error code and the sign in state before it forgets the secret, and
   `BasketSessionStore` keeps a small "ended" marker for the basket id so that a reload
   draws the same state. The states:
   - no secret, signed out: `needsSignIn`, "Sign in to open this list" with a sign in
     button that carries `returnUrl`;
   - no secret, signed in, 401: `notYours`, "This list is not yours" with "Go home";
   - a secret held, or an ended marker: today's `revoked` copy by reason, with "Go home";
   - `participant_expired`: today's `ended` copy.
7. `visitNotice` is hidden whenever the state is not `ready` or the basket is finished.
   The socket's `revoked` latch no longer draws a second banner over a state block.

### Scope

- `libs/velista/feature-shopping-lists/src/lib/join-page/join-page.ts`, `.html`, `.scss`,
  `join-page.spec.ts`; `basket-page/basket-page.ts`, `.html`, `basket-page.spec.ts`.
- `libs/velista/data-access/src/lib/baskets/basket-store.ts`, `basket-store.spec.ts`,
  `basket-session-store.ts` and its spec; `basket-memory.ts:1039-1060` for the error
  shapes of the in memory double.
- `libs/velista/feature-auth/src/lib/sign-in-page/sign-in-page.ts`, `sign-in-page.spec.ts`,
  `register-page/register-page.ts` only if the parameter must pass through it.
- `libs/velista/feature-shell/src/lib/auth-guards.ts` and `auth-guards.spec.ts`.
- `libs/velista/ui/assets/i18n/en.json` and `es.json` (`basket.join.*`, new keys).
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- `returnUrl` is accepted only as a relative in app path. Anything else goes to `home`.
  Write the check as a pure function with its own spec.
- The join route keeps `NO_NAV_CHROME`; the one action replaces the nav.
- The backend is not changed. A removed member and a stranger both get 401
  `not_a_participant` and are told apart only by the ended marker on the device; a removed
  member on a new device reads "not yours", which is true enough. Record it in "What the
  build decided".
- Copy follows the velista rules. Every state block has one primary action and names the
  person to ask where one exists.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you add a route, change the auth
  guard's redirect target shape, or touch the backend.
- If keeping the ended marker in `BasketSessionStore` turns out to collide with the two
  hour expiry of the secret, stop and report before you change the expiry.

### Progress evidence

- New specs, each failing before the change:
  - a preview that rejects draws `unreachable` with a working retry;
  - a join that answers 401 `not_a_participant` for a signed in reader draws `removed`
    and no guest offer;
  - a signed out reader sees the guest offer and sign in, and no register and no Google;
  - `dead` draws the one action; a 20 character secret draws the "not complete" sentence;
  - sign in from the link page lands back on the link page and joins;
  - the basket store on a 401 with no secret draws `needsSignIn` signed out and `notYours`
    signed in; a reload after a removal still draws `revoked`;
  - `visitNotice` is absent while the state is `revoked` and on a finished basket.
- `npx nx run-many -t lint test -p velista/feature-shopping-lists velista/feature-auth velista/feature-shell velista/data-access`
  passes.
- `npx nx build velista` passes.
- `apps/velista-luna-e2e` stays 8 of 8 (`guest.spec.ts` covers the join page).

## 1. Not in this plan

- A Google sign in. The button is removed until one exists.
- Telling a removed member from a stranger on a new device. It needs the backend to
  answer a different code for an ended row, which backend plan `0114` can extend.
- The 404 page with a way home (S31). Plan `0150` replaces the component and a follow up
  adds the link.

## 2. Choices that are mine

- **A `returnUrl` query parameter, checked as a relative path.** It is the smallest
  mechanism that also fixes the signed out deep link (F4.7), and the guard already knows
  the dropped page.
- **The guest path is the only way in from a link.** A person who wants an account can
  make one from the account page after joining as a guest, and upgrade keeps the
  memberships (rule C2).

## 3. What the build decided

- **Two files outside Scope were edited, because the target state needs them.**
  `BasketLoad` is in `libs/velista/models/src/lib/basket-view.ts`, so `needsSignIn` and
  `notYours` were added there. They replace `needsJoin`, which nothing sets any more.
  `libs/velista/feature-landing/src/lib/landing-page/landing-page.ts` now passes its query
  on to sign in (`queryParamsHandling: 'preserve'`). Without that, the `returnUrl` that
  `authenticatedGuard` puts on the front door is dropped there, and F4.7 stays open.
- **The guard keeps its redirect target.** It still sends a refused reader to the front
  door. It only adds `returnUrl` beside any query that was already there. A guarded sheet
  over a basket keeps the basket as its target, and `returnUrl` names the sheet.
- **`safeReturnUrl()` is in `feature-auth/src/lib/return-url.ts`.** The pages that write
  the parameter (the share link page, the basket page, the guard) use the literal
  `returnUrl`, because a lazily loaded library cannot be imported. It accepts a value
  that starts with `/`, is not `//` or `/\`, and has no backslash and no control
  character. The decoded value must pass the same check. Register also honours the
  parameter and passes it back on "Sign in instead", so "Create an account" on the sign
  in page does not lose the link.
- **The ended marker takes the credential's key.** `BasketSessionStore.end()` writes
  `{ ended: reason }` under `basketSessionKey`, `ended()` reads it, and `read()` never
  returns it as a credential. It has no expiry and needs none: a join writes over it, and
  `forget()` (Leave) removes it. No two hour expiry of the secret exists in this store,
  so the marker collides with nothing. The `basket.unshared` event writes the marker
  too, so a reload after the owner removes somebody says the same thing.
- **The order `_fail()` reads in.** A credential held: `revoked` with the code's reason.
  An ended marker: `revoked` with the marker's reason. A `participant_expired` with
  neither: `revoked`, `EXPIRED`. Otherwise `notYours` if signed in, `needsSignIn` if not.
  `SessionStore` is injected optionally, because the sheet specs build this store with no
  account. A missing one reads as signed out.
- **A removed member on a new device reads "This list is not yours".** The gateway
  answers a stranger and an ended row with the same `not_a_participant`, and nothing is
  on the device to tell them apart. This is true enough. Backend plan `0114` can give an
  ended row its own code later.
- **"Not complete" is decided after the preview, by the shape.** A whole secret is 43
  base64url characters (`randomBytes(32).toString('base64url')`). The preview still
  runs for every secret, so a later change to the secret's format cannot make a live
  link unreachable. Only the dead sentence uses the shape.
- **One action for each state block.** The share link page has Try again
  (`unreachable`, and `failed` for a signed in reader), Open Velista (`dead`) and Go
  home (`removed`). The basket page has Sign in (`needsSignIn`) and Go home (`notYours`,
  `revoked`). Go home goes to `home` for a signed in reader and to the front door
  otherwise.
- **Both stale notes draw only over a `ready` basket.** That covers the socket's revoked
  latch and "not updating". A reader with no place on a basket has no socket either, so
  "not updating" over "Sign in to open this list" was a second, contradictory banner.
- **A network failure of the preview also raises the app's connection lost screen.**
  That screen is app wide and reloads by itself. The `unreachable` state is what stays
  after it, and what a 503 draws.
