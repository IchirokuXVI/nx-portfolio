# 0130: what an account has been shown

> Frontend halves: velista `0091` (the setup) and velista `0092` (the tour), both of
> which are blocked on this one.
> Mocks: `apps/velista/plans/mocks/onboarding/` and `.../tour/`.
>
> velista is about to ask a new account three questions and then offer a walk through
> the app. Both need one fact that nothing in this system records: whether this person
> has already been through it. Browser storage cannot hold it, because the answer has
> to be the same on a second device, and it has to arrive on a read the app already
> makes at startup or every cold start pays for a request before it can draw. This plan
> adds that state to **core**, composes it into `GET /v1/account/me`, and adds the one
> extra route the setup's name step needs.
>
> Prerequisite reading: `0018` (the generated username and its pool), `0049` (shopping
> profiles, and why core owns what auth does not), the account controller's class
> comment in `apps/luna-shopper-backend/gateway/src/app/account/account.controller.ts`,
> and CLAUDE.md on regenerating the OpenAPI document.

## Brief for the agent

### Objective

Add per user application state to core, serve it on `GET /v1/account/me` without a
second request, let the client set it, and expose a fresh generated username that
writes nothing.

### Context

- **auth is identity only, by rule.** The account controller says so in prose: core
  owns the profile, auth owns the credential. `UserProfileView` (`userId`, `kind`,
  `username`, `email`, `emailVerified`, `displayName`) is auth's, and
  `GET /v1/account/me` passes it straight through.
- core already keys per user rows off `userId` without holding a user table:
  `shopping_profile` does exactly that, and `GET /v1/account/shopping-profiles` creates
  the default row lazily on first read (`0049`, section 1.3).
- `UsernameGeneratorService`
  (`apps/luna-shopper-backend/auth/src/app/username/username-generator.service.ts`)
  draws a name from one locale's pool. Registration calls it, so every account already
  has one before it ever opens the app.
- `PATCH /v1/account/me` is throttled with `THROTTLE_LIMITS.usernameChange`, because a
  public, non unique, freely changeable name makes rapid renaming a harassment pattern
  (`0018`, section 6).
- Every POST in this gateway answers 201, including the ones that create nothing, and
  `openapi-document.spec.ts` enforces that as a house rule.

### Target state

velista reads, in the one call it already makes on startup, whether this account has
finished the setup and whether it has seen the tour. It can mark either as done, and it
can ask for another generated name for the setup's first step.

### Scope

Work only in:

- `libs/luna-shopper/contracts/src/lib/` (messages, schemas, patterns)
- `apps/luna-shopper-backend/core/src/app/` (the entity, the migration, the service)
- `apps/luna-shopper-backend/auth/src/app/username/` (the suggestion handler)
- `apps/luna-shopper-backend/gateway/src/app/account/` (the routes and the DTOs)
- `apps/luna-shopper-backend/gateway/docs/openapi.json` (regenerated, never edited)
- `libs/luna-shopper-admin/models/src/lib/wire/` (regenerated, never edited)

Do not touch: velista, the admin screens, any other service.

### Constraints

- A new table needs a migration. Follow the ones in `core/src/app/db/migrations`, and
  read CLAUDE.md's note about the `migrate.ts` enum trap before writing it.
