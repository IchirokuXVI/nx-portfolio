# 0018 Global username

Today the only human readable name a user has is `ZoneMembership.username`, chosen per zone at
join time and required by the request. A user with no zone has no name at all, a user in three
zones has three unrelated names, and `users.displayName` is a nullable field that only gets set
when someone registers with a name or signs in with Google.

This plan gives every user one global username from the moment their identity exists, generated
from a nautical word pool in the language they are using, changeable by the user with an
explicit choice about how far the change travels, and overridable per zone by that zone's
owners and admins. Neither the global name nor the per zone name is unique.

Depends on 0005 (identity), 0006 (zones and memberships), 0009 (realtime), 0011 (the
`processed_events` inbox and the `user.deleted` saga, whose shape this plan copies).

## 1. Two names, and why they stay two

| | `users.username` (new) | `ZoneMembership.username` (exists) |
| --- | --- | --- |
| Owner | auth | core |
| Nullable | never | never |
| Unique | no | **no, after this plan** |
| Set at | identity creation, generated | zone create or join, defaulted from the global one |
| Changed by | the user | the user, or the zone's owner and admins |

The per zone name is not derived from the global one at read time. It is **copied** at join
time and then lives its own life, which is the entire point: a person can be "Vela" everywhere
and "Mamá" in the family zone. A derived name would make section 4's propagation modes
meaningless.

`users.displayName` stays exactly as it is and is **not** reused as the username. It holds
whatever the identity provider supplied, which for a Google sign in is the person's real full
name. Seeding a public, cross zone handle from it would publish a real name that the user never
chose to publish. The generated nautical name is used in every case, including Google sign in.

## 2. Dropping per zone username uniqueness

`ZoneMembership` currently carries `@Index('uq_membership_zone_username', ['zoneId',
'username'], { unique: true })`, and `ZoneService.saveHandlingUsername` turns the resulting
Postgres unique violation into `That username is taken in this zone`.

Read the entity decorator carefully before writing the migration: in
`1756000100000-InitialCoreSchema` this is declared as a table level `CONSTRAINT
"uq_membership_zone_username" UNIQUE ("zoneId", "username")`, not as a standalone index. It is
removed with `ALTER TABLE ... DROP CONSTRAINT`; a `DROP INDEX` on that name fails.

The requirement is that per zone usernames are not unique, so:

- The unique constraint is dropped and replaced by a plain non unique index on the same columns
  (`ix_membership_zone_username`), which still serves any lookup by name.
- `saveHandlingUsername` loses its username branch. The join code collision branch on `Zone`
  stays, because join codes are still unique.
- `anonymizedUsername(membershipId)` from 0011 keeps its id suffix. It no longer needs it for
  uniqueness, but it still needs it to distinguish two departed members in the same zone in the
  UI, which was always the more useful half of the reason.

