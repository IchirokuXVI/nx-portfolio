> **PR:** [#212](https://github.com/IchirokuXVI/nx-portfolio/pull/212)

# 0078 A basket priced against the profile that composed it

No basket has ever shown a price outside a hand built test. Plan `0066` joined every piece: the
scoped `item.getMany`, the profile to scope resolution, the redaction rule, the scope description
that names a chain. The client half draws every number. The screen still says nothing about what a
line costs, and the reason is one field doing two jobs.

This plan is small and urgent. It depends on nothing else in the leaflet series and ships first.
It changes core, one contract, one gateway read path, and two generated documents. It changes no
resolver, no catalog read, and nothing in velista.

## 1. Where the price is lost

The run is composed in `apps/luna-shopper-backend/core/src/app/generated-lists/generated-list.service.ts`.
`resolveSources` (lines 226 to 252) answers which lists the run draws from, in the order plan
`0050` section 2 states. Its first branch, lines 236 to 239:

```ts
if (req.sources && req.sources.length > 0) {
  this.checkSources(req.sources);
  return { profileId: null, sources: narrow(writable, req.sources) };
}
```

That `null` lands in the snapshot at lines 188 to 194 and is stored on
`generated_lists.sourceSnapshot`, a `jsonb` column (`entities/generated-list.entity.ts`, line 67).
The contract is `GeneratedListSourceSnapshot` in
`libs/luna-shopper/contracts/src/lib/messages/generated-list.messages.ts`, lines 150 to 155. Its
`profileId` is documented as "the profile whose sources the run used, or null when the request
named them".

The read side takes that field as the pricing scope. `searchScope` in
`generated-list-basket.service.ts`, lines 357 to 366, returns
`{ ownerUserId, profileId: list.sourceSnapshot.profileId }`. The gateway turns it into scope ids in
`generated-list-sharing.controller.ts`: `describeScopes` (lines 834 to 857) returns `undefined`
the moment `scope.profileId` is null. So `productsFor` (lines 468 to 471) calls `item.getMany`
with no `priceScopeIds`, and `bestOffer` is absent on every product. The suggest route (lines 781
to 789) searches unscoped for the same reason. Both halves behave exactly as their own comments
describe. The combination is what fails.

**Every run velista creates takes the first branch.** The sheet that starts a run is
`libs/velista/feature-home/src/lib/get-list-sheet/get-list-sheet.ts`. It always sends `sources`
(line 522). It sends `profileId` whenever one is chosen (line 521). Its own comment at lines 288
to 290 reads: "With one profile the run still uses it, because the request names it either way."
The server drops that profile on line 238. So the profile chooser on that sheet has never affected
a price. The symptom a person sees is the one that led here. The composer's typeahead on a zone
list shows prices, because the caller's profile scopes it. The same search inside the basket shows
none.

## 2. Why the obvious fix is wrong

The first proposed fix wrote the caller's default profile into `profileId` on the explicit
sources branch. It contradicts two plans, and both contradictions are real.

**Plan `0050` section 2** orders the sources: the request's own, otherwise the named profile's or
the caller's default, otherwise `ALL`. Explicit sources short circuit the profile. The profile is
never consulted. Recording it asserts that the run was composed against a profile whose sources
were never read. Section 1 of the same plan says why that matters: the snapshot exists so "a three
week old generated list can be explained to the person looking at it". A snapshot that names a
profile the run did not use explains the wrong thing.

**Plan `0055` section 5.1** is a three row verdict table. "The caller's default shopping profile"
is refused: a guest has none, and a registered participant's own profile ranks a stranger's basket
by a different city's shops. "The run's `sourceSnapshot` profile" is accepted. `searchScope` reads
that field verbatim. Writing a default profile into it launders the refused row into the accepted
one. A guest searching inside a basket is then ranked by a profile the table refused.

The two plans are not wrong. `profileId` means what `0050` says it means. The defect is that
`0055` made it also mean "the profile to price with", and those are different facts. A run that
named its sources by hand still belongs to a person who shops somewhere.

## 3. The decision: a second field, set when the run is composed

`GeneratedListSourceSnapshot` gains one field:

```ts
export interface GeneratedListSourceSnapshot {
  /** The profile whose sources the run used, or null when the request named them. */
  profileId: string | null;
  /**
   * The profile the basket is priced against: the one the request named, else the
   * owner's default at the moment the run was composed. Null only on a run composed
   * before plan 0078, which stays unpriced.
   */
  pricingProfileId: string | null;
  sources: { zoneId: string; listId: string }[];
}
```

`profileId` keeps its `0050` meaning exactly. On a run that named its sources it stays null.

**Set at compose time, in `create`, on every branch of `resolveSources`.** The rule:

1. The request names a `profileId`. Load it through `ProfileService.load(userId, profileId)`.
   That is the call `resolveGenerationSources` makes on line 612 of
   `core/src/app/profiles/profile.service.ts`. A stranger's id is refused exactly as it is today.
   A profile the caller does not own can never price a run.
2. Otherwise take the caller's default, through `defaultProfile(userId)` (line 613).
   `ensureProfiles` creates that profile for an account that has none. So the value is never null
   for a run composed after this plan.

**The owner's, never the reader's.** At compose time the caller is the owner. `write` stores
`ownerUserId: req.userId` (lines 429 and 476). So the profile recorded is the run owner's, captured
at composition. That is `0055` section 5.1's accepted row and not its refused one. A participant
who opens the basket a week later still prices it by the owner's profile. A guest prices it the
same way. No account of their own is consulted.

`resolveSources` returns `{ profileId, pricingProfileId, sources }`. In the explicit sources branch
it resolves the pricing profile and still returns `profileId: null`. In the profile branch the two
are the same id. The snapshot literal at lines 188 to 194 copies both.

**The read side changes one line.** `searchScope` returns
`profileId: list.sourceSnapshot.pricingProfileId`. `GeneratedListBasketScope.profileId` keeps its
name. In that message it has only ever meant "the profile to price with". Every gateway call site
is unchanged: `describeScopes` at 834, the suggest route at 781, `resolvedScopesOf` at 883.

### 3.1 The open question at plan `0055` line 217

That plan left one question open: does the suggest route fall back to the owner's default profile
for a snapshot that names none? It leaned no, because that is "one more read on a hot path to
improve the ranking of a search in an unscoped basket".

This plan answers yes, and moves the read. The fallback happens once, at composition. That is one
profile read per run instead of one per search. The hot path reads a stored id. The objection was
to the cost, and the cost is gone. The other half of the answer stands. A run composed before this
plan carries `pricingProfileId: null` and stays unpriced. That is the "no scope at all" fallback
the table already names.

### 3.2 No backfill

`sourceSnapshot` is `jsonb`, so there is no schema migration. Old rows lack the key and read as
null.

A data migration is possible. It sets `pricingProfileId` on every old run to its owner's current
default (`shopping_profiles.isDefault`, `entities/shopping-profile.entity.ts`, line 34). It is not
done. The snapshot is a record of what the run was composed against. The owner's default today is
a guess about that. Writing a guess into a record is the same mistake section 2 refuses, made once
instead of on every run. The number of affected baskets is also small. The feature has never
priced one, so nobody has a priced basket to lose.

## 4. What changes, file by file

| Where | Change |
| --- | --- |
| `contracts/src/lib/messages/generated-list.messages.ts` lines 150 to 155 | `pricingProfileId: string | null` on `GeneratedListSourceSnapshot` |
| `contracts/src/schemas/messages/generated-list.schemas.ts` lines 119 to 126 | `pricingProfileId: nullableString()`, added to `required` |
| `core/.../generated-list.service.ts` lines 188 to 194 and 226 to 252 | `resolveSources` resolves the pricing profile on both branches, the snapshot copies it |
| `core/.../generated-list-basket.service.ts` lines 357 to 366 | `searchScope` returns `pricingProfileId`, and its doc comment says which field and why |
| `core/.../profiles/profile.service.ts` | `load` and `defaultProfile` become reachable from the run for pricing, no new logic |
| `apps/luna-shopper-backend/gateway/docs/openapi.json` | regenerated, `npx nx run luna-shopper-backend-gateway:openapi` |
| `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` | regenerated, `npx nx run luna-shopper-admin/models:wire-types` |

**Velista needs nothing.** Its snapshot mapper, `libs/velista/data-access/src/lib/mapping/basket-mappers.ts`
lines 543 to 560, reads only `sources` and ignores keys it does not know. The gateway's
`forbidNonWhitelisted` applies to requests, and this is a response field. The sheet already sends
what the server now honours.

**The gateway needs nothing** beyond the two regenerated documents. `describeScopes` already
resolves whatever `searchScope` names. That resolution is cached in Redis for a minute and
invalidated on every profile write. So a price picks up a profile edit as soon as the owner makes
one.

## 5. What this does not change

- **Plan `0066` section 3's rule** that the scope is the run's and never the reader's. This plan
  makes it true for every run instead of for none.
- **`ScopeResolutionService`** and catalog's `ScopeResolverService`. The profile named is resolved
  by the same ladder as before.
- **A participant's own profile.** Still refused, on the same argument.
- **Plan `0050` section 2's source order.** Explicit sources still short circuit the profile's
  sources. Only pricing consults it now.

## 6. Testing

- `core/.../generated-list-run.spec.ts`: a run with explicit sources and a named profile records
  `profileId: null` and `pricingProfileId` equal to the named one. A run with explicit sources and
  no profile records the caller's default. A run with no sources records the same id in both
  fields. A run naming another user's profile is refused before anything is written, which is the
  behaviour `load` already has.
- `core/.../generated-list-sharing.spec.ts`: `searchScope` answers `pricingProfileId`, and answers
  null for a stored snapshot that lacks the key.
- `gateway/.../generated-list-basket-prices.spec.ts`: a basket whose run named sources is priced,
  which is the case that has never passed because it was never written.
- `libs/luna-shopper/contracts/src/schemas/schemas.spec.ts` round trips the widened snapshot.
- A hand check on a slot. Seed the reference catalog (plan `0067`). Create a profile with a postal
  code the seed's stores serve. Generate from a ticked list and open the basket. A line shows a
  price. Then search inside the basket and see the same prices the composer's typeahead shows.

## 7. Exit criteria

- A run created by velista, which always names its sources, carries a `pricingProfileId`. Its
  basket shows prices at the shops that profile resolves to.
- `sourceSnapshot.profileId` is still null for such a run, and plan `0050` section 2's order is
  unchanged.
- A guest and a registered participant see the same prices on the same basket, and neither
  account's own profile is consulted.
- A run composed before this plan stays unpriced and nothing is written into its snapshot.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and `npx nx affected -t lint test`
  is green.
