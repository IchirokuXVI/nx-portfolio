> **PR:** [#453](https://github.com/IchirokuXVI/nx-portfolio/pull/453)

# 0152: a place joins the shop and the scope it names

> Found by `0150` (report findings 3, 9 and 13, shopper F5 and F8). Prerequisite reading:
> `0038` section 5.5 (the matching this plan builds), `0097` section 3 (postal code
> provenance), `0107` sections 3.3, D4 and D6 (the places queue), `0116` section 5 (what an
> import sends), and in the code `discovered-place.service.ts` in the harvester.

An operator imported ten discovered places by hand. Each became a new shop with only a STORE
scope, although the run that found it said which Mercadona warehouse or which Lidl offer
region it belongs to. Two of them duplicated shops the seed already held, one with no
coordinates and one with them. The imported Mercadona Libertador showed no price for any
product, while the seeded copy of the same shop showed every price. A shopper saw both.

## Brief for the agent

### Objective

Make a hand import of a discovered place join the scope its run declared, find the shop the
catalog already holds before it creates a new one, keep the postal code's provenance, and
refuse to reject a place that is already imported.

### Context

In the harvester, `DPS` is `harvester/src/app/harvest/discovered-place.service.ts`.

- **The scope is dropped.** `DPS:454-470` sends only `req.priceScopeId` to `createLocation`
  (`DPS:494`). The run's `scopeKey` (`run-report.ts:58`) is not a column on
  `entities/discovered-place.entity.ts`. It survives only as a tag: `mercadona:warehouse`
  (`mercadona-store-discovery.runner.ts:264`) or `lidl:offerRegion`
  (`lidl-store-discovery.runner.ts:213`).
- **The auto path already does it right.** With `autoImportPlaces`, `DPS:280-282` resolves
  `scopeKey` through the run's resolver (`run-report.sink.ts:339-347`,
  `price-scope-resolver.ts:170`). `0116` section 5 says "promote sends the declared
  warehouse" and "the harvester needs no change", which is true only on the auto path.
- **No match against the catalog.** `promote` (`DPS:485-530`) always calls `createLocation`.
  The only guard is the partial unique index on `externalRef` (catalog migration
  `1756100000000-PriceScopesAndSourceProvenance.ts:112`). Seeded shops have no ref and no
  coordinates. `0038` section 5.5 and the entity comment
  (`catalog/src/app/entities/supermarket-location.entity.ts:113-117`) promise "externalRef
  first, then same brand within 50 metres". `distanceMetres` in
  `libs/luna-shopper/osm-places/src/lib/normalize.ts:183` was written for that and is unused.
- **Provenance is lost.** `DPS:517` writes `SOURCE` whenever a code exists. `0097` added
  `DERIVED` on places (`DPS:327`) and did not update `promote`.
- **Derivation is coarse.** In `libs/luna-shopper/postal-codes/src/data/es.json`, 14 of the
  18 Córdoba codes share one point, 37.8916,-4.7727. `rank()` in
  `catalog/src/app/postal-codes/postal-code.service.ts:222-226` breaks the distance tie by
  code, so 14001 always wins. 48 of 79 OpenStreetMap places read `14001 DERIVED`.
- **Reject ignores state.** `DPS:532-537` sets `REJECTED` with no status check and leaves the
  location and `supermarketLocationId` in place. `import` already refuses an imported place
  at `DPS:459`.
- **The same shop from two sources.** The same Lidl arrived from the Lidl list and from
  OpenStreetMap (`2c263bf8`, `106aaf6e`). `0107` section 8 excludes merging them, so this
  plan links the second one to the same shop and does not merge place rows.

### Target state

- `discovered_places` stores the run's `scopeKey`. A hand import with no `priceScopeId` joins
  the chain's scope with that `externalKey`, exactly as the auto path does. A named
  `priceScopeId` still wins.
- Before creating a shop, import looks for one the chain already holds, in this order: same
  `externalRef`, then same chain within 50 metres, then (for a shop with no coordinates) the
  same normalized address and postal code.
