# 0072: an entry whose size is in doubt shows it

> Follow up of backend plan `0249` (PR #942, merged), and checked against `origin/dev` on
> 2026-11-11. Plan `0249` compares a row's stated size with the size its own price and
> comparison price imply, and records a doubt on the row when they disagree. The PR body names
> this plan: "an admin plan that draws the chip on the queue row and the source products
> screen. It shows the stated and implied size and the label, and filters on `sizeDoubt`." No
> admin file outside `wire-types.ts` reads `sizeDoubt` today. On its walks of slot 8, PR #942
> counted 34 doubts in 5,740 DIA products and 32 in 4,328 Mercadona products. The count of
> doubts in a queue was not re-measured on 2026-11-11, Docker was down.
>
> Prerequisite reading: backend plan `0249` in full, the body of PR #942
> (`gh pr view 942`), admin plan `0071` (it draws the report fields, `sizesDisproved`
> included), and `libs/luna-shopper-admin/feature-harvest/src/lib/entry-view.ts`.

## Brief for the agent

### Objective

Show a quiet chip on an entry whose size is in doubt, in the decision queue and on a product's
source rows, with the stated size, the implied size and the label that disproved it. Build it
directly from this plan, with no mock, as admin plans `0067` and `0069` were built (D3). The
queue gets a filter only if the count of D2 asks for one.

### Context

- **The field.** `sizeDoubt?: { implied, unit, ratio, label, runId } | null` is on
  `HarvestItemSourceEntryView`, `HarvestQueuedSourceEntryView` and
  `HarvestSourceCatalogEntryView` (`libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`,
  near lines 4941, 5130 and 5230). Its meaning, from `toSizeDoubtView`
  (`apps/luna-shopper-backend/harvester/src/app/harvest/harvest.mappers.ts`, near line 300):
  - `implied`: the size the price and comparison price imply, in the base unit `unit`, for the
    whole pack.
  - `unit`: `GRAM`, `MILLILITER` or `UNIT`, the base unit of the row's `sizeUnit`.
  - `ratio`: implied divided by stated. The check agrees from 0.85 to 1.18.
  - `label`: the first price label whose dimension is the row's, or null.
  - `runId`: the run that recorded the doubt.
- **A probable pack count is not on the view.** The report examples carry
  `probablePackCount` (`harvest/size-doubt.ts`, near line 34). The rule is a ratio within 2% of
  a whole number from 2 to 48 on a row with no pack count. If the chip shows it, compute it from
  `ratio` with that rule and label it a guess, as PR #942 asks.
- **Where it is drawn.** Two places carry the title "Source products" in `en.json`: the
  harvest queue (`harvest.entries.heading`) and a catalog product's panel of source rows
  (`catalog.items.sources.heading`). PR #942 means both.
  - The queue: `entries-queue-page.ts` draws the current entry's identity line near lines 283
    to 300 with `span.chip` and the list column through `lib-queue-frame` with `listRows()`
    (near line 1232). Its rows are `SourceEntryRow` (`entry-view.ts`, near line 34), made by
    `toSourceEntryRow` (near line 143).
  - A product's source rows: `feature-catalog/src/lib/item-source-entries.ts`
    (`ItemSourceEntryRow` near line 38, `toItemSourceEntryRow` near line 60).
  - `feature-catalog/src/lib/products/product-context.ts` reads no source entry, and this plan
    does not touch it.
- **The chip is a CSS class, not a component.** `.chip` in `entries-queue-page.ts` (near line
  708). The waiting tone is `--admin-waiting-wash` and `--admin-waiting-on-wash`
  (`ui/src/lib/styles/_tokens.scss`, near lines 112 to 113).
- **The memory back end**: `data-access/src/lib/harvest/harvest-memory.ts` and the seeds
  `ITEM_SOURCE_ENTRY_SEED` and `SOURCE_ENTRY_SEED` (`harvest-seed.ts`, near lines 422 and 861).
- **The filter has no route yet.** `SourceEntryListQueryDto`
  (`apps/luna-shopper-backend/gateway/src/app/harvest/harvest.dto.ts`, near line 840) has
  `supermarketId`, `status`, `sourceKind`, `query`, `brandKey` and `delisted`. Plan `0249` D2
  asked for a filter, and it was not built.

### Target state

1. `SourceEntryRow` and `ItemSourceEntryRow` carry a `sizeDoubt` model of the admin, or null,
   mapped from `unknown` (rule D4).
2. The queue's identity line and the list row draw the chip. The entry's facts draw one
   sentence beside the stated size (section 1).
3. A product's source rows draw the chip.
4. If the queue of a slot holds more than one screen of doubts (D2), the queue has a filter
   "Size in doubt", with its gateway half. If it holds one screen or less, the PR gives the
   count and builds no filter.

### Scope

`entry-view.ts` and `entry-view.spec.ts`, `entries-queue-page.ts` and `entries-queue.spec.ts`,
`item-source-entries.ts` and its spec, the models file for the new type, `harvest-memory.ts`,
`harvest-seed.ts` (two seeded doubts), `en.json`. If the count of D2 asks for the filter, also
the gateway DTO, the harvester query, `openapi.json` and `wire-types.ts`. No mock.

### Constraints

- Never edit `openapi.json` or `wire-types.ts` by hand. Regenerate them with
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`.
- The chip is quiet: the waiting tone, no tinted container around it, nothing that moves.
- The sizes are written in the row's own unit, as the refusal of PR #942 writes them:
  `implied` divided by the base factor of `sizeUnit`.
- The doubt never blocks a decision in this plan. The backend refuses a create without a
  named size already.
- No dash as punctuation in any string.

### Action boundaries

- Count the doubts in the queue of a slot that holds a walk before you write the gateway half.
  If the count is one screen or less, do not write it (D2).
- Do not make a mock. Draw the chip as Constraints say (D3).

### Progress evidence

Spec output, `npx nx build luna-shopper-admin`, the count of doubted rows in the queue of a
slot that holds a walk (D2), and screenshots at 1360 px and 390 px of the queue and of a
product's source rows with one doubt.

## 1. Copy

| Key | English |
| --- | --- |
| `harvest.entries.sizeDoubt.chip` | Size in doubt |
| `harvest.entries.sizeDoubt.sentence` | States {{stated}}, its price per {{label}} implies {{implied}}. |
| `harvest.entries.sizeDoubt.sentenceNoLabel` | States {{stated}}, its prices imply {{implied}}. |
| `harvest.entries.sizeDoubt.pack` | Perhaps a pack of {{count}} (a guess). |
| `harvest.entries.filter.sizeDoubt` | Size in doubt |

## Tests

- `entry-view.spec.ts`: a doubt maps, a missing or malformed doubt maps to null, and the sizes
  are in the row's unit.
- `entries-queue.spec.ts`: the chip and the sentence on a doubted entry, none on another one.
- `item-source-entries` spec: the chip on a doubted row.
- The pack guess: shown for a ratio of 6.01 with no pack count, not for 6.2.

## Acceptance criteria

- [ ] A doubted entry shows the chip and the sentence in the queue.
- [ ] A product's doubted source row shows the chip.
- [ ] No hand edit of a generated file.
- [ ] `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.

## Verification

```sh
npx nx test luna-shopper-admin/feature-harvest
npx nx test luna-shopper-admin/feature-catalog
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

## Decisions

The owner answered every decision on 2026-11-11. D1, D2 and D4 are as recommended. D3 is not.
No decision is open.

**D1 (owner, answered 2026-11-11):** the words of section 1 as written.

**D2 (owner, answered 2026-11-11):** the filter comes in this PR if the queue of a slot holds
more than one screen of doubts. The builder counts them first and says the number. The filter
is a `sizeDoubt` flag on `SourceEntryListQueryDto`, parsed like `delisted`, a
`"sizeDoubtImplied" IS NOT NULL` clause in the harvester beside the `delisted` clause
(`apps/luna-shopper-backend/harvester/src/app/harvest/source-entry.service.ts`, near line
312), and both regenerations. If the count is one screen or less, the filter is a later plan.

**D3 (owner, answered 2026-11-11):** no mock. The builder builds directly from this plan, as
admin plans `0067` and `0069` were built. The recommendation was a small mock.

**D4 (owner, answered 2026-11-11):** admin plan `0071` draws `sizesDisproved`, with every other
report field, and this plan draws only the doubt on an entry.
