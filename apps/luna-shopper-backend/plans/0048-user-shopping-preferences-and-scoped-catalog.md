# 0048 User shopping preferences and a catalog you cannot list whole

Two ideas that turn out to be one plan: a user says where they shop, and the catalog stops
answering the question "show me everything". The second is what makes the first mandatory rather
than a convenience, and both exist to serve the generated basket in `0049` and backlog 0004.

Depends on 0012 (the catalog, its items, supermarkets and locations). Backlog 0001's
`PriceScope`, the scope a postal code actually resolves to, has since shipped with plan 0038,
so the resolver in section 1.1 has real scopes to resolve to.

## 1. What a user configures

One row per user, in a service settled in section 2, with child rows for the multi valued parts.

**UserShoppingPreference**
- `id` (uuid)
- `userId` (opaque, unique)
- `minSavingCents` (integer, default 0): the money a second stop has to save before the basket
  generator suggests it. Declared here because it is a preference; what it *means* is defined in
  backlog 0004 section 5.
- `minSavingPercent` (integer, nullable): the optional relative floor beside the absolute one.
- `generationScope`: `GenerationScope` enum (`ALL`, `SELECTED`), default `ALL`, which zones and
  lists feed a generated basket. Consumed by `0049`.

**UserPostalCode**
- `id`, `userId`, `postalCode` (string), `label` (free text, "home", "the office"), `position`
- unique (`userId`, `postalCode`)

**UserSupermarketPreference**
- `id`, `userId`, `supermarketId` (opaque catalog id), `excluded` (boolean, default false)
- unique (`userId`, `supermarketId`)

**UserGenerationSource** (only meaningful when `generationScope = SELECTED`)
- `id`, `userId`, `zoneId`, `listId` (nullable: null means the whole zone)
- unique (`userId`, `zoneId`, `listId`)

### 1.1 Store the postal code, resolve the scope

The user types a postal code. The system needs a set of `PriceScope` ids. It is tempting to
resolve once at save time and store the scope ids, and that is the wrong choice: the mapping from
postal code to scope belongs to the chain and moves without telling us (backlog 0001 section 1.2,
where Mercadona answers `change-pc` with the warehouse currently serving that code). A stored
scope id silently becomes a lie.

So the postal code is what is stored, and the resolution happens per query and is cached with a
short lifetime. The resolver lives in catalog beside the scopes, not in whichever service holds
the preference row.

### 1.2 Supermarket preferences are a filter, not a second address

A postal code answers "where am I". A supermarket preference answers "and of the chains that
reach here, these ones". Both are needed: a user with one postal code and no chain preference
shops every chain that serves it, and a user who refuses to set foot in one chain says so once
rather than in every query. The `excluded` flag exists so that "everything except DIA" does not
force the user to enumerate every other chain, and so that a chain added to the catalog later is
included by default rather than silently missing from a hand written allowlist.

Where both are set, the intersection wins: chains that serve one of my postal codes, minus the
ones I excluded, restricted to the ones I listed if I listed any.

## 2. Which service owns the preference

The row references zones and lists (core) and supermarkets and scopes (catalog), and is keyed by
an auth `userId`. Nothing owns all three, so this is a real decision.

**Recommendation: core owns it**, keyed by opaque `userId`, referencing catalog by opaque
`supermarketId` exactly as `ListLine.itemId` already does (0012 section 4). The argument is that
the heaviest consumer is the basket generator in `0049`, which is core work over core data,
and putting the preference anywhere else makes the generator do a cross service read on every run
to learn what the user wants.

Alternatives considered:

- **Auth owns it**, next to the profile that 0018 exposed at `/v1/account/me`. Rejected: auth is
  deliberately identity only, and it has no business holding a list of zone ids.
- **Catalog owns it**, next to the scopes. Rejected for the same reason inverted: catalog would
  then hold zone and list ids, and catalog is the one service with no idea what a zone is.
- **A fourth service.** Not for one table.

The cost of the recommendation is section 3: catalog is the service that has to apply the
defaults, and it will not hold them.

### 2.1 How catalog learns the defaults without owning them

**The gateway resolves and passes.** A catalog read arrives at the gateway, the gateway asks core
for the caller's effective scope set when the request did not specify one, and calls catalog with
explicit scopes. Catalog stays stateless about users, which is what keeps it the service that
owns owner curated reference data and nothing else.

The cost is a core round trip on catalog reads. Mitigations, in order of preference: cache the
resolved set per user in the gateway with a short lifetime and invalidate on the preference
changed event (section 6); or let catalog call core itself, which is worse because it inverts the
dependency direction every other plan has kept.

Putting the scope set in the JWT was considered and rejected: it goes stale exactly when a user
changes their postal codes, which is the moment they expect the catalog to change.

**Open**: whether the gateway resolution is a synchronous NATS request or a cached read. Leaning
cached read with the event as the invalidation signal.

## 3. The catalog stops being listable