- On a hit, import answers 409 `place_matches_location` with the candidates, and does not
  create. A new request `link` binds the place to a named location: it fills that location's
  missing coordinates and `externalRef`, sets `supermarketLocationId`, and marks the place
  `IMPORTED`. `import` with `force: true` still creates a new shop.
- A place's `DERIVED` postal code reaches catalog as `DERIVED`, or not at all, so catalog
  derives it again.
- The nearest postal code answers null when the best distance is shared by several codes.
- Reject answers 409 on an `IMPORTED` place.

### Scope

Work only in:

- `apps/luna-shopper-backend/harvester/src/app/harvest/` (discovered place service,
  entity, the two store discovery runners, specs) and one harvester migration
- `apps/luna-shopper-backend/catalog/src/app/postal-codes/postal-code.service.ts` and its spec
- `apps/luna-shopper-backend/catalog/src/app/catalog/supermarket-location.service.ts` only if
  `update` cannot already fill coordinates and `externalRef`
- `apps/luna-shopper-backend/gateway/src/app/harvest/` for the `link` route and the new error
- `libs/luna-shopper/contracts` for the messages, error codes and DTOs, plus the regenerated
  `openapi.json` and `wire-types.ts`

Do not touch: the auto import path's behaviour, the admin app (plan `0034` in
`apps/luna-shopper-admin/plans` is its half), price tables, or `es.json` by hand.

### Constraints

- **Nothing links a place to a shop without a person saying so.** Import stops at a
  candidate. Only `link`, or `import` with `force`, writes.
- The auto path keeps working unattended. When it finds a candidate, it leaves the place in
  the queue and does not create a shop.
- Rows written before the migration have no `scopeKey`. Read the scope from the tag for those.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: deleting a catalog location, merging two place rows, or changing the
postal code data file.

### Progress evidence

- Specs in `discovered-place.import.spec.ts`: a Mercadona place imports into its warehouse
  scope, a Lidl place into its offer region, a named scope wins over the declared one.
- Specs for the three matching rungs, the 409 with candidates, `link`, and `force`.
- A spec: the auto path leaves a place with a candidate in the queue.
- A spec: reject of an imported place answers 409.
- A catalog spec: a tied nearest postal code answers null.
- `npx nx test luna-shopper-backend-harvester`, `npx nx test luna-shopper-backend-catalog`
  and `npx nx test luna-shopper-backend-gateway` pass, and the OpenAPI and wire types are
  regenerated.

## 1. The scope key

Add `scopeKey text null` to `discovered_places`, written by `observe` from
`ObservedPlace.scopeKey`. In `import`, when `req.priceScopeId` is absent, list the chain's
scopes with `catalog.listAllPriceScopes(supermarketId)` and pick the one whose `externalKey`
equals the key. This is the lookup `RunScopeResolver.load` already does. When the key names
no scope, import answers 409 `scope_not_found` with the key, so the operator creates it
first. Rows with no column value read the key from the tag.

## 2. Matching an existing shop

List the chain's locations once per import. Match in this order, and stop at the first rung
that finds anything:

1. The same `externalRef`.
2. The same chain within 50 metres, with `distanceMetres`.
3. For locations with no coordinates: the same postal code and the same address after
   `normalizeName` from `matching.ts`.

The 409 answer lists every candidate with its id, label, address, postal code, and the rung
that found it.

## 3. Link

`POST /v1/admin/harvest/places/{id}/link` with `{ supermarketLocationId }`. The location
must belong to the place's chain. Fill only the fields the location lacks: coordinates,
`externalRef`, postal code with its provenance. Never overwrite a field that has a value.

## 4. Postal codes

In `promote`, send `place.postalCodeSource`. When it is `DERIVED`, send no code and let
catalog's `fillPostalCodeFromCentroid`
(`supermarket-location.service.ts:701-728`) derive it with the same rule. In `rank()`,
answer null when two or more codes share the best distance. That turns 48 wrong `14001`
codes into 48 honest gaps.

## 5. Reject

Refuse with 409 `place_already_imported`, the same code `import` uses. Removing an imported
shop is a catalog act on the location, not a queue act on the place.
