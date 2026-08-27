# 0013. The account: your name, your email, and the two ways out

> Prerequisite reading: `0009` (the credential flows, rules C1 to C3, and the resend
> sentence this screen reuses), `0004` sections 5 and 9 (the token lifecycle and the DI
> inventory), and `0010` section 5.7 (the typed confirm, which this plan spends for the
> second and last time).
>
> **This is a page plan** and follows the template in `0001` section 9.
>
> It covers one route, `account`. `settings` is deliberately **not** folded into it, and
> section 4.5 says why, along with the two preferences nobody in this app can change
> today.
>
> **Status: written 2026-08-27, mock drawn the same day and awaiting approval.**
> Nothing here is built yet.

## 1. Purpose

`0003` drew an account button into the app bar and `0007` kept it. It has recorded into
`pendingRoutes` ever since (`home-page.ts:430`). This is the screen behind it, and it is
the last one in the route table that is about the person rather than about a group.

Three things a person cannot do anywhere in this product today. A search across
`libs/velista` for sign out, logout, or `TokenStore.clear` from a component finds
nothing at all:

- **Sign out.** Somebody who signed in on a friend's phone cannot get back off it. The
  pair sits in `localStorage` until the friend clears site data.
- **Change their own name.** `0010` built a rename, and it renames a **membership**:
  the copy of the name inside one group. The global name that a new membership is
  seeded from cannot be touched from any screen.
- **Leave.** `DELETE /v1/account` has existed since backend plan 0011 and nothing calls
  it.

And a fourth thing, which is why this screen needs more care than its size suggests: a
**guest** arrives here too, and for a guest one of those controls does not mean what it
says. Section 4.2 is the whole of it.

## 2. Mock

**https://claude.ai/code/artifact/724e98ef-0b68-4d62-a19a-3ea29275af36**

Sources are committed in `mocks/account/`, built and published the way
`mocks/README.md` describes.

| Artboard | Frames |
| --- | --- |
| `Account.dc.html` | The screen for a registered account, confirmed and unconfirmed |
| `AccountGuest.dc.html` | The guest's screen, which is a different screen and not the same one with rows disabled (section 3.2) |
| `Rename.dc.html` | The name sheet: arrived, the propagation choice, and the hourly refusal (section 5.4) |
| `Delete.dc.html` | The delete sheet with the typed confirmation, for somebody who owns groups and for somebody who owns none |

Phone frames are 390 by 844. **Night only.** Every role this needs was proved by `0003`
and `0010`: amber primary, coral destructive, violet pending, and the muted row
treatment. It introduces no colour role, so under the rule in `mocks/README.md` it earns
no Day artboard.

## 3. States

### 3.1 The screen

| State | Behaviour |
| --- | --- |
| Loading | The name and initial render immediately from `SessionStore`, which already has them off the token pair. Only the email row skeletons, because only the email needs a request |
| Loaded | Name, email and its confirmation state, the password row, sign out, delete |
| Guest | A different screen. See 3.2 |
| Profile failed | The rows that need the profile are replaced by one retry line. **The screen still renders**, and sign out still works: being unable to read an email must never be what traps somebody on a phone they want off |
| Offline | The app's existing blocking screen (`0001` D6). Nothing special here |
| Renaming | The sheet's primary is busy and the field is read only |
| Deleting | The whole screen goes `aria-busy`, because there is no partial success to render and nothing to go back to |

The loading row is worth stating plainly because it is the difference between a screen
that flashes and one that does not: `SessionStore.username` is derived from the token
pair, which is already in memory, so the name at the top of this screen never has a
loading state. `GET /v1/account/me` is fetched for the **email**, which is the one fact
the app genuinely does not have.

### 3.2 The guest's screen is a different screen

A temporary user reaches this route: they are authenticated, `authenticatedGuard`
passes, and the app bar's account button is drawn for them on the dashboard.

What they must not be shown is this screen with rows greyed out. They have no email, no
password, and no way back into their account, so four of its six rows are meaningless
for them and the fifth, sign out, is a trap (rule A1). The guest's screen is:

- Their name, renameable exactly as it is for anybody else. This is the one row that is
  the same, and it is the reason a guest is not simply redirected away.
- **Secure this account**, the primary, linking to `auth/upgrade`, carrying the same
  group count `0009` put on the upgrade screen itself.
- One plain sentence saying this account lives on this phone and nowhere else.
- Delete, at the bottom, worded as the only exit it is.

No email row, no password row, no sign out. Not disabled: absent.

### 3.3 Renaming