Today a read API that returns items is a read API that can return all of them. This plan makes an
unscoped listing an error.

- Every catalog read that returns items or prices takes a **scope selector**: a set of postal
  codes, a set of supermarket ids, or both.
- If the request carries no selector, the caller's stored preferences are used.
- If the caller has no preferences either, the request **fails** with a dedicated error code
  (`CATALOG_SCOPE_REQUIRED`, HTTP 400) whose localized message tells the user to pick a postal
  code or a supermarket. It does not fall back to everything, and it does not return an empty
  page: an empty page reads as "there is nothing", which is a different and false statement.
- The error is a first class part of the contract, because the frontend has to render it as an
  onboarding step rather than as a failure.

This applies to browsing and to search alike. Backlog 0001 section 3.4 already gives
`catalog.searchItems` and `catalog.searchOffers` a set of scope ids for the same reason stated
from the other end: a price at a store nobody visits is noise.

**What stays unscoped**, deliberately: reading a single item by id, and listing supermarkets and
their locations. Fetching one known item is how a list line renders its product, and a line can
reference an item the user cannot currently buy anywhere near them; the item exists, its price at
your scopes may be absent, and those are different answers. Chain and location listings are how a
user picks preferences in the first place, so gating them behind preferences would deadlock
onboarding.

### 3.1 Filtering by supermarket with no postal code

"Show me Mercadona" with no location is ambiguous: Mercadona prices per warehouse, so there is no
single Mercadona price. Resolution order:

1. If the user also has postal codes, use that chain's scopes serving those codes.
2. Otherwise use the chain's `NATIONAL` scope if it has one (Lidl does, per backlog 0001 section
   1.3).
3. Otherwise pick the chain's default scope, an owner set field on `Supermarket`, and return the
   result **flagged as approximate** so the client can say "prices shown for Madrid".

Silently averaging across scopes is not an option: an average price is a price that exists in no
store.

## 4. Zone level scopes, and why not yet

A zone list is shopped by several people who may live in different places, so a zone with its own
postal codes is a coherent idea and will come up. It is deferred, not rejected, because the
generated basket in `0049` is explicitly per user and private, so the generator always has
exactly one person whose scopes matter. When a shared, zone owned basket appears, `Zone.config`
(0006 section 1, the jsonb that exists for this kind of growth) is where the zone level default
goes, with the user's own preferences overriding it.

## 5. Validation, privacy, and empty results

- A postal code that no supermarket serves is **accepted and flagged**, not rejected. Coverage is
  a property of our data, not of the user's address, and refusing the code would tell the user
  they live nowhere. The listing then legitimately returns nothing, with a distinct code that
  says "no chain we know reaches this postal code" so the client can offer to notify them later.
- Preferences are private. They are never returned in a zone membership view and never visible to
  other zone members, including admins. A generated basket built from them exposes prices and
  chosen stores to its owner alone (`0049` section 8).
- A user with several postal codes gets the union of their scopes, and every result says which
  scope produced it. This matters for the basket: two stops in two towns is not the same
  suggestion as two stops on one street, and only the user can judge that.

## 6. Contracts, events, and endpoints

- `GET /v1/account/shopping-preferences` and `PUT /v1/account/shopping-preferences`, on the
  account controller 0018 created, reaching core rather than auth.
- Core messages `preferences.get` and `preferences.set`, with the usual request and response
  schemas in `libs/luna-shopper/contracts/src/schemas` so 0019 documents them for free.
- Event `preferences.changed` on the user's own realtime room, which is also the gateway cache
  invalidation signal from section 2.1.
- New enums (`GenerationScope`) live in `contracts`, per the project rule that constant sets are
  enums.

## 7. Migrations

One new append only core migration for the four tables. No catalog schema change: scopes come
from backlog 0001, and section 3 is a change to the read messages, not to the tables.

## 8. Open decisions

- Gateway cached resolution versus a synchronous core call per catalog read (section 2.1).
- Whether `minSavingPercent` earns its place, or the absolute threshold is enough on its own.
- Whether a temporary user (0005) may hold preferences, or whether they are a registered account
  feature. Leaning: temporary users may, because the alternative is asking someone to register
  before they can see a single price.
- How many postal codes one user may keep. A cap exists mostly to bound the scope set the
  optimizer works over.

## 9. Exit criteria

- A user can store postal codes, chain preferences, generation sources and a saving threshold,
  and read them back.
- A catalog listing or search with no explicit selector uses those preferences.
- A catalog listing or search with no selector and no preferences fails with a documented,
  localized, distinguishable error rather than returning everything or nothing.
- Postal codes are stored as typed and resolved to scopes per query, so an upstream remapping
  changes results without a data migration.
- A chain filter with no location resolves through the documented ladder and marks approximate
  results as approximate.
- A postal code no chain serves is stored, flagged, and produces an explicable empty result.
- Preferences are invisible to every user but their owner.
- Requests and responses have contract schemas, so `/docs` describes them with no hand written
  DTOs.
