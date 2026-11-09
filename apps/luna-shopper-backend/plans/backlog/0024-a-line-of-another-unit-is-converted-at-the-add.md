# 0024 (backlog) A line of another unit is converted at the add

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Written on 2026-11-09 so the owner's decision U2 of that day is not forgotten: "a conversion
> between units is wanted at an add and at a merge, and not now". Until this plan is built,
> plan `0260` refuses an add that meets a line of another unit, and plan `0246` refuses a merge
> across units, both with `line_unit_differs`. This file holds the analysis and the open
> questions only. Code anchors were read on `origin/feat/velista-0183-line-unit-chip` on
> 2026-11-09.

## What `0246` decided and this plan would revisit

`0246` W4 (the owner's, 2026-11-05): one unit per product and no conversion table. The weight
of a piece (`approxWeight`, plan `0244`) and the size of a pack (`unitSize` in its base unit)
are the only two bridges between pieces and weight, and plan `0102` (an equivalence table) is
closed. M5 then made a merge across units a refusal, because "converting between units needs a
product, and a merge has none to prefer" (`0246` section 0).

U2 does not reopen W4. A conversion here uses only the two bridges W4 names; it adds no table.

## What `0260` refuses that this plan would accept

1. A product add in `UNIT` onto a line of that product set that counts in `GRAM` (a line with
   several products whose shopper chose grams), and the reverse.
2. A typed name in `UNIT` (U1: a free text add counts pieces) onto the one product line of
   that name that counts grams, such as loose bananas at 750 g.
3. A batch item that meets a line of another unit (`0260` R3).
4. A rename of one line onto another of another unit (`line-merge.service.ts:195`).

## The bridge a product already gives

`packBridgeOf` (`libs/luna-shopper/contracts/src/lib/units/line-unit.ts:148`) answers what one
pack or one piece weighs or holds: the size of a pack in grams or millilitres, or the
`approxWeight` of a piece priced as one. A kilo piece bridges through its `approxWeight` too
(`unitsServedBy`, `:86`). Those are every conversion the catalog can state:

| From | To | Through | Exact |
| --- | --- | --- | --- |
| `UNIT` of a pack sized `s` g or ml | `GRAM` or `MILLILITER` | `× s` | yes |
| `GRAM` or `MILLILITER` | `UNIT` of a pack sized `s` | `⌈q / s⌉` | no: rounds up to whole packs |
| `UNIT` of a kilo piece or a piece priced as one, weight `w` | `GRAM` | `× w` | no: `w` is the chain's "about" |
| `GRAM` | `UNIT` of such a piece | `⌈q / w⌉` | no: about, and rounded |
| a product sold by the kilo or the litre | `UNIT` | none | no bridge |
| a counted product (eggs, a six pack of no stated size) | `GRAM` | none | no bridge |
| free text | anything but `UNIT` | none | U1 |

So only one direction of one kind is exact: whole packs of a stated size into grams or
millilitres. Every other conversion is an estimate, and some have no answer at all.

## What a conversion needs to decide

- **Which product converts.** An add carries its product, so the add's product converts, if it
  bridges to the line's unit. A merge has two lines and maybe several products each; M5's
  reason still holds there, and a rule is needed: the survivor's `lineShownProduct`
  (`libs/velista/models/src/lib/line-products.ts:564`, which is a client rule today), the
  first member that bridges, or a refusal when the members disagree.
- **Which unit wins.** The line's unit (the add joins what is there) is the obvious answer for
  an add. For a merge, the survivor's.
- **The rounding.** `⌈q / s⌉` matches how `lineAmountOf` already serves a weight by whole packs
  (`0246` section 2). The opposite direction rounds nothing but carries an estimate.
- **The estimate mark.** A converted amount that went through `approxWeight` is an estimate.
  A line has no estimate flag today, only a settlement does (`0246` M7). Either the line gains
  one, or the client derives "about" from the line's products every time it draws.
- **Where it runs.** Core holds no product sizes (`0228` context), and the gateway already
  reads them for the unit check (`gateway/src/app/lists/line-unit-check.ts:108`). So the
  gateway converts and core sums what it is given, or core asks catalog, which it never does
  today.
- **The change record.** `list_line_changes` writes the unit pair (`0246` section 3.4). A
  conversion is one change whose `quantityBefore` and `quantityAfter` are in one unit, with the
  added amount converted, and the record should say it converted.

## What the shopper sees

- At the add: today `0260` says "this list already counts {name} in {unit}" and writes
  nothing. With a conversion the add lands and the line moves by the converted amount: one
  pack of 500 g onto a 750 g line makes it 1250 g, and the toast must say "added 500 g", not
  "added 1".
- Where no bridge exists (a product by the kilo onto a count line, free text onto a weighed
  line), the add is still refused with `0260`'s sentence.
- An estimated conversion (a kilo piece of about 700 g onto a weighed line) needs the
  "about" mark on the toast, and a line that was exact becomes an estimate.

## Open questions

1. Is a conversion that goes through `approxWeight` acceptable at all, or only the exact pack
   to grams direction?
2. Does a converted line keep a mark that it was converted, and does the shopper see it?
3. For a merge, which product's bridge converts when the two lines hold different products?
4. Does the free text add of `0260` R5 (refused beside a weighed product line) become "add one
   default of the line's unit", which needs no bridge at all, or stay refused?
5. Does the assistant convert, or say the amount in the line's unit as it does for
   `line_unit_mismatch` today?
6. Does the catalog need a third bridge for a counted product, which W4 rules out today?
