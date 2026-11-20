> **PR:** [#939](https://github.com/IchirokuXVI/nx-portfolio/pull/939)

# 0250: Carrefour and El Jamón read the sizes they print

> Found on 2026-11-06 by a scheduled walk of every chain on Luna slot 4 (locked with
> `--keep-data`): Carrefour run `04203ecd-910e-4aa2-94ef-7e7457c93c6d` (15,883 products) and El
> Jamón run `cd99272b-76f8-4645-820d-1ea425cbc37d` (6,798 products). Four parser gaps. Carrefour
> reads a brand number as a pack count, misses the pack phrase with no `de`, and drops every size
> on a card priced per unit; El Jamón drops the size of one unit when its size field says only
> `pk-3`. Together they leave about 1,500 rows with no size although the name prints one, and
> write one size about 1,900 times too large.
>
> Prerequisite reading: plan `0090` (the Carrefour adapter), plan `0162` (how many are in the
> pack), plan `0169` (the El Jamón adapter), plan `0177` (a source size states its own unit),
> plan `0183` (a size counts what is inside), `libs/luna-shopper/carrefour/src/lib/listing.ts`
> (`CONTAINER`, `PACK`, `TRAILING_SIZE`, `splitCardName`, `statedSize`, `packCountIn`,
> `quantityOf`, `readCard`) with `listing.spec.ts`, `libs/luna-shopper/eljamon/src/lib/size.ts`
> (`splitSize`, `PACK_ONLY`) with `size.spec.ts`, `libs/luna-shopper/eljamon/src/lib/listing.ts`,
> and `packCountOf`, `PACK_COUNT_MAX` in `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`.

## Brief for the agent

### Objective

Fix the four gaps of section 1 in the two parsers so the rows they name carry the size and pack
count the chain printed, with the size of the whole pack as plan `0162` states it, and no other
row changes.

### Context

1. **A number before a container is taken as a count, unbounded.** `PACK` accepts
   `(\d+)?\s*<container>\s+de\s+`, and `quantityOf` multiplies that number into the size with no
   bound. `Polvorones de almendra artesanos 1880 estuche de 310 g.` thus reads 1880 × 0.31 kg =
   582.8 kg. "1880" is the brand. `packCountOf` already refuses a count above `PACK_COUNT_MAX`
   (1,000), so `packCount` is null while the size took the multiplication anyway.
2. **`pack N <noun>` with no `de` is not a pack phrase.** `Cerveza Amstel 100% Malta pack 28
   latas 33 cl.` keeps `pack 28 latas` in the name, reads 330 ml, and has no count, while its
   price (20.72) is for 28 cans. 257 Carrefour rows print `pack <number>`: the 64 where it is
   part of `sizeFormat` have a count, and the 193 where it stayed in the name have none.
3. **A card priced per unit drops a weight or a volume.** `splitCardName` refuses a trailing
   size whose family is not the card's `measure_unit`, so a wine bottle priced in `€/ud` loses
   `75 cl.`. Measured, Carrefour rows with no size whose name ends in a size, by the word and the
   label: `cl` with `€/ud` 556, `g` with `€/ud` 200, `ml` with `€/ud` 120, `ml` with `€/kg` 82,
   `l` with `€/ud` 25, `g` with `€/l` 11, others 15. The family check exists for a misread: its
   comment names `Café molido 500 g` on a card measured in `ud` as one. On 2026-11-06 the
   `€/ud` cards with a content word were 901 rows, nearly all bottles, jars and tins priced per
   piece, so the check now costs far more sizes than the misreads it prevents (D1 below decides
   that trade).
4. **El Jamón states the count and not the size.** 731 rows have a size field of the shape `pk-3`
   or `pk 3` and no `unitSize`; 334 of the El Jamón rows with no size print it at the end of the
   name instead: `paté clásico 75g` with `pk-2`, `palomitas mantequilla 100g` with `pk-3`.

- Rows not in scope here: DEZA has 305 rows with a size in the middle of the name and 6,504 with
  none at all; DIA's `pack 24 x 1 L` for a 24 × 33 cl beer pack is the chain's own misprint. Plan
  `0249` is the net for misprints.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and a walk of each chain
on an ephemeral slot shows the counts of section 3.

### Scope

`libs/luna-shopper/carrefour/src/lib/listing.ts` and `listing.spec.ts`;
`libs/luna-shopper/eljamon/src/lib/size.ts`, `listing.ts` and their specs. Fixtures through each
library's `capture-fixtures` target only if a real card or page is needed beyond the names of
this plan, which the specs may quote verbatim.

### Constraints

- The name keeps what is not the size: a pack phrase that is part of the size moves across, the
  rest stays (plan `0090`'s rule that a broken name is worse than a missing size).
- `sizeFormat` stays the verbatim text that was split off. It is half of a key.
- A count multiplied into a size passes the same bounds as `packCountOf`.
- No harvester code changes. These are framework free libraries.

### Action boundaries

Stop and ask before changing `PACK_COUNT_MAX`, before changing the family check for any pair
that section 2.3 does not name, and before touching another adapter.

### Progress evidence

`npx nx test luna-shopper/carrefour`, `npx nx test luna-shopper/eljamon`, and the counts of
section 3 from walks on an ephemeral slot, quoted in the PR.

## 2. The rules

### 2.1 A count is bounded where it is multiplied

`quantityOf` multiplies only by a count that `packCountOf` accepts, or by 1 when the phrase has
no count (as today). A number outside it (1880) is not a count: the number stays in the name,
and the container phrase moves to the size whole, so the name never ends in a dangling `de`.
For the polvorones: name `Polvorones de almendra artesanos 1880`, `sizeFormat`
`estuche de 310 g.`, 0.31 kg, no count.

### 2.2 `pack N <noun>` before the quantity

Accept `pack <N> <noun>` directly followed by the quantity, where the noun is one of `CONTAINER`
(which already holds the plurals). `pack 28 latas 33 cl.` then reads count 28, `sizeFormat`
`pack 28 latas 33 cl.`, size 28 × 330 ml.

### 2.3 A content word on a card priced per unit

With D2 (a): on a card whose `measure_unit` is `ud`, a trailing weight or volume is the content
of the unit and is read. A volume on a `kg` card is read only with D1 (a). The other mismatches
(`g` on an `l` card) stay refused.

### 2.4 El Jamón: the size of one unit from the name

When the size field states a count and no size (`PACK_ONLY`) and the name ends in a quantity
and a weight or volume word, the size is count × that quantity, the count is the field's, and
the name loses the trailing size. `sizeFormat` becomes both printed texts, the name's first:
`75g pk-2`, so nothing the chain printed is lost and the key stays stable from walk to walk.
Rows with a `pk` field whose name prints no size keep today's answer.

## 3. Expected effect

Measured on slot 4, to be confirmed by the walk: up to 901 more Carrefour rows with a size
(section 2.3, the `€/ud` rows), up to 193 Carrefour packs with a count (section 2.2), one
polvorones row at 0.31 kg (section 2.1), and about 300 El Jamón rows with a size (section 2.4).

**Changing `sizeFormat` changes a key.** For a source with no id it is half of the row's
identity (`entryNameKey`), and for every source it is part of rung 4's sibling key. Carrefour
rows have an id, so they keep their rows. El Jamón rows have a product code as their id, so they
keep theirs too; confirm both in the PR before the walk, and state how many keys move.

## Tests

Each name quoted in the Context becomes a case in the spec of its parser, with the expected
`name`, `sizeFormat`, `unitSize`, `sizeUnit` and `packCount`. Every existing case keeps its
answer. Add `Café molido 500 g` on a card measured in `ud` to prove section 2.3 does what it
says, and `Leche entera CARREFOUR pack de 9 unidades de 1 l.` to prove section 2.2 left the old
phrase alone.

## Acceptance criteria

- [ ] Polvorones reads name `Polvorones de almendra artesanos 1880`, `sizeFormat`
  `estuche de 310 g.`, 0.31 kg, no count.
- [ ] Amstel reads count 28 and 9,240 ml.
- [ ] A wine card priced per unit with `75 cl.` reads 750 ml.
- [ ] `paté clásico 75g` with `pk-2` reads count 2, 150 g, name `paté clásico`, `sizeFormat`
  `75g pk-2`.
- [ ] Every existing spec case passes unchanged.

## Verification

Walk Carrefour and El Jamón on an ephemeral slot and report, per chain, the rows with no size
whose name ends in a size, before (slot 4) and after.

## Decisions

- **D1 (owner): a volume on a card priced per kilo.** 82 Carrefour rows (mostly ice cream) print
  `ml` and compare per kilo. (a) read the volume; (b) keep refusing. Recommended: (a), because the
  volume is what the tub holds and the comparison price stays verbatim beside it; plan `0249`
  then leaves them unchecked, as the dimensions differ.
- **D2 (owner): the family check on a card priced per unit.** (a) read a weight or volume on a
  `ud` card, as section 2.3 says; (b) keep refusing. Recommended: (a), for the 901 rows of the
  Context; the misread its comment names is caught by plan `0249`, which compares the size with
  the price per unit.
