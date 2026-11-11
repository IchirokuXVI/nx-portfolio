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
> Prerequisite reading: plan `0152` (the three rungs, the 409, provenance of a postal code),
> plan `0193` (the fourth rung, the link), plan `0097` section 3 (a derived postal code),
> `apps/luna-shopper-backend/harvester/src/app/harvest/place-matching.ts`,
> `harvest/matching.ts` (`normalizeName`), `harvest/discovered-place.service.ts` and
> `libs/luna-shopper/osm-places/src/lib/normalize.ts` (`readStreet`).

## Brief for the agent

### Objective

Make the address rung find a shop with no coordinates when its address and the place's street
name the same street in another common spelling. Add a read only query that counts the pairs
of shops that are possibly duplicates already. Nothing links without a person.

### Context

- `matchLocations` (`place-matching.ts`, near lines 133 to 163) tries three strict rungs and
  returns at the first that finds anything (near lines 137 to 148):
  1. The shop carries the place's `externalRef` (`locationsCarryingRef`, near lines 95 to 105).
  2. A shop of the chain within `SAME_SHOP_METRES`, 50 m (near line 13).
  3. A shop with no coordinates, the same trimmed `postalCode`, and
     `normalizeName(location.address) === normalizeName(place.street)` (near lines 150 to 162).
- `suggestLocations` (near lines 179 to 197) adds rung 4, `SAME_CHAIN_NEAR`, from 50 m to
  `NEAR_SHOP_METRES`, 250 m.
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
- **What the early return does not cause.** Any candidate blocks an import. A hand import
  answers 409 (`discovered-place.service.ts`, near lines 803 to 816) and a trusted import
  waits (near lines 478 to 485). A duplicate comes from three paths: rung 3 misses a shop with
  no coordinates (this plan), a hand import with `force`, or a hand import past a rung 4 hint,
  because the 409 reads only the strict rungs.

### Target state

1. A new pure function `streetKey(value)` in a new file `harvest/street-key.ts` turns an
   address into a key: `normalizeName`, then a closed table of Spanish street abbreviations
   (section 1), then the small words `de`, `del`, `la`, `las`, `el`, `los` removed.
2. Rung 3 compares `streetKey(location.address)` with `streetKey(place.street)`.
3. Rung 3 treats a place whose code is `DERIVED` as D1 decides.
4. A read only SQL query in the PR body, run on a slot that holds a catalog, quoted with its
   count.

### Scope

`place-matching.ts`, the new `street-key.ts`, their specs, and the field `postalCodeSource`
(and `city` if D1 needs it) on `PlaceMatchSubject`. No migration. No change to
`normalizeName`, `entryNameKey` or the 409 body, unless D2 or D3 says so.

### Constraints

- A candidate is a hint for a person (plan `0152`). No code path links on a street key.
- The abbreviation table is closed and spelled out. No fuzzy distance, no edit distance.
- A house number is kept in the key. `s/n` is a number of its own, and two shops at `s/n` on
  one street do not meet unless the postal code also matches.
- `streetKey` is pure and framework free.

### Action boundaries

- Stop and ask before rung 3 changes for a `DERIVED` code, until D1 is answered.
- Stop and ask before you change what `matchLocations` returns or what the 409 reads (D2, D3).
- Do not merge or delete a shop. Do not write to any database. The detection query is a
  `SELECT`.

### Progress evidence

The spec output, and the detection query with its count, run read only on a slot whose
catalog holds the shops of a store discovery.

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
the key keeps the words before it and the number itself.

## 2. The detection query

A self join of `supermarket_locations` on `supermarketId`, read only, that lists pairs with
either both coordinates within 250 m, or one side with null coordinates and the same postal
code. The address comparison is done on the output in the spec helper, with `streetKey`,
because the table is in TypeScript. Quote the count of pairs, by chain, in the PR.

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
- `place-matching.spec.ts`: rung 3 finds `Avda. de Cádiz, 68` for `Avenida de Cádiz 68`, does
  not find `Avenida de Cádiz 70`, and the `DERIVED` case as D1 decides.
- `entryNameKey` gives the same output as before for the fixtures of `matching.spec.ts`.

## Acceptance criteria

- [ ] Rung 3 finds a shop whose address uses an abbreviation of section 1.
- [ ] `normalizeName` and `entryNameKey` are unchanged.
- [ ] The detection query and its count are in the PR.
- [ ] No row is written, merged or deleted.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "street"
npx nx test luna-shopper-backend-harvester -t "matchLocations"
npx nx affected -t lint test
```

## Decisions

**D1. What rung 3 needs when the place's code is `DERIVED`.**

- (a) The same `city` and the same street key, with no postal code.
- (b) The same street key alone, as a rung 4 hint and not a strict candidate.
- (c) No change: a derived code must still be equal.

Recommended: (a). A city with one `Calle Mayor 5` is one shop, and the check stays strict.

**D2. Return the union of all rungs instead of the first.** A person sees more candidates, and
the body of the 409 changes. Recommended: yes only if D3 is yes.

**D3. The 409 of a hand import also reads rung 4.** It closes the third path to a duplicate,
and every import beside a shop within 250 m then asks for `force`. Plan `0193` chose not to.
Recommended: no, unless the detection query shows duplicates that came from that path.

**D4. A shop merge plan and its release task.** Recommended: decide after the detection query
gives the number of pairs.
