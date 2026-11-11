# 0268: an entry carries every path its chain files it under

> Asked by the owner on 2026-11-11, and checked against `origin/dev` on 2026-11-11. A chain
> files one product under several of its own categories. A source entry stores one path, the
> first one the walk met. DIA keeps the other leaves only as ids in `extra.diaCategoryIds`,
> which the category resolution reads and nothing else. Carrefour, El Jamón, DEZA and Mercadona
> drop the later paths. The curator and the back office thus see one of the chain's categories,
> and a DIA product whose leaves all lack a slug lands on `uncategorised` with nothing in the
> run report that names it.
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
> The owner answered D1 to D5 on 2026-11-11. The answer to D2 widens the plan from DIA to every
> chain, so the plan took a new title and file name.
>
> Prerequisite reading: plan `0173` (our tree is a copy of DIA's), plan `0174` (a DIA row is
> filed by its leaf ids), plan `0254` (PR #964, not merged on 2026-11-11: the leaves left with no
> slug on purpose), plan `0267` (the same runners hand products to the sink as they read them,
> in the same PR as this plan), admin plan `0071` (the report fields of the run page, in the
> same PR), `apps/luna-shopper-backend/harvester/src/app/harvest/run-report.ts` (`RunReport`),
> `harvest/run-report.sink.ts`, the six catalog runners and `harvest/file-import.runner.ts`,
> `harvest/category-resolution.ts`, `libs/luna-shopper/dia/src/lib/categories.ts`,
> `libs/luna-shopper/tools/curation/suggestions/src/packet.mjs` and `prompt.md`, and
> `libs/luna-shopper-admin/feature-harvest/src/lib/entry-view.ts`.

## Brief for the agent

### Objective

Give each source entry a list of every category path its chain files it under, chain neutral,
and fill it for every chain. Show the list to the curator (the curation packet and its prompt)
and in the back office queue. Make the DIA run report count the products whose leaves all have
no slug, by leaf, with a few examples. This plan decides no category and matches nothing. It
only shows context.

### Context

