> **PR:** [#970](https://github.com/IchirokuXVI/nx-portfolio/pull/970)

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
> The owner answered the decisions of this plan on 2026-11-11. A row whose split changes
> becomes a new entry (D1). No size is read from the middle of a name (D2), and the rest of
> Carrefour and El Jamón is work for the curator (D3).
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
Then make `splitSize` read a trailing size that ends with a full stop or `aprox`, and the units
the breakdown shows. A row whose split changes becomes a new entry, and the PR says how many
(D1).

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
   number of rows in each group by `status`, so the owner sees how many `ACTIVE` rows move
   (D1).
2. **Step 2, the fix**: `splitSize` reads a trailing stop and a trailing `aprox`, and the unit
   words the measurement names. A row whose split changes gets a new key and thus a new entry.
   The old entry stops being seen and ages out like a delisted product (D1).

### Scope

Step 1: a read only query or a read of fixtures. Step 2: `size.ts` and `size.spec.ts`. No
change to `rows.ts`, `deza-catalog.runner.ts`, `isNameKeyed` or `entryKey`. No migration and
no release task (D1).

### Constraints

- Read real rows from the locked slot 4 copy read only, or capture new fixtures with
  `npx nx run luna-shopper/deza:capture-fixtures`. Never write a fixture by hand. Do not
  unlock or start slot 4. If no catalog of DEZA is up, capture fixtures.
- A size in the middle of a name stays in the name (D2). **The harvester records the name as
  the chain states it.** To read more out of a name is work for the curator, not for the
  harvester.
- No price is written. No change to `normalizeName` or `entryNameKey`.
- The printed size stays verbatim in `sizeFormat`, the stop included, as Carrefour keeps it.

### Action boundaries

- Do step 1 first and put the breakdown in the PR. Then do step 2 in the same PR.
- Do not add a release task or a migration (D1).
- Do not read a size from the middle of a name, and do not add a parser for the Carrefour rest
  or El Jamón (D2, D3).

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

## 2. The identity of a row whose split changes

By D1 (a), the key follows the new split. `record` builds the key from the row with
`entryKey(row.name, row.sizeFormat)`, and the new split moves both, so the key changes. The
first walk after the fix thus writes a new `source_catalog_entries` row for each row whose
split changed. The old row stops being seen and ages out as unseen, as a renamed DEZA product
does today. `isNameKeyed` (`matching.ts`, near lines 302 to 313) still holds for the new row,
because its stored name and size are the ones its key was built from.

**The cost of (a).** A moved row that a person had bound to a product (`ACTIVE`) comes back as
a new entry and waits in the queue again. The count by `status` of step 1 says how many. The
PR quotes it, and the count of new and orphaned entries after the walk of Progress evidence.

## Tests

- `size.spec.ts`: `Leche entera 1 L.` and `Queso curado 250 g aprox` split, `Hermético azul
  TATAY 0.5 l ovalado` does not, and every unit the measurement adds.
- `size.spec.ts`: a name with a size in the middle splits as today (D2).

## Acceptance criteria

- [ ] The breakdown of step 1 is in the PR before any code of step 2.
- [ ] A trailing stop and `aprox` split, and a size in the middle stays.
- [ ] A row whose split changes gets a new key (D1), and the PR quotes the moved `ACTIVE`
      rows and the new and orphaned counts.
- [ ] No migration and no release task.
- [ ] No price, no `normalizeName` change.

## Verification

```sh
npx nx test luna-shopper/deza
npx nx test luna-shopper-backend-harvester -t "deza"
npx nx affected -t lint test
```

## Decisions

**D1 (owner, answered 2026-11-11):** a row whose split changes becomes a new entry (option a).
The old one ages out as unseen. No release task repoints or deletes the orphans, and the key
does not keep the split of today.

**D2 (owner, answered 2026-11-11):** no size is read from the middle of a name. The rule: the
harvester records the name as the chain states it. To read more out of a name is work for the
curator, not for the harvester.

**D3 (owner, answered 2026-11-11):** no plan for the Carrefour rest or for El Jamón now. It is
work for the curator. The Carrefour rest is 15 names (glued or two sizes), 22 `pack N` names
whose noun is not in `CONTAINER`, and `Turron 1000 caja de 300 g`, which reads 300 kg
(PR #939).

**D4 (owner, answered 2026-11-11):** a weight printed with `aprox` is not a fixed size. The
`aprox` ending is split off the name as above, and the row states the weight as an
approximate weight with no `unitSize`, as for a product bought by weight, whose exact weight
is known only once it is bought. The field is the `approxWeight` of plan `0244`, in the shape
the DIA and LIDL rows use (sections 5.2 and 5.3), which lifts DEZA out of its section 5.4. A
size that ends only with a full stop (`1 L.`) stays a fixed size. DEZA still writes no price.