| State | Behaviour |
| --- | --- |
| Arrived | The field carries the current name, selected, so replacing it is one gesture |
| Invalid | Refused on submit, never while typing. Two to forty characters, and the character rules in section 5.4 |
| Submitting | Primary busy, field read only |
| Refused, hourly | The section 5.4 copy, counting down the **server's** number |
| Done | The sheet closes, the name on the screen and in the app bar changes at once (rule A2) |

### 3.4 Deleting

| State | Behaviour |
| --- | --- |
| Arrived | The consequences, counted from the cache (section 5.7), and a disabled primary |
| Typed | The primary enables when the typed name matches, trimmed and case folded |
| Submitting | Primary busy, the sheet cannot be dismissed |
| Done | Session cleared, navigate to the front door, one line saying the account is gone |
| Failed | The sheet stays open with the generic panel and the correlation id. A failed delete must never look like a successful one |

## 4. Anatomy

### 4.1 One route, and it is not a sheet

`account` is a destination: it is deep linkable, it has its own scroll, and it is where
somebody goes deliberately rather than something drawn over a page they were reading. So
it is a route, by the same test `0009` section 4.1 used to make the credential screens
routes rather than sheets.

Its two confirms are the opposite, and are sheets under rule E1 (`0008`): each is one
decision about a row that is on screen, the screen underneath must not be lost, and
Android's back button has to dismiss it.

Declared **before** the `''` front door, like every other non empty path, and the
`routes.spec.ts` assertion from `0008` section 4.1.1 covers it for free.

| Route | Renders | Access |
| --- | --- | --- |
| `account` | `AccountPage` | Authenticated |
| `account/name` | `RenameSheet`, over the account page | Authenticated |
| `account/confirm/delete` | `DeleteAccountSheet` | Authenticated |

`authenticatedGuard` and nothing more. There is no guest variant of the guard: the guest
sees a different screen, not a different route, because everything on it is a property of
`SessionStore.isGuest` that the page already reads, and splitting the route would give
two URLs for one thing a person navigates to by pressing one button.

That is a deliberate departure from rule C1 (`0009`), which put `auth/register` and
`auth/upgrade` behind guards rather than behind a template branch, and the difference is
what the branch protects. There, the wrong screen **silently strands every group the
person has**, so it had to be unreachable. Here, the wrong branch is a screen with rows
that do not apply. Guards are for the ones that cost something.

### 4.2 Rule A1: a guest is offered no sign out

> **Rule A1.** Sign out is rendered only when `SessionStore.identity().kind` is
> `REGISTERED`.

For a registered user, sign out drops a pair that can be minted again by signing in. For
a guest it is **irreversible destruction of the account**, and it is worse than delete
because it looks harmless.

`TokenStore` says so itself, in the comment on why the pair is in `localStorage`: "a
temporary user's token is the only proof of their identity, so losing it loses their
data". There is no server call that recovers it. The groups keep existing, owned by a
user whose only credential was the string this button just erased, and no screen in the
product can reach them again.

So the app would be offering two controls with the same outcome, one of which reads as
routine and one of which reads as final. Offering the routine looking one is the trap,
and the fix is not a warning: it is not drawing it. What the guest gets instead is the
upgrade, which is the actual way out of this phone, and delete, which is honest about
being the other one.

Somebody who genuinely wants off a borrowed phone and wants to keep what they have has
exactly one path, and it is the right one: secure the account first, then sign out. The
screen says that in a sentence rather than making them discover it.

### 4.3 Libraries

| Library | Adds |
| --- | --- |
| `libs/velista/feature-account` **(new)** | `AccountPage`, `RenameSheet`, `DeleteAccountSheet` |
| `libs/velista/ui` | `AccountRow` (a label, a value, and an optional chevron or action), `SectionHeading`, and a `destructive` variant on the existing row. `ConfirmSheet` gains nothing: its typed mode already exists (`0010`) |
| `libs/velista/data-access` | `AccountApi` / `AccountMemory` behind `ACCOUNT_SERVICE`, `ProfileStore` (section 5.2), `forgotPassword` on `AuthServiceI`, and `member.usernameChanged` in the realtime union (section 5.8) |
| `libs/velista/models` | `UserProfile`, and `UsernameScope`, this app's own two valued enum mapped from `UsernamePropagation` at the boundary (rule D4) |
| `libs/velista/feature-shell` | The three route entries |
| `libs/velista/feature-home` | `account()` becomes a navigation. `pendingRoutes` loses an entry |
| `libs/velista/feature-zones`, `feature-lists` | Section 4.4 |

