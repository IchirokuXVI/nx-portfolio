# 0049 Shopping profiles, and a catalog you cannot list whole

Two ideas that turn out to be one plan: a user says where and how they shop, and the catalog
stops answering the question "show me everything". The second is what makes the first
mandatory rather than a convenience, and both exist to serve the generated basket in `0050`
and backlog 0004.

This plan reworks the parked preferences design (the backlog version of this document) around
one change decided at pickup: **the unit of configuration is a profile, and a user can have
several.** One person shops from home, from the office, and from their parents' town in
August. Those are three postal codes, three sets of reachable chains, and potentially three
different thresholds, and a single preference row forces them to overwrite each other. A
profile names the bundle, and switching profiles is how the same person shops from somewhere
else.

Depends on 0012 (the catalog, its items, supermarkets and locations). Backlog 0001's
`PriceScope`, the scope a postal code actually resolves to, has since shipped with plan 0038,
so the resolver in section 1.1 has real scopes to resolve to. Companion plan:
`apps/velista/plans/0046`, the profile page.

## 1. What a profile holds

**ShoppingProfile** (core):

- `id` (uuid)
- `userId` (opaque)
- `name` (varchar, nullable; section 1.3)
- `isDefault` (boolean; exactly one per user, enforced by a partial unique index)
- `position` (int, the order the select shows them in)
- `addressText` (nullable free text: "Calle Mayor 12". Display and context only; nothing is
  geocoded, and the postal codes below are what resolve to scopes)
- `minSavingCents` (int, default 0): the money a second stop has to save before the basket
  generator suggests it. Declared here because it is per profile; what it _means_ is defined
  in backlog 0004 section 5.
- `minSavingPercent` (int, nullable): the optional relative floor beside the absolute one.
- `generationScope`: `GenerationScope` enum (`ALL`, `SELECTED`), default `ALL`: which zones
  and lists feed a generated basket. Consumed by `0050`.

**ProfilePostalCode**: `id`, `profileId`, `postalCode`, `label` ("home", "the office"),
`position`; unique (`profileId`, `postalCode`).

**ProfileSupermarketPreference**: `id`, `profileId`, `supermarketId` (opaque catalog id),
`excluded` (boolean, default false); unique (`profileId`, `supermarketId`). The preference
names the **chain**, never a location: "no DIA" means no DIA anywhere, and which locations a
chain reaches is the scope resolver's business, not the user's.

> **Superseded in part by `0064`.** There is a per location preference now, beside this one
> rather than instead of it: `ProfileLocationPreference` says "not that shop", this one says
> "not that brand, including its future shops", and an excluded chain still hides every one of
> its locations whatever their own rows say.

**ProfileGenerationSource** (only meaningful when `generationScope = SELECTED`): `id`,
`profileId`, `zoneId`, `listId` (nullable: null means the whole zone); unique (`profileId`,
`zoneId`, `listId`).

Everything multi valued hangs off the profile, so deleting one cascades its children and
touches nothing else.

### 1.1 Store the postal code, resolve the scope

The user types a postal code. The system needs a set of `PriceScope` ids. It is tempting to
resolve once at save time and store the scope ids, and that is the wrong choice: the mapping
from postal code to scope belongs to the chain and moves without telling us (backlog 0001
section 1.2, where Mercadona answers `change-pc` with the warehouse currently serving that
code). A stored scope id silently becomes a lie.

So the postal code is what is stored, and the resolution happens per query and is cached with
a short lifetime. The resolver lives in catalog beside the scopes, not in core where the
profile row lives.

### 1.2 Supermarket preferences are a filter, not a second address

> **Superseded in part by `0064`**, which adds the finer axis this section says there is not.
> Everything below is still true of the chain preference; what changed is that it is no longer
> the only one. `0064` section 2 is why both exist.

A postal code answers "where am I". A supermarket preference answers "and of the chains that
reach here, these ones". Both are needed: a profile with one postal code and no chain
preference shops every chain that serves it, and a user who refuses to set foot in one chain
says so once rather than in every query. The `excluded` flag exists so that "everything
except DIA" does not force the user to enumerate every other chain, and so that a chain added
to the catalog later is included by default rather than silently missing from a hand written
allowlist.

Where both are set, the intersection wins: chains that serve one of this profile's postal
codes, minus the ones it excluded, restricted to the ones it listed if it listed any.

### 1.3 The default profile exists before anybody creates it