- **Where `categoryPath` goes today.**
  - Contracts: `SourceCatalogEntryView.categoryPath: string[]`
    (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`, near line 1029), and
    `categoryPath: array(string())` in the schema (`harvest.schemas.ts`, near line 612, required
    near line 676). `ItemSourceEntryView` and `QueuedSourceEntryView` extend that view (near
    lines 1821 and 1855).
  - The harvester: `SourceObservation` (`harvest/source-ingest.ts`, near lines 94 and 150), the
    write in `fieldsOf` (near line 2071), the column `categoryPath`, `jsonb`, default `[]`
    (`entities/source-catalog-entry.entity.ts`, near lines 185 to 187), and the view mapper
    (`harvest.mappers.ts`, near line 272).
  - The curation tool: `packet.mjs` (near line 137) passes `entry.categoryPath`, and
    `prompt.md` (near line 109) calls it "the chain's own shelf path".
  - The back office: `SourceEntryRow.categoryPath` is one string (`entry-view.ts`, near line
    51), joined from the array (near lines 160 and 161). The queue draws it as a field
    (`entries-queue-page.ts`, near line 1316).
  - The category resolution of every adapter other than `dia-api` reads `categoryPath` through
    the Mercadona table (`category-resolution.ts`, near line 57). Its deepest node drives the
    map (the comment of the entity column).
- **The sink.** `RunReport` (`run-report.ts`, near line 108) has `product`, `availability`,
  `assortmentComplete` and the listing calls. `RunReportSink.product()` (`run-report.sink.ts`,
  near line 426) writes a chunk each `PRODUCT_CHUNK` observations. `availability()` (near line
  445) only collects. `drain()` (near line 509) writes the rest, and then the work that needs
  the whole run.
- **What each adapter knows, on `origin/dev`.** Section 3 has the detail. In short:
  - Mercadona: the client walk drops a product it already yielded (`seen`,
    `mercadona.client.ts` near lines 457 to 461), so the walk path is the first category that
    listed it. The detail payload's `categories` array can hold more than one branch: the
    fixture `product-pack-of-wipes.json` has two roots, and
    `product-approximate-weight-per-piece.json` has two children under one root.
    `readProductCategoryPath` (`normalize.ts`, near lines 561 to 572) follows the first.
  - DIA: the walk keeps every leaf id of a product (`record`, `dia-catalog.runner.ts` near lines
    500 to 516) and writes the first leaf as `categoryPath` (near line 755).
  - Carrefour: the runner keeps the first sighting (`products.has`, `carrefour-catalog.runner.ts`
    near lines 247 and 385). Each sighting comes with the path of its frontier category
    (`readCards(listing.cards, category.path)`, near line 383).
  - El Jamón: `record` keeps the first top level category and counts a repeat
    (`eljamon-catalog.runner.ts`, near lines 776 to 782). The path is the breadcrumb of the
    product page, else the top level category of the listing (near lines 684 to 686).
  - LIDL: one path, from `wonCategoryPrimary` (`libs/luna-shopper/lidl/src/lib/normalize.ts`,
    near lines 119 and 158 to 161). The same payloads also carry `wonCategoryBreadcrumbs`, a list
    of paths of the online shop tree, which no code reads. The committed fixtures hold at most
    one breadcrumb a product (`search-page.json`, `product-approximate-weight.json`).
  - DEZA: the first section that saw a product writes `[...section.path, ...row.attributes]`
    (`deza-catalog.runner.ts`, near line 837). A later sighting adds only shop codes (near lines
    818 to 823).
  - The leaflet import and the file import (`file-import.runner.ts`, near line 246): the harvest
    document carries one `category_path` a product, so they know one path or none.
  - The store discovery runs, OSM among them, write places and no source entry. They are out of
    this plan.
  - The Carrefour detail pass (`carrefour-detail.runner.ts`, near line 126) and the price
    refresh (`price-refresh.fetchers.ts`, near line 204) walk no category. They pass the stored
    path or none.
- **The DIA leaves.** Each `DiaLeaf` of the menu carries `id`, `name` and `rootName`
  (`libs/luna-shopper/dia/src/lib/types.ts`, near line 12, filled in `menu.ts` near line 39).
  `diaSlugs` (`category-resolution.ts`, near lines 61 to 73) maps each id through
  `DIA_CATEGORY_SLUGS`. An id with no slug is skipped, and a product with no id that maps gets
  `uncategorised` (near lines 70 to 72).
- **What `noteLeaves` reports.** A leaf goes into `unmappedLeaves` only when its id is in
  neither `DIA_CATEGORY_NAMES` nor `DIA_CATEGORY_SLUGS` (near lines 436 to 448). A leaf that
  `DIA_CATEGORY_NAMES` names and `DIA_CATEGORY_SLUGS` does not map is silent. A product listed
  only under such leaves resolves to `uncategorised`, and no report key names it.
- **Leaves with no slug on purpose.** PR #964 (plan `0254`, not merged on 2026-11-11) leaves
  these mixed leaves with no slug after the owner's answer: L2354, L2222, L2230, L2258, L2355,
  L2353, L2255, L2015. On the walk of 2026-11-11 (store 13835, 5,738 entries) no product sat
  only under a seasonal one.
- **Plan `0267`.** It moves `report.product` of Carrefour, El Jamón, DIA, LIDL and DEZA to the
  first point where the observation is known, often the first sighting. A product's later
  paths then arrive after its observation was written. Section 4 states how the two plans fit.

### Target state

1. **A new field `categoryPaths`** beside `categoryPath`: every path the chain files the entry
   under, each root first, in walk order, distinct. It is chain neutral. `categoryPath` keeps
   its meaning and its value for every adapter (D1).
2. **Every chain fills it** (D2). Each adapter keeps every path it meets for a product, as
   section 3 states. An adapter that can only know one path writes that one path as the single
   element.
3. **The paths travel apart from the observation.** A new call on `RunReport`,
   `categoryPaths(externalId, paths, mode)`, is made once a product at the end of the walk.
   The sink collects the calls and writes them in `drain()`, after the last chunk (section 2).
   An observation never carries the field. A streamed observation of plan `0267` thus never
   writes a partial list.
4. **The entry stores it.** A new column `categoryPaths`, `jsonb`, default `[]`, on
   `source_catalog_entries`. The migration adds the column and deletes and rewrites no row.
5. **The views carry it.** `SourceCatalogEntryView.categoryPaths: string[][]`, in the contract
   type and the schema, read by `ItemSourceEntryView` and `QueuedSourceEntryView` through the
   base view. The OpenAPI document and `wire-types.ts` are regenerated.
6. **The curator sees it.** `packet.mjs` passes `entry.categoryPaths`, and `prompt.md` says
   what it is: every shelf the chain files the product under, as context, in the chain's own
   words, never a category of ours.
7. **The back office sees it** (D4). `SourceEntryRow` carries every path, read from `unknown`
   (rule D4 of the admin), and the queue draws them where it draws the path today, one path a
   line.
8. **The DIA run report names the products from leaves with no slug** (section 5). Admin plan
   `0071` draws it.
9. **No backfill** (D3). Each entry gets its paths on the next walk of its chain.

### Scope

- Harvester: `run-report.ts` and `run-report.sink.ts` (the new call), `source-ingest.ts` (the
  write in `drain()`), the entity, one migration in
  `apps/luna-shopper-backend/harvester/src/app/db/migrations` and its integration spec in
  `db/`, `harvest.mappers.ts`, and each runner of section 3 with its spec.
- The framework free libraries where section 3 says so: `@portfolio/luna-shopper/mercadona`
  (the walk and `readProductCategoryPath`) and `@portfolio/luna-shopper/lidl`
  (`wonCategoryBreadcrumbs`).
- Contracts: `harvest.messages.ts` and `harvest.schemas.ts`.
- Generated: `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, by the two commands of
  `CLAUDE.md`. No file under `apps/luna-shopper-backend/gateway/src` names `categoryPath` on
  `origin/dev`: the gateway answers the contract view, so it gets no DTO change. The OpenAPI
  document changes through the contract schema.
- Curation: `libs/luna-shopper/tools/curation/suggestions/src/packet.mjs`, `prompt.md` and their
  tests.
- Back office: `entry-view.ts`, `entry-view.spec.ts`, `entries-queue-page.ts`, and a few entries
  of the memory seed (`data-access/src/lib/harvest/harvest-seed.ts`) with several paths.
- Out of scope: the run page words (admin plan `0071`), any change to `categoryPath`,
  `diaSlugs`, `DIA_CATEGORY_SLUGS` or `unmappedLeaves`, the harvest document format and the
  export (`harvest-export.ts`, near line 216), which keep one `category_path`.

### Constraints

- **No category is decided here.** A leaf with no slug stays with no slug. Nothing maps a path
  to a slug, and `categorySlugsFor` does not read `categoryPaths`.
- `categoryPath` keeps its value for every adapter, because the category resolution of every
  adapter but DIA reads its deepest node. The first path of `categoryPaths` is the path that
  `categoryPath` holds, when the run wrote both.
- The migration deletes no row and rewrites no row. It adds one column with a default.
- Never edit `openapi.json` or `wire-types.ts` by hand. Regenerate them with
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`, and commit both.
- The field is stated but not required in the schema, as plan `0248` did for `packaging`, so a
  reader built before it keeps validating.
- The back office reads the field from `unknown`. A shape it does not expect reads as no paths.
- The names in the paths are the chain's, verbatim. No translation, no normalization.
- **The per chain rules stay.**
  - DEZA writes no price, ever. Its observations keep `prices: []`.
  - El Jamón never clears a stored photo or category for a row whose page it could not read
    (`eljamon-catalog.runner.ts`, near lines 213 to 233). Its paths follow the same rule
    (section 3).
  - `@portfolio/luna-shopper/mercadona`, `dia`, `carrefour`, `eljamon`, `lidl` and `deza` stay
    free of Nest, TypeORM and the database. Their tests run against the committed fixtures with
    no network. If a fixture must change, refresh it only with the library's
    `capture-fixtures` target, never by hand.
- A run that dies before `drain()` writes no path, and the stored paths stay as they were.

### Action boundaries

- Stop and ask before you write a backfill or a release task (D3).
- Stop and ask before you change `unmappedLeaves` or `categoryPath`.
- Stop and ask before you change the harvest document format.
- Stop and ask before you add a path for LIDL from a field other than `wonCategoryPrimary` and
  `wonCategoryBreadcrumbs`.
- If an adapter cannot keep its paths without a change to what it reports as its observation,
  stop and report that adapter. Build the others.

### Progress evidence

For the first PR: the spec output, the migration integration spec, the two regenerations, one
DIA walk on an ephemeral slot with the count of entries whose `categoryPaths` holds more than
one path, the section 5 block of its run report quoted, and one curation packet of a DIA entry
with several paths. For each adapter PR: the spec output, and one walk of that chain against
its committed fixtures or a closed copy, never the live storefront at full rate, with the count
of entries that hold more than one path.

## 1. Why a new field and not a new meaning for `categoryPath`

Two ways existed, and the owner chose (a) (D1):

- (a) A new field `categoryPaths: string[][]` beside `categoryPath`. Nothing that reads
  `categoryPath` changes.
- (b) `categoryPath` becomes the list of every path. Every reader changes meaning at once: the
  Mercadona table that files every adapter but DIA by the deepest node, the view mapper, the
  admin queue and the curator. A row written before the change and a row written after it then
  mean two different things in one column.

A field in `extra` was a third way, with no migration. `extra` is stored and shown and never
read by any rule, and a field there belongs to one adapter, not to every chain.

## 2. The call and its write

**The call.** `RunReport.categoryPaths(externalId, paths, mode)`. The builder proposes the final
names in the first PR.

- `paths` holds every distinct path the walk met for the product, each root first, in walk
  order. A path that is a prefix of another path of the same product is dropped, because it
  adds nothing the longer path does not say.
- `mode` is `REPLACE` when the walk met every place the product sits in that this walk can
  reach, and `ADD` when it cannot say that. Section 3 states which mode each adapter uses.
- A runner that met no path for a product makes no call. A product the run did not meet is not
  touched.
- A runner makes the call at the end of its walk, after the walk and before `drain()`, as it
  states availability today.

**The write.** The sink collects the calls and, in `drain()`, after the last chunk, writes the
column for each entry of the run's source that a call named:

- `REPLACE` writes the run's paths in place of the stored ones.
- `ADD` writes the stored paths followed by each run path that is not already stored.
- An aborted run writes every call as `ADD`, because a walk that stopped early has not proved
  that a stored path is gone. This follows the rule of `assortmentComplete` (`run-report.ts`,
  near lines 133 to 141).
- An entry the run created has `[]` until `drain()` writes its paths.

**Why at the end and not on the observation.** The paths of a product are a fact of the whole
walk. Plan `0267` writes an observation at the first sighting, before the later paths are
known. On the observation, a streamed chunk would write a partial list, and a run that died
after the chunk would leave it. At the end, a dead run writes no path at all and the stored
list stays whole.

## 3. Every adapter

| Adapter | Where it learns its paths | More than one path? | What changes | Mode |
| --- | --- | --- | --- | --- |
| Mercadona | The walk (`walkCatalog`, `mercadona.client.ts` near line 432) gives each listing its root and child. The detail's `categories` (`readProductCategoryPath`, `normalize.ts` near line 561) is read only when the walk gives no path. | Yes. A product sits in several children of the tree, and a detail can carry several branches (Context). | The client walk keeps every path of a product it already yielded, not only the first. The runner keeps the paths across the warehouses of the run (`union`, `mercadona-catalog.runner.ts` near lines 135 to 170). A product with no walk path gets every branch of the detail's `categories`. | `REPLACE` on a walk whose tree answered, else `ADD` (`missingCategories`, near line 348). |
| DIA | `record` (`dia-catalog.runner.ts`, near lines 500 to 516) gets the menu leaf of each listing row. | Yes, up to four leaves. | `WalkedProduct` keeps the leaves (`DiaLeaf`) and not only their ids. The path of each is `[rootName, name]`. `extra.diaCategoryIds` stays. | `REPLACE` for a scope that finished, else `ADD`. |
| Carrefour | Each card comes with the path of its frontier category (`readCards(listing.cards, category.path)`, near line 383). | Yes. Plan `0090`: a product is listed once in each frontier category it is filed in. | `pageCategory` and `pageFrom` (near lines 247 and 385) keep the path of each later sighting. The end pass `askAgain` adds its paths the same way. | `REPLACE` when `declareListing` would declare the crawl whole (near line 529), else `ADD`. |
| El Jamón | The breadcrumb of the product page (`parseBreadcrumb`, `libs/luna-shopper/eljamon/src/lib/product.ts` near line 43), else the top level category of the listing. | Yes. A product is listed under several top level categories (`rowsRepeated`), and the page has one breadcrumb. | `record` (near line 776) keeps each top level category of a repeat. The paths are the breadcrumb, when the page was read this run, and `[category.name]` for each listing category. | `REPLACE` only when this run read the product's page. `ADD` for a known row and for a row whose page this run did not read, so a breadcrumb read before is never cleared. |
| LIDL | `wonCategoryPrimary` of the page or the search row (`normalize.ts`, near lines 119 and 158 to 161). | The need world tree gives one path. `wonCategoryBreadcrumbs` gives a list of paths of the online shop tree. | `normalize.ts` reads `wonCategoryBreadcrumbs` as paths of names, beside `categoryPathOf(wonCategoryPrimary)`, which stays first. | `REPLACE` when the page answered, else no call. |
| DEZA | Each sighting comes with its section path and the attribute icons (`[...section.path, ...row.attributes]`, near line 837). | Yes. A product is seen in more than one section. | The later sighting (near lines 818 to 823) keeps its path beside the shop codes. | `ADD` always, because a DEZA crawl never proves that it saw a whole section (`CLAUDE.md`, plan `0085`). |
| Leaflet and file import | `category_path` of the harvest document (`file-import.runner.ts`, near line 246). | No. The document holds one path a product. | The runner calls with that one path when it is not empty. | `ADD`, because a leaflet shows one department of a product, not every shelf. |
| Carrefour detail pass, price refresh | Neither walks a category. | No. | No call. The stored paths stay. | None. |

The mode of each row is a proposal the builder of that adapter confirms or corrects in the PR,
with the reason. DEZA and the leaflet import never use `REPLACE`, so a path they wrote stays
until a person or a later plan removes it. That is the honest answer for a chain that cannot
prove completeness.

## 4. How this plan and plan `0267` fit

**What plan `0267` requires of this plan.** No list of paths rides an observation. A streamed
chunk writes what is true at the first sighting and nothing that a later sighting can change.
Section 2 meets that: the paths travel in their own call, at the end.

**What this plan requires of plan `0267`.** A runner that streams its observations still keeps,
for each product, the paths it met until the end of its walk, and makes the
`categoryPaths` call there, as it keeps what `declareListing` and availability need. Plan
`0267` Target state 2 already lets a runner keep what its end of walk work needs, and this call
joins that list. The constraint of plan `0267` "The first sighting of a product keeps its
category path" is about `categoryPath`, which this plan does not change.

**Which lands first.** With the call at the end, the two plans do not depend on each other's
order for correctness. They do touch the same runner files, so two PRs on one runner must not
be open at the same time. The recommended order is D6.

## 5. The DIA products that come only from leaves with no slug

**Definition.** A leaf has no slug when `DIA_CATEGORY_SLUGS` does not map its id, whether
`DIA_CATEGORY_NAMES` names it or not. A product is only from leaves with no slug when every
leaf it was listed under is such a leaf. That product resolves to `uncategorised` by
`diaSlugs`.

**The report block.** The DIA `toReport` (near lines 519 to 560) gains:

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

**Only DIA.** The block needs a table of the chain's own leaves that says which leaf has a slug
and which has none on purpose. Only DIA has one (`DIA_CATEGORY_NAMES` and
`DIA_CATEGORY_SLUGS`). Every other adapter resolves its path by name through a table that
climbs to the root, so a node nobody mapped and a node with no category on purpose look the
same. An equivalent for another chain needs one of two things, and this plan builds neither:

- A table of that chain's nodes with a slug or "no slug on purpose", as DIA has.
- At least a count of the run's entries whose path resolves to `uncategorised`, which
  `categorySlugsFor` already knows. That count says "unmapped" without saying why.

**The words on the run page** (D5). Admin plan `0071` owns the report section of the run page
and draws this block with every other report field (its section 2 names it). This plan states
the copy, and admin plan `0071` uses it:

| Key | English |
| --- | --- |
| `harvest.run.report.unslottedOnly.heading` | Products only in chain categories we do not map |
| `harvest.run.report.unslottedOnly.count` | {{count}} products sit only in chain categories with no category of ours. They wait as uncategorised. |
| `harvest.run.report.unslottedOnly.leaf` | {{root}} / {{name}}: {{count}} products |
| `harvest.run.report.unslottedOnly.examples` | For example: {{names}} |

If admin plan `0071` is built before this block is on `origin/dev`, the run page draws the
block in a short follow up of admin plan `0071`. The builder of this plan says in the PR which
case applies. If the builder renames the block, both plans change in that PR.

## 6. The build, in several PRs

With every chain this plan is large. The cut is the builder's to propose in the first PR.
Recommended:

1. **The base and DIA.** The call and its write in `drain()`, the column and its migration, the
   contract type and schema, the view mapper, the two regenerations, the curation packet and
   prompt, the back office mapping and queue, and DIA with its report block of section 5. This
   PR alone gives the owner what was first asked for.
2. **One PR for each remaining adapter, or a small group.** Carrefour, El Jamón, Mercadona,
   LIDL, DEZA, and the leaflet and file import. A small group that fits one review is
   Carrefour with DEZA (both add a path at a later sighting), and LIDL with the leaflet import
   (both read one field). El Jamón and Mercadona each touch a framework free library or a rule
   of their own, and each is a PR of its own.

Each later PR names this plan and its row of section 3.

## Tests

- `run-report.sink.spec.ts`:
  - `REPLACE` writes the run's paths in place of the stored ones, and `ADD` keeps the stored
    paths and adds the new ones once.
  - An aborted run writes a `REPLACE` call as `ADD`.
  - The write happens in `drain()`, after the last chunk, and a run that never reaches
    `drain()` writes no path.
  - An entry with no call keeps its stored paths.
- `dia-catalog.runner.spec.ts`:
  - A product under three leaves gets three paths, in walk order, and its first path equals
    `categoryPath`.
  - A product under one leaf gets one path.
  - Two products under leaves with no slug, one also under a mapped leaf: the report counts one
    product, names it under its leaf, and gives at most five examples a leaf.
  - A leaf that `DIA_CATEGORY_NAMES` names and `DIA_CATEGORY_SLUGS` does not map counts as a
    leaf with no slug.
- For each other adapter, in its runner spec: a product met on two paths gets both, in walk
  order, and the mode of section 3. Plus:
  - El Jamón: a known row and a row whose page was not read call with `ADD`, and a stored
    breadcrumb stays.
  - DEZA: no observation carries a price, and every call is `ADD`.
  - Mercadona: the library spec of the walk yields every path of a product listed in two
    children, with a fake fetch that answers two committed listing payloads, and
    `readProductCategoryPath` reads both branches of `product-pack-of-wipes.json`.
  - LIDL: the library spec reads `wonCategoryBreadcrumbs` of `search-page.json` as a second
    path, and a product with none gets one path.
  - The file import: a product with a `category_path` calls with one path, and one with none
    makes no call.
- The migration integration spec: the column exists with the default `[]`, and the row count of
  `source_catalog_entries` is the same before and after.
- `harvest.mappers` spec: the view carries `categoryPaths`, and a row with no value reads `[]`.
- Curation: the packet carries `categoryPaths`, and the prompt test finds its line.
- `entry-view.spec.ts`: the paths map, and a malformed value maps to no paths.
- `category-resolution.spec.ts`: unchanged, and green.

## Acceptance criteria

- [ ] An entry of every chain met on several paths shows every path to the curator and in the
      queue, after the PR of its adapter.
- [ ] `categoryPath` and the category of every product are unchanged.
- [ ] A run that dies writes no path, and an aborted run removes no stored path.
- [ ] El Jamón never clears a stored path for a row whose page it did not read, and DEZA writes
      no price.
- [ ] The DIA run report names the products whose leaves all have no slug, by leaf, with
      examples.
- [ ] The migration adds one column and deletes no row.
- [ ] `openapi.json` and `wire-types.ts` are regenerated, never edited by hand.
- [ ] The framework free libraries name no Nest and no TypeORM, and no fixture is edited by
      hand.
- [ ] Admin plan `0071` and this plan name the same report block and the same copy.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "RunReportSink"
npx nx test luna-shopper-backend-harvester -t "dia"
npx nx test luna-shopper-backend-harvester -t "categorySlugsFor"
npx nx test luna-shopper/mercadona
npx nx test luna-shopper/lidl
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/feature-harvest
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

Each adapter PR adds the test target of its runner (`-t "carrefour"`, `-t "eljamon"`,
`-t "lidl"`, `-t "deza"`, `-t "mercadona"`, `-t "file import"`). Then the migration
integration spec on an ephemeral slot, and the walks of Progress evidence.

## Decisions

**D1 (owner, answered 2026-11-11):** a new field `categoryPaths` beside `categoryPath`, in a new
column (option a of section 1). `categoryPath` keeps its meaning.

**D2 (owner, answered 2026-11-11):** every chain fills it, not DIA only. Section 3 states what
each adapter knows and what changes. An adapter that can only know one path writes that one
path as the single element.

**D3 (owner, answered 2026-11-11):** no backfill. Existing entries get their paths on the next
walk of their chain.

**D4 (owner, answered 2026-11-11):** the back office queue shows the paths, in this plan.

**D5 (owner, answered 2026-11-11):** the run page words of section 5 as written. Admin plan
`0071` uses them.

**D6. The order of this plan and plan `0267`. Open.** Section 4 shows that the order does not
change the result. It decides only which PR rebases onto which, runner by runner.

- (a) PR 1 of this plan (section 6) first. Then, for each runner, the PR of plan `0267` before
  the PR of this plan for that runner.
- (b) Plan `0267` first for every runner, then this plan.
- (c) This plan first for every runner, then plan `0267`.

Recommended: (a). PR 1 touches the sink, the contract and the DIA runner, and plan `0267`
builds DIA last, so PR 1 conflicts with nothing that plan `0267` builds first. After that, plan
`0267` moves the report calls of a runner, and the adapter PR of this plan then adds one end of
walk call to code that has stopped moving. Plan `0267` starts with Carrefour and El Jamón, the
longest walks, so their data loss is fixed first.
