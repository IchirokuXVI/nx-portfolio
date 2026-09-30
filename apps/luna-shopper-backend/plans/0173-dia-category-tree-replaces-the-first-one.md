# 0173: DIA's category tree replaces the first one

> Prerequisite reading: `0166` (categories as rows: the model, the triggers, the seed, the
> harvester's slug resolution), admin `0036` (the Categories screen and "Set categories"), `0167`
> (shop sections point at categories), velista `0118`, `0119` and `0120` (the category store, the
> picker and the aisles), and `0174` (the DIA adapter that reads this tree back). In the code:
> `catalog/src/app/db/reference/categories.ts`, `taxonomy-seed.ts`,
> `db/migrations/1758100000000-CategoryTree.ts`, `reference-catalog.spec.ts`,
> `harvester/src/app/harvest/category-resolution.ts` and
> `libs/luna-shopper/mercadona/src/lib/categories.ts`.

Plan `0166` seeded a hand written tree of 17 roots and 84 leaves and said it was "a starting point
... edited in the back office afterwards". The owner has chosen a better starting point: DIA's
own tree, which is complete (28 roots and 244 leaves after the drops below) and exists in Spanish
and English. This plan replaces the first tree with it.

**The first tree has not reached any cluster.** The `0166` migration is on `dev` and not on
`main` (checked on 2026-09-29: commit `42278671` is not an ancestor of `origin/main`), so neither
cluster has a `categories` table yet, and the reference seed is off in both
(`referenceSeed.enabled: false`). Developer slots and compose volumes have run it. So this is the
cheapest moment the tree will ever have to change.

DIA's tree was read on 2026-09-29. The probe scripts, the tree in both languages and the
analysis behind the drops are committed under `apps/luna-shopper-backend/harvester/docs/research/dia/`.

## Brief for the agent

### Objective

Replace the category tree with the tree of Appendix A (29 roots, 246 leaves: DIA's tree without
its seasonal, offer and campaign categories, plus three rows of ours), everywhere a category is
defined, seeded, mapped or named: a new catalog migration, the reference taxonomy and every
seeded product's categories, the Mercadona and LIDL category tables, the in memory twins in
velista and the admin, and every spec and e2e test that names a slug or a category name.

### Context

- A category is a row of `categories` (`id`, `parentId`, `slug`, `name` as `{ es, en }`,
  `position`). Its id is `uuidv5("category:" + slug, <fixed namespace>)` (`db/reference/ids.ts`),
  so **a slug is an id**, and a new slug equal to an old one is the old row.
- Two levels, enforced by triggers: a parent is a root, and a product sits on a leaf only. DIA's
  tree is two levels too, so neither trigger changes.
- `item_categories` and `section_categories` point at categories with `ON DELETE RESTRICT`. Only
  catalog holds category ids. Core, realtime, assistant and auth hold none.
- The harvester files a product created from a source row by running the row's `categoryPath`
  through the Mercadona table (`resolveCategory`), whatever the chain, and a path it cannot place
  lands on `uncategorised`. LIDL has its own table whose answer nothing reads yet.
- The reference seed upserts by id and never deletes. It runs on developer slots (`stack.sh`) and
  is off in both clusters.

### Target state

- A new migration leaves every database, fresh or already migrated by `0166`, holding exactly the
  tree of Appendix A, with every product and every shop section remapped by Appendix C and no row
  of the first tree left that Appendix A does not name.
- `categories.ts` is Appendix A, and `reference-catalog.spec.ts` asserts that, not the old counts.
- Every seeded product sits on the Appendix A leaf that fits it, chosen product by product.
- The Mercadona and LIDL tables answer Appendix A slugs only, and both `category-leaves.ts` copies
  are the Appendix A leaf list.
- Velista, the admin and every e2e suite pass against the new tree.
- `openapi.json` and `wire-types.ts` are unchanged, or regenerated and committed if they change.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/db/migrations/` (one new migration, and its entry in
  `index.ts`), `db/reference/` (`categories.ts`, `authored.ts`, `mercadona.ts`, their specs),
  `db/seed/` (the demo seed), and catalog specs that name slugs
- `apps/luna-shopper-backend/harvester/`: specs and fakes that name slugs (`category-tree.fake.ts`
  and the rest); `category-resolution.ts` only if a comment names the old tree
- `libs/luna-shopper/mercadona/src/lib/categories.ts`, `libs/luna-shopper/lidl/src/lib/categories.ts`,
  both `category-leaves.ts` copies, and their specs
- `libs/luna-shopper/test-fixtures` (the demo world names `milk` and `bread`)
- `libs/velista/data-access` in memory twins (`category-memory.ts`, `catalog-browse-memory.ts`,
  `catalog-memory.ts`, `basket-memory.ts`) and velista specs that name slugs
- `libs/luna-shopper-admin/data-access` memory seeds (`category-seed.ts`, `catalog-seed.ts`,
  `section-seed.ts`) and admin specs that name slugs
- `libs/luna-shopper/tools/curation/`: the prompt examples and fixture `categories.json` files, and
  `tools/catalog/review-entries-prompt.md`
- `apps/velista-luna-e2e/src/` (`catalog.spec.ts`, `aisles.spec.ts`, and any other suite that
  names a category)
- `apps/luna-shopper-backend/harvester/docs/research/dia/` is already committed with this plan.
  Read it, do not change it.

Do not touch: the `0166` migration file, the triggers, the entity, any service or controller,
velista or admin components and templates, the DIA adapter (`0174`), or any Helm values file.

### Constraints

- **Never edit `1758100000000-CategoryTree.ts`.** Developer databases have run it. The change is a
  new migration after `1758200000000-ShopSections.ts`.
- Names are DIA's, verbatim, in both languages, including the English names that read as machine
  translation (Appendix A lists them). Correcting them is the owner's call, in the back office.
- Slugs, parents and positions are Appendix A's exactly. Do not rename, merge or reorder.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- changing a trigger, the entity, or anything that allows a third level
- deleting a category that still holds a product or a section after the remap of section 4
- a mapping in Appendix C that the data contradicts (for example a leaf whose seeded products
  plainly belong elsewhere): say which, and the target you propose
- any change to velista or admin UI code: the tree grows from 101 rows to 275, and section 8 says
  what that does, but a change is a separate plan

### Progress evidence

- The migration's integration spec of section 10, run against real Postgres.
- The reference seed proved as `reference-seed-renames-safely` describes: the built `migrate.js`
  and `seed-reference.js` on a throwaway Postgres, once fresh and once on a database that ran only
  `0166` and holds products and sections on old rows.
- A velista browser check on a slot: the category picker lists the 28 DIA roots, and a seeded
  product appears under its new leaf.
- `nx affected -t lint test` green, and the velista-luna-e2e suite green on a slot.

## 1. DIA's tree

| Fact | Value |
| --- | --- |
| Source | `GET https://www.dia.es/api/v1/common-aggregator/menu-data` |
| Levels | two, the same as ours |
| Roots | 29, plus `L150` Ofertas, an offer listing flagged as a category |
| Leaves in the menu | 251, plus a "Todo" child per root that carries the root's own id |
| Hidden leaves | 27 in `sitemap.xml` and not in the menu: dormant Christmas, summer, gluten free and campaign trees |
| Ids | `L` plus digits, the same in both languages, the join key |
| English | server session state: `PATCH /api/v1/common-aggregator/current/locale` `{"locale":"en"}`, then the same `menu-data` request answers in English. `?locale=en` and `Accept-Language` change nothing |

**The tree changes over time.** Against a Wayback snapshot from December 2024: 24 roots and 191
leaves then, 163 of those ids still exist, only 17 keep their full path, and two ids were reused
with a new meaning. So this plan copies the tree **once**, as ours. It is not a mirror, and it
does not follow DIA afterwards. The DIA adapter (`0174`) reports DIA leaves it cannot map, and an
operator decides.

## 2. The new tree

### 2.1 What is copied

DIA's menu tree, two levels, in DIA's menu order, names verbatim in `es` and `en`, **without**:

| Dropped | Why |
| --- | --- |
| `L128` Novedades y recomendados, with its six leaves (Novedades, Oktoberfest, Freidora de aire, Selección sin gluten, Nutrición deportiva, Mejor valorados) | novelty, campaign, ranking and theme lists. Every one of their products sits in a kept leaf too (measured, 100%) |
| `L150` Ofertas | an offer listing, not a kind of product |
| `L2040` Frutas de temporada | seasonal: its content changes by the month |
| the 27 hidden leaves | dormant campaign trees DIA itself no longer shows |
| the "Todo" children | they are the root itself |

**Kept on purpose**, though they read as seasonal or as a diet list, because each is a kind of
product and not a moment in the calendar: `L2267` Melón y sandía, `L2119` Tinto de verano y
sangría, `L2106` Gazpachos, `L2340` Protector solar, and the gluten free leaves that sit under a
stable root (`L2200` Pan sin gluten, `L2274` Pastas sin gluten, `L2323` Galletas, cereales y
tortitas sin gluten). Most products DIA files under the first four are filed nowhere else (0 to
4% elsewhere), so dropping them orphans them. Duplicate navigation leaves (packs, the infant
subsets) are kept too: a product sits on up to ten categories.

### 2.2 Three rows of ours

- `other-fruits` ("Otras frutas" / "Other fruits"), the last leaf under Frutas. Eleven fruits
  (granada, chirimoya, ciruelas, melocotón, nectarina, higos and others) are listed only under
  Frutas de temporada. Dropping that leaf needs a stable home for them, and DIA has no general
  fruit leaf.
- `other` ("Otros" / "Other"), the last root, with its one leaf `uncategorised` ("Sin categoría" /
  "Not yet categorised"). The harvester files a product it cannot place there (`0166`, section
  7). Both are today's rows, unchanged, so they keep their ids.

### 2.3 Slugs

A slug is DIA's English URL segment for that node. Where two rows of the new tree share one,
each leaf of the pair takes `<its root's slug>-<slug>`. Where a new leaf takes the slug of a
current row of a different level, the new leaf takes the prefix too, so it never inherits that
row's id. Appendix A states the result, and it is the only source: do not derive slugs again.

The renames the rule made:

- `canned-vegetables`, `fresh`, `noodles` and `cakes` each appear twice in DIA's tree. Both halves
  are prefixed, and `L2270` Fideos takes its Spanish segment (`rice-pasta-and-pulses-fideos`)
  because both noodle leaves sit under the same root.
- `fish-and-seafood` and `juices-and-smoothies` are roots and also leaf segments elsewhere. The
  roots keep their slugs and the leaves are prefixed.
- `frozen` is today's root Congelados and DIA's leaf Congelado under Pescados. The leaf becomes
  `fish-and-seafood-frozen`, so today's root is not silently turned into frozen fish.
- `L2229` uses its canonical English slug, `protein-desserts-and-yogurts`.

### 2.4 Positions

`position` per sibling group from 0, in DIA's menu order. `other-fruits` is Frutas' last leaf and
`other` is the last root.

## 3. What the tree's own rules become

The database rules stay: two levels, a product only on a leaf, slugs unique, both languages on
every seeded row, `ON DELETE RESTRICT`. What changes is what `reference-catalog.spec.ts` asserts
about **this** tree. Today it asserts 17 roots and 84 leaves, at most 8 children per root, an
`other-*` catch all under every root, and agreement with `0166`'s `ROOTS` and `LANDING_LEAVES`.
DIA's roots have up to 14 leaves and no catch alls, so replace those assertions with:

- the taxonomy equals Appendix A: every slug, parent, position and both names
- every root has at least one leaf, every slug matches the slug rule, all slugs are distinct
- every row the new migration inserts equals the taxonomy row of the same slug, id for id
- `uncategorised` exists under `other`

The agreement with `0166`'s exported `ROOTS` and `LANDING_LEAVES` moves: it now holds only in the
`0166` migration's own spec, as history, because the reference file no longer contains those rows.

## 4. The migration

One new migration, `<next timestamp>-DiaCategoryTree`, after `1758200000000-ShopSections`. It
exports the Appendix A rows and the Appendix C map as constants, so specs read the same data.

`up`, in one transaction, in this order:

1. **Insert or update every Appendix A row, roots first, then leaves**, with
   `ON CONFLICT (id) DO UPDATE SET parentId, name, position`. A row whose slug already exists
   (`fish-and-seafood`, `bakery`, `pets`, `pork`, `milk`, `eggs`, `cereals`, `water`, `other`,
   `uncategorised`, and `vegetables`) is that row, updated in place. **Except `vegetables`**: today
   a leaf holding products, tomorrow a root. The two level trigger refuses making a row with
   products into a root, so move its products and sections (step 2) before updating it, and
   update it last.
2. **Remap `item_categories`** by Appendix C: every row on a current leaf moves to that leaf's
   target. When an item then holds the same category twice, keep the first by `position`, and
   renumber the item's positions from 0 so `uq_item_categories_position` holds.
3. **Remap `section_categories`** by Appendix C: a root to its target root, a leaf to its target
   leaf, deduplicated per section. A section that now covers both a root and one of its leaves
   keeps both, as today's service already allows.
4. **Delete every row Appendix A does not name**, leaves first, then roots. `ON DELETE RESTRICT`
   is the check: if any delete fails, a remap missed a row, and the migration fails whole.

On a fresh database, `0166` inserts its 29 rows and maps the old `items.category` enum onto its
landing leaves, and this migration then moves those products on by Appendix C in the same
deploy. That is what both clusters will run.

**Why the catch alls map to `uncategorised`** (Appendix C): in a cluster every product sits on a
`0166` landing leaf, which is an `other-*` catch all. DIA has no catch alls, and a guessed target
misfiles the whole cluster (every dairy product as milkshakes). `uncategorised` is honest,
and the admin's "Set categories" bulk action, or section 11's follow up, files them properly.

`down` reinserts the `0166` rows (its exported `ROOTS` and `LANDING_LEAVES` constants), maps every
product and section back through a table from each Appendix A root to the `0166` root it came
closest to (write it from Appendix C's root column, inverted), puts every product on that root's
landing leaf, and deletes the DIA rows. It restores `0166`'s shape, not each product's exact
category, and its doc comment says so.

## 5. The reference taxonomy and the seeds

- `db/reference/categories.ts` becomes Appendix A, in the existing `REFERENCE_CATEGORIES` shape.
  Record each row's DIA id in a comment beside it, not in the data: the table has no column for
  it, and the id means nothing to the catalog.
- `authored.ts` (123 entries) and `mercadona.ts` (116 entries): **file every product by itself**
  on the Appendix A leaf that fits it, one or more, not by mapping its old slug through Appendix C.
  The seed rewrites its own products' categories on every run (`writeItemCategories`), so on a
  developer slot the seed then corrects what the migration's coarse map did. A product that fits
  no leaf goes on `uncategorised` and is listed in the PR.
- The demo seed (`db/seed/seed.ts`) and the demo world (`demo-world.ts`, `factories.ts`): replace
  every slug by the leaf that fits, product by product.

## 6. The chain tables

- **Mercadona** (`libs/luna-shopper/mercadona/src/lib/categories.ts`): 21 sections, 104 child
  mappings and the cheese override. Point every entry at the Appendix A leaf that holds the same
  kind of product. Mercadona's children are finer than DIA's in places and coarser in others:
  where one Mercadona child spans several DIA leaves, take the one holding most of it and list the
  choice in the PR. **This table files every chain today** (DEZA, Carrefour and El Jamón
  included), so it matters more than its name says.
- **LIDL** (`libs/luna-shopper/lidl/src/lib/categories.ts`): 39 nodes, the same way.
- Both `category-leaves.ts` copies become the Appendix A leaf list, and their specs keep asserting
  that every mapped slug is in it.
- The DIA table itself is `0174`'s. `dia-map.json` in the research folder is its input, and it
  already follows Appendix A and Appendix B.

## 7. Names in tests, twins and prompts

Replace every slug and every category name the old tree put in:

- catalog and harvester specs (the largest: `category.integration.spec.ts`, `section.integration.spec.ts`,
  `item.service.spec.ts`, `catalog-search.integration.spec.ts`, `source-entry-batch.service.spec.ts`,
  `category-tree.fake.ts`)
- velista's memory twins (ids there are `cat-<slug>`) and the admin's memory seeds
- `apps/velista-luna-e2e`: `catalog.spec.ts` names "Bakery" and "Dairy and eggs", a
  `dairy-and-eggs` URL and `?category=milk`, and `aisles.spec.ts` names `bread`, `milk` and
  `eggs`. Read the new names from Appendix A, in the language the suite runs in.
- the curation prompt examples (`oil-and-vinegar` in `suggestions/src/prompt.md` and
  `tools/catalog/review-entries-prompt.md`) and the fixture `categories.json` files

A spec that tests the tree's machinery, not the taxonomy, keeps its made up slugs. Change it only
where it names a slug the seed provides.

## 8. What a tree of 275 rows does to the apps

Nothing here is changed by this plan. It is stated so the reviewer knows what to look at in the
browser check.

- **Velista.** The picker and the catalog chip read the tree once per session, list rows rather
  than a grid, and hide rows with no products, so a new tree with 28 roots and few products per
  leaf reads as a short list. The tree payload grows to about 60 KB. Shared links that name an old
  slug open the catalog unnarrowed (`catalog-page.ts`), which is acceptable.
- **The admin.** The category reference picker shows 20 rows and finds the rest by typing, which
  the list's `query` filter supports. Assigning 246 leaves by hand is what "Set categories" and the
  curation tools are for.
- **The curation prompt** lists every leaf slug, grouped by root, so it grows about threefold.
- **The tree route** is unpaged and recounts products per row on every call. Its comments assume
  about a hundred rows. At 275 it is still one query over `item_categories`.

## 9. The English names

They are DIA's, copied as served, and several are machine translation ("Cuts and cuts", "Ron and
whisky", "Pots and Snacks", "Cakes" for both Tartas and Tortitas). Appendix A lists them. The
owner asked for DIA's translations, so this plan copies them. Correcting one is a back office
rename after the deploy, which keeps its id. Because the reference seed is off in both clusters,
the seed cannot revert that correction there.

## 10. Testing

- A migration integration spec against real Postgres (the pattern of
  `category-tree-migration.integration.spec.ts`): start from a database that ran `0166` and holds
  products on several current leaves (a split leaf, a catch all, `vegetables`, `frozen`'s
  children) and sections on a current root and a current leaf. After `up`: the tree equals
  Appendix A, every product sits where Appendix C says, positions are dense, sections are
  remapped, no current only row remains. After `down`: `0166`'s rows and shape are back.
- The same spec on a fresh database: `0166` then this migration, products from the enum end on
  `uncategorised` or their mapped leaf.
- `reference-catalog.spec.ts` as section 3 describes.
- The Mercadona and LIDL table specs against the new leaf list.
- The seed proof of the brief's progress evidence.

## 11. What this plan does not do

- **It does not re-file products from their source path.** A product created from a Mercadona or
  LIDL source row keeps the row's `categoryPath`, so running the remapped table again after this plan files
  it far better than Appendix C's coarse map. That is a follow up worth planning next: a back
  office action that re-runs `categorySlugsFor` for products still on `uncategorised`.
- No UI change in velista or the admin (section 8).
- No icons, colours or third level. No `source_category_maps` table (`0166` section 11 left that
  open, and `0174` keeps DIA's map in code).
- No DIA adapter. That is `0174`, which is built after this plan.

## 12. Exit criteria

- Everything in the brief's target state holds.
- The PR lists every Mercadona and LIDL mapping chosen between several leaves, and every seeded
  product filed on `uncategorised`.
- The browser check and the e2e run are recorded in the PR.

## Appendix A. The new category tree

**29 roots, 246 leaves, 275 rows.** 28 roots and 244 leaves are copied from DIA's menu; the leaf `other-fruits` and the root `other` with its leaf `uncategorised` are ours and carry no DIA id.

Positions count from 0 within each sibling group and follow DIA's menu order. Names are DIA's own, except that invisible characters (zero width and non breaking spaces) were cleaned out of four of them, listed below the tables. A slug is the last segment of DIA's English URL unless the note under the tables says otherwise.

English names that look like machine translation errors, copied verbatim and not corrected:

| DIA id | es | en |
| --- | --- | --- |
| L2266 | Arreglos y despieces | Cuts and cuts |
| L2128 | Ron y whisky | Ron and whisky |
| L2140 | Bolsitas y snacks | Pots and Snacks |
| L2319 | Tartas | Cakes |
| L2216 | Tortitas | Cakes |
| L2135 | Croquetas y rebozados | Croquettes and batters |
| L2146 | Espumas y fijadores | Foams and fixers |
| L2304 | Horno | Oven |
| L2078 | Yogures bífidus y colesterol | Bifidus yoghurts and cholesterol |
| L2167 | Lavavajillas | Dishwasher |
| L2280 | Cafés fríos | Cold brew coffee |

### 0. Frutas / Fruits (`fruits`, L105)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2033 | `bananas-and-plantains` | Plátanos y bananas | Bananas and plantains |
| 1 | L2032 | `apples-and-pears` | Manzanas y peras | Apples and pears |
| 2 | L2196 | `oranges-tangerines-and-lemons` | Naranjas, mandarinas y limones | Oranges, tangerines, and lemons |
| 3 | L2267 | `melon-and-watermelon` | Melón y sandía | Melon and watermelon |
| 4 | L2035 | `grapes` | Uvas | Grapes |
| 5 | L2039 | `tropical-fruits` | Frutas tropicales | Tropical fruits |
| 6 | L2038 | `red-and-forest-fruits` | Frutos rojos y del bosque | Red and forest fruits |
| 7 | L2268 | `frozen-fruits` | Frutas congeladas | Frozen fruits |
| 8 | (ours) | `other-fruits` | Otras frutas | Other fruits |

### 1. Verduras / Vegetables (`vegetables`, L104)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2027 | `lettuce-and-leafy-greens` | Lechugas y hojas verdes | Lettuce and leafy greens |
| 1 | L2023 | `tomatoes-peppers-and-cucumbers` | Tomates, pimientos y pepinos | Tomatoes, peppers and cucumbers |
| 2 | L2022 | `garlic-onions-and-leeks` | Ajos, cebollas y puerros | Garlic, onions and leeks |
| 3 | L2181 | `courgette-pumpkin-and-aubergine` | Calabacín, calabaza y berenjena | Courgette, pumpkin and aubergine |
| 4 | L2028 | `potatoes-and-carrots` | Patatas y zanahorias | Potatoes and carrots |
| 5 | L2024 | `broccoli-cauliflower-and-green-beans` | Brócoli, coliflor y judías verdes | Broccoli, cauliflower, and green beans |
| 6 | L2029 | `mushrooms` | Setas y champiñones | Mushrooms |
| 7 | L2031 | `aromatic-herbs` | Hierbas aromáticas | Aromatic herbs |
| 8 | L2030 | `salads-and-prepared-vegetables` | Ensaladas y verduras preparadas | Salads and prepared vegetables |
| 9 | L2025 | `frozen-and-steamed-vegetables` | Verduras congeladas y al vapor | Frozen and steamed vegetables |
| 10 | L2026 | `vegetables-canned-vegetables` | Conservas de verduras | Canned vegetables |

### 2. Carnes / Meats (`meats`, L102)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2202 | `chicken` | Pollo | Chicken |
| 1 | L2013 | `beef` | Vacuno | Beef |
| 2 | L2014 | `pork` | Cerdo | Pork |
| 3 | L2015 | `turkey` | Pavo | Turkey |
| 4 | L2016 | `rabbit` | Conejo | Rabbit |
| 5 | L2017 | `hamburgers-ground-beef-and-meatballs` | Hamburguesas, carne picada y albóndigas | Hamburgers, ground beef, and meatballs |
| 6 | L2265 | `breaded-and-prepared-foods` | Empanados y elaborados | Breaded and prepared foods |
| 7 | L2266 | `cuts-and-cuts` | Arreglos y despieces | Cuts and cuts |

### 3. Pescados y mariscos / Fish and seafood (`fish-and-seafood`, L103)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2019 | `fish-and-seafood-fresh` | Fresco | Fresh |
| 1 | L2249 | `fish-and-seafood-frozen` | Congelado | Frozen |
| 2 | L2251 | `breaded` | Rebozado | Breaded |
| 3 | L2253 | `seafood-shrimp-and-squid` | Marisco, gamba y calamar | Seafood, shrimp and squid |
| 4 | L2020 | `smoked-and-salted` | Ahumado y salazón | Smoked and salted |
| 5 | L2021 | `surimi-and-prepared-products` | Surimi y elaborados | Surimi and prepared products |

### 4. Charcutería / Charcuterie (`charcuterie`, L134)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2001 | `cooked-ham` | Jamón cocido | Cooked ham |
| 1 | L2342 | `turkey-and-chicken` | Pavo y pollo | Turkey and chicken |
| 2 | L2004 | `serrano-ham` | Jamón serrano | Serrano ham |
| 3 | L2005 | `loin-and-chorizo` | Lomo y chorizo | Loin and chorizo |
| 4 | L2343 | `fuet-and-salchichon` | Fuet y salchichón | Fuet and salchichón |
| 5 | L2259 | `chopped-and-mortadella` | Chopped y mortadela | Chopped and mortadella |
| 6 | L2206 | `sausages` | Salchichas | Sausages |
| 7 | L2344 | `bacon` | Bacon | Bacon |
| 8 | L2012 | `pate-and-sobrasada` | Paté y sobrasada | Pâté and sobrasada |

### 5. Quesos / Cheeses (`cheeses`, L101)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2007 | `cured` | Curado | Cured |
| 1 | L2345 | `semi-cured` | Semicurado | Semi-cured |
| 2 | L2346 | `young-mild` | Tierno | Young/Mild |
| 3 | L2008 | `cheeses-fresh` | Fresco | Fresh |
| 4 | L2011 | `specialties` | Especialidades | Specialties |
| 5 | L2009 | `blue-and-goat-cheese` | Azul y de cabra | Blue and goat cheese |
| 6 | L2205 | `sliced` | En lonchas | Sliced |
| 7 | L2347 | `shredded-grated` | Rallado | Shredded/Grated |
| 8 | L2010 | `spreadable-and-portions` | Untable y en porciones | Spreadable and portions |

### 6. Huevos, leche y mantequilla / Eggs, milk, and butter (`eggs-milk-and-butter`, L108)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2055 | `eggs` | Huevos | Eggs |
| 1 | L2051 | `milk` | Leche | Milk |
| 2 | L2261 | `lactose-free-and-fortified-milk` | Leche sin lactosa y enriquecidas | Lactose-free and fortified milk |
| 3 | L2052 | `plant-based-drinks-and-horchata` | Bebidas vegetales y horchatas | Plant-based drinks and horchata |
| 4 | L2262 | `infant-formula` | Leche infantil | Infant formula |
| 5 | L2053 | `milkshakes` | Batidos | Milkshakes |
| 6 | L2264 | `condensed-and-evaporated-milk` | Leche condensada y evaporada | Condensed and evaporated milk |
| 7 | L2056 | `butter-and-margarine` | Mantequilla y margarina | Butter and margarine |
| 8 | L2054 | `cream` | Nata | Cream |

### 7. Panadería / Bakery (`bakery`, L112)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2070 | `freshly-baked-bread` | Pan recién horneado | Freshly baked bread |
| 1 | L2069 | `sliced-and-specialty-breads` | Pan de molde y especiales | Sliced and specialty breads |
| 2 | L2073 | `hamburger-and-hot-dog-buns` | Pan para hamburguesas y perritos | Hamburger and hot dog buns |
| 3 | L2074 | `wheat-tortillas-and-pita-bread` | Tortillas de trigo y pitas | Wheat tortillas and pita bread |
| 4 | L2200 | `gluten-free-bread` | Pan sin gluten | Gluten-free bread |
| 5 | L2072 | `breadcrumbs-toasted-bread-and-breadsticks` | Pan rallado, tostado y picos | Breadcrumbs, toasted bread, and breadsticks |
| 6 | L2304 | `oven` | Horno | Oven |
| 7 | L2076 | `doughs-and-pastries` | Masas y hojaldres | Doughs and pastries |

### 8. Yogures y postres / Yoghurts and desserts (`yoghurts-and-desserts`, L113)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2079 | `natural-and-skimmed-yogurts` | Yogures naturales y desnatados | Natural and skimmed yogurts |
| 1 | L2081 | `flavoured-and-fruit-yoghurts` | Yogures de sabores y frutas | Flavoured and fruit yoghurts |
| 2 | L2082 | `greek-yogurts` | Yogures griegos | Greek yogurts |
| 3 | L2248 | `liquid-yogurts` | Yogures líquidos | Liquid yogurts |
| 4 | L2078 | `bifidus-yoghurts-and-cholesterol` | Yogures bífidus y colesterol | Bifidus yoghurts and cholesterol |
| 5 | L2085 | `kefir-and-plant-based-desserts` | Kéfir y postres vegetales | Kefir and plant-based desserts |
| 6 | L2229 | `protein-desserts-and-yogurts` | Postres y batidos de proteínas | Desserts and protein shakes |
| 7 | L2083 | `yogurts-and-children-s-desserts` | Yogures y postres infantiles | Yogurts and children's desserts |
| 8 | L2087 | `traditional-desserts` | Postres tradicionales | Traditional desserts |
| 9 | L2088 | `custard-flan-and-rice-pudding` | Natillas, flan y arroz con leche | Custard, flan, and rice pudding |
| 10 | L2089 | `gelatins-and-curds` | Gelatinas y cuajadas | Gelatins and curds |

### 9. Congelados y helados / Frozen foods and ice cream (`frozen-foods-and-ice-cream`, L119)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2131 | `pizzas-and-doughs` | Pizzas y masas | Pizzas and doughs |
| 1 | L2135 | `croquettes-and-batters` | Croquetas y rebozados | Croquettes and batters |
| 2 | L2132 | `frozen-foods-and-ice-cream-fish-and-seafood` | Pescado y marisco | Fish and seafood |
| 3 | L2210 | `vegetables-and-potatoes` | Verduras y patatas | Vegetables and potatoes |
| 4 | L2137 | `rice-and-pasta` | Arroces y pasta | Rice and pasta |
| 5 | L2130 | `ice-creams-and-ice` | Helados y hielo | Ice creams and ice |
| 6 | L2136 | `cakes-and-churros` | Tartas y churros | Cakes and churros |

### 10. Arroz, pastas y legumbres / Rice, pasta and pulses (`rice-pasta-and-pulses`, L106)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2042 | `rice` | Arroz | Rice |
| 1 | L2270 | `rice-pasta-and-pulses-fideos` | Fideos | Noodles |
| 2 | L2044 | `macaroni-spaghetti-and-dried-pasta` | Macarrones, espaguetis y pastas secas | Macaroni, spaghetti, and dried pasta |
| 3 | L2271 | `filled-and-sauced-pasta` | Pastas rellenas y en salsa | Filled and Sauced Pasta |
| 4 | L2272 | `lasagna-and-cannelloni` | Lasaña y canelones | Lasagna and cannelloni |
| 5 | L2297 | `pasta-sauces` | Salsas para pasta | Pasta sauces |
| 6 | L2273 | `rice-pasta-and-pulses-noodles` | Noodles | Noodles |
| 7 | L2274 | `gluten-free-pasta` | Pastas sin gluten | Gluten-free pasta |
| 8 | L2191 | `chickpeas-and-beans` | Garbanzos y alubias | Chickpeas and beans |
| 9 | L2193 | `lentils` | Lentejas | Lentils |
| 10 | L2043 | `quinoa-couscous-and-soy` | Quinoa, couscous y soja | Quinoa, couscous, and soy |

### 11. Aceites, salsas y especias / Oils, sauces and spices (`oils-sauces-and-spices`, L107)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2046 | `oils` | Aceites | Oils |
| 1 | L2047 | `vinegars-and-dressings` | Vinagres y aliños | Vinegars and dressings |
| 2 | L2048 | `garlic-salt-and-pepper` | Ajo, sal y pimienta | Garlic, salt, and pepper |
| 3 | L2294 | `spices-and-herbs` | Especias y hierbas | Spices and herbs |
| 4 | L2295 | `seasonings` | Sazonadores | Seasonings |
| 5 | L2208 | `tomato-and-pasta-sauces` | Salsas de tomate y pasta | Tomato and pasta sauces |
| 6 | L2296 | `special-and-spicy-sauces` | Salsas especiales y picantes | Special and spicy sauces |
| 7 | L2050 | `ketchup-mayonnaise-and-mustard` | Ketchup, mayonesa y mostaza | Ketchup, mayonnaise, and mustard |

### 12. Conservas, caldos y cremas / Canned food, broths and creams (`canned-food-broths-and-creams`, L114)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2179 | `tuna-and-bonito` | Atún y bonito | Tuna and bonito |
| 1 | L2207 | `mackerel-and-sardines` | Caballa y sardinas | Mackerel and sardines |
| 2 | L2195 | `mussels-cockles-and-fish` | Mejillones, berberechos y pescado | Mussels, cockles, and fish |
| 3 | L2341 | `pates` | Patés | Pâtés |
| 4 | L2092 | `canned-food-broths-and-creams-canned-vegetables` | Conservas de verdura | Canned vegetables |
| 5 | L2298 | `canned-fruit` | Conservas de fruta | Canned fruit |
| 6 | L2094 | `creams-and-purees` | Cremas y purés | Creams and purées |
| 7 | L2093 | `broths-and-soups` | Caldos y sopas | Broths and soups |

### 13. Café, cacao e infusiones / Coffee, cocoa and infusions (`coffee-cocoa-and-infusions`, L109)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2057 | `compatible-nespresso-capsules` | Cápsulas compatibles Nespresso | Compatible Nespresso capsules |
| 1 | L2275 | `compatible-dolce-gusto-capsules` | Cápsulas compatibles Dolce Gusto | Compatible Dolce Gusto capsules |
| 2 | L2276 | `other-compatible-capsules` | Otras cápsulas compatibles | Other compatible capsules |
| 3 | L2277 | `ground-coffee` | Café molido | Ground coffee |
| 4 | L2278 | `instant-coffee` | Café soluble | Instant coffee |
| 5 | L2279 | `whole-bean-coffee` | Café en grano | Whole bean coffee |
| 6 | L2280 | `cold-brew-coffee` | Cafés fríos | Cold brew coffee |
| 7 | L2058 | `cocoa-and-hot-chocolate` | Cacao y chocolate a la taza | Cocoa and hot chocolate |
| 8 | L2059 | `infusions` | Infusiones | Infusions |
| 9 | L2281 | `tea` | Té | Tea |

### 14. Bollería, repostería y azúcar / Pastries, cakes, and sugar (`pastries-cakes-and-sugar`, L132)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2317 | `sweet-baked-goods` | Bollería de horno dulce | Sweet baked goods |
| 1 | L2067 | `muffins-and-classic-pastries` | Magdalenas y bollería clásica | Muffins and classic pastries |
| 2 | L2318 | `doughnuts-and-cakes` | Rosquillas y pastelitos | Doughnuts and cakes |
| 3 | L2319 | `pastries-cakes-and-sugar-cakes` | Tartas | Cakes |
| 4 | L2075 | `flours-and-yeasts` | Harinas y levaduras | Flours and yeasts |
| 5 | L2077 | `dessert-mixes-and-decorations` | Preparados para postres y decoración | Dessert mixes and decorations |
| 6 | L2060 | `sugar-honey-and-sweeteners` | Azúcar, miel y edulcorantes | Sugar, honey, and sweeteners |

### 15. Galletas, cereales y mermeladas / Biscuits, cereals, and jams (`biscuits-cereals-and-jams`, L111)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2320 | `chocolate-and-filled-biscuits` | Galletas de chocolate y rellenas | Chocolate and filled biscuits |
| 1 | L2065 | `classic-and-digestive-biscuits` | Galletas clásicas y digestive | Classic and digestive biscuits |
| 2 | L2066 | `savory-biscuits-and-crackers` | Galletas saladas y crackers | Savory biscuits and crackers |
| 3 | L2068 | `cereals` | Cereales | Cereals |
| 4 | L2321 | `whole-grain-cereals-and-muesli` | Cereales integrales y muesli | Whole grain cereals and muesli |
| 5 | L2322 | `cereal-and-protein-bars` | Barritas de cereales y proteínas | Cereal and protein bars |
| 6 | L2216 | `biscuits-cereals-and-jams-cakes` | Tortitas | Cakes |
| 7 | L2323 | `gluten-free-biscuits-cereals-and-pancakes` | Galletas, cereales y tortitas sin gluten | Gluten-free biscuits, cereals, and pancakes |
| 8 | L2062 | `jams` | Mermeladas | Jams |

### 16. Chocolates y golosinas / Chocolates and sweets (`chocolates-and-sweets`, L110)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2324 | `milk-chocolate` | Chocolate con leche | Milk chocolate |
| 1 | L2325 | `dark-chocolate` | Chocolate negro | Dark chocolate |
| 2 | L2326 | `white-chocolate` | Chocolate blanco | White chocolate |
| 3 | L2063 | `chocolates-and-bonbons` | Chocolatinas y bombones | Chocolates and bonbons |
| 4 | L2228 | `cocoa-spreads-and-creams` | Cremas de cacao y de untar | Cocoa spreads and creams |
| 5 | L2064 | `sweets` | Golosinas | Sweets |
| 6 | L2327 | `chewing-gum-and-candies` | Chicles y caramelos | Chewing gum and candies |

### 17. Platos preparados y pizzas / Prepared meals and pizzas (`prepared-meals-and-pizzas`, L116)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2102 | `ready-to-eat-dishes` | Listos para comer | Ready-to-eat dishes |
| 1 | L2105 | `tortillas-and-pies` | Tortillas y empanadas | Tortillas and pies |
| 2 | L2101 | `refrigerated-pizzas` | Pizzas refrigeradas | Refrigerated pizzas |
| 3 | L2246 | `frozen-pizzas` | Pizzas congeladas | Frozen pizzas |
| 4 | L2104 | `sandwiches-and-burgers` | Sándwiches y hamburguesas | Sandwiches and Burgers |
| 5 | L2247 | `traditional-food` | Comida tradicional | Traditional Food |
| 6 | L2103 | `mexican-food` | Comida mexicana | Mexican Food |
| 7 | L2299 | `asian-food` | Comida asiática | Asian Food |
| 8 | L2300 | `salads-and-bowls` | Ensaladas y bowls | Salads and Bowls |
| 9 | L2106 | `gazpachos-and-salmorejos` | Gazpachos y salmorejos | Gazpachos and salmorejos |
| 10 | L2269 | `hummus-and-guacamole` | Hummus y guacamoles | Hummus and guacamole |

### 18. Aperitivos y frutos secos / Snacks and nuts (`snacks-and-nuts`, L115)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2098 | `potato-chips` | Patatas fritas | Potato chips |
| 1 | L2282 | `savory-snacks` | Snacks salados | Savory snacks |
| 2 | L2285 | `vegetable-snacks` | Snacks vegetales | Vegetable snacks |
| 3 | L2097 | `nuts` | Frutos secos | Nuts |
| 4 | L2283 | `mixed-nuts` | Mix de frutos secos | Mixed nuts |
| 5 | L2041 | `dried-fruit` | Frutas deshidratadas | Dried fruit |
| 6 | L2096 | `olives` | Aceitunas | Olives |
| 7 | L2284 | `pickles` | Encurtidos | Pickles |

### 19. Agua y refrescos / Water and Soft Drinks (`water-and-soft-drinks`, L117)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2107 | `water` | Agua | Water |
| 1 | L2108 | `cola` | Cola | Cola |
| 2 | L2212 | `orange-lemon-and-lemon-lime` | Naranja, limón y lima-limón | Orange, Lemon, and Lemon-Lime |
| 3 | L2112 | `tonic-sparkling-water-and-bitter` | Tónica, gaseosa y bitter | Tonic, Sparkling Water, and Bitter |
| 4 | L2111 | `iced-tea` | Té frío | Iced Tea |
| 5 | L2192 | `non-carbonated-soft-drinks` | Refrescos sin gas | Non-Carbonated Soft Drinks |
| 6 | L2114 | `isotonic-and-sports-drinks` | Bebidas isotónicas y deportivas | Isotonic and sports drinks |
| 7 | L2217 | `energy-drinks` | Bebidas energéticas | Energy drinks |
| 8 | L2110 | `kombucha-and-vitamin-infused-waters` | Kombucha y aguas vitaminadas | Kombucha and Vitamin-Infused Waters |
| 9 | L2286 | `water-and-soft-drink-packs` | Packs de agua y refrescos | Water and Soft Drink Packs |

### 20. Zumos y smoothies / Juices and Smoothies (`juices-and-smoothies`, L127)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2113 | `freshly-squeezed-and-fresh` | Recién exprimido y fresco | Freshly squeezed and fresh |
| 1 | L2287 | `orange` | Naranja | Orange |
| 2 | L2312 | `lemonade` | Limonadas | Lemonade |
| 3 | L2288 | `peach-and-pineapple` | Melocotón y piña | Peach and Pineapple |
| 4 | L2289 | `multifruit-and-other-flavors` | Multifrutas y otros sabores | Multifruit and Other Flavors |
| 5 | L2290 | `fruit-and-milk` | Fruta y leche | Fruit and Milk |
| 6 | L2291 | `smoothies` | Smoothies | Smoothies |
| 7 | L2292 | `juice-packs` | Packs de zumos | Juice Packs |

### 21. Cervezas, vinos y licores / Beers, wines, and spirits (`beers-wines-and-spirits`, L118)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2115 | `beers` | Cervezas | Beers |
| 1 | L2117 | `premium-and-specialty-beers` | Cervezas prémium y especiales | Premium and specialty beers |
| 2 | L2182 | `beers-with-lemon` | Cervezas con limón | Beers with lemon |
| 3 | L2118 | `non-alcoholic-beers` | Cervezas sin alcohol | Non-alcoholic beers |
| 4 | L2293 | `beer-packs` | Packs de cervezas | Beer packs |
| 5 | L2119 | `summer-red-wine-and-sangria` | Tinto de verano y sangría | Summer red wine and sangria |
| 6 | L2120 | `red-wine` | Vino tinto | Red wine |
| 7 | L2121 | `white-wine` | Vino blanco | White wine |
| 8 | L2124 | `rose-wine` | Vino rosado | Rose wine |
| 9 | L2122 | `cavas-and-cider` | Cavas y sidra | Cavas and cider |
| 10 | L2125 | `gin-vodka-and-tequila` | Ginebra, vodka y tequila | Gin, vodka and tequila |
| 11 | L2128 | `ron-and-whisky` | Ron y whisky | Ron and whisky |
| 12 | L2127 | `vermouth-and-aperitifs` | Vermouth y aperitivos | Vermouth and aperitifs |
| 13 | L2129 | `creams-liqueurs-and-brandy` | Cremas, licores y brandy | Creams, liqueurs, and brandy |

### 22. Limpieza y hogar / Cleaning and home (`cleaning-and-home`, L122)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2170 | `detergents` | Detergentes | Detergents |
| 1 | L2306 | `fabric-softeners-and-laundry-care` | Suavizantes y cuidado de la ropa | Fabric softeners and laundry care |
| 2 | L2167 | `dishwasher` | Lavavajillas | Dishwasher |
| 3 | L2168 | `toilet-paper-kitchen-paper-and-napkins` | Papel higiénico, cocina y servilletas | Toilet paper, kitchen paper and napkins |
| 4 | L2160 | `garbage-bags-brooms-and-mops` | Bolsas de basura, escobas y fregonas | Garbage bags, brooms and mops |
| 5 | L2166 | `kitchen-cleaning-and-degreasing` | Limpieza cocina y quitagrasas | Kitchen cleaning and degreasing |
| 6 | L2164 | `bathroom-and-toilet-cleaning` | Limpieza baño y WC | Bathroom and toilet cleaning |
| 7 | L2163 | `cleaning-floors-windows-and-furniture` | Limpieza suelos, cristales y muebles | Cleaning floors, windows and furniture |
| 8 | L2161 | `bleach-and-disinfectants` | Lejía y desinfectantes | Bleach and disinfectants |
| 9 | L2169 | `film-aluminum-and-preservation` | Film, aluminio y conservación | Film, aluminum and preservation |
| 10 | L2159 | `scouring-pads-cloths-and-gloves` | Estropajos, bayetas y guantes | Scouring pads, cloths and gloves |
| 11 | L2226 | `air-fresheners-refills-and-candles` | Ambientadores, recambios y velas | Air fresheners, refills and candles |
| 12 | L2173 | `insecticides` | Insecticidas | Insecticides |
| 13 | L2209 | `batteries-kitchenware-and-bags` | Pilas, menaje y bolsas | Batteries, kitchenware and bags |

### 23. Higiene y cuidado del cuerpo / Hygiene and Body Care (`hygiene-and-body-care`, L129)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2211 | `shower-gel-and-sponges` | Gel de ducha y esponjas | Shower gel and sponges |
| 1 | L2151 | `oral-hygiene` | Higiene bucal | Oral hygiene |
| 2 | L2154 | `deodorants` | Desodorantes | Deodorants |
| 3 | L2150 | `shaving` | Afeitado | Shaving |
| 4 | L2188 | `hair-removal` | Depilación | Hair removal |
| 5 | L2158 | `sanitary-pads-and-feminine-hygiene` | Compresas e higiene íntima | Sanitary pads and feminine hygiene |
| 6 | L2153 | `body-and-hand-hydration` | Hidratación de cuerpo y manos | Body and hand hydration |
| 7 | L2156 | `hand-soap` | Jabón de manos | Hand soap |

### 24. Cabello y perfumería / Hair and Perfumery (`hair-and-perfumery`, L130)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2144 | `shampoo` | Champú | Shampoo |
| 1 | L2145 | `conditioners-and-masks` | Acondicionadores y mascarillas | Conditioners and masks |
| 2 | L2146 | `foams-and-fixers` | Espumas y fijadores | Foams and fixers |
| 3 | L2147 | `dyes` | Tintes | Dyes |
| 4 | L2148 | `facial-care` | Cuidado facial | Facial Care |
| 5 | L2155 | `perfumes-and-colognes` | Perfumes y colonias | Perfumes and colognes |

### 25. Salud y parafarmacia / Health and Pharmacy (`health-and-pharmacy`, L131)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2183 | `nutritional-supplements` | Complementos nutricionales | Nutritional supplements |
| 1 | L2184 | `parapharmacy` | Parafarmacia | Parapharmacy |
| 2 | L2307 | `first-aid-kit` | Botiquín | First Aid Kit |
| 3 | L2340 | `sunscreen` | Protector solar | Sunscreen |

### 26. Infantil / Children (`children`, L120)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2138 | `milk-and-baby-food` | Leches y papillas | Milk and Baby Food |
| 1 | L2141 | `baby-foods-and-jars` | Potitos y tarritos | Baby foods and jars |
| 2 | L2139 | `yogurt-and-desserts` | Yogures y postres | Yogurt and Desserts |
| 3 | L2140 | `pots-and-snacks` | Bolsitas y snacks | Pots and Snacks |
| 4 | L2142 | `diapers-and-wipes` | Pañales y toallitas | Diapers and wipes |
| 5 | L2143 | `hygiene-and-care` | Higiene y cuidado | Hygiene and Care |
| 6 | L2314 | `children-juices-and-smoothies` | Zumos y batidos | Juices and Smoothies |
| 7 | L2315 | `cookies-and-pastries` | Galletas y bollería | Cookies and Pastries |
| 8 | L2316 | `sweets-and-chocolates` | Golosinas y chocolatinas | Sweets and Chocolates |

### 27. Mascotas / Pets (`pets`, L123)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | L2308 | `wet-cat-food` | Gato comida húmeda | Wet cat food |
| 1 | L2175 | `dry-cat-food` | Gato comida seca | Dry cat food |
| 2 | L2309 | `cat-treats-and-care` | Gato snacks y cuidado | Cat treats and care |
| 3 | L2310 | `wet-dog-food` | Perro comida húmeda | Wet dog food |
| 4 | L2174 | `dry-dog-food` | Perro comida seca | Dry dog food |
| 5 | L2311 | `dog-treats-and-care` | Perro snacks y cuidado | Dog treats and care |

### 28. Otros / Other (`other`, no DIA id)

| Pos | DIA id | slug | es | en |
| --- | --- | --- | --- | --- |
| 0 | (ours) | `uncategorised` | Sin categoría | Not yet categorised |

### Slug decisions

| DIA id | DIA slug | slug used | why |
| --- | --- | --- | --- |
| L2202 | `chicken` | `chicken` | canonical URL sits under another root (`/en/butchery/chicken`) but its last segment is the same |
| L2229 | `desserts-and-protein-shakes` | `protein-desserts-and-yogurts` | the category's canonical English URL names it `protein-desserts-and-yogurts` |
| L2319 | `cakes` | `pastries-cakes-and-sugar-cakes` | `cakes` is used by another node; both take the parent root slug as a prefix |
| L2216 | `cakes` | `biscuits-cereals-and-jams-cakes` | `cakes` is used by another node; both take the parent root slug as a prefix |
| L2026 | `canned-vegetables` | `vegetables-canned-vegetables` | `canned-vegetables` is used by another node; both take the parent root slug as a prefix |
| L2092 | `canned-vegetables` | `canned-food-broths-and-creams-canned-vegetables` | `canned-vegetables` is used by another node; both take the parent root slug as a prefix |
| L103 | `fish-and-seafood` | `fish-and-seafood` | collides with a leaf; a root has no parent root to prefix, so the root keeps the bare slug and only the leaf is prefixed |
| L2132 | `fish-and-seafood` | `frozen-foods-and-ice-cream-fish-and-seafood` | `fish-and-seafood` is used by another node; both take the parent root slug as a prefix |
| L2019 | `fresh` | `fish-and-seafood-fresh` | `fresh` is used by another node; both take the parent root slug as a prefix |
| L2008 | `fresh` | `cheeses-fresh` | `fresh` is used by another node; both take the parent root slug as a prefix |
| L127 | `juices-and-smoothies` | `juices-and-smoothies` | collides with a leaf; a root has no parent root to prefix, so the root keeps the bare slug and only the leaf is prefixed |
| L2314 | `juices-and-smoothies` | `children-juices-and-smoothies` | `juices-and-smoothies` is used by another node; both take the parent root slug as a prefix |
| L2273 | `noodles` | `rice-pasta-and-pulses-noodles` | `noodles` is used by another node; both take the parent root slug as a prefix |
| L2270 | `noodles` | `rice-pasta-and-pulses-fideos` | collides with its sibling L2273, so the parent prefix alone cannot separate them; DIA's Spanish segment `fideos` is used as the tail (L2273, named Noodles in both languages, keeps `noodles`) |
| L2249 | `frozen` | `fish-and-seafood-frozen` | `frozen` is a current root; a new leaf equal to a current row of another level takes the parent root prefix, so the current root is not reused as a leaf |

Every slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`; the longest is 47 characters, and all 275 are unique.

### Names cleaned

Four names carried invisible characters, removed in the tables above and otherwise unchanged: a
zero width space in the English names of `L2069` and `L2174`, and a non breaking space in the
Spanish names of `L2101` and `L2125`. `data/category-tree.json` in the research folder keeps them
as DIA served them.

## Appendix B. DIA nodes not copied

Every node of DIA's tree that the new tree leaves out. "Products" is the listing walk's count (for L150, the offers endpoint's total). "Only there" counts products the walk found under that node and under **no copied leaf**, so they would have nowhere to land without a redirect. The redirect slug is where such a product is filed; `none` means every product seen there also sits under a copied leaf, and that leaf's own mapping is enough. The "Todo X" pseudo children are not listed: they repeat their parent's id and are not nodes.

Names of hidden nodes are not served by DIA; they are shown here as the Spanish URL segment, in italics.

| DIA id | es | why dropped | products | products only there | redirect slug |
| --- | --- | --- | --- | --- | --- |
| L128 | Novedades y recomendados | dropped root (rule 2): new arrivals and recommendations, a merchandising branch | 270 | 0 | none |
| L2302 | Novedades | child of dropped root L128 | 38 | 0 | none |
| L2352 | Oktoberfest | child of dropped root L128 | 34 | 0 | none |
| L2328 | Freidora de aire - Airfryer | child of dropped root L128 | 59 | 0 | none |
| L2350 | Selección sin gluten | child of dropped root L128 | 43 | 0 | none |
| L2351 | Nutrición deportiva | child of dropped root L128 | 58 | 0 | none |
| L2303 | Mejor valorados | child of dropped root L128 | 47 | 0 | none |
| L2040 | Frutas de temporada | dropped leaf (rule 2); replaced by `other-fruits` | 18 | 11 (Granada unidad 500 g aprox.; Chirimoya unidad 500 g aprox.; Ciruela roja granel 500 g aprox.; Melocotón amarillo granel 1 Kg aprox.; Nectarina granel 750 g aprox.; ...) | `other-fruits` <br>rule 4: seasonal fruit DIA files only here (granada, chirimoya, ciruela, melocotón, nectarina) |
| L150 | Ofertas | offer listing, not a branch of the tree | 253 | 0 | none <br>only the first 119 of 253 offers were fetched; every one of those also sits under a copied leaf |
| L2336 | *Hielo agua refrescos y horchatas* | hidden, not in the menu (summer campaign, `/verano/`) | 41 | 0 | none |
| L2254 | *Carnes navidad* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 4 | 0 | `pork` <br>Christmas only; the walk shows 2 pork, 1 beef, 1 chicken cut, pork is the majority |
| L2176 | *Pajaros* | hidden, not in the menu (dormant pets leaf, `/mascotas/`) | 0 | 0 | none <br>empty; no kept leaf holds pets other than cats and dogs, so a product seen here would fall to `uncategorised` |
| L2241 | *Panaderia sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 2 | 0 | none |
| L2224 | *Bodega* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 46 | 0 | `red-wine` <br>Christmas only; red wine is the largest group of its 46 |
| L2243 | *Platos sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 2 | 0 | none |
| L2333 | *Gazpacho y salmorejo* | hidden, not in the menu (summer campaign, `/verano/`) | 6 | 0 | none |
| L2335 | *Cervezas y tintos de verano* | hidden, not in the menu (summer campaign, `/verano/`) | 58 | 0 | none |
| L2240 | *Desayunos sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 11 | 0 | none |
| L2218 | *Turrones* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 0 | 0 | `chocolates-and-bonbons` <br>Christmas only, empty today; turrón has no menu leaf, chocolates and bonbons is the nearest confectionery leaf (doubt) |
| L2331 | *Barbacoa* | hidden, not in the menu (summer campaign, `/verano/`) | 20 | 0 | none |
| L2330 | *Aperitivos y picoteo* | hidden, not in the menu (summer campaign, `/verano/`) | 41 | 0 | none |
| L2256 | *Frutos secos y deshidratados* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 9 | 0 | `dried-fruit` <br>Christmas only; 6 of its 9 are dried fruit, 3 are nuts |
| L2225 | *Entrantes navidad* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 6 | 0 | `savory-snacks` <br>Christmas only; today broths (3) and crisps (3), so no kind dominates; a starter is closest to a savoury snack (doubt) |
| L2244 | *Bebidas sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 1 | 0 | none |
| L2220 | *Roscones panettones y polvorones* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 9 | 0 | `muffins-and-classic-pastries` <br>Christmas only; all 9 (panettone, pandoro) also sit there |
| L2332 | *Listo para comer* | hidden, not in the menu (summer campaign, `/verano/`) | 13 | 0 | none |
| L2245 | *Productos infantiles sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 34 | 0 | none |
| L2339 | *Especial mundial* | hidden, not in the menu (campaign under L128, `/novedades-y-recomendados/`) | 7 | 0 | none |
| L2242 | *Reposteria sin gluten* | hidden, not in the menu (retired gluten free root, `/sin-gluten/`) | 7 | 0 | none |
| L2257 | *Postres de navidad* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 12 | 0 | `traditional-desserts` <br>Christmas only; all 12 also sit there |
| L2189 | *Dulces de navidad* | hidden, not in the menu (Christmas leaf under a retired root, `/azucar-chocolates-y-caramelos/`) | 2 | 2 (Barquillos rellenos de crema de turrón D; Barquillos rellenos de crema de cacao co) | `chocolate-and-filled-biscuits` <br>Christmas only (under a retired root); both products are filled wafers seen nowhere else |
| L2334 | *Helados* | hidden, not in the menu (summer campaign, `/verano/`) | 33 | 0 | none |
| L2221 | *Polvorones y mantecados* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 2 | 2 (Marquesas Delaviuda 125 g; Mantecados de pistacho La flor de Antequ) | `muffins-and-classic-pastries` <br>Christmas only; both products (marquesas, mantecados) appear nowhere else; DIA files its panettones in that leaf |
| L2219 | *Chocolates y dulces navidad* | hidden, not in the menu (Christmas campaign, `/navidad/`) | 3 | 3 (Barquillos rellenos de crema de turrón D; Barquillos rellenos de crema de cacao co; Pastas en hucha globo Dulce Noel Dia 160) | `chocolate-and-filled-biscuits` <br>Christmas only; 2 of 3 are filled wafers, the third (pastas) is a classic biscuit |
| L2329 | *Productos premiados* | hidden, not in the menu (campaign under L128, `/novedades-y-recomendados/`) | 50 | 0 | none |
| L2349 | *Vuelta a la accion* | hidden, not in the menu (campaign under L128, `/novedades-y-recomendados/`) | 60 | 0 | none |

Nodes listed: 36 (1 dropped root with its 6 children, L2040, L150, and 27 hidden leaves). Products seen only under a dropped node: 16 distinct, of the walk's 5718, spread over 4 nodes (L2040 11, L2219 3, L2221 2, L2189 2; the two filled wafers sit under both L2219 and L2189). This agrees with `drop-analysis.json` (`orphansClear.count` 16). Every other dropped node, the whole of L128 included, holds only products that also sit under a copied leaf.

The Christmas leaves get a redirect even where today's products all sit elsewhere, because they are Christmas only: in December they fill with seasonal stock DIA may file nowhere else. Summer, gluten free and campaign leaves get `none`, since the walk shows their stock is always cross filed.
## Appendix C. Current rows to new rows

**Of the 84 current leaves, 65 map to a DIA leaf (or our `other-fruits`) and 19 map to `uncategorised`** (the current `uncategorised` itself, 16 `other-*` catch-alls, and 2 doubtful leaves). The 17 root mappings are for shop sections only.

Every row of the current tree (17 roots, 84 leaves) mapped to exactly one row of the new tree: a root to a new root (for shop sections that point at a root), a leaf to a new leaf (for the products on it). `split:` names the other leaves the current one's products spread over; `doubt:` marks a weak fit. Where a current root spans several new roots, the note says which holds most of its products, measured on DIA's assortment in the leaves its own leaves map to, with the reference seed's products beside it.

Leaf rule: in a cluster every product sits on one of the plan 0166 landing leaves (the `other-*` catch-alls and `uncategorised`), so a guessed target would misfile a whole cluster at once. Every `other-*` leaf and every leaf marked `doubt:` therefore maps to `uncategorised`, where the products wait to be filed properly; the one exception is `beef-and-lamb`, which keeps `beef`. A `split:` leaf keeps its best single target. The note keeps the nearest guess for reference.

| current slug | level | new slug | new es | note |
| --- | --- | --- | --- | --- |
| `fruit-and-vegetables` | root | `vegetables` | Verduras | spans `fruits` and `vegetables` (and nuts, now under `snacks-and-nuts`); vegetables holds most of it (DIA 209 against 74; seed 4 against 1). The new root is the row of the current leaf `vegetables` |
| `fruit` | leaf of `fruit-and-vegetables` | `other-fruits` | Otras frutas | split: every fruit leaf (`bananas-and-plantains`, `apples-and-pears`, `oranges-tangerines-and-lemons`, `melon-and-watermelon`, `grapes`, `tropical-fruits`, `red-and-forest-fruits`); no DIA leaf is fruit in general, so the catch all. The seed's Plátanos belongs in `bananas-and-plantains` |
| `vegetables` | leaf of `fruit-and-vegetables` | `uncategorised` | Sin categoría | split: `lettuce-and-leafy-greens`, `garlic-onions-and-leeks`, `courgette-pumpkin-and-aubergine`, `potatoes-and-carrots`, `broccoli-cauliflower-and-green-beans`, `mushrooms`. doubt: DIA has no general vegetable leaf and no vegetable catch all; picked its largest fresh vegetable leaf. Seed: 2 mushrooms, 1 aubergine, 1 grilled vegetable mix. The slug `vegetables` itself becomes the root. The nearest guess was `tomatoes-peppers-and-cucumbers` |
| `salads-and-herbs` | leaf of `fruit-and-vegetables` | `lettuce-and-leafy-greens` | Lechugas y hojas verdes | split: `aromatic-herbs`, `salads-and-prepared-vegetables` |
| `nuts-and-dried-fruit` | leaf of `fruit-and-vegetables` | `nuts` | Frutos secos | split: `mixed-nuts`, `dried-fruit`. Moves to root `snacks-and-nuts` (seed: 1 product) |
| `other-produce` | leaf of `fruit-and-vegetables` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `other-fruits` (the only catch all in either produce root; a vegetable left here would sit under Frutas) |
| `meat` | root | `meats` | Carnes |  |
| `poultry` | leaf of `meat` | `chicken` | Pollo | split: `turkey` |
| `pork` | leaf of `meat` | `pork` | Cerdo | same slug, same row; parent changes from `meat` to `meats` |
| `beef-and-lamb` | leaf of `meat` | `beef` | Vacuno | doubt: DIA has no lamb leaf |
| `minced-and-burgers` | leaf of `meat` | `hamburgers-ground-beef-and-meatballs` | Hamburguesas, carne picada y albóndigas |  |
| `other-meat` | leaf of `meat` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `breaded-and-prepared-foods` (no general meat leaf; split: `rabbit`, `cuts-and-cuts`) |
| `cold-cuts-and-cheese` | root | `charcuterie` | Charcutería | spans `charcuterie` and `cheeses`; charcuterie holds most (DIA 188 against 133; seed 26 against 10) |
| `cured-ham-and-sausages` | leaf of `cold-cuts-and-cheese` | `serrano-ham` | Jamón serrano | split: `fuet-and-salchichon`, `loin-and-chorizo`. Seed: 4 fuet, salchichón or salami, 2 chorizo, 2 cured ham |
| `sliced-cold-cuts` | leaf of `cold-cuts-and-cheese` | `cooked-ham` | Jamón cocido | split: `turkey-and-chicken`, `chopped-and-mortadella`, `bacon`. Seed: 2 bacon, chopped, paleta, mortadela, turkey breast |
| `cheese` | leaf of `cold-cuts-and-cheese` | `semi-cured` | Semicurado | split: `cured`, `young-mild`, `cheeses-fresh`, `specialties`, `blue-and-goat-cheese`, `sliced`, `shredded-grated`, `spreadable-and-portions`. Moves to root `cheeses` (seed: 10 products) |
| `pates-and-spreads` | leaf of `cold-cuts-and-cheese` | `pate-and-sobrasada` | Paté y sobrasada | split: `pates` (canned pâtés under `canned-food-broths-and-creams`; DIA files many pâtés in both) (seed: 8 products) |
| `other-cold-cuts` | leaf of `cold-cuts-and-cheese` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `sausages` (no general charcuterie leaf; the seed holds 3 sausages and a cabeza de jabalí; split: `chopped-and-mortadella`) |
| `fish-and-seafood` | root | `fish-and-seafood` | Pescados y mariscos | same slug, same row |
| `fresh-fish` | leaf of `fish-and-seafood` | `fish-and-seafood-fresh` | Fresco | (seed: 5 products) |
| `shellfish` | leaf of `fish-and-seafood` | `seafood-shrimp-and-squid` | Marisco, gamba y calamar | split: `mussels-cockles-and-fish` (canned) |
| `smoked-and-salted-fish` | leaf of `fish-and-seafood` | `smoked-and-salted` | Ahumado y salazón |  |
| `other-seafood` | leaf of `fish-and-seafood` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `surimi-and-prepared-products` (no general fish leaf; split: `fish-and-seafood-frozen`, `breaded`) |
| `dairy-and-eggs` | root | `eggs-milk-and-butter` | Huevos, leche y mantequilla | spans `eggs-milk-and-butter` and `yoghurts-and-desserts`; five of its six leaves go to the first (DIA 204 against 187). doubt: the seed holds 7 desserts and 1 egg, so by seed products it would be `yoghurts-and-desserts` |
| `milk` | leaf of `dairy-and-eggs` | `milk` | Leche | same slug, same row; parent changes from `dairy-and-eggs` to `eggs-milk-and-butter`. split: `lactose-free-and-fortified-milk`, `condensed-and-evaporated-milk` |
| `plant-drinks` | leaf of `dairy-and-eggs` | `plant-based-drinks-and-horchata` | Bebidas vegetales y horchatas |  |
| `yogurts-and-desserts` | leaf of `dairy-and-eggs` | `uncategorised` | Sin categoría | split: every leaf of `yoghurts-and-desserts` (`flavoured-and-fruit-yoghurts`, `greek-yogurts`, `liquid-yogurts`, `bifidus-yoghurts-and-cholesterol`, `kefir-and-plant-based-desserts`, `protein-desserts-and-yogurts`, `yogurts-and-children-s-desserts`, `traditional-desserts`, `custard-flan-and-rice-pudding`, `gelatins-and-curds`). doubt: the seed's 7 are desserts (3 flans, mousse, panna cotta, tarta al whisky) and 1 Greek yogurt, and would land in `custard-flan-and-rice-pudding` or `traditional-desserts`. The nearest guess was `natural-and-skimmed-yogurts` |
| `butter-and-cream` | leaf of `dairy-and-eggs` | `butter-and-margarine` | Mantequilla y margarina | split: `cream` |
| `eggs` | leaf of `dairy-and-eggs` | `eggs` | Huevos | same slug, same row; parent changes from `dairy-and-eggs` to `eggs-milk-and-butter` (seed: 1 product) |
| `other-dairy` | leaf of `dairy-and-eggs` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `milkshakes` (no general dairy leaf; split: `kefir-and-plant-based-desserts`, `gelatins-and-curds`, `condensed-and-evaporated-milk`) |
| `bakery` | root | `bakery` | Panadería | same slug, same row. Spans `bakery` and `pastries-cakes-and-sugar` (its pastries); bakery holds more (DIA about 155 against 145) |
| `bread` | leaf of `bakery` | `freshly-baked-bread` | Pan recién horneado | split: `sliced-and-specialty-breads`, `hamburger-and-hot-dog-buns`, `wheat-tortillas-and-pita-bread`, `gluten-free-bread`. Seed: 3 sliced loaves, 1 hot dog bun, 1 bocatín |
| `pastries-and-cakes` | leaf of `bakery` | `muffins-and-classic-pastries` | Magdalenas y bollería clásica | split: `sweet-baked-goods`, `doughnuts-and-cakes`, `pastries-cakes-and-sugar-cakes`. Moves to root `pastries-cakes-and-sugar` (seed: 9 products) |
| `toasts-and-crispbread` | leaf of `bakery` | `breadcrumbs-toasted-bread-and-breadsticks` | Pan rallado, tostado y picos | (seed: 3 products) |
| `other-bakery` | leaf of `bakery` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `oven` (`oven` (Horno, the in store bakery counter) is the widest; split: `doughs-and-pastries`) |
| `breakfast-and-sweets` | root | `biscuits-cereals-and-jams` | Galletas, cereales y mermeladas | spans `biscuits-cereals-and-jams`, `chocolates-and-sweets` and `coffee-cocoa-and-infusions`. doubt: a near tie, DIA about 369 against 338 once cocoa spreads follow jams; the seed ties 5, 5 and 5; picked the breakfast one |
| `cereals` | leaf of `breakfast-and-sweets` | `cereals` | Cereales | same slug, same row; parent changes from `breakfast-and-sweets` to `biscuits-cereals-and-jams`. split: `whole-grain-cereals-and-muesli` (seed: 1 product) |
| `biscuits` | leaf of `breakfast-and-sweets` | `classic-and-digestive-biscuits` | Galletas clásicas y digestive | split: `chocolate-and-filled-biscuits`, `savory-biscuits-and-crackers` (seed: 3 products) |
| `jam-honey-and-spreads` | leaf of `breakfast-and-sweets` | `jams` | Mermeladas | split: `sugar-honey-and-sweeteners` (honey), `cocoa-spreads-and-creams` (seed: 1 product) |
| `chocolate-and-sweets` | leaf of `breakfast-and-sweets` | `sweets` | Golosinas | split: `milk-chocolate`, `dark-chocolate`, `white-chocolate`, `chocolates-and-bonbons`, `chewing-gum-and-candies`. Moves to root `chocolates-and-sweets`; `sweets` is its widest leaf (seed: 5 products) |
| `coffee-tea-and-cocoa` | leaf of `breakfast-and-sweets` | `ground-coffee` | Café molido | split: every leaf of `coffee-cocoa-and-infusions` (capsules of three kinds, `instant-coffee`, `whole-bean-coffee`, `cold-brew-coffee`, `cocoa-and-hot-chocolate`, `infusions`, `tea`). Seed: 2 capsules, 2 cold coffees, 1 infusion, none ground |
| `other-breakfast` | leaf of `breakfast-and-sweets` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `cereal-and-protein-bars` (no general breakfast leaf) |
| `pantry` | root | `oils-sauces-and-spices` | Aceites, salsas y especias | spans `oils-sauces-and-spices`, `canned-food-broths-and-creams`, `rice-pasta-and-pulses` and `pastries-cakes-and-sugar` (flour, sugar). doubt: the first three are close (DIA about 324, 305, 223 once pasta sauces follow sauces); seed 7, 3, 2 |
| `pasta-rice-and-legumes` | leaf of `pantry` | `macaroni-spaghetti-and-dried-pasta` | Macarrones, espaguetis y pastas secas | split: `rice`, `rice-pasta-and-pulses-fideos`, `chickpeas-and-beans`, `lentils`, `quinoa-couscous-and-soy`. Seed: chickpeas and fideos |
| `canned-food` | leaf of `pantry` | `canned-food-broths-and-creams-canned-vegetables` | Conservas de verdura | split: `tuna-and-bonito`, `mackerel-and-sardines`, `mussels-cockles-and-fish`, `canned-fruit`. Seed: 2 sardines, 1 whole tomato |
| `oil-and-vinegar` | leaf of `pantry` | `oils` | Aceites | split: `vinegars-and-dressings` |
| `sauces-and-condiments` | leaf of `pantry` | `ketchup-mayonnaise-and-mustard` | Ketchup, mayonesa y mostaza | split: `tomato-and-pasta-sauces` (seed: 2 tomate frito), `special-and-spicy-sauces`, `pasta-sauces` |
| `flour-sugar-and-baking` | leaf of `pantry` | `flours-and-yeasts` | Harinas y levaduras | split: `sugar-honey-and-sweeteners`, `dessert-mixes-and-decorations`. Moves to root `pastries-cakes-and-sugar` (seed: 3 products) |
| `spices-and-salt` | leaf of `pantry` | `spices-and-herbs` | Especias y hierbas | split: `garlic-salt-and-pepper` (seed salt), `seasonings` |
| `soups-and-stock` | leaf of `pantry` | `broths-and-soups` | Caldos y sopas | split: `creams-and-purees`. Moves to root `canned-food-broths-and-creams` |
| `other-pantry` | leaf of `pantry` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `quinoa-couscous-and-soy` (no general pantry leaf in any of the four roots; the seed's one product (a revuelto mix) fits none) |
| `frozen` | root | `frozen-foods-and-ice-cream` | Congelados y helados | the current row `frozen` has no counterpart in the new tree (the DIA leaf L2249 Congelado is `fish-and-seafood-frozen`); the migration deletes it after remapping |
| `frozen-vegetables` | leaf of `frozen` | `frozen-and-steamed-vegetables` | Verduras congeladas y al vapor | split: `vegetables-and-potatoes` (the frozen root's own vegetable leaf). Moves to root `vegetables`, whose leaf carries the same name (seed: 1 product) |
| `frozen-fish-and-seafood` | leaf of `frozen` | `frozen-foods-and-ice-cream-fish-and-seafood` | Pescado y marisco | split: `fish-and-seafood-frozen` (seed: 1 product) |
| `frozen-meals-and-pizzas` | leaf of `frozen` | `pizzas-and-doughs` | Pizzas y masas | split: `rice-and-pasta`, `croquettes-and-batters`, `frozen-pizzas` (under `prepared-meals-and-pizzas`) (seed: 3 products) |
| `ice-cream` | leaf of `frozen` | `ice-creams-and-ice` | Helados y hielo | (seed: 5 products) |
| `other-frozen` | leaf of `frozen` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `croquettes-and-batters` (no general frozen leaf; split: `rice-and-pasta`, `cakes-and-churros`) |
| `ready-meals` | root | `prepared-meals-and-pizzas` | Platos preparados y pizzas |  |
| `pizzas` | leaf of `ready-meals` | `refrigerated-pizzas` | Pizzas refrigeradas | split: `frozen-pizzas`. The seed's three pizzas are frozen and also carry `frozen-meals-and-pizzas` |
| `prepared-dishes` | leaf of `ready-meals` | `traditional-food` | Comida tradicional | split: `ready-to-eat-dishes`, `mexican-food`, `asian-food` |
| `salads-and-sandwiches` | leaf of `ready-meals` | `salads-and-bowls` | Ensaladas y bowls | split: `sandwiches-and-burgers` |
| `fresh-pasta-and-dough` | leaf of `ready-meals` | `filled-and-sauced-pasta` | Pastas rellenas y en salsa | split: `doughs-and-pastries` (bakery). Moves to root `rice-pasta-and-pulses` |
| `other-ready-meals` | leaf of `ready-meals` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `ready-to-eat-dishes` (split: `tortillas-and-pies`, `gazpachos-and-salmorejos`, `hummus-and-guacamole`) |
| `snacks` | root | `snacks-and-nuts` | Aperitivos y frutos secos |  |
| `crisps` | leaf of `snacks` | `potato-chips` | Patatas fritas | (seed: 2 products) |
| `salty-snacks` | leaf of `snacks` | `savory-snacks` | Snacks salados | split: `vegetable-snacks`, `savory-biscuits-and-crackers` (seed: galletas saladas) |
| `olives-and-pickles` | leaf of `snacks` | `olives` | Aceitunas | split: `pickles` (seed: 1 product) |
| `other-snacks` | leaf of `snacks` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `savory-snacks` (the widest snack leaf) |
| `drinks` | root | `beers-wines-and-spirits` | Cervezas, vinos y licores | spans `beers-wines-and-spirits`, `water-and-soft-drinks` and `juices-and-smoothies`; beers, wines and spirits holds most (DIA 469, 274, 120). doubt: by seed products water wins (5 against 4) |
| `water` | leaf of `drinks` | `water` | Agua | same slug, same row; parent changes from `drinks` to `water-and-soft-drinks` (seed: 5 products) |
| `soft-drinks` | leaf of `drinks` | `cola` | Cola | split: `orange-lemon-and-lemon-lime`, `tonic-sparkling-water-and-bitter`, `iced-tea`, `non-carbonated-soft-drinks`, `energy-drinks`, `water-and-soft-drink-packs` |
| `juices` | leaf of `drinks` | `multifruit-and-other-flavors` | Multifrutas y otros sabores | split: every leaf of `juices-and-smoothies` (`orange`, `peach-and-pineapple`, `fruit-and-milk`, and the rest). Seed: 1 fruit and milk |
| `beer` | leaf of `drinks` | `beers` | Cervezas | split: `premium-and-specialty-beers`, `beers-with-lemon`, `non-alcoholic-beers`, `beer-packs` (seed: 3 products) |
| `wine-and-cava` | leaf of `drinks` | `red-wine` | Vino tinto | split: `white-wine` (the seed's one wine), `rose-wine`, `cavas-and-cider`, `summer-red-wine-and-sangria` |
| `spirits` | leaf of `drinks` | `gin-vodka-and-tequila` | Ginebra, vodka y tequila | split: `ron-and-whisky`, `creams-liqueurs-and-brandy`, `vermouth-and-aperitifs` |
| `other-drinks` | leaf of `drinks` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `non-carbonated-soft-drinks` (no general drinks leaf; split: `isotonic-and-sports-drinks`, `kombucha-and-vitamin-infused-waters`) |
| `baby` | root | `children` | Infantil |  |
| `baby-food` | leaf of `baby` | `baby-foods-and-jars` | Potitos y tarritos | split: `milk-and-baby-food`, `pots-and-snacks`, `yogurt-and-desserts`, `infant-formula` |
| `nappies-and-wipes` | leaf of `baby` | `diapers-and-wipes` | Pañales y toallitas | (seed: 1 product) |
| `other-baby` | leaf of `baby` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `hygiene-and-care` (the widest baby leaf) |
| `pets` | root | `pets` | Mascotas | same slug, same row |
| `dogs` | leaf of `pets` | `dry-dog-food` | Perro comida seca | split: `wet-dog-food`, `dog-treats-and-care`. The seed's three dog products (chews, sausages, waste bags) all belong in `dog-treats-and-care` |
| `cats` | leaf of `pets` | `dry-cat-food` | Gato comida seca | split: `wet-cat-food`, `cat-treats-and-care` |
| `other-pets` | leaf of `pets` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind (DIA has leaves for cats and dogs only (its other animals leaf L2176 is hidden and empty), so nothing fits) |
| `household` | root | `cleaning-and-home` | Limpieza y hogar |  |
| `cleaning` | leaf of `household` | `cleaning-floors-windows-and-furniture` | Limpieza suelos, cristales y muebles | split: `bathroom-and-toilet-cleaning`, `kitchen-cleaning-and-degreasing`, `bleach-and-disinfectants`, `garbage-bags-brooms-and-mops`, `scouring-pads-cloths-and-gloves`. Seed: 4 floor cleaners, 3 WC, bleach, mop, bucket, furniture polish |
| `laundry` | leaf of `household` | `detergents` | Detergentes | split: `fabric-softeners-and-laundry-care` (all three seed products: perfume pearls and two stain removers) |
| `dishwashing` | leaf of `household` | `dishwasher` | Lavavajillas | Lavavajillas covers hand and machine dishwashing |
| `paper-and-wipes` | leaf of `household` | `toilet-paper-kitchen-paper-and-napkins` | Papel higiénico, cocina y servilletas | (seed: 3 products) |
| `bags-foil-and-wrap` | leaf of `household` | `film-aluminum-and-preservation` | Film, aluminio y conservación | split: `garbage-bags-brooms-and-mops`, `batteries-kitchenware-and-bags` (seed: shopping bag) |
| `other-household` | leaf of `household` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `batteries-kitchenware-and-bags` (the widest household leaf; split: `air-fresheners-refills-and-candles` (seed: 2 air fresheners), `insecticides` (seed: 1 refill)) |
| `personal-care` | root | `hygiene-and-body-care` | Higiene y cuidado del cuerpo | spans `hygiene-and-body-care`, `hair-and-perfumery` and `health-and-pharmacy`; hygiene holds most (DIA 324, 304, 73) |
| `hair` | leaf of `personal-care` | `shampoo` | Champú | split: `conditioners-and-masks`, `foams-and-fixers`, `dyes`. Moves to root `hair-and-perfumery` (seed: 3 products) |
| `skin-and-body` | leaf of `personal-care` | `body-and-hand-hydration` | Hidratación de cuerpo y manos | split: `shower-gel-and-sponges`, `hand-soap`, `facial-care`. Seed: one of each of the last three |
| `oral-care` | leaf of `personal-care` | `oral-hygiene` | Higiene bucal |  |
| `shaving-and-deodorant` | leaf of `personal-care` | `deodorants` | Desodorantes | split: `shaving`, `hair-removal` (seed: 2 products) |
| `feminine-care` | leaf of `personal-care` | `sanitary-pads-and-feminine-hygiene` | Compresas e higiene íntima | (seed: 2 products) |
| `pharmacy` | leaf of `personal-care` | `parapharmacy` | Parafarmacia | split: `first-aid-kit`, `nutritional-supplements`, `sunscreen`. Moves to root `health-and-pharmacy` |
| `other-personal-care` | leaf of `personal-care` | `uncategorised` | Sin categoría | catch-all: no DIA leaf holds the same kind. The nearest guess was `facial-care` (DIA has no makeup or nail leaf; 11 of the seed's 13 are cosmetics (nail lacquers, blush, lip liner), and facial care is where DIA files make up removers and lip balm. Moves to root `hair-and-perfumery`) |
| `other` | root | `other` | Otros | same slug, same row |
| `uncategorised` | leaf of `other` | `uncategorised` | Sin categoría | same slug, same row (seed: 6 products) |

Rows marked split: 60; marked doubt: 7. New rows used: 83 of 275; the other 192 new rows start empty and fill from DIA's own filing through `dia-map.json`.
## Appendix D. Slugs in both trees

Ids are the uuidv5 of the slug, so each slug below names **one row** that the current tree and the new tree both describe. The migration updates that row in place rather than inserting a new one, and must handle the level and parent changes flagged here.

| slug | current level / parent | new level / parent | flag | current maps to |
| --- | --- | --- | --- | --- |
| `vegetables` | leaf / `fruit-and-vegetables` | root | **LEVEL CHANGE: leaf becomes root** | `uncategorised` |
| `pork` | leaf / `meat` | leaf / `meats` | parent changes | `pork` |
| `fish-and-seafood` | root | root | unchanged | `fish-and-seafood` |
| `milk` | leaf / `dairy-and-eggs` | leaf / `eggs-milk-and-butter` | parent changes | `milk` |
| `eggs` | leaf / `dairy-and-eggs` | leaf / `eggs-milk-and-butter` | parent changes | `eggs` |
| `bakery` | root | root | unchanged | `bakery` |
| `cereals` | leaf / `breakfast-and-sweets` | leaf / `biscuits-cereals-and-jams` | parent changes | `cereals` |
| `water` | leaf / `drinks` | leaf / `water-and-soft-drinks` | parent changes | `water` |
| `pets` | root | root | unchanged | `pets` |
| `other` | root | root | unchanged | `other` |
| `uncategorised` | leaf / `other` | leaf / `other` | unchanged | `uncategorised` |

What each flag asks of the migration:

- **Leaf becomes root** (`vegetables`): the current leaf holding every fresh vegetable product becomes the root Verduras. Its products must be moved to a leaf (Appendix C sends them to `uncategorised`, since no DIA leaf is vegetables in general) **before** the row turns into a root, because a product may only sit on a leaf; and anything that names it as a leaf (shop sections, the reference products in `mercadona.ts`, and the specs and fakes that use the slug) now names a root. Its name changes from "Verduras y hortalizas" to "Verduras".
- **Parent changes** (`pork`, `milk`, `eggs`, `cereals`, `water`): the row keeps its id and products; only `parentId`, `position` and the name are rewritten.
- **Unchanged level and parent** (`fish-and-seafood`, `bakery`, `pets`, `other`, `uncategorised`): name and position rewrites only. Their current leaves all move away, so each of these roots is emptied of its old children and refilled with DIA's.

### Current rows with no new row

`frozen` (current root Congelados / Frozen) is **only a current row**. DIA's leaf L2249 Congelado, whose English slug is also `frozen`, takes `fish-and-seafood-frozen` under the extended collision rule (a new leaf equal to a current row of another level takes the parent root prefix), so the id of `frozen` is never reused. The migration moves its five children (Appendix C), repoints every shop section that names it to `frozen-foods-and-ice-cream` (`old-to-new.json`), then deletes the row. Every other current slug not in the table above also ends with no new row and is handled the same way: remap, then delete.

The rule was also checked the other way round: `vegetables` is the only new root equal to a current leaf, and it keeps its slug by decision.

Near misses that are **different rows** (different slug, so a new id) and are easy to confuse in review: `fruit` / `fruits`, `cheese` / `cheeses`, `meat` / `meats`, `yogurts-and-desserts` (current leaf) / `yoghurts-and-desserts` (new root) / `yogurt-and-desserts` (new leaf under `children`), `ice-cream` / `ice-creams-and-ice`, `pizzas` / `pizzas-and-doughs`, `beer` / `beers`, `chocolate-and-sweets` (current leaf) / `chocolates-and-sweets` (new root), `fish-and-seafood` (root) / `frozen-foods-and-ice-cream-fish-and-seafood` (leaf), `frozen` (current root, deleted) / `fish-and-seafood-frozen` (new leaf).