Every user has one profile from the start, without a registration saga: the first read or
resolution that finds no profile for the caller **creates one**, idempotently, with
`isDefault = true`, `name = null` and nothing else set. `name = null` is rendered by the
client as a localized default ("My profile" / "Mi perfil") rather than stored as one, because
core does not know the caller's locale and a stored English word in a Spanish account is
wrong forever.

Rules that follow from `isDefault`:

- Catalog reads and generation runs that do not name a profile use the default one.
- A request may name a `profileId` instead, which is how the velista profile page edits a
  non default profile and how a generation run shops "as" another profile. A `profileId`
  that is not the caller's is answered as not found, never as forbidden.
- The default can be reassigned (`profiles.setDefault`); deleting the default promotes the
  oldest remaining profile; the last remaining profile cannot be deleted. There is always
  exactly one default.

## 2. Which service owns the profile

The row references zones and lists (core) and supermarkets and scopes (catalog), and is keyed
by an auth `userId`. Nothing owns all three, so this is a real decision.

**Core owns it**, keyed by opaque `userId`, referencing catalog by opaque `supermarketId`
exactly as `ListLine.itemId` already does (0012 section 4). The heaviest consumer is the
basket generator in `0050`, which is core work over core data, and putting the profile
anywhere else makes the generator do a cross service read on every run to learn what the user
wants.

Alternatives considered and rejected, unchanged from the backlog version: auth is
deliberately identity only and has no business holding zone ids; catalog is the one service
with no idea what a zone is; a fourth service is not warranted by five tables.

### 2.1 How catalog learns the scopes without owning the profile

**The gateway resolves and passes.** A catalog read arrives at the gateway, the gateway asks
core for the effective scope set of the caller's default (or named) profile when the request
did not specify one, and calls catalog with explicit scopes. Catalog stays stateless about
users, which is what keeps it the service that owns owner curated reference data and nothing
else.

The cost is a core round trip on catalog reads, mitigated by caching the resolved set per
user in the gateway with a short lifetime and invalidating on the `profiles.changed` event
(section 6). Letting catalog call core itself was rejected because it inverts the dependency
direction every other plan has kept, and putting the scope set in the JWT was rejected
because it goes stale exactly when a user edits a profile, which is the moment they expect
the catalog to change.

## 3. The catalog stops being listable

> **Superseded by `0069`.** The error this section introduces is gone, and with it the empty
> page: an empty scope set and an absent one are now the same read, ranked and paged with
> every price field null. The rest of the section, including 3.1's ladder, still stands. This
> file is left as it was written.

Today a read API that returns items is a read API that can return all of them. This plan
makes an unscoped listing an error.

- Every catalog read that returns items or prices takes a **scope selector**: a set of
  postal codes, a set of supermarket ids, or both. `0048` already put the parameter on the
  search messages; this plan is where sending nothing stops meaning everything.
- If the request carries no selector, the caller's default profile is resolved and used.
- If that profile holds no postal code and no supermarket either, the request **fails** with
  a dedicated error code (`CATALOG_SCOPE_REQUIRED`, HTTP 400) whose localized message tells
  the user to pick a postal code or a supermarket. It does not fall back to everything, and
  it does not return an empty page: an empty page reads as "there is nothing", which is a
  different and false statement.
- The error is a first class part of the contract, because the frontend has to render it as
  an onboarding step (fill in your profile) rather than as a failure.

**What stays unscoped**, deliberately: reading a single item by id, and listing supermarkets
and their locations. Fetching one known item is how a list line renders its product, and a
line can reference an item the user cannot currently buy anywhere near them; the item exists,
its price at your scopes may be absent, and those are different answers. Chain and location
listings are how a user fills a profile in the first place, so gating them behind a filled
profile would deadlock onboarding.

### 3.1 Filtering by supermarket with no postal code

"Show me Mercadona" with no location is ambiguous: Mercadona prices per warehouse, so there
is no single Mercadona price. Resolution order:

1. If the profile also has postal codes, use that chain's scopes serving those codes.
2. Otherwise use the chain's `NATIONAL` scope if it has one (Lidl does, per backlog 0001
   section 1.3).
3. Otherwise pick the chain's default scope, an owner set field on `Supermarket`, and return
   the result **flagged as approximate** so the client can say "prices shown for Madrid".

Silently averaging across scopes is not an option: an average price is a price that exists
in no store.

## 4. Zone level scopes, and why not yet

