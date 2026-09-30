> **PR:** [#548](https://github.com/IchirokuXVI/nx-portfolio/pull/548)

# 0176: a shop knows its size from OpenStreetMap

> Part of the shop map series as rewritten on 2026-09-29. Consumed by velista `0121`, whose
> shop page shows "About 1,200 m²" when the size is known and nothing when it is not.
> Independent of `0168` and `0175`, so it can be built first.
>
> Prerequisite reading: `libs/luna-shopper/osm-places` (`findSupermarkets`, the Overpass
> query `out center tags`, `normalizeOverpassResponse`, and the fixture rule: refresh
> fixtures with `capture-fixtures`, never by hand), the harvester's
> `osm-store-discovery.runner.ts`, and how a discovered place becomes a
> `supermarket_locations` row in catalog.

The user asked for a shop page with the shop's approximate size, "if available and already
recorded from OSM". OpenStreetMap maps many supermarkets as a building outline (a way or a
multipolygon) rather than a point. Discovery already asks for every supermarket around a
postal code, and it throws the outline away because it asks for centres only. This plan
keeps the area of that outline, and nothing else about it.

## Brief for the agent

### Objective

Ask Overpass for the geometry of supermarkets mapped as areas, compute each one's area in
square metres, carry it on the discovered place, and store it on the location as
`footprintM2`, served on `SupermarketLocationView`.

### Context

- **The query** is `nwr["shop"="supermarket"](around:…); out center tags;`. A node has a
  position and no area. A way or a relation has an outline that `out center` reduces to
  its centre.
- **`DiscoveredPlace`** carries `externalRef`, the brand, the name and the position, and the
  harvester writes it into catalog through the location upsert.
- **Discovery runs** are two requests per postal code (`CLAUDE.md`, the harvester section),
  and existing locations are updated when a run meets them again.

### Target state

- The query becomes `out tags geom;`, and the normalizer computes the centre itself for a
  way or a relation (the mean of the outer ring's points, as `out center` does today).
- `DiscoveredPlace.footprintM2: number | null`: the area of a closed outer ring by the
  shoelace formula in a local metric projection, the sum of outer rings minus inner rings
  for a multipolygon, rounded to whole square metres, and null for a node.
- The fixtures are refreshed with `capture-fixtures`, and a spec asserts a known area for
  one way in them within 5 percent of the area OpenStreetMap's own tools show.
- `supermarket_locations.footprintM2 int NULL`, written by the upsert when the place
  carries one, and never overwritten with null by a place that carries none.
- `SupermarketLocationView.footprintM2: number | null`. `openapi.json` and `wire-types.ts`
  are regenerated.

### Scope

Work only in `libs/luna-shopper/osm-places`, the harvester's OSM store discovery runner and
its catalog client call, catalog's location entity, migration, upsert and mapper,
`libs/luna-shopper/contracts`, and the regenerated documents.

Do not touch: chain store finders (Mercadona, LIDL), which publish no outline, the
postal code queue, velista.

### Constraints

- **Still one Overpass request per discovery.** `out tags geom` replaces `out center tags`
  in the same request.
- **An outline is not stored.** Only the number. A building outline for drawing a map is
  not part of this design.
- **A shop inside a larger building** (a node within a mall) gets no size. Nothing guesses.
- `osm-places` stays framework free and never names `process`.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a second Overpass request, storing geometry, or estimating a size for
a place mapped as a point.

### Progress evidence

Per section: the files changed and the spec run. At the end: the refreshed fixture, the
area spec, the migration on an ephemeral Luna slot, one store discovery run over a
Córdoba postal code on that slot with the count of locations that got a size, and the
regenerated documents.

## 1. Not in this plan

- Showing it: velista `0121`.
- Sizes from any source other than OpenStreetMap.
