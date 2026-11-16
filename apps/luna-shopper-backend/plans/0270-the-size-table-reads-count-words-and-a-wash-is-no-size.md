# 0270: the size table reads the count words a chain prints, and a wash is no size

> Three owner decisions of 2026-11-16, one plan, built in wave 2 of the harvester round of
> plans `0264` to `0269`. Checked against `origin/dev` and the branches of PR #970 (plan
> `0266`) and PR #974 (plan `0264`) on 2026-11-16.
>
> 1. **A count word counts.** Three pairs of socks is a 3 pack, a dozen eggs is 12 (the owner's
>    words). The printed size table gains `par`, `pares`, `bolsita`, `bolsitas`, `porción`,
>    `porcion` and `porciones`, each a count of one, as `sobres`, `rollos` and `hojas` are and
>    as `docena` is a count of 12. A measurement on stored DEZA rows found 295 rows whose size
>    stays in the name because the unit word is unknown. Of them, `pares` is 58 and `bolsitas`
>    is 10.
> 2. **A wash is no size.** `lavado` and `lavados` leave the same table. Plan `0264` (PR #974)
>    removed the wash only as the basis of a unit price. The owner's rule of 2026-11-11 is
>    wider: a wash count is the brand's claim, nobody can measure it, and it is a bad basis to
>    compare prices on.
> 3. **A capital `X` multiplies.** `2X100 g` is read as `2x100 g` is.
>
> Prerequisite reading: plan `0177` (a source size states its own unit), plan `0183` (a length
> is no size, the `NxQ` rule), plan `0162` (pack counts), plan `0245` (the comparable price),
> plan `0249` (the size doubt), plan `0264` on the branch of PR #974, plan `0266` on the branch
> of PR #970 (its D1: a DEZA row whose split changes becomes a new entry),
> `libs/luna-shopper/contracts/src/lib/units/source-size.ts`, and the size parser of each
> adapter: `libs/luna-shopper/deza/src/lib/size.ts` (on the branch of PR #970),
> `carrefour/src/lib/listing.ts`, `dia/src/lib/size.ts`, `eljamon/src/lib/size.ts`,
> `lidl/src/lib/size.ts` and `mercadona/src/lib/units.ts`.

## Brief for the agent

### Objective

Add the seven count words to the shared printed size table and to the closed unit lists of the
adapters. Make a wash state no size anywhere. Make a capital `X` multiply in the two parsers
that refuse it today. Prove each change with specs and with a replay of stored rows, and give
the count of changed rows for each chain in the PR.

### Context

- **The shared table.** `PRINTED_SIZE_UNITS` in `source-size.ts` (near lines 54 to 107) maps a
  printed word to a catalog unit and a factor. `printedSizeUnit` reads it, and
  `measuresContent` is `printedSizeUnit(word) !== null` (near line 163). `sourceSizeOf` (near
  lines 190 to 205) is the one conversion: a length answers no size, a known word answers its
  unit, and **any other word keeps the number and states no unit** (`3` and `paquete` is
  `{ unitSize: 3, sizeUnit: null }`, pinned by `source-size.spec.ts` near line 40).
  `racion` and `raciones` are in the table, `ración` is not.
- **Who calls the shared table**, found by a search of `origin/dev`:
  - DEZA `statedSize` and `multipliedCount` (`deza/src/lib/size.ts`).
  - Carrefour `statedSize` for a volume only, and `packCountIn` (`listing.ts`, near lines
    321 and 392).
  - DIA `splitSize` (`dia/src/lib/size.ts`, near lines 105 and 111).
  - El Jamón `splitSize` (`eljamon/src/lib/size.ts`, near lines 124, 140, 160 and 161).
  - The leaflet import, `sizeOf` in `harvester/src/app/harvest/file-import.runner.ts` (near
    line 434), which reads `size.unit` of the document.
  - **Not** Mercadona: `mapSizeFormat` (`mercadona/src/lib/units.ts`) has its own table of the
    chain's unit tokens. **Not** LIDL: `parseSize` has its own `UNITS` (`lidl/src/lib/size.ts`,
    near lines 20 to 41), with no wash and no count word but `ud` and `piezas`. **Not**
    catalog: no file of `apps/luna-shopper-backend/catalog` reads a printed size.
    **Not** curation: `printedUnit` in `libs/luna-shopper/tools/curation/suggestions/src/rules.mjs`
    has its own `PRINTED_UNITS` (near line 310), read only for a row with no `sizeUnit`.
- **Each adapter but LIDL and Mercadona has its own closed list too**, and that list, not the
  shared table, decides whether a trailing size is split off the name:
  - DEZA `DEZA_SIZE_UNITS` holds `lavado`, `lavados`, `sobres`, `rollos`, `hojas`,
    `raciones`, and no count word of decision 1.
  - Carrefour `UNITS` (`listing.ts`, near lines 48 to 99) maps each word to a family and a
    factor. Its `statedSize` computes a weight or a count with that factor and **not** through
    the shared table. `lavado` and `lavados` are `{ base: 'ud', factor: 1 }` there.
  - DIA `UNITS` (near lines 62 to 83) holds `lavados`. El Jamón `UNITS` (near lines 53 to 78)
    holds `lavados`.
- **What reads a wash size today.**
  - A source entry: DEZA `40 lavados` is 40 `UNIT` (shared table). Carrefour is 40 `UNIT`
    (its own factor). DIA and El Jamón are 40 `UNIT` (shared table). The entity says the
    source rewrites `unitSize`, `sizeUnit` and `sizeFormat` on every full read
    (`source-catalog-entry.entity.ts`, near line 163).
  - A product: a product created from such a row is `UNIT` with a size of 40
    (`createdSize`, `source-entry-size.ts`). A walk never rewrites the size of a product.
  - The comparable price of plan `0245` (`comparablePriceOf`,
    `contracts/src/lib/units/comparable-price.ts`, and `comparable-price.sql.ts` in catalog)
    divides the price of a `UNIT` product by its `unitSize`. **A detergent of 40 washes is
    thus ranked by its price per wash today**, by the product's stored size and not by any
    label.
  - The size doubt of plan `0249` (`size-check.ts`, `size-doubt.ts`): `checkSize` compares a
    `UNIT` size only with a count label (`ud`, `unidad`, `docena`). `lv` and `lavado` are not in
    `LABEL_AMOUNTS`, so a row priced per wash is never checked. A wash row priced per `ud` can
    carry a doubt. Admin plans `0071` and `0072` draw the doubt.
- **Why a wash cannot simply leave the table.** `sourceSizeOf(40, 'lavados')` would then answer
  `{ unitSize: 40, sizeUnit: null }`. `rowUnit` in `source-entry-size.ts` (near line 218) reads
  a size with no unit as `UNIT`, so a product created from that row is still 40 `UNIT`. A
  number with no unit beside it reads as a count, which is what plan `0183` exists to stop
  writing. A wash must thus answer no size, as a length does.
- **The `NxQ` rule.** `measuresContent` decides that the `N` of `NxQ` is a pack count
  (plan `0183`). After decision 1, `2x3 pares` states a pack count. After decision 2,
  `2x40 lavados` states none.
- **A capital `X`.** DEZA `TRAILING_SIZE` has no case flag and its `QUANTITY` joins numbers by
  `[x+]`, so `2X100 g` is not split and the size stays in the name. `STATED_SIZE` and
  `COUNT_TIMES_QUANTITY` beside it already carry `i`. LIDL `PRINTED_SIZE` (near line 54) has no
  case flag and joins by `[x×]`, so `2X100 g` reads as no size. Carrefour (`i` on
  `TRAILING_SIZE`), DIA (`i` on `FORMAT`) and El Jamón (lower cases before `QUANTITY`) already
  read it. Mercadona reads no multiplier from text.
- **Only DEZA keys a walk row on its text** (`entryKey(row.name, row.sizeFormat)`,
  `deza-catalog.runner.ts` near line 810, and `isNameKeyed` in `matching.ts`). A leaflet row
  with no `external_id` does too (`file-import.runner.ts`, near lines 218 and 445). Every
  other chain keys on its own product id, so a changed split rewrites the row in place.

### Target state

1. `printedSizeUnit` answers `UNIT` with factor 1 for `par`, `pares`, `bolsita`, `bolsitas`,
   `porción`, `porcion` and `porciones`, and `measuresContent` is true for each.
2. `printedSizeUnit('lavado')` and `printedSizeUnit('lavados')` are null,
   `measuresContent` is false for both, and `sourceSizeOf(40, 'lavados')` is
   `{ unitSize: null, sizeUnit: null }`, as `sourceSizeOf(30, 'm')` is (section 2).
3. Each adapter reads the words of section 1 and section 2 the same way (the table of
   section 3).
4. `2X100 g` reads as `2x100 g` on DEZA and on LIDL.
5. The PR holds the replay table of section 4, and no `ACTIVE` row whose key stays changes its
   item.

### Scope

- `libs/luna-shopper/contracts/src/lib/units/source-size.ts` and `source-size.spec.ts`.
- DEZA: `size.ts` and `size.spec.ts`. Carrefour: `listing.ts` and `listing.spec.ts`. DIA:
  `size.ts` and its spec. El Jamón: `size.ts` and `size.spec.ts`. LIDL: `size.ts` and
  `size.spec.ts`.
- `harvester/src/app/harvest/file-import.runner.ts` only if a spec there pins a wash size.
- No change to Mercadona, catalog, curation, the leaflet prompts, `entryKey`,
  `normalizeName`, `size-check.ts` or `unit-basis.ts`. No migration and no release task. The
  products already made from wash rows are corrected by plan `0271`, a release task of its
  own (D2). The leaflet prompts change in a later leaflet plan (D3).
- If the owner answers O2 with 28b, the re-key of section 5 joins this scope. Until then it is
  out of it.

### Constraints

- **The harvester records a name as the chain states it.** This plan reads a printed size and
  nothing more out of a name: no size from the middle of a name, no pack noun, no inference
  (memory rule of 2026-11-11, plan `0266` D2).
- `w` (watts), `h` (hours) and `ga` stay out of every table. They count nothing in the pack:
  a 60 w bulb is one bulb and a 24 h cream is one jar.
- No new wash key in any spelling, in any table.
- The printed text stays verbatim in `sizeFormat`.
- **No live walk of any chain** for this plan (the owner, 2026-11-11). The proof is specs plus
  the replay of section 4. The walk of the whole round covers it later. Note it as pending in
  the PR.
- Build after PR #970 is merged into `dev`. Cut the branch from `dev` after that merge, since
  `deza/src/lib/size.ts` is the file of that PR.

### Action boundaries

- Do the replay of section 4 first, on the code of `dev`, and keep its output. Then change the
  code and replay again.
- Stop and report if the replay shows an `ACTIVE` row whose key stays and whose item changes,
  or a chain whose changed rows are more than twice the count the PR body expected.
- Do not touch stored rows. Plan `0271` corrects the stored products (D2), after this plan is
  merged.

### Progress evidence

The spec output, the replay table of section 4 before and after, and the counts by `status` of
the rows whose key moves, per chain, with the `ACTIVE` count on its own line (O2).

## 1. The count words

Add to `PRINTED_SIZE_UNITS`, each as `UNIT`:

```
par, pares, bolsita, bolsitas, porción, porcion, porciones
```

`docena` stays a count of 12. `racion` and `raciones` stay. Add `ración` beside them, since
`porción` takes its accented form too.

`printedSizeUnit` lower cases and removes one trailing stop before the lookup, so `Pares` and
`pares.` read the same.

## 2. A wash is no size

1. Remove `lavado` and `lavados` from `PRINTED_SIZE_UNITS`.
2. Add a set of printed words that state no size, beside `PRINTED_LENGTHS`: `lavado`,
   `lavados`. `sourceSizeOf` answers `{ unitSize: null, sizeUnit: null }` for a word in it, as
   it does for a length. Name it for what it holds (a claim of the brand) and say why in its
   comment, with the reason of the owner.
3. `isPrintedLength` does not change. A wash is not a length, and El Jamón branches on
   `isPrintedLength` alone (near line 140).
4. Rewrite the comment of the table near lines 50 to 52, which names `lavados` as a count.

The printed text stays a split size. `Detergente ARIEL 40 lavados` still splits into the name
`Detergente ARIEL` and the size format `40 lavados`, so no DEZA key moves for a wash (choice
C1). Only the number goes.

## 3. What changes for each chain

| Chain | Count words (1) | Wash (2) | Capital `X` (3) |
| --- | --- | --- | --- |
| DEZA | Add the seven words to `DEZA_SIZE_UNITS`. A name that ends in one now splits, so its key moves and it becomes a new entry (plan `0266` D1, section 5). `3 pares` is 3 `UNIT`. `2x3 pares` is 6 `UNIT` with a pack count of 2. | `lavado` and `lavados` stay in `DEZA_SIZE_UNITS`, so the split and the key stay. `statedSize` answers no size, because `sourceSizeOf` does. `2x40 lavados` states no size and no pack count (D1). | `QUANTITY` joins by `[xX+]`. A name that ends in `2X100 g` now splits, so its key moves. |
| Carrefour | Add the seven words to `UNITS` as `{ base: 'ud', factor: 1 }`. A card measuring in `ud` splits them. A card measuring in `kg` or `l` refuses them, by `ACCEPTED_FAMILIES`. The row keeps its key. | `lavado` and `lavados` become `{ base: 'ud' }` with no factor. `statedSize` then answers no size (its `factor === undefined` branch), the split stays. `packCountIn` reads `measuresContent`, so `2x40 lavados` states no pack count. | Already read. A spec pins it. |
| DIA | Add the seven words to `UNITS`. The row keeps its key. | `lavados` stays in `UNITS`. `sourceSizeOf` answers no size. `packCount` is null by `measuresContent`. | Already read. A spec pins it. |
| El Jamón | Add the seven words to `UNITS`. The row keeps its key. | `lavados` stays in `UNITS`. The branch near line 156 answers no size through `sourceSizeOf`, and no pack count. | Already read (lower cased). A spec pins it. |
| LIDL | No change. Its table holds no count word of decision 1 and the decision names the shared table (choice C2). | No change. It holds no wash. | `PRINTED_SIZE` joins by `[xX×]`. The row keeps its key. |
| Mercadona | No change. The chain prints a unit token (`ud`), not a word. | No change. | No change. |
| Leaflet import | `size.unit` `pares` now reads as `UNIT`. | `size.unit` `lavados` now reads as no size. The DEZA and DIA prompts tell the model to write a wash count as `ud`, so a leaflet still writes a wash as a count until the leaflet follow-up of D3. | No change. |

**Is `2x3 pares` as 6 `UNIT` with a pack of 2 right?** Yes, by the rule the table already
follows. `2x10 sobres` is 20 `UNIT` with a pack of 2 today. Two packs of three pairs is six
pairs, the comparable price of plan `0245` divides by the size, so it is a price per pair, and
the pack count says that two packs are sold as one.

**What a wash loses.** On the next full read of each chain, every wash row of Carrefour, DIA and
El Jamón states no size and no pack count, and so does every DEZA wash row. A size doubt held
on such a row clears, because `decide` in `size-doubt.ts` clears a doubt when the size goes.
A new row with no size is created as `UNIT` with no size, unless the person names one.

**What a count word gains.** A row priced per `ud` now meets `checkSize`, so a new doubt can
appear on it. The replay counts them.

**What stays.** A product made from a wash row before this plan keeps its stored 40 `UNIT`,
because a walk never rewrites a product's size. This plan does not change it. Its comparable
price stays a price per wash until plan `0271`, the release task of D2, runs.

## 4. The replay

Read only, on the harvester database of the locked slot 4 copy, as plan `0266` did. Do not
unlock or start slot 4. If it is not up, restore a dump of it into an ephemeral slot
(`luna-slot.sh --ephemeral`). Never write a fixture by hand.

For each chain, read every `source_catalog_entries` row and rebuild the printed text the adapter
split: `name` and `sizeFormat` joined by a space (El Jamón joins by `, `). Run the parser of
`dev` and the parser of the branch over it, in a script outside the repository. Count:

- rows whose split changes, and of them rows whose key changes (DEZA and name keyed leaflet
  rows only), by `status`;
- rows whose `unitSize` or `sizeUnit` changes, by reason (count word, wash, capital `X`);
- rows whose `packCount` changes;
- rows whose size doubt would change, with a count label of their latest price.

Quote three names for each reason and chain. Then assert, on the same rows, that no row whose
key stays has a new `itemId`. Nothing in the ingest changes an `itemId` on a size change, so
the assertion is a check of the replay, and a failure stops the build.

**The rows whose key moves.** By plan `0266` D1 such a row becomes a new entry and the old one
ages out as unseen. An `ACTIVE` old row keeps its product. The new row waits in the queue
again. The PR gives that count **per chain** and by `status`, with the `ACTIVE` count of each
chain on its own line. Only DEZA can move a key (section 5), so every other chain must read 0,
and the replay asserts it. The replay also counts the two collision shapes of section 5.3:
old keys that yield two new keys, and new keys that two old keys yield, each by `status`. If
the `ACTIVE` count is 0 for every chain, O2 costs nothing and the PR says so.

## 5. The key of a DEZA row, and what O2 asks

### 5.1 What the key is made of

The DEZA runner keys a row on `entryKey(row.name, row.sizeFormat)` (`deza-catalog.runner.ts`,
`record`, near line 813 on the branch of PR #970). `entryKey` is the SHA-1 hex of
`entryNameKey(name, sizeFormat)`, which is
`normalizeName(name) + '|' + normalizeName(sizeFormat ?? '')` (`matching.ts`, near lines 69 to
89). `normalizeName` removes accents, lower cases, and turns every run of characters outside
`a-z0-9` into one space, then trims. `name` and `sizeFormat` both come from one call of
`splitSize(description)` in `rows.ts` (near line 80), where `description` is the text of the
`wpdz-row-col-desc` cell. `splitSize` collapses white space, then cuts the trailing size off at
one space.

So the key is the hash of the description **with a pipe where the split falls**. Moving the
split moves text across the pipe: `Calcetines 3 pares` is `calcetines 3 pares|` under the rule
of `dev` and `calcetines|3 pares` under this plan. The two strings differ, so the hashes
differ, so the row is a new `externalId`. The same holds for `Yogur 2X125 g`
(`yogur 2x125 g|` before, `yogur|2x125 g` after). A wash row does not move (choice C1), because
its split does not change.

### 5.2 The key moves once, not on every walk

`splitSize` is a pure function of the description. It reads no section, no shop, no attribute
and no state of the run, and `record` builds the key from its answer alone. Leaflet rows are
not affected at all: a leaflet keys on the document's own `name` and `size.label` or
`size.unit` (`file-import.runner.ts`, near lines 216 to 218), which no size table changes.

So the first walk on the new code writes each moved row under its new key, and every later
walk computes the same key from the same printed description and finds that row. The new key
is stable for as long as the chain prints the same description and no later plan changes the
split again. Verified on the code, not assumed: the builder adds one spec to
`deza-catalog.runner.spec.ts` (or the nearest spec of `record`) that records the same row
twice through two `Crawl` instances and asserts one key, and the replay of section 4 computes
the new key twice per row and asserts equality.

Two cases change the picture, and the replay counts both:

- A capital `X` row can land on a row that already exists. `Yogur 2X125 g` and
  `Yogur 2x125 g` were two rows before (different keys). After this plan both are
  `yogur|2x125 g`, so the first joins the row of the second, and its own old row ages out.
- A moved row whose new key is new waits in the queue with no proposal. Rung 4 does not
  propose it to the old product, because the old row's size text is empty and the new row's is
  not (`wordOrderKey` keeps the size).

### 5.3 How reliable carrying a decision across would be

The design under evaluation: during a walk the runner still holds `row.description`. It runs
the split of `dev` on the same string, builds the key that rule gives, and looks for an entry
of the same chain under that old key. If it finds one and no entry holds the new key yet, that
entry is the same printed row.

- **The match is exact.** It compares the SHA-1 of two strings that one deterministic function
  built from the same printed bytes. No similarity, no threshold and no word order is involved.
  An entry found this way is the row the code of `dev` would have written for this very
  description, which is the row a person decided on.
- **Many printed descriptions to one old key is not a new collision.** `normalizeName` is
  lossy (case, accents, punctuation), so `Calcetines 3 pares.` and `calcetines 3 pares` give one
  old key. They are one row today already, and carrying its decision across keeps what is true
  now.
- **One old key to two new keys can happen in principle.** Two descriptions that normalize
  equal can split differently under the new rule: `Calcetines 3 pares` splits and
  `Calcetines 3-pares` does not (the hyphen sits where `TRAILING_SIZE` wants a space). Both
  were one row before. Rule: when one walk meets two descriptions with one old key and two new
  keys, it carries the decision to neither, and both wait. The replay counts these, and 0 is
  expected.
- **Two old keys to one new key happens for a capital `X`** (section 5.2). The new key already
  holds a row, so there is nothing to carry: the existing row keeps its own decision, and the
  other old row ages out as under 28a.
- **What must be computed or stored.** Nothing new is stored. The runner must keep the split of
  `dev` as a frozen copy (the unit list and `QUANTITY` of before this plan, named for this
  plan), and remove it once a walk re-keys nothing. The same match can also be computed once
  from stored rows, with no walk: a stored `name`, one space and the stored `sizeFormat` give
  back the collapsed description byte for byte, because `splitSize` cuts one collapsed string at
  one space. That holds for every row where `isNameKeyed` is true, which proves the stored pair
  is the pair its key was built from.
- **Re-key in place, not a copy.** The builder would update `externalId` of the existing row to
  the new key, and the normal upsert then writes the new `name`, `sizeFormat` and size. The row
  keeps its id, its `status`, its `itemId`, its availability and its history. A copy would make
  a second row and write an `itemId` onto it by machine, and leave the first row aged out with
  the same `itemId`. The unique key on chain and `externalId` refuses a re-key whose new key is
  taken, which is the case of the capital `X` above.
- **The harvester rule.** "No automated match ever binds a printed name to a product" (plan
  `0081`) forbids a machine from deciding that two printed names are one product. A re-key in
  place makes no such decision: the printed bytes are the same, the row is the same, and no
  binding is written. Only the way the code spells the row's identity changed. A copy of the
  decision onto a new row is closer to the letter of the rule, which is one more reason for the
  re-key in place.
- **Its relation to plan `0266` D1.** D1 says the key follows the new split, and it still would.
  28b keeps the row's identity, not the old split. If the owner picks 28b, the same question
  holds for the keys that plan `0266` moves, and the frozen rule would then be the rule before
  `0266`.

**Recommendation.** Let the count of section 4 decide. If no moved row is `ACTIVE`, the
question costs nothing: take 28a and build nothing. If a few are, 28a is still cheaper: a
person accepts them again in the queue, and no frozen rule lives in the runner. 28b pays for
itself only when the `ACTIVE` count is more than a person clears in one sitting (about 25), and
then the re-key in place above is exact and safe.

## Tests

- `source-size.spec.ts`: the seven count words and `ración` answer `UNIT` 1;
  `measuresContent` is true for each; `lavado`, `lavados` and `LAVADOS.` answer null from
  `printedSizeUnit` and false from `measuresContent`; `sourceSizeOf(40, 'lavados')` is no size;
  `sourceSizeOf(60, 'w')`, `(24, 'h')` and `(3, 'ga')` answer as today, a number with no unit.
- DEZA `size.spec.ts`: `Calcetines 3 pares`, `Infusión 20 bolsitas`, `Queso 8 porciones`,
  `Calcetines 2x3 pares` (6 `UNIT`, pack 2), `Detergente 40 lavados` (split, no size, no pack),
  `Detergente 2x40 lavados` (split, no size, no pack), `Yogur 2X125 g` (split, 250 g, pack 2).
- Carrefour `listing.spec.ts`: a `ud` card with `3 pares`, a `kg` card with `3 pares`
  (refused), a wash name (split, no size), a `2X100 g` name.
- DIA and El Jamón specs: a count word, a wash, a capital `X`.
- LIDL `size.spec.ts`: `2X100 g` is 200 g with a count of 2.
- The DEZA runner spec: `Calcetines 3 pares` recorded by two `Crawl` instances gives one key,
  and that key is not the key of `dev` for the same description (section 5.2).

## Acceptance criteria

- [ ] The seven count words are `UNIT` 1 in the shared table and in the four closed lists.
- [ ] No table maps a wash to a unit, and a wash states no size and no pack count anywhere.
- [ ] `w`, `h` and `ga` are in no table.
- [ ] `2X100 g` reads as `2x100 g` on every chain that prints a multiplier.
- [ ] The PR holds the replay before and after, for each chain, with counts by `status`.
- [ ] No row whose key stays changes its item.
- [ ] The PR states the moved `ACTIVE` rows per chain, and the two collision counts of
      section 5.3.
- [ ] No migration, no release task, no change to a stored row.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper/deza
npx nx test luna-shopper/carrefour
npx nx test luna-shopper/dia
npx nx test luna-shopper/eljamon
npx nx test luna-shopper/lidl
npx nx test luna-shopper-backend-harvester -t "size"
npx nx affected -t lint test
```

## Decisions

**Owner, 2026-11-16:** the three decisions of the head of this plan, in one plan, built in
wave 2.

**C1 (builder choice, for the owner):** a wash keeps its split. The printed `40 lavados` stays
in `sizeFormat` and out of the name, and only the number goes. The other answer, to drop the
wash from the closed lists, leaves the size in the name and moves the key of every DEZA wash
row.

**C2 (builder choice, for the owner):** the seven count words join the closed lists of DEZA,
Carrefour, DIA and El Jamón, not only the shared table, because those lists decide the split.
LIDL is left alone, because its table names no count word but `ud` and `piezas`.

**D1 (owner, answered 2026-11-16, was C3):** `2x40 lavados` states no size and no pack count.
One predicate, `measuresContent`, decides the `NxQ` rule, and a wash measures nothing. The two
boxes are still in `sizeFormat` for the curator.

**D2 (owner, answered 2026-11-16, was O1):** the products already made from wash rows are
corrected by a release task in a plan of its own, plan `0271`
(`0271-a-release-task-takes-the-wash-count-off-products.md`). It builds after this plan is
merged. This plan rewrites no stored product.

**D3 (owner, answered 2026-11-16, was O3):** the DEZA leaflet prompt maps `44 lavados` to
`unitSize 44, sizeFormat "ud"` (`libs/luna-shopper/tools/leaflet/chains/src/deza/prompt.txt`,
near line 106), and the DIA prompt example does the same (`dia/prompt.txt`, near line 256).
They change in a later leaflet plan, not here and not now. **Named follow-up:** a leaflet plan
that makes the DEZA and DIA prompts write a wash count as the printed label and not as `ud`.
No plan file is written for it yet. Until it lands, a leaflet still writes a wash as a count,
and plan `0271` does not catch such a product, because its `sizeFormat` reads `ud`.

## Open questions

**O2 (owner, still open):** DEZA rows whose key moves (count words and capital `X`) become new
entries by plan `0266` D1. Section 5 answers the owner's two questions as facts: the key moves
once, on the first walk on the new code, and stays stable after (5.2). A decision can be
carried across exactly, with no similarity, by a re-key of the same row in place (5.3). The
replay of section 4 counts the moved `ACTIVE` rows per chain. If that count is 0, the question
costs nothing.

- **28a:** accept. The old row keeps its product and ages out, the new row waits in the queue.
  Nothing more is built.
- **28b:** the row keeps its identity through the key change. The runner re-keys the old row in
  place, as section 5.3 describes, and the re-key joins the scope of this plan.

Recommendation: 28a, unless the moved `ACTIVE` count is more than a person clears in one
sitting (about 25). Then 28b.
