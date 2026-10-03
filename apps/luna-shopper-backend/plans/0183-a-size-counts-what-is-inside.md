# 0183: a size counts what is inside

> Found by the audit of the first catalog on local slot 1, 2026-10-03.
>
> **Needs plan `0177` first.** `0177` gives a queue row its `sizeUnit` and makes the gate
> compare through it and through the pack count. This plan changes the same readers and
> the same gate. If `0177` has not landed, stop and say so.
>
> Prerequisite reading: plans `0162` and `0177`, plan `0096` section "Base units only",
> `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`readPackCount`) and `units.ts`,
> `libs/luna-shopper/deza/src/lib/size.ts` (`COUNT_TIMES_QUANTITY`, `DEZA_SIZE_UNITS`),
> `libs/luna-shopper/eljamon/src/lib/size.ts`, `harvester/src/app/harvest/run-report.sink.ts`
> (`fillPackCounts`), and `libs/luna-shopper/tools/curation/suggestions/src/{decision.mjs,rules.mjs,prompt.md}`.

Three readers write a number that is not a size, and nothing says which units a product
can be measured in.

## Brief for the agent

### Objective

Stop a chain's placeholder, a dimension and a capacity from being stored as a product's
size or pack count, and make every sized product use grams, millilitres or a count.

### Context

Read from slot 1 on 2026-10-03:

- **395 Mercadona products are sized `1 UNIT`.** Mercadona's API answers `unit_size: 1` and
  `size_format: "ud"` for a pack of pads, wipes or gloves. The real count is not in those
  two fields. Deza and El Jamón print the count, so one product became two: Evax
  "Compresa super Liberty con alas" at 1 and at 10, Bosque Verde "Papel higiénico húmedo WC"
  at 1 and at 100.
- **9 products took a pack count from a dimension.** Deza's `COUNT_TIMES_QUANTITY` accepts
  any word of 1 to 10 letters as the unit, so "125x157 cm" gives 125 and "5x1.2 m" gives 5.
  El Jamón's parser multiplies count by amount for `m`, `cm` and `mm` too.
- **174 products use `LITER` and 25 use `KILOGRAM` with a size**, beside 13,900 in grams
  and millilitres. `itemFrom` defaults to `mapSizeFormat(entry.sizeFormat)`, so a Mercadona
  row printed in `kg` or `l` creates a product in that unit. No validator restricts the
  unit. The same product in two units never matches itself.
- **21 of the `LITER` products are capacities**: a 25 litre bin, a 70 litre storage box.
  That number says how big the object is. It is not what the shopper gets more of.

### Target state

1. **Mercadona, a count of one.** When `size_format` is `ud` and `unit_size` is 1, the
   adapter reads the real count from the payload. Decide the field from captured fixtures
   of three products (a pack of pads, a pack of wipes, a single object such as a razor),
   and write the rule beside `readPackCount`. When the payload holds no count, write
   `unitSize: null`. A size of 1 that the chain did not mean is never written.
2. **A pack count needs a unit of content.** Deza's `COUNT_TIMES_QUANTITY` and El Jamón's
   `QUANTITY` prefix read a count only when the unit is a weight, a volume or a count. A
   length (`m`, `cm`, `mm`, `metros`) is a dimension: no pack count, no multiplied size.
   The same check goes into the LIDL and Carrefour readers if a fixture shows the case.
3. **A dimension or a capacity is not a size.** A row whose printed format is a length
   carries `unitSize: null`. `prompt.md` says that the capacity of a container (a bin, a
   box, a bottle sold empty) is never the size, and that such a product is `UNIT` with no
   size.
4. **Base units.** One shared helper in `libs/luna-shopper/contracts`, `toBaseUnit(size, unit)`,
   answers grams or millilitres. `itemFrom` in both decision services uses it, so a row in
   `kg` or `l` creates a product in `GRAM` or `MILLILITER` with the size multiplied by
   1000. `KILOGRAM` is written only with a null size, for a product sold by weight (plan
   `0181`). `LITER` and `PACK` are never written by a create.
5. **The gate says so.** `validateDecision` refuses a CREATE with a sized `KILOGRAM`, any
   `LITER` or any `PACK` with a new code `NOT_A_BASE_UNIT`, and `prompt.md` names the code
   and the rule. The gateway DTOs and the catalog service do not change: an admin can still
   write any unit by hand.
6. `fillPackCounts` is unchanged, and a spec shows it no longer receives a count from a
   dimension.

### Scope

Work only in `libs/luna-shopper/{mercadona,deza,eljamon,lidl,carrefour}` (size and
normalize files and their fixtures), `libs/luna-shopper/contracts`, the harvester's two
decision services, and `libs/luna-shopper/tools/curation/suggestions`.

Do NOT touch: the `unit_of_measure` enum, catalog's item code, the alias key, `externalId`,
`sizeFormat`, velista.

### Constraints

- `sizeFormat` stays the printed text for every row. It is part of the alias key.
- Refresh fixtures with each library's `capture-fixtures` target, never by hand.
- Three specs pin wording in `prompt.md` (`Brand never separates items`, `groupRef`,
  `rule`). Keep them passing.
- Only make the changes this plan names. Do not convert existing products: plan `0186`
  does.

### Acceptance criteria

- [ ] A Mercadona spec on the fixtures: the pad pack answers its real count, the razor
      answers `unitSize` null or 1 as the fixture justifies, and the rule is stated in the
      PR with the fixture's fields quoted.
- [ ] A Deza spec: "125x157 cm" and "5x1.2 m" answer `packCount` null and `unitSize` null.
      "6x33 cl" still answers `packCount` 6.
- [ ] An El Jamón spec for the same two shapes.
- [ ] A harvester spec: a create from a row of `0.25 kg` writes 250 `GRAM`, and from `1.5 l`
      writes 1500 `MILLILITER`, on both routes.
- [ ] A curation spec: a CREATE of 1 `LITER` is refused with `NOT_A_BASE_UNIT`. A CREATE of
      `KILOGRAM` with a null size passes.

### Action boundaries

Proceed with code, fixtures and specs. Stop and ask if Mercadona's payload holds no count
for the pad pack: the owner then decides between a null size and a count read from the
name.

### Progress evidence

Report each criterion with its spec output.