Layering unchanged: `models -> platform -> {ui, data-access} -> feature-*`. No `ui`
component injects a store or a service token, per rule D1.

`ProfileStore` goes in `data-access` and not in `feature-account`, for the reason
`ZoneStore`'s own header gives and `0010` section 5.2 repeated: a store owned by a
feature library is destroyed on navigation, and the app bar on four other screens reads
the name it holds.

### 4.4 The account button is inert on three screens

Found while looking for where this route is entered from, and it is a defect rather than
a design: `lib-app-bar` is rendered with `[signedIn]="true"` by the group page, the
members page and the list page, and **none of them binds `(account)`**. Only
`home-page.html:7` does. The button is drawn, is focusable, has an accessible name, and
does nothing.

`(openSearch)` is unbound on the same three, and stays unbound: search is not built and
recording it in three more places is not progress. The account button is different
because after this plan its destination exists.

All four signed in pages bind `(account)` and navigate. The bar keeps emitting an output
rather than taking a `routerLink`, so rule D1 holds and the ui lib still knows nothing
about the route table.

While there: `AppBar.accountInitial`'s comment says "There is no display name to derive
one from: the API exposes no profile". That has been untrue since backend plan 0018 —
the name rides on the token pair and `GET /v1/account/me` exists — and `SessionStore`
already derives it. Correct the comment when the binding is added. `0010` rule G2 asked
for the same habit for the same reason: a stale comment is read as a constraint.

### 4.5 Why `settings` is not this plan, and the two preferences nobody can reach

`0001` section 6.2 lists `account` and `settings` as separate routes with different
access: `account` is **Authenticated**, `settings` is **Any**. That difference is the
whole argument and it survives every attempt to fold one into the other. Theme and
language belong to whoever is holding the phone, including somebody who has never
signed in and is reading the front door in the wrong language. Putting them on this
screen puts them behind `authenticatedGuard`.

So `settings` stays its own plan, and it should be the next one, because two things are
unreachable right now and both are one screen away from working:

1. **A signed in user cannot change language.** `app-bar.html` branches on `signedIn`:
   anonymous gets the locale menu, signed in gets search and account. The menu is not
   moved, it is dropped. Everything under it works — `APP_USABLE_LOCALES`, the locale
   guard, the rewrite — and there is no control.
2. **Nobody can change the theme.** `ThemeStore` exists in `platform`, `AppThemePreference`
   models `system`, `night` and `day` with `system` as the default, `appThemeClass`
   binds it to the stylesheet, and `StorageKeys` reserves a slot for it. Nothing in
   `libs/velista` calls `setPreference`. `0002` designed both themes as first class and
   the app ships one of them.

Neither is fixed here. A language row added to this screen would be moved when
`settings` lands, and it would be added to the one screen an anonymous visitor cannot
open.

## 5. Data

### 5.1 The endpoints

| Call | Auth | Body | Returns | Throttle |
| --- | --- | --- | --- | --- |
| `GET /v1/account/me` | bearer | — | `UserProfileView` | default |
| `PATCH /v1/account/me` | bearer | `{ username, propagation? }` | `UserProfileView` | `usernameChange`, **5 per hour** |
| `DELETE /v1/account` | bearer | — | `DeleteAccountResult` | default |
| `POST /v1/auth/forgot-password` | **none** | `{ email }` | `RetryAfterResult` | `passwordReset`, 1 per minute |
| `POST /v1/auth/resend-verification` | bearer | — | `RetryAfterResult` | `verifyResend`, 1 per minute |

`resendVerification` is already on `AuthServiceI` from `0009` and is reused unchanged.
`forgotPassword` is new to the frontend and is the only genuinely new transport in the
auth service; everything else in the table is `AccountApi`.

`UserProfileView` is `{ userId, kind, username, email, emailVerified, displayName }`.
`email` is nullable, which is exactly the guest, and `displayName` is nullable and
nothing anywhere renders it (`0009` section 5.1 explains why it is never asked for).

All three account routes take `userId` from the verified token and never from the body
or a path parameter, so there is no id for this app to send and no way to address
anybody else. Every write goes through `Mutations.run` per rule D2.

### 5.2 Rule A2: the profile owns the name, not the token

> **Rule A2.** Once `ProfileStore` has loaded, `SessionStore.username` reads from it and
> falls back to the token pair only until then. A rename never triggers a token refresh.

This is the one thing in the plan that will silently not work if it is skipped, so it is
a rule rather than a note.

