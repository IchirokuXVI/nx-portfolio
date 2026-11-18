> **PR:** [#971](https://github.com/IchirokuXVI/nx-portfolio/pull/971)

# 0265: the address rung reads a street the way people write it

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. The store discoveries of that day brought places from
> OpenStreetMap and from the chains' own shop lists beside shops the catalog already held.
> The third rung of the place matcher compares a street with a strict equality after
> `normalizeName`. It misses a shop with no coordinates whose address is written
> `Avda. de Cádiz, 68` when the place says `Avenida de Cádiz 68`. A miss lets a person import
> the place as a second shop. No count of duplicate shops exists yet. It was not re-measured
> on 2026-11-11, Docker was down.
>
> The owner answered the decisions of this plan on 2026-11-11. A shop merge is needed. It is a
> plan of its own, written after the detection query of this plan has counted the duplicates
> that production holds today (D4).
>
> Prerequisite reading: plan `0152` (the three rungs, the 409, provenance of a postal code),
> plan `0193` (the fourth rung, the link), plan `0097` section 3 (a derived postal code),
> `apps/luna-shopper-backend/harvester/src/app/harvest/place-matching.ts`,
> `harvest/matching.ts` (`normalizeName`), `harvest/discovered-place.service.ts` and
> `libs/luna-shopper/osm-places/src/lib/normalize.ts` (`readStreet`).

## Brief for the agent

### Objective

Make the address rung find a shop with no coordinates when its address and the place's street
name the same street in another common spelling, also when the place's postal code is derived.
Make `matchLocations` return every strict candidate, not only those of the first rung that
finds one. Count the pairs of shops that are possibly duplicates already, on a slot and on the
data of production, read only. Nothing links without a person.

### Context

- `matchLocations` (`place-matching.ts`, near lines 133 to 163) tries three strict rungs and
  returns at the first that finds anything (near lines 137 to 148):
  1. The shop carries the place's `externalRef` (`locationsCarryingRef`, near lines 95 to 105).
  2. A shop of the chain within `SAME_SHOP_METRES`, 50 m (near line 13).
  3. A shop with no coordinates, the same trimmed `postalCode`, and
     `normalizeName(location.address) === normalizeName(place.street)` (near lines 150 to 162).
- `suggestLocations` (near lines 179 to 197) calls `matchLocations`, then adds rung 4,
  `SAME_CHAIN_NEAR`, from 50 m to `NEAR_SHOP_METRES`, 250 m.
- `normalizeName` (`matching.ts`, near lines 49 to 56) removes accents, lowercases, and turns
  each run of other characters into one space. **It is also half of `entryNameKey`** (near
  line 69), the identity of a row from a source with no product id. This plan must not
  change it.
- OpenStreetMap gives `addr:street` and `addr:housenumber` joined by a space (`readStreet`,
  `normalize.ts` near lines 277 to 284). `types.ts` near line 57 says 35% of elements carry it.
- `place-matching.spec.ts` (near lines 130 to 141) proves `Avenida de Cádiz 68` meets
  `avenida de cadiz, 68`. No spec has an abbreviation (`Av.`, `Avda.`, `C/`, `Pza.`), a
  dropped `de la`, `s/n`, extra text such as `local 3`, or another order of the number.
- **The postal code can be derived.** A place with no code gets the nearest code, marked
  `DERIVED` (`locate`, `discovered-place.service.ts` near lines 555 to 590). Plan `0152`
  measured that 14 of 18 Córdoba codes share one point and that 48 of 79 places read
  `14001 DERIVED`. Plan `0152` section 4 made a tie answer null. A derived code that is not
  null can still differ from the shop's real code, and then rung 3 fails on the code.
- `PlaceMatchSubject` (near lines 59 to 66) has no `postalCodeSource` and no `city`. The
  entity `discovered_places` has both, and `SupermarketLocationView` has `city` and
  `postalCodeSource`.
- **Which rungs block what, on `origin/dev`:**
  - A hand import answers the 409 `place_matches_location` when `matchLocations` finds a
    candidate (`discovered-place.service.ts`, near lines 803 to 816). That is rungs 1 to 3.
    `force` gets past it.
  - An auto import (`autoImport`, near lines 465 to 486) calls `suggestLocations`, so it reads
    all four rungs. Any candidate, rung 4 included, leaves the place in the queue for a person.
    It does not link and does not import. Its comment says so: "It waits on all four rungs".
  - The places list draws the candidates of `suggestLocations` (`candidatesFor`, near lines
    674 to 691).
- **What the early return does not cause.** Any candidate blocks an import as the list above
  says. A duplicate comes from three paths: rung 3 misses a shop with no coordinates (this
  plan), a hand import with `force`, or a hand import past a rung 4 hint, because the 409 reads
  only the strict rungs. The third path stays open by D3.
- **Production can be read through the admin API.** `GET /v1/admin/catalog/supermarkets` lists
  the chains, and `GET /v1/admin/catalog/supermarkets/:id/locations` lists the shops of one
  chain, a page at a time (`catalog-admin.controller.ts`, near lines 210 and 318). Both are
  `GET`s. The owner prefers the API to SSH for production.

### Target state

1. A new pure function `streetKey(value)` in a new file `harvest/street-key.ts` turns an
   address into a key: `normalizeName`, then a closed table of Spanish street abbreviations
   (section 1), then the small words `de`, `del`, `la`, `las`, `el`, `los` removed.
2. Rung 3 compares `streetKey(location.address)` with `streetKey(place.street)`.
3. **Rung 3 and a derived code (D1).** When the place's `postalCodeSource` is `DERIVED`, rung 3
   needs the same city and the same street key, and it does not compare the postal code. The
   city is compared after `normalizeName`, and a blank city on either side never matches.
   For every other place, rung 3 needs the same postal code and the same street key, as today.
4. **The union (D2).** `matchLocations` returns the union of rungs 1, 2 and 3. A shop that two
   rungs find appears once, with the first rung that found it. The order is by rung, then the
   nearest first, as `suggestLocations` orders its parts today. `suggestLocations` adds rung 4
   to that union, as today.
5. **What blocks (D3).** The 409 of a hand import reads `matchLocations`, so rungs 1 to 3, as
   today. Rung 4 stays a hint for a hand import. An auto import still reads
   `suggestLocations`, so a rung 4 hint still leaves the place in the queue for a person, as
   today. No rung links anything.
6. **The analysis (D4).** The detection query of section 2 runs read only on a slot that holds
   a catalog and against the data of production. The PR quotes both counts.

### Scope

`place-matching.ts`, the new `street-key.ts`, their specs, the fields `postalCodeSource` and
`city` on `PlaceMatchSubject`, and the callers that build a `PlaceMatchSubject`, if a caller
does not pass the two fields already. The body of the 409 can now hold candidates of more than
one rung. Its shape does not change. No migration. No change to `normalizeName` or
`entryNameKey`. Out of scope: a shop merge and its release task (D4).

### Constraints

- A candidate is a hint for a person (plan `0152`). No code path links on a street key.
- The abbreviation table is closed and spelled out. No fuzzy distance, no edit distance.
- A house number is kept in the key. `s/n` is a number of its own, and two shops at `s/n` on
  one street do not meet unless the postal code also matches. For a derived code, two shops at
  `s/n` do not meet on city and street alone.
- `streetKey` is pure and framework free.
- Rung 4 never answers the 409 (D3).
- The analysis on production is a read. It uses `GET` routes or a dump, never a write, and no
  login secret enters the PR, a plan or a commit.

### Action boundaries

- Do not merge or delete a shop. Do not write to any database. The detection query is a
  `SELECT`, and on production it is a `GET`.
- If the admin API does not give the fields that section 2 needs, do not use SSH. Stop and ask
  the owner to supply a dump of `luna_catalog` or to run the query.
- Do not write the merge plan in this PR (D4).

### Progress evidence

The spec output, and the detection query with its counts by chain: one count from a slot whose
catalog holds the shops of a store discovery, and one from the data of production, with the
date and the route that read it.

## 1. The abbreviation table

Each key is the normalized form of what people write, and the value is the word it stands for:

| Written | Key after `normalizeName` | Reads as |
| --- | --- | --- |
| `Av.`, `Avda.`, `Avd.` | `av`, `avda`, `avd` | `avenida` |
| `C/`, `Cl.`, `Cll.` | `c`, `cl`, `cll` | `calle` |
| `Pza.`, `Pl.`, `Plza.` | `pza`, `pl`, `plza` | `plaza` |
| `Ctra.` | `ctra` | `carretera` |
| `Pº`, `P.º`, `Pso.` | `p`, `pso` | `paseo` |
| `Ronda`, `Rda.` | `rda` | `ronda` |
| `Urb.` | `urb` | `urbanizacion` |
| `Gta.` | `gta` | `glorieta` |
| `Trv.`, `Trav.` | `trv`, `trav` | `travesia` |
| `nº`, `núm.`, `no` before a number | `n`, `num`, `no` | removed |

The builder confirms each row against real addresses in the slot's `supermarket_locations`
and `discovered_places`, and drops a row that no address uses. A one letter key (`c`, `p`, `n`) is replaced only
where the table says: `c` and `p` as the first word, `n` directly before a number. A single
letter elsewhere can be part of a name.

Extra text after the number (`local 3`, `bajo`, `esquina ...`) is cut at the first number:
the key keeps the words before it and the number itself. An address that holds a second number,
or whose first word is a number, is uncertain, and on rung 3 it is a hint only (D5).

## 2. The detection query

This query is the analysis that the merge plan of D4 waits for.

On a slot: a self join of `supermarket_locations` on `supermarketId`, read only, that lists
pairs with either both coordinates within 250 m, or one side with null coordinates and the
same postal code or the same city. The address comparison is done on the output in the spec
helper, with `streetKey`, because the table is in TypeScript.

On production, read only, in this order:

1. Sign in as the production admin and read the chains with
   `GET /v1/admin/catalog/supermarkets`.
2. For each chain, read every page of `GET /v1/admin/catalog/supermarkets/:id/locations`.
3. Apply the pair rule of the slot query to those rows in the same TypeScript helper, so both
   counts come from one rule.
4. If the rows of the route lack the coordinates, the address, the postal code or the city, stop
   and ask the owner for a dump of `luna_catalog` or for the owner to run the query.

Quote the count of pairs, by chain, for the slot and for production, in the PR. Keep the list
of pairs out of the PR: it names real shops. Give it to the owner as a file outside the
repository.

Merging two existing shops is **out of scope**. It repoints rows in catalog
(`supermarket_location_items`, `supermarket_location_price_scopes`, `shop_sections`,
`shop_walks`), core (`basket.supermarketLocationId`, `line_settlements`,
`profile_location_preference`) and the harvester (`discovered_places.supermarketLocationId`,
`source_locations`), and it deletes rows a harvest wrote. By `CLAUDE.md` that is a release
task and a plan of its own (D4).

## Tests

- `street-key.spec.ts`: every row of section 1, `Avda. de la Constitución, 12` against
  `Avenida Constitucion 12`, `C/ Mayor 5 local 3` against `Calle Mayor 5`, and two numbers on
  one street that stay apart.
- `place-matching.spec.ts`:
  - Rung 3 finds `Avda. de Cádiz, 68` for `Avenida de Cádiz 68`, and does not find
    `Avenida de Cádiz 70`.
  - A place with a `DERIVED` code finds a shop with another postal code, the same city and the
    same street key. It does not find a shop in another city, or a shop whose city is blank.
  - A place with a code that is not `DERIVED` and another postal code finds nothing on rung 3.
  - A place that rung 1 and rung 2 both find returns the candidates of both rungs, and a shop
    that both rungs find appears once, with rung 1.
  - `suggestLocations` returns the union and then rung 4.
- `discovered-place.import.spec.ts`: a hand import with only a rung 4 candidate imports, and
  a hand import with a rung 3 candidate answers the 409.
- `discovered-place.auto-import.spec.ts`: an auto import with only a rung 4 candidate leaves
  the place in the queue.
- `entryNameKey` gives the same output as before for the fixtures of `matching.spec.ts`.

## Acceptance criteria

- [ ] Rung 3 finds a shop whose address uses an abbreviation of section 1.
- [ ] Rung 3 matches a `DERIVED` code on city and street, and no other code on city alone.
- [ ] `matchLocations` returns the union of rungs 1 to 3, each shop once.
- [ ] The 409 reads rungs 1 to 3 only. Rung 4 blocks no hand import.
- [ ] `normalizeName` and `entryNameKey` are unchanged.
- [ ] The detection counts of a slot and of production are in the PR.
- [ ] No row is written, merged or deleted.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "street"
npx nx test luna-shopper-backend-harvester -t "matchLocations"
npx nx test luna-shopper-backend-harvester -t "suggestLocations"
npx nx affected -t lint test
```

## Decisions

**D1 (owner, answered 2026-11-11):** when the place's code is `DERIVED`, rung 3 needs the same
city and the same street, and it does not compare the postal code (option a). A city with one
`Calle Mayor 5` is one shop, and the check stays strict.

**D2 (owner, answered 2026-11-11):** show all candidates. `matchLocations` returns the union of
every strict rung, not only the first rung that finds something. This answer does not depend on
D3.

**D3 (owner, answered 2026-11-11):** the 409 of a hand import does not fire for rung 4. The
strict rungs 1 to 3 block, as today. Rung 4 stays a hint. An auto import keeps waiting on
rung 4 as it does today, which leaves the place for a person and links nothing.

**D4 (owner, answered 2026-11-11):** a shop merge is needed. It first needs an analysis of the
places that production holds today. The detection query of section 2 is that analysis. The
builder of this plan runs it read only on a slot and on the data of production, and quotes the
counts. The merge and its release task are a plan of their own, written after those numbers.
That plan is out of scope here.

**D5 (owner, answered 2026-11-11):** no more reading rules go into the street key. The more
rules a name gets, the more finicky it is, and it must stay easy to understand and adapt. A
key can still meet two shops of one street: `Avenida 28 de Febrero, 12` and `, 40`, or two
kilometre points of one road. Such a place is flagged for a person. An address is uncertain when
it holds more than one number, or when its first word is a number. A pair with an uncertain side
is not a strict match on rung 3. `matchLocations`, and so the 409 of a hand import, does not
return it. `suggestLocations` returns it as a hint, in the shape of rung 4, so an auto import
waits and nothing links.