**Consequence, stated plainly because the UI has to answer it:** two members of one zone can now
be called the same thing, and any user can rename themselves to match anyone. Impersonation
inside a zone is now possible by construction. Wherever identity carries weight (approving a
join request, an admin action log, a line's author when it matters who added it), the interface
must show a stable discriminator next to the name: the role badge, the join date, or a short
prefix of the membership id. That is a frontend obligation this plan creates and cannot solve
on the backend.

## 3. Generating a localized name

### 3.1 The invariant

A generated name is produced from **one locale's pool only**, and the pools share no words. An
English speaker cannot draw `Vela` because `Vela` exists only in the Spanish pool. There is no
translation step anywhere: a name is a plain string, stored verbatim, shown verbatim to every
viewer whatever their locale. A Spanish user who draws `Vela` is `Vela` to an English viewer.

The stored value carries **no locale tag**. Recording which pool a name came from would invite
a future translation of it, which is exactly the behaviour the requirement forbids.

### 3.2 Composition is per locale, never a shared template

The pool is adjective plus noun, which gives roughly a thousand names per locale instead of the
few dozen a flat noun list would give. That is a UX matter, not a uniqueness matter: names are
not unique, so a collision is legal, but a product where a quarter of the guests are called
`Vela` reads as broken.

Spanish makes this a localization trap, so the shape of the data is dictated by it:

- Spanish nouns carry grammatical gender, and the adjective must agree. `Vela` is feminine
  (`Vela Rápida`), `Timón` is masculine (`Timón Rápido`).
- Word order differs. English puts the adjective first (`Swift Sail`), Spanish puts it after the
  noun (`Vela Rápida`).

So each locale owns both its words **and** its composition function. There is no shared
`"{adjective} {noun}"` template with a slot per language; that is precisely the construction
that produces `Rápida Timón`.

```ts
interface NounEntry {
  word: string;
  /** Required for locales whose adjectives inflect; ignored where they do not. */
  gender?: 'm' | 'f';
}

interface AdjectiveEntry {
  /** A locale with no inflection supplies one form under `m` and omits `f`. */
  m: string;
  f?: string;
}

interface UsernamePool {
  nouns: NounEntry[];
  adjectives: AdjectiveEntry[];
  compose(noun: NounEntry, adjective: AdjectiveEntry): string;
}
```

- `en.compose` returns `` `${adjective.m} ${noun.word}` ``.
- `es.compose` returns `` `${noun.word} ${noun.gender === 'f' ? adjective.f : adjective.m}` ``.

Word material is nautical: parts of a boat, sailing actions, sea and weather, navigation,
knots, and sea creatures. Both pools are written independently by meaning, not translated from
each other, which is what keeps them disjoint without needing a check. A spec asserts the
disjointness anyway (section 9), because a translated word slipping in is the one mistake that
breaks the invariant silently.

Roughly forty nouns and twenty five adjectives per locale is the target. Fewer reads as
repetitive; more is unpaid work for no gain.

### 3.3 Where the generator lives

`apps/luna-shopper-backend/auth/src/app/username/`: the pools, the composer, a
`UsernameGenerator` service, and the validator from section 6. Auth is the only service that
mints identities, so it is the only service that generates names. If a second service ever
needs one, promote the directory to `libs/luna-shopper/platform`; do not pre emptively put it
there for a single consumer.

### 3.4 Which locale, and when

The locale is the **request locale at the moment the identity is created**, resolved by the
platform's existing `resolveLocale`. It already reaches auth: `RpcCorrelationInterceptor` seeds
the request context from the NATS headers, and the gateway already forwards the locale on every
call. An unsupported or missing locale falls through to `DEFAULT_LOCALE` (`en`), as everywhere
else.

Generation happens once, at each of the three points where a user row is first written:

- `auth.createTemporaryUser`: the guest gets a name immediately, so a guest is never nameless.
- `auth.register`: the registered user gets one too, regardless of any `displayName` supplied.
- `auth.googleLogin` when it creates a new user: same, and specifically **not** the Google
  profile name (section 1).

`auth.upgrade` changes nothing. The upgrade is in place, `userId` is stable, and so is the
username; a guest who registers keeps the name their zones already know them by, which is the
whole reason the upgrade is in place to begin with.

The locale is not persisted on the user. It is used once and discarded; a user who later
switches the app to English does not get a new name, because the name is theirs now.

## 4. Changing the global username

### 4.1 The three modes

```ts
/** How far a global username change travels (plan 0018, section 4). */
export enum UsernamePropagation {
  /** Default. Only `users.username` changes; no membership is touched. */
  GLOBAL_ONLY = 'GLOBAL_ONLY',
  /** Also rename memberships whose username equals the OLD global username. */
  MATCHING_ZONES = 'MATCHING_ZONES',
  /** Also rename every membership, whatever it was called. */
  ALL_ZONES = 'ALL_ZONES',
}
```

`GLOBAL_ONLY` is the default and is what an omitted field means. A user who has taken the
trouble to be called something specific in a zone should not lose that by editing their profile.

`MATCHING_ZONES` compares the membership's current username to the user's **previous** global
username, byte for byte. Case sensitive: a member who typed `vela` where their global name was
`Vela` chose a different string, and this mode is defined as "the zones that had the old name".
The alternative (case insensitive, or Unicode normalized) is a legitimate product choice but it
must be a decision, not an accident of the SQL, so it is written down here as rejected.

`ALL_ZONES` renames unconditionally.

### 4.2 Which memberships are eligible

For both propagating modes, only memberships with status `APPROVED` or `PENDING` are updated.
`KICKED` and `BANNED` memberships are historical records that the zone's admins recognise by
name; letting a banned user rewrite the name on that row is a way to re enter unrecognised.
Anonymized rows from 0011 (`former member 1a2b3c4d`) belong to deleted users and are never
reachable by a live user's change.

### 4.3 The message and the event

```ts
export const AUTH_PATTERNS = {
  // ...existing
  setUsername: 'auth.setUsername',
  getProfile: 'auth.getProfile',
} as const;

export interface SetUsernameRequest {
  /** Set by the gateway from the verified token, never from the body. */
  userId: string;
  username: string;
  /** Defaults to GLOBAL_ONLY when omitted. */
  propagation?: UsernamePropagation;
}

export interface UserProfileView {
  userId: string;
  kind: UserKind;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}
```

```ts
export const IDENTITY_EVENTS = {
  // ...existing
  userUsernameChanged: 'user.usernameChanged',
} as const;

export interface UserUsernameChangedEvent {
  userId: string;
  /** Needed by MATCHING_ZONES; always sent so the consumer needs no lookup. */
  oldUsername: string;
  newUsername: string;
  propagation: UsernamePropagation;
}
```

Auth commits the column change and emits the event. The event always fires, including for
`GLOBAL_ONLY`, so that a future consumer sees every rename; core simply does nothing with a
`GLOBAL_ONLY` event beyond recording it as processed.

### 4.4 Core applies it as a saga

The consumer mirrors `AccountDeletionService`'s handling of `user.deleted` exactly: an
`@EventPattern` handler, idempotent through the `processed_events` inbox keyed on the event id,
so an at least once redelivery is a no op.

The update is one statement per user, not a row at a time:

```sql
UPDATE zone_memberships
   SET username = $newUsername
 WHERE "userId" = $userId
   AND status IN ('APPROVED', 'PENDING')
   AND ($allZones OR username = $oldUsername)
RETURNING id, "zoneId", "userId", username, role, status;
```

The `RETURNING` clause supplies exactly the rows that changed, which is what the realtime
emission in section 7 needs. Without it, `ALL_ZONES` for a user in twenty zones would mean
twenty selects.

**Consistency:** the global name changes synchronously and the zone names change when the event
is consumed, so there is a window in which a client that already refreshed its profile sees the
old name in a zone list. This is accepted, not worked around. The window is milliseconds in
practice, the realtime events in section 7 close it without a refetch, and the alternative
(a distributed transaction across two databases) is the thing this architecture exists to
avoid.

## 5. Changing a username inside one zone

One message covers both the admin case in the requirement and the user renaming themselves in a
single zone, because they are the same operation with two authorization branches.

```ts
export const MEMBERSHIP_PATTERNS = {
  // ...existing
  setUsername: 'membership.setUsername',
} as const;

export interface SetMembershipUsernameRequest {
  /** The caller, from the verified token. */
  userId: string;
  zoneId: string;
  membershipId: string;
  username: string;
}
```

Authorization, resolved from the caller's own membership in that zone:

- The caller may always rename **their own** membership, with no role requirement beyond being
  `APPROVED` or `PENDING` in the zone.
- An `OWNER` or `ADMIN` may rename **any** membership in the zone.
- An `ADMIN` may not rename the `OWNER`, mirroring the guard already in `ZoneService.setRole`
  where an admin cannot act on the owner. The owner may rename anyone including themselves.
- A `KICKED` or `BANNED` membership cannot be renamed by anybody, for the reason in section
  4.2.

This changes nothing globally: `users.username` is untouched, and a later global change with
`MATCHING_ZONES` will not match this zone unless the admin happened to pick the old global
name. That is the correct behaviour and is worth a test.

Self renaming in one zone is slightly beyond the literal requirement, which names only the
admin case. It is included because `ALL_ZONES` already lets a user set their per zone names in
bulk, so withholding the single zone version would be arbitrary. Cut the self branch if it is
unwanted; the admin branch stands alone.

## 6. Validation

Applied to any username the user or an admin supplies, in auth for the global name and in core
for the per zone name, from one shared implementation in
`libs/luna-shopper/platform` (both services need identical rules, and a rule that differs
between the two produces a name that is legal in one place and not the other).

- Trim, then collapse internal whitespace runs to a single space.
- Length after normalization: 2 to 32 characters, counted in Unicode code points, not bytes.
- Allowed: Unicode letters and marks (so accents and non Latin scripts work), digits, spaces,
  and `.`, `_`, `-`, `'`.
- Rejected: control characters, zero width and bidirectional control characters (a name is
  rendered next to other names and must not be able to reorder them), anything that normalizes
  to empty, and a name made only of digits or punctuation.
- Rejected: any name beginning with `ANONYMIZED_USERNAME_PREFIX` (`former member`), case
  insensitively. That prefix is the system's own marker for a deleted account from 0011 and
  must not be forgeable.
- Normalize to Unicode NFC before storing, so two visually identical names compare equal in
  `MATCHING_ZONES`.

A rejection is a `ValidationException` with `messageArgs: { field: 'username' }`, matching what
`saveHandlingUsername` used to throw, so the client's existing handling of that shape keeps
working after section 2 removes the uniqueness error.

**Rate limiting.** Because names are public, non unique and freely changeable, rapid renaming is
a plausible harassment pattern (change to a target's name, act, change back). Both
`auth.setUsername` and `membership.setUsername` go behind a named throttler bucket at the
gateway, sized around five changes per hour per user. The bucket name and the exact figure are
config, not code.

## 7. Realtime

```ts
export enum RealtimeEvent {
  // ...existing
  MemberUsernameChanged = 'member.usernameChanged',
}
```

Payload is the existing `MembershipView`, which already carries `username`, so no new payload
type is needed. Add the subject to `DOMAIN_EVENT_SUBJECTS`; `member.usernameChanged` collides
with no command subject.

Emitted once per affected membership, to that membership's zone room, from both:

- the section 4.4 saga, iterating the rows `RETURNING` gave back, and
- `membership.setUsername` in section 5.

A user in twenty zones doing `ALL_ZONES` therefore produces twenty events across twenty rooms,
one per room. That is the correct fan out: each room learns only about its own member.

The global username itself is not a realtime event. Nothing renders another user's global name;
what a zone renders is the membership name. The user's own global name changes in response to
their own request, so their client already has it.

## 8. Migrations

### 8.1 `1756000700000-GlobalUsername` (auth)

Expand and contract, in one migration because the table is small and the backfill is
deterministic:

1. `ALTER TABLE users ADD COLUMN username varchar` (nullable at first).
2. Backfill every existing row. The TypeScript generator cannot run inside a raw SQL migration,
   and the repo's rule is that migrations are raw SQL, so the backfill uses a small inline
   English pool and picks deterministically from the row's id:

   ```sql
   UPDATE users SET username =
     (ARRAY['Swift','Steady','Bright', /* ... */])[1 + (abs(hashtext(id::text)) % 12)]
     || ' ' ||
     (ARRAY['Sail','Helm','Wake', /* ... */])[1 + (abs(hashtext(id::text || 'n')) % 16)]
   WHERE username IS NULL;
   ```

   English, because a pre existing row has no recorded locale and `en` is `DEFAULT_LOCALE`.
   Deterministic, so re running the migration on a copy of the database produces the same names.
   The inline pool is a subset of the real one and is allowed to drift from it; it exists only
   to fill rows that predate the feature.
3. `ALTER TABLE users ALTER COLUMN username SET NOT NULL`.

No unique index. `ix_users_username` (plain) is added, because the admin back office will
eventually search by it.

The down migration drops the column.

### 8.2 `1756000710000-DropZoneUsernameUniqueness` (core)

1. `ALTER TABLE zone_memberships DROP CONSTRAINT "uq_membership_zone_username"` (a constraint,
   not an index, see section 2).
2. `CREATE INDEX ix_membership_zone_username ON zone_memberships ("zoneId", username)`.

The down migration recreates the unique constraint, and **will fail if duplicates exist by
then**.
That is correct and should not be papered over: reverting to a uniqueness rule that the data
already violates is a real conflict, and a silent dedupe would rename people without asking.
Say so in the migration's comment.

## 9. Zone create and join default the name

`CreateZoneRequest.username` and `JoinZoneRequest.username` stay required on the NATS contract,
because core must be told what to write and should not reach into auth for it.

The REST layer changes: `username` becomes **optional** in the create and join DTOs. When the
client omits it, the gateway calls `auth.getProfile` for the caller and uses the global name.
This is one extra NATS hop, only on the two rarest operations in the product.

Rejected alternative: putting `username` in the JWT claims so the gateway needs no hop. Access
tokens live fifteen minutes, so a user who renames themselves and immediately joins a zone
would seed that zone with the old name and have no way to know why. A stale name written into
a durable row is worse than one extra request on a rare path.

## 10. Testing

- **Contract schemas are mandatory.** The completeness spec in
  `libs/luna-shopper/contracts/src/schemas` fails CI if `auth.setUsername`, `auth.getProfile`,
  `membership.setUsername`, `user.usernameChanged` or `member.usernameChanged` lack a schema.
  Also extend the enum schemas with `UsernamePropagation`.
- **Pool specs**, which are what protect the load bearing invariant in 3.1:
  - every locale in `SUPPORTED_LOCALES` has a pool, and no pool is empty;
  - the pools are pairwise disjoint on every word, nouns and adjectives alike;
  - every Spanish noun declares a gender and every Spanish adjective has both forms;
  - composition produces the right order and agreement for a masculine and a feminine noun in
    each locale;
  - every name the generator can produce passes the section 6 validator, for every combination,
    not a sample.
- **Generation**: a Spanish request yields a name drawn only from the Spanish pool and an
  English request only from the English pool; an unsupported locale falls back to English;
  `auth.upgrade` leaves the username untouched; a Google sign in does not use the Google
  profile name.
- **Propagation**, one test per mode: `GLOBAL_ONLY` leaves every membership alone;
  `MATCHING_ZONES` renames only the memberships that held the exact old name and leaves a
  differently cased one alone; `ALL_ZONES` renames every eligible membership; all three skip
  `KICKED` and `BANNED`.
- **Saga idempotency**: redelivering `user.usernameChanged` performs no second update and emits
  no second realtime event.
- **Per zone authorization**: self rename allowed; admin renames a member; admin cannot rename
  the owner; owner renames anyone; a plain member cannot rename anyone else; nobody renames a
  banned membership.
- **Validation**: each rejection rule has a case, including the `former member` prefix and a
  bidirectional control character.
- **Non uniqueness is exercised, not merely permitted**: two members of one zone are given the
  same name and both saves succeed, and two users are given the same global name.
- **Integration** (`LUNA_INTEGRATION` gated): a real rename with `ALL_ZONES` across two zones
  updates both membership rows and delivers two `member.usernameChanged` events.

## 11. Exit criteria

- Every user row has a non null `username` from creation, generated from the request locale's
  pool, and existing rows are backfilled.
- The pools are disjoint and gender correct, proven by spec, and no generated name fails
  validation.
- `PATCH` on the account (route owned by the `GET /v1/account/me` work, see below) reaches
  `auth.setUsername`, defaults to `GLOBAL_ONLY`, and the two propagating modes update exactly
  the memberships section 4.2 defines.
- `membership.setUsername` enforces the five authorization rules in section 5.
- `uq_membership_zone_username` no longer exists; two members of one zone may share a name; the
  `That username is taken in this zone` error path is gone.
- `member.usernameChanged` reaches each affected zone room exactly once per change.
- Both migrations apply and revert cleanly (the core down migration's documented failure on
  duplicate data is expected behaviour, not a defect).
- `nx run-many --all --target=test|lint|build` green for the luna projects.

## 12. Boundary with work reserved elsewhere

The REST surface for reading and writing the caller's own profile (`GET /v1/account/me`, and the
`PATCH` that carries the username change) is work the repository owner has reserved. This plan
therefore stops at the NATS contract: `auth.getProfile` and `auth.setUsername` are defined,
implemented and tested here, and whichever gateway route eventually exposes them needs only to
forward the verified `userId` and the body. Nothing in sections 1 through 11 depends on which
route that is.
