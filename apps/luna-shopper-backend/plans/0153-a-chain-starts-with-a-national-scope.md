# 0153: a chain starts with a national scope

> Found by `0150` (report item P1.2, "Things I did that the plan did not script", and
> finding 13). Prerequisite reading: `0049` section 3.1 (default scopes), `0111` section 8,
> and in the code `supermarket.service.ts` in catalog and `findOrCreateChain` in the
> harvester's `discovered-place.service.ts`.

To put an El Jamón leaflet and three new chains into the catalog, the operator had to create
Lidl, Dia and Deza by hand, then create a `NATIONAL` scope for El Jamón, because its default
scope is one shop's `STORE` scope. A chain created in the back office gets no default scope
at all, and the gateway cannot set one. OpenStreetMap places cannot create a chain. The
sources page offers an `osm-places` adapter whose row does nothing, and plan `0150` told the
operator to enable it.

## Brief for the agent

### Objective

Give every chain a default `NATIONAL` scope from the moment it exists, let the gateway change
a chain's default scope, let an operator create a chain while importing an OpenStreetMap
place, correct the El Jamón seed, and stop offering `osm-places` as a source row.

### Context

- `catalog/src/app/catalog/supermarket.service.ts:51-68` hard codes
  `defaultPriceScopeId: null` in `create`. Only `update` (`:92-102`) sets it, and the
  gateway's `UpdateSupermarketDto` has no such field, so nothing can reach it.
- The seed sets El Jamón's default to its only scope
  (`catalog/src/app/db/reference/seed-reference-catalog.ts:110`), which is `STORE`
  (`db/reference/stores.ts:23`). SuperCash is built the same way.
- The seed's El Jamón Wikidata key is `Q116893318`, commented as the operating company from
  the receipts (`stores.ts:21-22`). OpenStreetMap carries the brand key `Q6135982`, so chain
  matching falls back to the name (`discovered-place.service.ts:118-128`).
- The seed's SuperCash is "Deza Calidad" (`stores.ts:36-37`, `Q117761543`), and the DEZA
  site lists "SuperCash (Quemadas)" as shop C1. The hand made "Deza" chain from `0150`
  therefore duplicates part of SuperCash. Plan `0154` handles the DEZA shops.
- `findOrCreateChain` refuses OpenStreetMap (`discovered-place.service.ts:622-630`), because
  `osm-places.printedLocale` is null
  (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:381-389`).
- OpenStreetMap is always asked and is not a source row
  (`postal-code-discovery.service.ts:198-201`). The back office still offers `osm-places` in
  the adapter picker (`libs/luna-shopper-admin/feature-harvest/src/lib/sources-page.ts:49`).
  That picker is the admin half and belongs to admin plan `0034`. The adapter list the
  picker reads, if it comes from the backend, is this plan's.
- The reference seed rewrites names and keys on every deploy and upserts by id.

### Target state

- `create` makes the chain and a `NATIONAL` scope named after it, sets that scope as the
  default, and does both in one transaction.
- `PATCH /v1/admin/catalog/supermarkets/{id}` accepts `defaultPriceScopeId`, which must name
  a scope of that chain.
- The seed gives El Jamón and SuperCash a `NATIONAL` default beside their `STORE` scopes.
- El Jamón's Wikidata key is the brand's key, after you check on Wikidata which QID is the
  brand.
- `import` of an OpenStreetMap place accepts `newChain: { name, locale }` and creates the
  chain (with its national scope) when no chain matches.
- No backend list offers `osm-places` as an adapter a source row can use. Plan `0150` step 2
  no longer tells the operator to enable it.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/catalog/supermarket.service.ts` and its spec
- `apps/luna-shopper-backend/catalog/src/app/db/reference/` (seed and its spec)
- `apps/luna-shopper-backend/gateway/src/app/catalog/` (the update DTO and controller)
- `apps/luna-shopper-backend/harvester/src/app/harvest/discovered-place.service.ts` (the
  `newChain` branch) and its spec
- `libs/luna-shopper/contracts` for the DTOs and messages, plus the regenerated `openapi.json`
  and `wire-types.ts`
- `apps/luna-shopper-backend/plans/0150-populating-the-catalog-by-hand-and-what-it-shows.md`,
  line 178 only

Do not touch: price policies, `effective-price.ts`, scope resolution for shoppers, or the
admin app.

### Constraints

- A seed change must be safe on a database that already holds the old scopes. The seed adds
  the national scope and moves the default. It does not delete the `STORE` scope or any price.
- A chain's default scope is always one of its own scopes.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a migration that rewrites existing chains' defaults on deployed
environments, deleting a scope, or merging the "Deza" chain into SuperCash.

### Progress evidence

- A catalog spec: `create` makes a chain with a national default in one transaction, and
  rolls both back on failure.
- A gateway spec: `defaultPriceScopeId` of another chain's scope answers 400.
- `reference-catalog.spec.ts` asserts the national defaults and the new Wikidata key.
- A harvester spec: an OpenStreetMap import with `newChain` creates the chain, and one
  without it still answers the current refusal.
- Tests pass for catalog, gateway and harvester, and the OpenAPI and wire types are
  regenerated.

## 1. Existing chains

Chains created before this plan keep whatever default they have. A chain with no default
gets one only when an operator sets it through the new field. The seed fixes the two seeded
chains that need it. Record in the PR how many chains on staging have no default, from a
read of the admin list, so the operator knows the size of the hand work.

## 2. The Wikidata key

Look up both QIDs on Wikidata. Keep whichever is the supermarket brand, not the operating
company, and write the other one in the comment beside it. If neither is the brand, stop and
ask.