`SessionStore.username` is computed from `TokenStore.tokens().username`. The name rides
in the **response body** of every issue and refresh, deliberately and not in the signed
claims, so that it cannot go stale for a token's whole lifetime (`token.service.ts`,
`issueTokens`). But `PATCH /v1/account/me` answers with a `UserProfileView` and **no new
pair**. `ACCESS_TOKEN_TTL` defaults to `15m`. So a person who renames themselves would
watch the sheet close, see the new name on this screen, go back to the dashboard, and
find the old initial still in the app bar for up to a quarter of an hour.

The tempting fix is to call `TokenStore.refresh()` after the rename, and it is the wrong
one. Refresh **rotates**: the presented refresh token is revoked and a new pair issued
(`token.service.ts`, `rotate`). That is why `TokenStore` refreshes single flight at all,
with its own comment about the second caller presenting a token the first just revoked.
Spending a rotation to update one letter puts a race into the cheapest possible action.

So `ProfileStore` holds the `UserProfileView`, `PATCH` writes its response straight into
it, and `SessionStore.username` prefers it. The app bar changes on the same tick, on
every screen, with no request. The token catches up on its own schedule and agrees when
it does.

### 5.3 Rule A3: propagation is a question about other people's screens

> **Rule A3.** The screen offers **two** choices and never the three enum names, and it
> always sends `propagation` explicitly.

`UsernamePropagation` has three values and the per zone names are copies rather than
derivations, which is why the enum exists at all:

| Value | What it does |
| --- | --- |
| `GLOBAL_ONLY` | The wire default. Only `users.username`. No membership is touched |
| `MATCHING_ZONES` | Also renames memberships whose username equals the **old** global name |
| `ALL_ZONES` | Renames every membership, whatever it was called |

Read as a question to a person, this is not "pick a propagation mode". It is: *the name
you picked in one group is not the name you use everywhere — should this change follow
it?* So the sheet offers:

- **Change it in my groups too**, which sends `MATCHING_ZONES`, and is the default the
  client picks.
- **Only here**, which sends `GLOBAL_ONLY`, and is what somebody who has deliberately
  renamed themselves in a group wants.

`ALL_ZONES` is **not offered**. It overwrites a name the person deliberately chose,
which is the exact case the enum's own comment says the default exists to protect:
somebody who became "Mamá" in the family group should not lose it by editing a profile.
Offering it honestly needs a screen listing the per zone names it would overwrite, and
that screen has no endpoint behind it (section 5.10).

The client default differs from the wire default, which is why sending it explicitly is
part of the rule: omitting the field means `GLOBAL_ONLY`, so the "do what I mean"
behaviour only happens if it is asked for. `MATCHING_ZONES` is the safer of the two
because it can only ever change a name that already equalled the old global one, so it
cannot clobber a deliberate choice; `GLOBAL_ONLY` leaves a person renamed in one place
and not in another, which reads as the rename half working.

The comparison it relies on is byte equality after normalization, and that is not a
coincidence: `normalizeUsername` collapses whitespace runs and normalizes to NFC
precisely so two visually identical names compare equal, with the comment saying
`MATCHING_ZONES` is what it is for. The client normalizes nothing and compares nothing;
it sends the raw string and lets the server be the only place those rules exist.

### 5.4 Rule A4: five per hour, and `0010`'s copy is wrong

> **Rule A4.** The rename countdown renders `retryAfterSeconds` from the problem body.
> Never sixty, and never a minute in the copy.

`THROTTLE_LIMITS.usernameChange` is **`{ ttl: hours(1), limit: 5 }`**. Not per minute.
Somebody who tries five names in a sitting waits up to an hour, and a countdown that
says "wait a minute" would run out, invite the tap, and fail again — the failure mode
rule C3 (`0009`) was written for, on a bucket an order of magnitude larger.

`ProblemDetails.retryAfterSeconds` is already modelled in
`libs/velista/models/src/lib/problem.ts`, and it rides in the body rather than in a
`Retry-After` header for the CORS reason `0004` recorded and `0009` section 5.7 restated.
So the number is available and the only work is rendering it.

**This catches an existing defect.** `0010` gave the per zone rename the copy "Too many
changes. Wait a minute and try again" (`zone.error.tooManyRenames`), and
`PATCH /v1/zones/:id/members/:mid/username` carries the **same** `usernameChange` limit.
That string is wrong on the screen it already ships on. This plan rewrites it to take
`{{wait}}` and renders the server's number in both places, which is one key and two call
sites.

The validation rules the field states up front, all from `validateUsername`, which is in
the platform library precisely so auth and core cannot disagree about them:

- Two to forty characters, counted in **code points**, so an emoji counts once.
- Letters, marks, digits, spaces, and `. _ ' -`. Unicode aware, so a Cyrillic or Greek
  name passes unharmed.
- At least one letter or mark, so a name of pure punctuation is refused.
- No control, zero width or bidirectional formatting characters, because a name is
  rendered next to other names and a character that can reorder the text around it is an
  impersonation tool rather than a spelling.
- It may not begin with `former member`, which is the marker the system writes over a
  deleted user's membership (section 5.7) and therefore must not be forgeable.

The client states the length rule and lets the server enforce every one of them. A
second copy of that regular expression in the browser is a second place for it to drift.

### 5.5 Sign out is client only, and what it does not do

**There is no logout endpoint.** The gateway's auth controller has `register`, `login`,
`verify-email`, `resend-verification`, `forgot-password`, `reset-password`, `refresh`
and `upgrade`, and nothing else.

So sign out is `TokenStore.clear()` plus a navigation to the front door. The refresh
token stays live on the server until it expires. Nothing about that is dangerous on the
device doing it — the pair is gone from `localStorage` — but it means **sign out does
not end the session anywhere else**, and the copy must not imply that it does. One
sentence, about this phone, and no claim about other devices.

The only thing in the product that actually revokes every live session is a **password
reset**: `resetPassword` calls `revokeAllForUser` and then issues a fresh pair to the
person resetting, in that order and with a comment explaining the ordering. So "sign out
everywhere" exists, reachable only by asking for a password reset link, which is a
strange shape for a security control and is recorded in section 5.10 as the gap it is.

### 5.6 Changing a password means asking for a link

There is no authenticated change password route: no current password field anywhere,
because nothing consumes one. What exists is the pair from backend plan 0022,
`forgot-password` and `reset-password`, and the account screen's password row drives the
first of them with the profile's own email.

Three consequences the row has to respect:

1. **It is deliberately incurious.** The same answer for an address with an account, one
   with none, and one that signs in with Google. So the copy is "if that address has a
   password, a link is on its way" and **never** claims delivery. `RetryAfterResult`
   comes back either way.
2. **One per minute** (`passwordReset`), rendered as the server's wait under rule A4.
3. **It signs the other devices out.** Spending the link revokes every live refresh
   token and issues a new pair to whoever spent it, so the person changing their password
   stays signed in here and is signed out everywhere else. The row says so before it is
   pressed, because that is a useful thing to know and a surprising thing to discover.

The row is rendered whenever `email` is non-null. **The profile cannot say how somebody
signs in** — `UserProfileView` has no provider list — so the screen cannot draw "You sign
in with Google" and cannot hide the row from a Google only account. Offering it is the
safe side of that: an account with no password gets the same incurious answer as any
other address, which is exactly what the endpoint was designed to give.

### 5.7 What deleting an account actually does

Taken from `identity.service.ts` and `account-deletion.service.ts`, not inferred,
because every line of the confirmation copy is a claim about somebody else's data:

- **In auth**, deleting the `users` row cascades its credentials, OAuth identities,
  email verifications and refresh tokens. Every child FK is `ON DELETE CASCADE`, so one
  delete satisfies the right to be forgotten for the identity data, which lives only
  there.
- **In core**, `user.deleted` is consumed once per user and, for every zone the user
  touched:
  - A zone they **owned** has `ownerUserId` set to null, its status set to
    `MARKED_FOR_DELETION` and `markedForDeletionAt` stamped. `zone.markedForDeletion`
    goes out on the room. **An admin can still rescue it** by claiming it, which `0010`
    built, and core's reaper deletes it for good if the grace period passes with nobody
    doing so.
  - Their membership is retired: the per zone username is overwritten with the
    anonymized placeholder and the status set to `KICKED`, with `member.kicked` and
    fresh counts emitted.
- **What they wrote stays.** Lists, lines and comments reference an opaque `userId` and
  are retained; the KICKED tombstone is what keeps them resolving to the neutral former
  member label rather than to nothing.
- It is **idempotent**. A repeat answers `{ deleted: false }` and emits no event.

So the confirmation says three specific things, and the first is countable from the
cache. `ZoneStore` holds `myRole` per zone, which is what `0010` rule G2 already gates
governance controls on, so the sheet can say *"You own 2 groups. They will be deleted
unless an admin in them takes them on"* without a request. A person with no owned groups
is not shown that sentence at all, because for them it is not true.

**This is the second and last use of the typed confirmation**, and `0010` section 5.7
asked for exactly that justification before anything else grew one by imitation. The
argument is the same argument, one level up: deleting a group destroys every list in it
for everyone in it, and deleting an account does that to **every group the person owns
at once**, plus their own access to every group they do not. If typing was worth its
friction there, it cannot be optional here.

