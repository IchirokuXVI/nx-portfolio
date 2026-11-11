# 0268: a DIA entry carries every leaf the chain files it under

> Asked by the owner on 2026-11-11, and checked against `origin/dev` on 2026-11-11. DIA files
> one product under up to four leaves of its menu. A DIA entry stores one path, the first leaf
> that the walk met. The other leaves survive only as ids in `extra.diaCategoryIds`, which the
> category resolution reads and nothing else. The curator and the back office thus see one of
> the chain's categories, and a product whose leaves all lack a slug lands on `uncategorised`
> with nothing in the run report that names it.
>
> The owner's rules (2026-11-11):
>
> - A chain category that fits none of our categories is kept, and it is not forced onto a slug.
> - The curator decides the category of each product, and needs the chain's categories as
>   context. "Ibéricos y quesos" tells the curator that the product is most probably ham or
>   cheese. "Especial otoño" tells little. In the owner's words: "the curator needs all of them
>   for context".
> - In the owner's words: "it would be nice to know which products come from unmapped
>   categories".
>
> Prerequisite reading: plan `0173` (our tree is a copy of DIA's), plan `0174` (a DIA row is
> filed by its leaf ids), plan `0254` (PR #964, not merged on 2026-11-11: the leaves left with no
> slug on purpose), admin plan `0071` (the report fields of the run page, in the same PR as this
> plan), `apps/luna-shopper-backend/harvester/src/app/harvest/dia-catalog.runner.ts`,
> `harvest/category-resolution.ts`, `libs/luna-shopper/dia/src/lib/categories.ts`,
> `libs/luna-shopper/tools/curation/suggestions/src/packet.mjs` and `prompt.md`, and
> `libs/luna-shopper-admin/feature-harvest/src/lib/entry-view.ts`.

## Brief for the agent

### Objective

Give each source entry a list of every category path the chain files it under, chain neutral,
and fill it for DIA. Show the list to the curator (the curation packet and its prompt) and in
the back office queue. Make the DIA run report count the products whose leaves all have no
slug, by leaf, with a few examples. This plan decides no category and matches nothing. It only
shows context.

### Context

- **One path per DIA product.** `observationOf` (`dia-catalog.runner.ts`, near lines 678 to
  764) writes `categoryPath: [product.firstLeaf.rootName, product.firstLeaf.name]` (near line
  755). The walk keeps every leaf of a product as `leafIds` (near lines 507 to 515), and the
  observation stores them as `extra.diaCategoryIds` (near line 731).
- **Only the category resolution reads the ids.** `diaSlugs` (`category-resolution.ts`, near
  lines 61 to 73) maps each id through `DIA_CATEGORY_SLUGS`. An id with no slug is skipped, and
  a product with no id that maps gets `uncategorised` (near lines 70 to 72). No other code reads
  `diaCategoryIds`.
- **The leaf names are known to the walk.** Each `DiaLeaf` of the menu carries `id`, `name` and
  `rootName` (`libs/luna-shopper/dia/src/lib/types.ts`, near line 12, filled in `menu.ts` near
  line 39). `noteLeaves` (near lines 436 to 453) keeps the menu leaves of the run in
  `walk.leaves`.
- **What `noteLeaves` reports.** A leaf goes into `unmappedLeaves` only when its id is in
  neither `DIA_CATEGORY_NAMES` nor `DIA_CATEGORY_SLUGS` (near lines 444 to 448). A leaf that
  `DIA_CATEGORY_NAMES` names and `DIA_CATEGORY_SLUGS` does not map is silent. A product listed
  only under such leaves resolves to `uncategorised`, and no report key names it.
- **Leaves with no slug on purpose.** PR #964 (plan `0254`, not merged on 2026-11-11) leaves
  these mixed leaves with no slug after the owner's answer: L2354, L2222, L2230, L2258, L2355,
  L2353, L2255, L2015. On the walk of 2026-11-11 (store 13835, 5,738 entries) no product sat
  only under a seasonal one.
