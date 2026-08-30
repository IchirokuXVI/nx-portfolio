# OpenStreetMap fixtures

Captured payload shapes for the normalization tests (plan 0038, section 9). No
test in this library touches the network.

| File | The case it exists for |
| --- | --- |
| `overpass-supermarkets.json` | One `node` (position of its own), one `way` (position only via `center`, so it proves the `out center` request is being read), `Dia` and `Maxi Dia` collapsing to one `brand:wikidata`, an element with no `brand` tag at all (an independent shop), an element with no address tags, and a `relation` with no resolvable position at all, which must be dropped rather than stored at 0,0. |
| `nominatim-14013.json` | Section 2.8's finding: 14013 answers with a point **and** a bounding box spanning most of Córdoba. The box is in the fixture precisely so the test can assert it is ignored. |

Tag coverage in the wider 353 element sample section 2.7 measured, which is why
the fixture is deliberately patchy rather than uniformly complete:

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

Authored from plan 0038 section 2.7 and 2.8, whose numbers came from live runs on
2026-08-27. `npx nx run luna-shopper/osm-places:capture-fixtures` replaces them
with real captures; commit the diff. The data is ODbL, so anything derived from
it that reaches a user carries "© OpenStreetMap contributors".