What is typed is the person's **own username**, not a fixed word. It is on the screen, it
is personal, and it is the same gesture in both languages, which a typed `DELETE` is not.
Compared trimmed and case folded, matching `0010`.

Afterwards: clear the session, navigate to the front door, and say once that the account
is gone. Not a redirect to sign in, which is the screen for somebody who has an account.

### 5.8 The rename nobody currently sees

`member.usernameChanged` is a real event. Core emits it from
`username-propagation.service.ts` when a global rename propagates, and from
`membership.service.ts` when `0010`'s per zone rename runs.

**The frontend does not know it exists.** It is absent from the union in
`realtime-events.ts`, absent from the accepted event list beside it, and `ZoneStore._apply`
has no case for it — not even the deliberate ignore that eight list and line events get.

That is in scope here rather than deferred, because propagation is this plan's feature
and shipping a propagation nothing renders is shipping half of it. Without the event,
a rename with `MATCHING_ZONES` changes the member lists on the server and every open
members screen keeps showing the old name until it is reloaded — including the renamer's
own, on a second device.

So: add the event to the union and the accepted list, map it, and have `ZoneStore` update
that member's username in place. It is the smallest possible case in `_apply` and it is
the one that makes section 5.3's choice observable.

### 5.9 What a failure means, per operation

Seven codes, one message each from the gateway's catalog, so the client keys its own copy
on **code plus operation**, which `0004` settled and every page plan since has applied.

| Code | Operation | Means | Copy |
| --- | --- | --- | --- |
| `validation_failed` | `account.rename` | Length, characters, or the reserved prefix | Against the field, and it states the rule rather than echoing the server |
| `rate_limited` | `account.rename` | The hourly bucket | Section 5.4, counting the server's number |
| `rate_limited` | `auth.forgotPassword` | One per minute | The same treatment, its own wait |
| `not_found` | `account.rename`, `account.me` | The user row is gone: deleted in another tab, or reaped | Not an error panel. Clear the session and go to the front door, which is the only true thing left to do |
| `unauthorized` | Any | The access token is spent and the refresh failed | `TokenStore` already clears and signs out. This screen adds nothing |
| `internal` | Any | The generic panel with the correlation id, as `0003` renders it | |

The `not_found` row is the one worth arguing for. Every route here resolves the caller
from their own token, so not found cannot mean "you asked for somebody who does not
exist". It can only mean the caller themselves is gone, and an error panel offering a
retry would retry forever. The session is over; saying so is the honest handling.

`DELETE /v1/account` has no failure row of its own by design: it is idempotent, so the
only thing left is transport, which is `internal`.

### 5.10 What this plan needs from the backend, and what it does without

Recorded, not assumed. Nothing here blocks the plan.

1. **No logout.** `POST /v1/auth/logout`, revoking the presented refresh token, and a
   `logout-all` calling the `revokeAllForUser` that already exists. Today sign out is
   local only (section 5.5) and revoking everything is reachable only through a password
   reset, which is the wrong door for it.
2. **No authenticated change password.** Somebody who knows their password and wants a
   different one has to go through an email link. The endpoint would take the current
   password and skip the round trip.
3. **The profile does not say how you sign in.** A `providers` array on
   `UserProfileView` would let the screen say "You sign in with Google" and stop offering
   a password row that means nothing to that account (section 5.6).
4. **Nothing lists your per zone names.** `ALL_ZONES` cannot be offered honestly without
   a screen showing what it would overwrite, and there is no endpoint that returns the
   caller's memberships with their usernames across zones (section 5.3).
5. **The grace period on a marked zone is still not reported**, unchanged from `0010`
   section 5.8 item 3. So the delete sheet says an owned group will be deleted and does
   not say when.

## 6. Localization

New keys nested under `account` in `libs/velista/ui/assets/i18n/{en,es}.json`. Rule N1
holds: no key names the product. Rule N2 holds: the keys say zone, the values say group.

`home.action.account` ("Your account" / "Tu cuenta") already exists and is reused as the
app bar's label. `auth.nudge.*` and the whole of `auth.resend.*` are reused unchanged
from `0009`; they were written as facts about an unconfirmed address rather than as
sentences about the dashboard, which is what makes them portable here.