- **Where `categoryPath` goes today.**
  - Contracts: `SourceCatalogEntryView.categoryPath: string[]`
    (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`, near line 1029), and
    `categoryPath: array(string())` in the schema (`harvest.schemas.ts`, near line 612).
    `ItemSourceEntryView` and `QueuedSourceEntryView` extend that view (near lines 1821 and
    1855).
  - The harvester: `SourceObservation` (`harvest/source-ingest.ts`, near lines 94 and 150), the
    write (near line 2071), the column `categoryPath`, `jsonb`, default `[]`
    (`entities/source-catalog-entry.entity.ts`, near lines 185 to 187), and the view mapper
    (`harvest.mappers.ts`, near line 272).
  - The curation tool: `packet.mjs` (near line 137) passes `entry.categoryPath`, and
    `prompt.md` (near line 109) calls it "the chain's own shelf path".
  - The back office: `SourceEntryRow.categoryPath` is one string (`entry-view.ts`, near line
    51), joined from the array (near lines 160 and 161).
  - The category resolution of every adapter other than `dia-api` reads `categoryPath` through
    the Mercadona table (`category-resolution.ts`, near line 57). Its deepest node drives the
    map (the comment of the entity column).
- **Other adapters that meet a product on more than one path.** Carrefour lists a product once
  in each frontier category it is filed in and keeps the first sighting (plan `0090`, the
  `pageCategory` comment). El Jamón keeps the first sighting and counts the repeats
  (`rowsRepeated`). DEZA keeps the first section that saw a product. LIDL reads one
  `wonCategoryPrimary` (`libs/luna-shopper/lidl/src/lib/normalize.ts`, near line 119).
  Mercadona follows the first branch of its `categories` array (`normalize.ts`, near lines 561
  to 572). The builder says for each whether the payload holds more than one path (D2).

### Target state

1. **A new field `categoryPaths`** beside `categoryPath`: every path the chain files the entry
   under, each root first, in walk order, distinct. It is chain neutral. `categoryPath` keeps
   its meaning and its value (D1).
2. **DIA fills it.** For each id in `leafIds`, the path is `[rootName, name]` of that menu leaf.
   The first path equals `categoryPath`. Every other adapter writes `[]` (D2).
3. **The entry stores it.** A new column `categoryPaths`, `jsonb`, default `[]`, on
   `source_catalog_entries`. The migration adds the column and deletes and rewrites no row.
4. **The views carry it.** `SourceCatalogEntryView.categoryPaths: string[][]`, in the contract
   type and the schema, read by `ItemSourceEntryView` and `QueuedSourceEntryView` through the
   base view. The OpenAPI document and `wire-types.ts` are regenerated.
5. **The curator sees it.** `packet.mjs` passes `entry.categoryPaths`, and `prompt.md` says
   what it is: every shelf the chain files the product under, as context, in the chain's own
   words, never a category of ours.
6. **The back office sees it.** `SourceEntryRow` carries every path, read from `unknown` (rule
   D4), and the queue draws them where it draws the path today (D4 of this plan).
7. **The run report names the products from leaves with no slug** (section 2). Admin plan
   `0071` draws it.
8. **Existing entries get their paths on the next full read** of a DIA walk. No backfill (D3).

### Scope

- Harvester: `dia-catalog.runner.ts` and its spec, `source-ingest.ts`, the entity, one
  migration in `apps/luna-shopper-backend/harvester/src/app/db/migrations` and its integration
  spec in `db/`, `harvest.mappers.ts`.
- Contracts: `harvest.messages.ts` and `harvest.schemas.ts`.
- Generated: `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, by the two commands of
  `CLAUDE.md`. No file under `apps/luna-shopper-backend/gateway/src` names `categoryPath` on
  `origin/dev`: the gateway answers the contract view, so it gets no DTO change. The OpenAPI
  document changes through the contract schema.
- Curation: `libs/luna-shopper/tools/curation/suggestions/src/packet.mjs`, `prompt.md` and their
  tests.
- Back office: `entry-view.ts`, `entry-view.spec.ts` and the queue page that draws the path.
- Out of scope: the run page words (admin plan `0071`), any change to `categoryPath`,
  `diaSlugs`, `DIA_CATEGORY_SLUGS` or `unmappedLeaves`.

### Constraints

- **No category is decided here.** A leaf with no slug stays with no slug. Nothing maps a path
  to a slug, and `categorySlugsFor` does not read `categoryPaths`.
- `categoryPath` keeps its value for every adapter, because the category resolution of every
  adapter but DIA reads its deepest node.
- The migration deletes no row and rewrites no row. It adds one column with a default.
- Never edit `openapi.json` or `wire-types.ts` by hand. Regenerate them with
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`, and commit both.
- The field is stated but not required in the schema, as plan `0248` did for `packaging`, so a
  reader built before it keeps validating.
- The back office reads the field from `unknown`. A shape it does not expect reads as no paths.
- The names in the paths are the chain's, verbatim. No translation, no normalization.

### Action boundaries

- Stop and ask before you fill `categoryPaths` for an adapter other than DIA (D2).
- Stop and ask before you write a backfill or a release task (D3).
- Stop and ask before you change `unmappedLeaves` or `categoryPath`.

### Progress evidence

The spec output, the migration integration spec, the two regenerations, one DIA walk on an
ephemeral slot with the count of entries whose `categoryPaths` holds more than one path, the
section 2 block of its run report quoted, and one curation packet of a DIA entry with several
paths.

## 1. Why a new field and not a new meaning for `categoryPath`

Two ways exist:

- (a) A new field `categoryPaths: string[][]` beside `categoryPath`. It touches the contracts
  type and schema, the entity and one migration that adds a column, the observation, the
  mapper, the two regenerations, the curation packet and prompt, and the back office mapping.
  Nothing that reads `categoryPath` changes.
- (b) `categoryPath` becomes the list of every path, or the paths joined into one array. Every
  reader changes meaning at once: the Mercadona table that files every adapter but DIA by the
  deepest node, the view mapper, the admin queue and the curator. A row written before the
  change and a row written after it then mean two different things in one column.

Recommended: (a). A field in `extra` is a third way, with no migration. `extra` is stored and
shown and never read by any rule, and a field there is DIA's own and not chain neutral, so the
view would read a key of one adapter. It is not recommended.

## 2. The products that come only from leaves with no slug

**Definition.** A leaf has no slug when `DIA_CATEGORY_SLUGS` does not map its id, whether
`DIA_CATEGORY_NAMES` names it or not. A product is only from leaves with no slug when every id
of its `leafIds` is such a leaf. That product resolves to `uncategorised` by `diaSlugs`.

**The report block.** The DIA `toReport` (near lines 540 to 560) gains:

```ts
unslottedOnly: {
  /** Products whose every leaf has no slug. */
  products: number;
  /** One entry per leaf with no slug that holds at least one such product. */
  leaves: Array<{
    id: string;
    rootName: string;
    name: string;
    /** Products only from leaves with no slug, listed under this leaf. */
    products: number;
    /** The first five, in walk order. */
    examples: Array<{ externalId: string; name: string }>;
  }>;
};
```

A product under two such leaves counts once in `products` and once under each leaf. The names
of the block are the builder's to propose in the PR. The cap of five examples a leaf follows
the cap of twenty examples of `sizesDisprovedExamples` (`run-executor.service.ts`, near line
983) in spirit: enough to read, not a list of the run.

`unmappedLeaves` keeps its meaning: a leaf the table does not know, for an operator to add. The
new block answers the owner's other question: which products come from a leaf that has no
slug, known or not.

**The words on the run page.** Admin plan `0071` owns the report section of the run page and
draws this block with every other report field (its section 2 names it). This plan states the
copy, and admin plan `0071` uses it:

| Key | English |
| --- | --- |
| `harvest.run.report.unslottedOnly.heading` | Products only in chain categories we do not map |
| `harvest.run.report.unslottedOnly.count` | {{count}} products sit only in chain categories with no category of ours. They wait as uncategorised. |
| `harvest.run.report.unslottedOnly.leaf` | {{root}} / {{name}}: {{count}} products |
| `harvest.run.report.unslottedOnly.examples` | For example: {{names}} |

If admin plan `0071` is built before this block is on `origin/dev`, the run page draws the
block in a short follow up of admin plan `0071`. The builder of this plan says in the PR which
case applies. If the builder renames the block (above), both plans change in that PR.

## Tests

- `dia-catalog.runner.spec.ts`:
  - A product under three leaves gets three paths, in walk order, and its first path equals
    `categoryPath`.
  - A product under one leaf gets one path.
  - Two products under leaves with no slug, one also under a mapped leaf: the report counts one
    product, names it under its leaf, and gives at most five examples a leaf.
  - A leaf that `DIA_CATEGORY_NAMES` names and `DIA_CATEGORY_SLUGS` does not map counts as a
    leaf with no slug.
- The ingest: an observation with `categoryPaths` writes the column on a full read, and an
  observation from another adapter writes `[]`.
- The migration integration spec: the column exists with the default `[]`, and the row count of
  `source_catalog_entries` is the same before and after.
- `harvest.mappers` spec: the view carries `categoryPaths`, and a row with no value reads `[]`.
- Curation: the packet carries `categoryPaths`, and the prompt test finds its line.
- `entry-view.spec.ts`: the paths map, and a malformed value maps to no paths.
- `category-resolution.spec.ts`: unchanged, and green.

## Acceptance criteria

- [ ] A DIA entry under several leaves shows every leaf path to the curator and in the queue.
- [ ] `categoryPath` and the category of every product are unchanged.
- [ ] The DIA run report names the products whose leaves all have no slug, by leaf, with
      examples.
- [ ] The migration adds one column and deletes no row.
- [ ] `openapi.json` and `wire-types.ts` are regenerated, never edited by hand.
- [ ] Admin plan `0071` and this plan name the same report block and the same copy.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "dia"
npx nx test luna-shopper-backend-harvester -t "categorySlugsFor"
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/feature-harvest
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

Then the migration integration spec on an ephemeral slot, and one DIA walk on it, as Progress
evidence says.

## Decisions

**D1. A new field or a new meaning for `categoryPath`.** Section 1 weighs them. Recommended:
(a), a new field `categoryPaths` in a new column.

**D2. Other chains.** The field is chain neutral. Carrefour, El Jamón and DEZA meet a product on
more than one path and keep the first. Mercadona and LIDL read one path from the payload, as
far as this plan read.

- (a) DIA only in this plan. Every other adapter writes `[]`, and a later plan fills one
  adapter at a time.
- (b) Every adapter that meets a product on more than one path, in this plan.

Recommended: (a). Each other adapter keeps its first sighting for a reason its own plan states,
and each is a review of its own. The builder lists in the PR which adapters know more than one
path.

**D3. Existing entries.**

- (a) No backfill. Each entry gets its paths on the next full read of a DIA walk, as every
  field of the source does.
- (b) A release task that fills the column from `extra.diaCategoryIds` and the leaf names of
  `DIA_CATEGORY_NAMES`.

Recommended: (a). DIA walks run on a schedule, and a backfill rewrites rows that a walk rewrites
anyway. A leaf that `DIA_CATEGORY_NAMES` does not name has no name to backfill.

**D4. The back office half.**

- (a) In this plan: `entry-view.ts` maps the paths, and the queue draws every path where it
  draws one today, one path a line.
- (b) A later admin plan.

Recommended: (a). It is one mapping and one line of the queue, and the owner asked for the
context where the decision is made.

**D5. The words of section 2.** Recommended: as written. Admin plan `0071` uses them.
