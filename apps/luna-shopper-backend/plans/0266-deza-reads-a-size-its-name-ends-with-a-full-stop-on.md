# 0266: DEZA reads a size that its name ends with a full stop on

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. The report of that day counted names that keep a size
> while the size field is empty: El Jamón 334, DEZA 516, Carrefour 1,184. Plan `0250`
> (PR #939, merged) fixed Carrefour and El Jamón. On its Carrefour walk of 2026-11-08 the
> Carrefour count went from 1,009 to 15. El Jamón has no count after the fix, because that walk
> did not finish before plan `0253`. **DEZA is the one chain left**, and plan `0250` excluded it
> on purpose (its Context, the paragraph "Rows not in scope here"). The DEZA count of 516 was
> not re-measured on 2026-11-11, Docker was down. Its breakdown is not known: the committed
> fixtures hold about 20 descriptions.
>
> Prerequisite reading: plan `0085` (the DEZA adapter), plan `0086` D2 (the key of a source
> with no id), plan `0177` (a source size states its own unit), plan `0250` (the Carrefour
> and El Jamón fix, its count query), `libs/luna-shopper/deza/src/lib/size.ts`,
> `libs/luna-shopper/deza/src/lib/rows.ts` (`parseRow`),
> `apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts` (`entryNameKey`,
> `entryKey`) and `harvest/deza-catalog.runner.ts` (`record`).

## Brief for the agent

### Objective

Measure first why DEZA names keep a size while `unitSize` is empty, and report the breakdown.
Then, after the owner answers D1, make `splitSize` read a trailing size that ends with a full
stop or `aprox`, and the units the breakdown shows, without a silent change to the identity of
any row.

### Context

- `splitSize` (`size.ts`, near lines 120 to 138) splits only a **trailing** quantity followed
  by one word of `DEZA_SIZE_UNITS` (near lines 39 to 86). Its regex `TRAILING_SIZE` (near line
  99) ends `\s*$` with no `\.?`. The Carrefour regex in
  `libs/luna-shopper/carrefour/src/lib/listing.ts` (near line 150) accepts `\.?`, an optional
  `aprox` and trailing stops. That DEZA prints a stop or `aprox` is an inference from the
  regex. No DEZA fixture shows it. Find real rows first.
- What `splitSize` refuses today:
  - A size in the middle of a name, by design (near lines 114 to 118). Plan `0250` counted
    305 DEZA rows of that shape.
  - A trailing stop or `aprox` (the inference above).
  - A unit word outside `DEZA_SIZE_UNITS`.
- `sizeOf` (near lines 158 to 169) gives no size for a sum (`23+12 lavados`) or a length
  (`30 m`) while `sizeFormat` is set, on purpose. Those rows have a `sizeFormat` and no
  `unitSize`, and a count on `unitSize IS NULL` counts them too.
- **`sizeFormat` is half of the identity of a DEZA row.** DEZA has no product id. The runner
  keys a row on `entryKey(row.name, row.sizeFormat)` (`deza-catalog.runner.ts`, near line
  810), the hash of `entryNameKey` (`matching.ts`, near lines 69 and 85). A change to the
  split moves both the name and the size, so the key changes: a new `source_catalog_entries`
  row, and the old one stops being seen.
- The entity says the source rewrites `sizeFormat`, `unitSize` and `name` on every full read
  (`source-catalog-entry.entity.ts`, near line 163). A row that keeps its `externalId` thus
  takes the new size on the next walk.
- DEZA writes no price, ever (`CLAUDE.md`).

### Target state

1. **Step 1, the measurement.** A table in the PR: the DEZA rows with a name that ends in a
   quantity and a unit and an empty `unitSize`, grouped by the reason (trailing stop, `aprox`,
   unit not in the list, a sum, a length, other). Quote three names per group, and give the
   number of rows in each group by `status`, so the owner sees how many `ACTIVE` rows would
   move (D1).
2. **Step 2, the fix**, after D1: `splitSize` reads a trailing stop and a trailing `aprox`,
   and the unit words the measurement names, and the identity of each row follows D1.

### Scope

Step 1: a read only query or a read of fixtures. Step 2: `size.ts` and `size.spec.ts`. Under
D1 (c) also `rows.ts`, `deza-catalog.runner.ts`, `isNameKeyed` in `matching.ts` and the
migration of section 2.

### Constraints

- Read real rows from the locked slot 4 copy read only, or capture new fixtures with
  `npx nx run luna-shopper/deza:capture-fixtures`. Never write a fixture by hand. Do not
  unlock or start slot 4. If no catalog of DEZA is up, capture fixtures.
- A size in the middle of a name stays in the name (D2).
- No price is written. No change to `normalizeName` or `entryNameKey`.
- The printed size stays verbatim in `sizeFormat`, the stop included, as Carrefour keeps it.

### Action boundaries

- Do step 1 and stop. Report the breakdown and ask before step 2, until D1 is answered.
- Stop and ask before you add a release task or a migration.

### Progress evidence

The breakdown table of step 1. For step 2, the spec output and the count of step 1 again on a
fresh DEZA walk on an ephemeral slot, with the number of new and of orphaned entries.

## 1. The query of step 1

On the harvester database, read only, for the DEZA chain:

```sql
SELECT name, "sizeFormat"
FROM source_catalog_entries
WHERE "supermarketId" = $1
  AND "unitSize" IS NULL
  AND name ~* '\d\s*[a-zà-ÿ]{1,10}\.?\s*(aprox\.?)?\s*$';
```

The pattern is the one plan `0250` used for Carrefour, made wide enough to show unit words
outside the list. Classify each row in TypeScript with the reasons of Target state 1.

## 2. The identity under D1 (c)

`record` builds the key from the row. Under D1 (c) the parser answers both splits: the split
of today, for the key, and the new one, for `name`, `sizeFormat` and `unitSize`. The key then
does not move, and the entity takes the new values on the next full read. `parseRow`
(`rows.ts`, near line 80) has the whole `description`, and the runner reads the key in one
place, so this half is a small change.

**The other half is not small.** `isNameKeyed` (`matching.ts`, near lines 302 to 313, plan
`0221` section 3.2) decides that a row is keyed on its own text by computing
`entryKey(row.name, row.sizeFormat)` from the stored columns and comparing it with
`externalId`. `source-ingest.ts` calls it near lines 1447 and 1967, and `matching.ts` near
line 379. Under (c) a changed row stores the new name and size while its `externalId` is the
hash of the old ones, so `isNameKeyed` answers false for it, and the word order rung of plan
`0221` treats a DEZA row as a row with a chain id. To keep (c) correct, `isNameKeyed` needs
another test, for example a column that records that the row is name keyed. That is a
migration. Name it in the PR before you write it.

## Tests

- `size.spec.ts`: `Leche entera 1 L.` and `Queso curado 250 g aprox` split, `Hermético azul
  TATAY 0.5 l ovalado` does not, and every unit the measurement adds.
- Under D1 (c): the key of a row whose split changes equals the key of today.

## Acceptance criteria

- [ ] The breakdown of step 1 is in the PR before any code of step 2.
- [ ] A trailing stop and `aprox` split, and a size in the middle stays.
- [ ] The identity of each row follows D1, and the PR quotes the new and orphaned counts.
- [ ] No price, no `normalizeName` change.

## Verification

```sh
npx nx test luna-shopper/deza
npx nx test luna-shopper-backend-harvester -t "deza"
npx nx affected -t lint test
```

## Decisions

**D1. A row whose split changes.**

- (a) Accept new entries. The old ones age out as unseen.
- (b) A release task that repoints or deletes the orphans.
- (c) The key keeps the split of today, and only the size is filled from the new split.

Recommended: (a), if the measurement shows a few hundred rows. A new entry is what a renamed
DEZA product makes today, and the old row stops being seen like any delisted product. (c)
keeps every identity but needs the `isNameKeyed` change and the migration of section 2.
Choose (c) only if the measurement shows that many of the moved rows are `ACTIVE` rows a
person already bound to a product, because under (a) each of them waits in the queue again.

**D2. A size in the middle of a name.** Recommended: no, by design (`size.ts`, near line 117).

**D3. The rest of Carrefour and a count for El Jamón.** The Carrefour rest is 15 names (glued
or two sizes), 22 `pack N` names whose noun is not in `CONTAINER`, and
`Turron 1000 caja de 300 g`, which reads 300 kg (PR #939). Recommended: count El Jamón again on
the next scheduled walk first, and no plan now.