| Key | English | Spanish |
| --- | --- | --- |
| `account.title` | Your account | Tu cuenta |
| `account.section.you` | You | Tú |
| `account.section.access` | Getting in | Cómo entras |
| `account.name.label` | Name | Nombre |
| `account.name.hint` | This is the name other people in your groups see | Es el nombre que ven los demás en tus grupos |
| `account.name.change` | Change name | Cambiar nombre |
| `account.name.rule` | Between 2 and 40 characters | Entre 2 y 40 caracteres |
| `account.name.scope.matching` | Change it in my groups too | Cambiarlo también en mis grupos |
| `account.name.scope.matchingHint` | Groups where you chose a different name keep it | Los grupos donde elegiste otro nombre lo conservan |
| `account.name.scope.globalOnly` | Only here | Solo aquí |
| `account.name.save` | Save name | Guardar nombre |
| `account.email.label` | Email | Correo |
| `account.email.confirmed` | Confirmed | Confirmado |
| `account.email.unconfirmed` | Not confirmed | Sin confirmar |
| `account.password.label` | Password | Contraseña |
| `account.password.action` | Change your password | Cambiar la contraseña |
| `account.password.body` | We send a link to {{email}}. Using it signs you out on your other phones, and keeps you signed in here | Te enviamos un enlace a {{email}}. Al usarlo se cerrará la sesión en tus otros teléfonos y seguirás dentro en este |
| `account.password.sent` | If that address has a password, a link is on its way | Si esa dirección tiene contraseña, el enlace va de camino |
| `account.signOut.action` | Sign out | Cerrar sesión |
| `account.signOut.body` | Signs you out on this phone. Your other phones stay signed in | Cierra la sesión en este teléfono. En los otros seguirás dentro |
| `account.guest.title` | This account lives on this phone | Esta cuenta vive en este teléfono |
| `account.guest.body` | There is no email and no password on it yet, so it cannot be opened anywhere else, and clearing this browser's data would end it | Todavía no tiene correo ni contraseña, así que no se puede abrir en ningún otro sitio, y borrar los datos del navegador acabaría con ella |
| `account.guest.secure` | Secure this account | Proteger esta cuenta |
| `account.delete.action` | Delete your account | Eliminar tu cuenta |
| `account.delete.title` | Delete your account? | ¿Eliminar tu cuenta? |
| `account.delete.body` | Your email, your password and your name go for good. This cannot be undone | Tu correo, tu contraseña y tu nombre se van para siempre. Esto no se puede deshacer |
| `account.delete.ownedZones_one` | You own 1 group. It will be deleted unless an admin in it takes it on | Eres dueño de 1 grupo. Se eliminará a menos que un administrador se haga cargo |
| `account.delete.ownedZones_other` | You own {{count}} groups. They will be deleted unless an admin in each takes them on | Eres dueño de {{count}} grupos. Se eliminarán a menos que un administrador se haga cargo de cada uno |
| `account.delete.authored` | What you added to other people's lists stays, with your name taken off it | Lo que añadiste a las listas de otros se queda, sin tu nombre |
| `account.delete.typeName` | Type your name to confirm | Escribe tu nombre para confirmar |
| `account.delete.confirm` | Delete my account | Eliminar mi cuenta |
| `account.delete.done` | Your account is gone | Tu cuenta ya no existe |
| `account.error.tooManyRenames` | Too many name changes. You can change it again in {{wait}} | Demasiados cambios de nombre. Podrás cambiarlo otra vez en {{wait}} |
| `account.error.tooManyResets` | Too many requests. You can ask for another in {{wait}} | Demasiadas peticiones. Puedes pedir otro en {{wait}} |
| `account.error.badName` | Names are 2 to 40 characters, and can use letters, numbers, spaces and . _ ' - | Los nombres tienen de 2 a 40 caracteres y admiten letras, números, espacios y . _ ' - |
| `account.error.gone` | That account no longer exists | Esa cuenta ya no existe |

**One existing key changes.** `zone.error.tooManyRenames` currently reads "Too many
changes. Wait a minute and try again" and its bucket is hourly (section 5.4). It becomes
"Too many name changes. You can change it again in {{wait}}" / "Demasiados cambios de
nombre. Podrás cambiarlo otra vez en {{wait}}", and `0010`'s member rename sheet renders
the server's number. The value changes; the key does not, so nothing else moves.

`{{wait}}` is an already formatted `m:ss` string, the convention `0009` set so that
neither language owns a clock format inside a translation and neither needs a plural.
`account.delete.ownedZones` is a plural pair, with the whole phrase written per form for
the Spanish agreement reason in `0001`.

## 7. Accessibility and input

- **The name field is a real field**, `autocomplete="nickname"`, `enterkeyhint="done"`,
  inside a `<form>` with a submit button, so the phone keyboard's Go key works with no
  separate handler.