- Integration specs that need a database go in their own target, never beside the unit
  specs (see the repo's existing `*.integration.spec.ts` pairs).
- Regenerate the OpenAPI document and the admin wire types in the same commit.

### Action boundaries

Stop and ask before: adding a column to any auth table, changing `UserProfileView`,
changing the throttle on an existing route, or adding a dependency.

### Progress evidence

After each section output: the files changed and the test command you ran.

## 1. Where the state lives, and why it is not in auth

A new core table, `user_app_state`:

| Column | Type | Meaning |
| --- | --- | --- |
| `userId` | uuid, primary key | The account. No foreign key: core holds no user table, exactly as `shopping_profile` does not. |
| `setupCompletedAt` | timestamptz, null | When the setup was finished **or dismissed**. Null means it has never been. |
| `tourSeenAt` | timestamptz, null | When the tour was finished or skipped. |
| `createdAt`, `updatedAt` | from `BaseEntity` | |

**Not a column on auth's user.** Whether somebody has seen a walk through of velista is
not identity, and the moment it goes in auth the next three product flags follow it
there. Core already owns everything about how this person shops.

**A timestamp and not a boolean**, for both. The answer to "have they seen it" is yes
or no, but the answer to "when" is what makes a later question answerable: whether to
offer the tour again after a release that adds a screen is a decision nobody can take
without knowing how old the last one is. It costs nothing now to store the fact rather
than the conclusion.

**The row is created on demand**, by the write, and a missing row reads as two nulls.
A read never writes, which is what keeps `GET /v1/account/me` a read.

## 2. The read rides on `GET /v1/account/me`

That route is the one velista already calls on startup, for the name in the app bar. It
must carry this state, because the alternative is a second request on every cold start
before the app can decide whether to draw the setup.

So the route composes: auth answers the profile, core answers the state, and the
gateway returns both. Two `nats.send` calls, and the core one is **not** wrapped in
`aboutTheCaller`, for the reason that helper's comment already gives: it turns a
downstream "not found" into a 401, and a missing state row is an ordinary answer.

A new view in `contracts`, beside `UserProfileView` rather than replacing it:

```ts
export interface AccountMeView extends UserProfileView {
  appState: UserAppStateView;
}

export interface UserAppStateView {
  setupCompletedAt: string | null;
  tourSeenAt: string | null;
}
```

`UserProfileView` does not change. Auth keeps answering exactly what it answers today,
and every other caller of `AUTH_PATTERNS.getProfile` is untouched.

**If core cannot be reached, the route still answers.** The state falls back to two
nulls and the profile is returned, because the app bar's name must not depend on a
service that owns nothing on that screen. A null reads as "not set up", and the worst
case is a setup offered twice, which is a screen somebody presses through. Log it.

## 3. The write

`PATCH /v1/account/app-state`, body:

```ts
{ setupCompleted?: true; tourSeen?: true }
```

- Each flag stamps `now()` when it is absent, and is **idempotent**: a second call with
  the same flag does not move the timestamp. The client presses Done once, retries, and
  gets the same answer.
- `false` is not accepted. Unsetting is not a thing the app needs, and a route that can
  unset is a route that can unset by accident. Replaying the tour does not clear
  `tourSeenAt`: it is a fact about the past, not a switch.
- An empty body is a 400, not a no-op. Nothing asked for is a client mistake.
- Answers the whole `UserAppStateView`, as every profile write answers the profile.
- Throttled, modestly. This is two writes in an account's life.

## 4. The fresh name

`GET /v1/account/username-suggestions`, answering `{ username: string }`.

- auth's own generator, in the caller's locale, exactly as registration draws one. The
  locale comes from the request the same way every other localized read takes it.
- **It writes nothing.** The name is a suggestion on a screen, and it becomes this
  account's name only when the client sends it to `PATCH /v1/account/me`, which is the
  route that already owns that write and already carries the rename throttle.
- Throttled tightly. It costs a round trip and a bored thumb can hold the button down.
- A `GET` rather than a `POST`, because nothing is created and nothing about the caller
  reaches the log: there is no body and no parameter.

Plural in the path and singular in the answer is deliberate: a later screen that offers
three names at once must not need a second route.

## 5. Not in this plan

- Any decision about when velista shows the setup or the tour. Both are the frontend's,
  and both plans read this state.
- A per device flag. If the same account on a second phone must see the tour again,
  that is a new field, and it is not this one.
- Anything admin facing. No screen in the back office reads this.

## 6. Tests

- `user-app-state.service.spec.ts`: absent row reads as two nulls; the first write
  creates the row; the second write with the same flag leaves the timestamp alone; two
  flags in one call stamp both.
- `user-app-state.integration.spec.ts` (its own target): the migration applies, the
  primary key refuses a second row for one user, and a concurrent double write leaves
  one row.
- `account.controller.spec.ts` in the gateway: `me` composes both answers; a core
  failure still answers the profile with two nulls; an empty patch body is a 400.
- `username-suggestions.spec.ts`: answers a name from the caller's locale pool, and
  the database holds no write afterwards.
- `openapi-document.spec.ts` passes, which is what proves the document was regenerated.

## 7. Acceptance criteria

- [ ] `GET /v1/account/me` answers `appState` with both fields, in one round trip.
- [ ] `PATCH /v1/account/app-state` stamps, is idempotent, refuses `false` and refuses
      an empty body.
- [ ] `GET /v1/account/username-suggestions` answers a name and writes nothing.
- [ ] The migration runs forwards on an existing database with accounts in it.
- [ ] `apps/luna-shopper-backend/gateway/docs/openapi.json` and
      `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` are regenerated and
      committed.

## 8. Verification

```sh
npx nx test luna-shopper-backend-core
npx nx test luna-shopper-backend-core-integration
npx nx test luna-shopper-backend-auth
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx run-many --target=lint --projects=luna-shopper-backend-*
```

Then, against a luna slot: register an account, read `me`, patch both flags, read `me`
again, and ask for two names in a row.
