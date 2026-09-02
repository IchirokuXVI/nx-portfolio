# 0060 A postal code is a point on a map we ship

Two questions this system is about to ask constantly, and cannot answer today:

1. **Which postal code is this device in?** A browser granted location permission hands back a
   latitude and a longitude. A shopping profile stores a postal code. Nothing bridges them.
2. **Which postal codes are within 2 km of this one?** The profile expansion in `0062` is entirely
   this question, and the store screen in `apps/velista/plans/0059` is only worth drawing once a
   profile holds more than the one code its owner typed.

Neither has an answer we are allowed to buy from an API, so this plan ships the data instead: a
table of postal code centroids, loaded by a migration, owned by catalog. It is the foundation
under `0061`, `0062` and `0063`, and it is deliberately the least interesting plan in the set.

Depends on `0012` (the catalog and its locations) and `0049` (the profile that holds postal
codes). Nothing in it depends on the harvester.

## 1. Why this is not an API call

`OsmPlacesClient` already geocodes **forward**: `geocodePostalCode('14013', 'es')` returns the
point at that code's centre, and `0038` section 2.8 is the finding that the bounding box beside it
is useless. What the client has no method for is either question above, and the reason is not that
nobody got round to writing it.

- **There is no reverse method, and adding one is the wrong move.** Nominatim has `/reverse`, so a
  device's point could be turned into an address carrying a postcode. That is one network call, to
  a volunteer funded service, on the critical path of a user granting a permission, rate limited
  to one request per second across the whole deployment, and it means **posting a user's live
  coordinates to a third party**. Every one of those is a reason on its own.
- **"Postcodes near a point" has no query at all.** Not in Nominatim, not in Overpass. The only way
  to synthesise it is to reverse geocode a grid of sample points around the centre and collect the
  distinct codes, which is precisely the bulk geocoding Nominatim's usage policy forbids, as
  `osm-places.client.ts` records in its own doc.

A shipped dataset answers both with a local query. No network, no rate limit, no third party, no
failure mode in a user facing path, and the device's coordinates never leave our own process.

## 2. The table, and who owns it

**`postal_code_points`** (catalog):

- `country` (varchar(2), ISO 3166-1 alpha-2, lowercase)
- `postalCode` (varchar(16))
- `latitude` (double precision)
- `longitude` (double precision)
- primary key (`country`, `postalCode`)
- `ix_postal_code_points_geo` on (`latitude`, `longitude`)

No `id`, no `BaseEntity`, no timestamps. This is reference data with a natural key, replaced
wholesale by a migration and never written by a service. A surrogate key would imply somebody
edits rows, and nobody does.

**Catalog owns it**, and `ScopeResolverService` already settled why this class of knowledge lives
there rather than in core:

> It lives in catalog and not in core, beside the scopes it resolves to. Core stores what the user
> typed; this is the half that knows what a postal code means this week.

Postal code geography is the same kind of fact. Core stores the codes a profile holds; catalog
knows where they are. Core asks over NATS, exactly as it already asks for scopes.

## 3. Where the data comes from

**GeoNames**, whose per country postal code export is the only openly licensed dataset with the
shape this needs. The Spanish file carries roughly 11,000 distinct codes once reduced, a figure to
confirm against the real download rather than to trust from this sentence.

- **Licence: CC BY 4.0**, so this is a second attribution obligation beside OSM's ODbL. Follow the
  pattern `osm-places` set and export a `GEONAMES_ATTRIBUTION` constant next to the data, so the
  obligation travels with the thing rather than living in a comment somebody later deletes.
- **A new library, `@portfolio/luna-shopper/postal-codes`**, framework free by the same hard
  constraint as `mercadona` and `osm-places`: no TypeORM, no Nest, no database. It holds the
  reduced dataset, the attribution constant, and the bounding box arithmetic in section 5.
- **The raw download is not committed. The reduced file is.** The raw export carries one row per
  place name per code, so a code covering six villages appears six times, and it carries a dozen
  columns this system will never read. The committed artifact is `country,postalCode,lat,lon`,
  distinct on the key.
- **A `refresh-dataset` target does the reduction**, the way each source library already has
  `capture-fixtures`. Never reduce it by hand, and never hand edit the reduced file: it is
  generated output, and the generator is the only thing allowed to write it.

## 4. How it reaches every environment

This is the requirement that decides the mechanism, so it goes before the mechanism.

There are `seed` targets on auth, catalog and core, and **nothing in any cluster runs them**. They
are a developer convenience. What runs automatically, everywhere, with no operator action, is the
**migration Job**: one per service, executing `node migrate.js`, a second webpack entry point
emitted beside the service bundle.

