# OpenStreetMap fixtures

Captured payloads for the normalization tests (plan 0038, section 9). No test in
this library touches the network.

| File | The case it exists for |
| --- | --- |
| `overpass-supermarkets.json` | The `out geom` answer a discovery run gets for 3 km around 14013: 23 nodes and 3 ways. The ways carry their outline and bounds, which is where their centre and their footprint come from (backend plan 0176). `ALDI` and `Aldi` share one `brand:wikidata`, ten shops carry no brand tag at all, and several carry no address tags. |
| `overpass-multipolygon.json` | One supermarket mapped as a multipolygon relation, the Dia at Leganés (`relation/3013098`), whose outer ring is drawn as two member ways that have to be joined before it can be measured. No shop around 14013 is mapped as a relation, so it is captured by id. |
| `nominatim-14013.json` | Section 2.8's finding: 14013 answers with a point **and** a bounding box spanning most of Córdoba. The box is in the fixture precisely so the test can assert it is ignored. |

The cases the captures do not hold (an inner ring, an outline that does not
close, a relation with no position, the old `out center` shape) are written as
element literals inside `normalize.spec.ts` rather than added to a fixture.

Tag coverage in the wider 353 element sample section 2.7 measured, which is why
the fixture is patchy rather than uniformly complete:

| Tag | Coverage |
| --- | --- |
| geometry | 100% |
| `brand`, `brand:wikidata`, `shop` | 100% |
| `name` | 99.4% |
| `website` | 70.0% |
| `opening_hours` | 37.4% |
| `addr:street` | 35.1% |
| `addr:postcode` | 32.9% |

## Provenance

Captured on 2026-09-30 (Overpass base 2026-09-29T22:04:30Z) with
`npx nx run luna-shopper/osm-places:capture-fixtures`. Rerun it to refresh them
and commit the diff. The specs name element ids, so after a refresh, check their
expectations against the new capture. The data is ODbL, so anything derived from it that
reaches a user carries "© OpenStreetMap contributors".