- **The propagation choice is a radio group**, labelled by the sheet's heading, not two
  buttons that look chosen. Both options are always visible: a disclosure that hides the
  non default one hides the consequence.
- **The confirmation state is text, not a colour.** "Confirmed" and "Not confirmed" are
  words, so the row survives a colourblind reader and a screen reader alike.
- **Destructive rows say what they do in their text.** "Delete your account" reads as
  destructive with the styling removed, matching `0010`.
- **44 by 44 minimum** on every row, the back button, and the radio targets.
- **The typed confirmation is not a spelling test**: trimmed and case folded, and the
  name being typed is on screen the whole time.
- **A busy primary keeps its accessible name** and gains `aria-busy="true"`.
- **The rename result is announced** through one `aria-live="polite"` region on the
  screen, because the sheet closes and the change it made is behind it.
- **Focus after the sheets** returns to the row that opened each, and Escape dismisses
  both.
- **Reduced motion**: the sheets keep `0008`'s treatment.

## 8. Acceptance criteria

- [ ] `/en/velista/account` renders for a signed in user, redirects an anonymous one, and
      is declared before the `''` front door, with `0008`'s ordering spec still passing.
- [ ] The name and initial render with **no request** and no loading state, from
      `SessionStore`. Only the email row skeletons.
- [ ] Renaming updates the app bar's initial on the dashboard **immediately**, and a spec
      proves `TokenStore.refresh` was **not** called (rule A2).
- [ ] The rename sends `propagation` explicitly, defaulting to `MATCHING_ZONES`, and
      `ALL_ZONES` is not reachable from any control (rule A3).
- [ ] A rename refused by the hourly bucket counts down from `retryAfterSeconds`, and a
      spec proves a wait longer than a minute is rendered as that number rather than 60
      (rule A4).
- [ ] `zone.error.tooManyRenames` renders the server's wait on `0010`'s member rename
      sheet too, verified against the in-memory service.
- [ ] A guest sees the guest screen, and **no sign out control exists in the DOM** for
      them — asserted by query, not by inspection (rule A1).
- [ ] A guest's primary goes to `auth/upgrade` and never to `auth/register`, which is
      rule C2 (`0009`) holding on a second screen.
- [ ] Sign out clears the session, lands on the front door, and its copy claims nothing
      about other devices.
- [ ] The delete sheet counts owned groups from `ZoneStore` with no request, and omits
      the sentence entirely for somebody who owns none.
- [ ] Delete stays disabled until the typed username matches, trimmed and case folded.
- [ ] A successful delete clears the session and navigates; a failed one leaves the sheet
      open with the correlation id and does **not** clear it.
- [ ] `not_found` on the profile or the rename clears the session rather than rendering a
      retry (section 5.9).
- [ ] `member.usernameChanged` is in the realtime union and `ZoneStore` updates that
      member in place, proven by a spec that renames a member and asserts an open members
      screen changes without a refetch (section 5.8).
- [ ] The app bar's account button navigates from the group, members and list pages as
      well as the dashboard, and `AppBar.accountInitial`'s stale comment is corrected
      (section 4.4).
- [ ] `home-page.ts`'s `pendingRoutes` no longer records `account`.
- [ ] No component in `libs/velista/ui` injects a store or a service token (rule D1).
- [ ] Every state in section 3 is reachable against `AccountMemory` with no gateway
      running.
- [ ] `npx nx lint` and `npx nx test` pass for every touched project, and
      `npx nx build velista` succeeds, which is the only real type gate in this workspace.

## 9. Out of scope

- **`settings`: theme, language and density.** Section 4.5 gives the access argument for
  keeping it a separate route and records the two preferences that are unreachable until
  it lands. It should be the next plan.
- **Search.** The app bar's other button stays unbound on every screen. It is a page of
  its own and nothing about it belongs here.
- **Sign out everywhere**, which needs section 5.10 item 1. Today it is reachable only as
  a side effect of a password reset, and this screen does not dress that up as a feature.
- **Changing an email address.** There is no endpoint: `upgrade` sets one on a guest and
  nothing changes one afterwards.
- **A display name.** `UserProfileView` carries one, nothing sets it, nothing renders it,
  and `0009` section 5.1 explains why no form asks for one.
- **Merges.** `merge.requested` and its siblings still reach `ZoneStore` and are still
  ignored, unchanged from `0010`.
- **Anything origin scoped**: biometric unlock, an install prompt, offline. All of it
  belongs to the standalone phase (`0001` D3, and plan `0011`).