A zone list is shopped by several people who may live in different places, so a zone with its
own postal codes is a coherent idea and will come up. It is deferred, not rejected, because
the generated basket in `0050` is per user, so the generator always has exactly one person
whose profile matters. When a shared, zone owned basket appears, `Zone.config` (0006 section
1, the jsonb that exists for this kind of growth) is where the zone level default goes, with
the user's own profile overriding it.

## 5. Validation, privacy, and empty results

- A postal code that no supermarket serves is **accepted and flagged**, not rejected.
  Coverage is a property of our data, not of the user's address, and refusing the code would
  tell the user they live nowhere. The listing then legitimately returns nothing, with a
  distinct code that says "no chain we know reaches this postal code" so the client can
  offer to notify them later.
- Profiles are private. They are never returned in a zone membership view and never visible
  to other zone members, including admins. A generated basket built from one exposes prices
  and chosen stores on the terms `0051` sets, and the profile itself to nobody.
- A profile with several postal codes gets the union of their scopes, and every result says
  which scope produced it. This matters for the basket: two stops in two towns is not the
  same suggestion as two stops on one street, and only the user can judge that.
- `name` is trimmed and capped (64 characters). The client renders it on one line and
  truncates the overflow (velista `0046`); the cap is so the truncation is cosmetic rather
  than load bearing.

## 6. Contracts, events, and endpoints

- `GET /v1/account/shopping-profiles` (lists them, creating the default on first call),
  `POST /v1/account/shopping-profiles`, `PATCH /v1/account/shopping-profiles/:id` (name,
  thresholds, generation scope, and full replacement of the postal code, supermarket and
  source lists), `POST /v1/account/shopping-profiles/:id/default`, and
  `DELETE /v1/account/shopping-profiles/:id`. On the account controller 0018 created,
  reaching core rather than auth.
- Core messages `profiles.list`, `profiles.create`, `profiles.update`, `profiles.setDefault`,
  `profiles.delete`, and `profiles.resolveScopes` (the gateway's resolution call from
  section 2.1), with the usual request and response schemas in
  `libs/luna-shopper/contracts/src/schemas` so 0019 documents them for free.
- Event `profiles.changed` on the user's own realtime room, which is also the gateway cache
  invalidation signal, and what keeps two of the user's own devices agreeing.
- New enum `GenerationScope` in `contracts`, per the constant sets rule.
- The OpenAPI document is regenerated, per the rule in `CLAUDE.md`.

## 7. Migrations

One new append only core migration for the four tables. No catalog schema change: scopes
shipped with plan 0038, and section 3 is a change to the read messages, not to the tables.

## 8. Open decisions

- Gateway cached resolution versus a synchronous core call per catalog read (section 2.1).
  Leaning cached read with the event as the invalidation signal.
- Whether `minSavingPercent` earns its place, or the absolute threshold is enough on its own.
- Whether a temporary user (0005) may hold profiles. Leaning yes, because the alternative is
  asking someone to register before they can see a single price.
- How many profiles and postal codes one user may keep. A cap exists mostly to bound the
  scope set the optimizer works over; leaning ten profiles, five postal codes each.
- Whether a generation run should remember which profile it ran with by snapshotting the
  profile id into `0050`'s `sourceSnapshot`. Leaning yes, it is one field and explains an
  old basket.

## 9. Exit criteria

- Every user has a default profile without creating one, and it survives being listed twice
  concurrently (creation is idempotent).
- A user can create, rename, reorder, edit and delete profiles; the last one cannot be
  deleted; deleting the default promotes another; there is always exactly one default.
- A profile stores postal codes, chain preferences, generation sources, an address text and
  a saving threshold, and reads them back.
- A catalog listing or search with no explicit selector uses the caller's default profile;
  naming a `profileId` uses that one; naming another user's is not found.
- A catalog listing or search with no selector and an empty profile fails with a documented,
  localized, distinguishable error rather than returning everything or nothing.
- Postal codes are stored as typed and resolved to scopes per query, so an upstream
  remapping changes results without a data migration.
- A chain filter with no location resolves through the documented ladder and marks
  approximate results as approximate.
- A postal code no chain serves is stored, flagged, and produces an explicable empty result.
- Profiles are invisible to every user but their owner, and `profiles.changed` reaches only
  their own room.
- Requests and responses have contract schemas, so `/docs` describes them with no hand
  written DTOs.