Two things follow.

- **The dataset ships as a migration**, so a fresh cluster gets it as part of the release that
  needs it: in compose, in a dev slot, in staging and on a brand new VPS, with no extra line in
  `README-new-cluster.md`.
- **The data must be bundled, not read from disk.** `migrate.js` is a webpack bundle, and the
  backend images are assembled from `dist` with hand written per service manifests, so a data file
  sitting beside the source is simply not in the image. The migration therefore **imports** the
  dataset as a module and webpack inlines it. A few hundred KB of `postalCode,lat,lon` is an
  acceptable addition to a migration bundle and needs no asset plumbing at all.

The loading migration is **idempotent**: it truncates and reloads rather than inserting, so a
dataset refresh is a new migration running the same code against a newer module, and re running it
is harmless. Insert in batches, so no single statement carries 11,000 tuples.

## 5. The two reads

Both live in catalog, both are pure SQL plus arithmetic, and **neither needs PostGIS**.

```
nearestPostalCode(point, country, maxDistanceMetres) -> { postalCode, distanceMetres } | null
postalCodesWithin(postalCode, country, radiusMetres) -> { postalCode, distanceMetres }[]
```

The method is a bounding box the btree index can serve, then an exact distance over the survivors:

```
latDelta = radiusMetres / 111_320
lonDelta = radiusMetres / (111_320 * cos(latitude))
```

Filter on the box, then sort by `distanceMetres` from `@portfolio/luna-shopper/osm-places`, which
is already written and already tested. Reusing it rather than writing a second haversine is the
point: there is one definition of distance in this system.

**Why not `cube` plus `earthdistance`**, which ship in the stock `postgres:16-alpine` image and
would give a GiST index: at 11,000 rows the bounding box scan is already trivial, and the
extension buys nothing until the table is two orders of magnitude larger. **Why not PostGIS**: a
different image for catalog's Postgres in the compose file, in both values files and on two VPSs,
for a query a btree already answers instantly.

The second read takes a postal code rather than a point on purpose. Its caller in `0062` has a
code, and making it geocode first would put the centroid lookup in two places.

## 6. What this table is not

**It is a centroid, never a boundary.** A postal code covers an area, sometimes a large and
strangely shaped one, and this table reduces it to a single point. The error that introduces is
real and has to be said in three places rather than assumed away:

- **"Which code is this device in" is approximate.** The nearest centroid to somebody standing at
  the edge of a large rural code may belong to the neighbouring code. `maxDistanceMetres` exists so
  the answer can be "we don't know" rather than a confident wrong code, and the frontend in
  `apps/velista/plans/0058` shows the resolved code for confirmation rather than adopting it
  silently.
- **"Which codes are within 2 km" is centroid to centroid.** Two adjacent codes whose centroids sit
  2.5 km apart are neighbours in reality and not in this query. That is acceptable for the feature
  it serves, which is widening the net a little, and unacceptable as an authoritative statement
  about geography.
- **It never overrides a postcode we were told.** `0061` uses it as a fallback for locations whose
  source gave no postal code, and never to correct one that did.

Radii are configuration from the start, not constants, because the right value in central Madrid
and the right value in rural Córdoba are unlikely to be the same number. `0062` section 4 owns the
default.

## 7. Contracts and endpoints

Two new NATS messages in `libs/luna-shopper/contracts` under the catalog domain, with their zod
schemas: `ResolveNearestPostalCodeRequest` / `NearestPostalCodeView` and
`ListNearbyPostalCodesRequest` / `NearbyPostalCodesView`.

**No gateway route in this plan.** Nothing user facing calls either read directly: `0062` calls
them from core, and `0058` reaches the first through a core route that plan defines. A public
endpoint here would create a geocoding service nobody asked for.

## 8. Migrations

One migration in catalog: create the table, create the index, load the dataset in batches. Its
`down` drops the table.

## 9. Exit criteria

- `postal_code_points` exists in a fresh compose stack, a dev slot and a cluster with no step
  beyond `migration:run`, and `README-new-cluster.md` needs no new line.
- The reduce script regenerates the committed file byte for byte from a fresh GeoNames download.
- `GEONAMES_ATTRIBUTION` is exported beside the data and referenced wherever the data is shown.
- Both reads have unit tests over a small fixture, including the two cases that matter: a point
  beyond `maxDistanceMetres` returns null, and a radius catching nothing returns an empty array
  rather than the code it was asked about.
- The bounding box and the exact distance agree on a hand checked pair of real Spanish codes.
- `npx nx run luna-shopper-backend-catalog:build` and `test` pass.
