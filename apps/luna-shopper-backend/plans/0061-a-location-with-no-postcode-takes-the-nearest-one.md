# 0061 A location with no postcode takes the nearest one

Two thirds of the supermarkets OpenStreetMap knows about carry no `addr:postcode` tag. That
number is recorded in `osm-places/src/lib/types.ts` as the reason discovery is a radius and never
a postcode search, and it was treated there as a fact about _searching_. It is also a fact about
_storing_, and this is the plan for that half.

Depends on `0060` (the centroid table and its `nearestPostalCode` read). Everything in
`apps/velista/plans/0059` depends on this, in a way that is easy to miss, so section 2 says how.

## 1. What actually happens today

`SupermarketLocation`'s own doc describes a fallback and a flag:

> where it is not [known] (two thirds of OSM stores carry no postcode) it takes the scope of the
> postal code the discovery run was centred on, and the location is flagged for review.

**Neither exists.** `DiscoveredPlaceService.import()` passes the value through verbatim:

```ts
postalCode: place.postalCode,
country: null,
```

so a place with no postcode becomes a location with `postalCode: null`, and there is no review
flag column on the entity at all. The doc is describing an intention that was never built. This
plan makes it true, by a better route than the one the doc names: the nearest centroid beats the
run's centre, because a run's centre is one point for a whole city and a centroid is per store.

The hardcoded `country: null` beside it is a second, smaller gap, and section 4 closes it because
the centroid lookup needs a country to be correct.

## 2. Why a null postcode breaks two things

**Price scope resolution.** `ScopeResolverService`'s first rung is literally

```ts
where: {
  postalCode: In(postalCodes);
}
```

A location with a null postcode can never match it, so the chain it belongs to falls through to
rung two or three: its `NATIONAL` scope, or the owner set default with the result **flagged
approximate**. The user has a Mercadona 400 metres away and is shown a price labelled as somebody
else's city, because we hold that store's coordinates and not its postcode.

**The store screen.** `apps/velista/plans/0059` answers "which supermarkets are in my postal
codes" with the same column. Two thirds of every store ever imported would simply not appear on
the screen built to show them. This is the dependency worth stating loudly: **the screen plan and
the dataset plan are not independent, and the coupling hides inside the import step rather than in
either plan's description.**

## 3. Catalog fills it, not the harvester

The obvious place is `import()`, which is where the null originates. The right place is
`SupermarketLocationService.create()`, in catalog.

- **Every creator gets the behaviour.** A hand entered supermarket typed by an admin has the same
  gap, and fixing it in the harvester fixes it for one caller.
- **The centroid table lives in catalog.** Filling it from the harvester means the harvester asks
  catalog for a centroid, then sends it back to catalog on the create: two round trips to move one
  fact across a boundary and back.
- **The harvester stays ignorant of geography**, which is what it is today.

So: on create, when `postalCode` is absent **and** `latitude` and `longitude` are present, catalog
resolves the nearest centroid and stores it. The same rule runs on update, but only when the
update leaves the postcode absent; an update that sets one is a statement.

## 4. The rules, in order of how easy they are to get wrong

**A source postcode is never overridden.** If OSM gave us one, it wins, even when it disagrees with
the nearest centroid. The centroid is an approximation of a boundary and the tag is somebody's
observation of a sign on a building. This is `0060` section 6's third bullet, and it is the rule
this plan exists to obey rather than to bend.

**A guess beyond a bounded distance is not made.** `nearestPostalCode` takes `maxDistanceMetres`
for this reason. A store in the middle of nowhere, whose nearest centroid is 30 km away, keeps a
null postcode. A wrong postcode is worse than none: none produces an approximate price that says
it is approximate, and wrong produces a confident price for the wrong scope.

**The country stops being null.** The lookup is keyed on `(country, postalCode)`, and a centroid
search with no country would search Spain and Bolivia together. `DiscoveredPlace` gains a
`country` column written by `StoreDiscoveryRunner` from its own `StoreDiscoveryInput.country`,
which it already has and currently discards, and `import()` passes it through instead of `null`.

**The price scope is not touched.** A location with no named scope still gets a `STORE` scope of
its own, exactly as today. Deriving a postcode changes what the location _says about where it is_,
not what it prices against, and re resolving scopes from a derived postcode is a larger change
that belongs to whoever picks up chain specific scope resolution.

## 5. The column the entity doc already promised

**`postalCodeSource`** on `SupermarketLocation`, an enum, not a boolean:

| Value     | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `SOURCE`  | The discovery source gave it.                                            |
| `DERIVED` | We took the nearest centroid. This is the review flag the doc describes. |
| `MANUAL`  | A person typed it, and it outranks a later re discovery.                 |

Nullable, alongside a null `postalCode`, so "we have no idea" stays expressible. An enum rather
than `isDerived: boolean` because `MANUAL` and `SOURCE` behave identically today and will not
forever: a person correcting a bad OSM tag should not have their correction overwritten the next
time that place is re discovered, and a boolean cannot express that.

The value is what an eventual admin queue (backlog `0009`) sorts on, and what lets a support
question about a wrong price be answered without guessing.

## 6. Backfilling what is already there

A migration in catalog, after the centroid table exists: for every location with a null
`postalCode` and non null coordinates, resolve the nearest centroid within the bound and write it
with `postalCodeSource = 'DERIVED'`. Existing rows with a postcode get `SOURCE`, since that is
where every current value came from.

**This changes prices that are already being shown**, and that is the point rather than a side
effect. Locations that fell to the approximate rung start matching rung one, so a user whose
profile names a covered postal code moves from "prices shown for Madrid" to a real local price. It
is an improvement and it is a visible behaviour change, so it belongs in the release notes rather
than only in this file.

## 7. Contracts and endpoints

`SupermarketLocationView` gains `postalCodeSource`, so the eventual queue can read it and so the
value is not invisible from outside catalog. `CreateSupermarketLocationRequest` gains an optional
`country` on the import path.

No new gateway route. **The OpenAPI document changes** because a response DTO changed, so
regenerate and commit it in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 8. Migrations

Catalog: add `postalCodeSource`, backfill it, backfill derived postcodes. Harvester: add `country`
to `discovered_places`.

## 9. Exit criteria

- A discovered place with no postcode, imported, produces a location whose `postalCode` is the
  nearest centroid and whose `postalCodeSource` is `DERIVED`.
- A discovered place **with** a postcode produces `SOURCE` and the source's value, even when a
  different centroid is nearer. There is a test that asserts precisely this.
- A place whose nearest centroid is beyond the bound keeps a null postcode and a null source.
- The backfill is re runnable and touches no row that already has a postcode.
- `ScopeResolverService` resolves a chain to rung one for a backfilled location, proven by a test
  that fails before the backfill and passes after.
- `openapi.json` is regenerated and committed; `luna-shopper-backend-gateway:test` is green.
- `npx nx run-many -t build test -p luna-shopper-backend-catalog,luna-shopper-backend-harvester,luna-shopper-backend-gateway` passes.
