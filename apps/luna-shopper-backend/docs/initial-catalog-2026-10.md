# The initial production catalog (October 2026)

This document records how the catalog and harvester databases that production starts from
were built, on 2026-10-03, and what a person must know before and after that state is
copied to production. The work is not meant to be repeated. Read this document instead.

The data was built on a local Luna slot (slot 1) from a copy of staging. It was then
harvested, curated by model deciders under a person's rules, corrected by the owner's
decisions, and dumped. The dumps are the only artifact production needs. They are
`catalog.dump` and `harvester.dump` (`pg_dump -Fc`, taken 2026-10-03 20:44 Madrid time) in
the git ignored folder `.curation-runs/2026-10-deza-staging/harvest-curation/final-dumps/`
on the developer's machine. Slot 1 held the same data until 2026-10-06, locked with
`luna-slot.sh --down --keep-data`. The scripts that
drove the work were job local and are not in the repository. Their logic is described
here.

**Slot 1 no longer holds that state.** On 2026-10-06 plan 0186 repaired the defects that an
audit of this catalog found. The dumps in `final-dumps/` thus no longer match slot 1. The
section "Repairs after the audit" at the end records what changed, the new counts, the new
dumps and what stays wrong. Every other section describes the catalog as it was built on
2026-10-03, and says so where a repair changed a number.

## The state in numbers

| | Count |
| --- | ---: |
| Supermarkets | 5 (Carrefour, Deza, El Jamón, LIDL, Mercadona) |
| Price scopes | 103 (Carrefour 1, Deza 9, El Jamón 20, LIDL 59, Mercadona 14) |
| Categories | 275 (DIA's tree, plan 0173) |
| Brands | 2,782 (139 from staging, the rest registered by this work) |
| Products (`items`) | 19,791 |
| Price rows (`item_prices`) | 22,335 |
| Queue rows (`source_catalog_entries`) | 25,725 |
| Queue rows linked to a product (`ACTIVE`) | 21,751 |
| Queue rows left for a person | 3,974 |

"Final counts" splits them by chain.

These are the counts of 2026-10-03. After the repairs of 2026-10-06 slot 1 holds:

| | Count on 2026-10-06 |
| --- | ---: |
| Price scopes | 103 |
| Categories | 309 |
| Brands | 2,782 |
| Products (`items`) | 19,761 |
| Price rows (`item_prices`) | 23,374 |
| Queue rows (`source_catalog_entries`) | 25,856 |
| Queue rows linked to a product (`ACTIVE`) | 21,754 |
| Queue rows left for a person | 4,077 `UNRESOLVED` and 25 `CANDIDATE` |

"Counts after the repairs" in the last section splits them by chain.

## What production must do before it serves this state

Release task `0003-restore-the-first-catalog` copies this state into a cluster
(k8s plan 0012, `k8s/catalog-import/README.md`). It enforces three of the five
conditions below, and the other two stay with a person:

| Condition | Who holds it |
| --- | --- |
| 1. Run the same code | The task. It refuses unless the live `migrations` tables hold the same names as the dumps. |
| 2. Turn the four harvest sources off | The task. It turns every `supermarket_sources` row off before the swap and reads the result back after it. The route named below is no longer needed for this. |
| 3. Check what references catalog ids | The task. It refuses to lose a chain, price scope, shop, brand or product group that the cluster holds, unless `expected-losses.txt` accepts the row. It then clears every reference in core that points at nothing. |
| 4. Know the actor ids in the audit trail | A person. The task changes nothing here. |
| 5. Prices age | A person. The task changes no price, so a restore after 2026-10-08 carries Deza leaflet prices that the read side already treats as expired. |

The numbers in this document are those of the dumps of 2026-10-03. The owner
went on editing slot 1 after that day, so the dumps that ship are taken again,
and `k8s/catalog-import/first-catalog.manifest` then states what they hold.
The dumps of 2026-10-06 are such dumps. "Repairs after the audit" names them.

1. **Run the same code.** In the dumps of 2026-10-03 the catalog database holds 26
   migrations, the last one `DiaCategoryTree1758500000000` (plan 0173, PR #597). The
   harvester database holds 17, the last one `DiscoveredPlaceFootprint1757900000000`
   (plan 0176). Since 2026-10-06 slot 1 runs the code of `dev`, and its dumps hold 29 and
   20 migrations, the last ones `ItemEans1758800000000` and
   `SourceEntryAvailability1758200000000`. Production's release must contain exactly the
   migrations of the dumps it restores, or the services will try to run or miss one.
2. **Turn the four harvest sources off.** The harvester dump has a `supermarket_sources`
   row for Mercadona, LIDL, Deza and El Jamón, all with `enabled = true`. A cluster keeps
   every source off (plan 0083, `CLAUDE.md`). Set each one to false right after the
   restore, through `PUT /v1/admin/harvest/sources/:supermarketId/enabled`.
3. **Check what references catalog ids.** The catalog came from staging, so every id in it
   (supermarkets, price scopes, locations, categories, brands, products) is staging's id or
   a new one. Production's own core database (lists, list lines, baskets) and any client
   cache that stored a production catalog id will not find it. Copy this state only into a
   production whose core holds no catalog references, or plan a migration of them.
4. **Know the actor ids in the audit trail.** `catalog_audit` names four actors that
   production's auth database does not hold: the local harvester actor
   (`ac700000-0000-4000-a000-000000000001`), the curation admin of slot 1
   (`af302b51-24d1-4c8e-8c1d-cd41c6102c39`, `admin@curation.local`, which exists only on
   slot 1), and two staging actors. They are history and nothing reads them to decide.
   Production's `HARVESTER_ACTOR_ID` keeps its own value.
5. **Prices age.** Every price was observed on 2026-10-03. Mercadona's are for three
   Córdoba warehouses. LIDL's are that week's offers. The Deza leaflet prices are valid
   from 2026-09-24 to 2026-10-08. The price policy and the `ADMIN` protection rules decide
   on every read which price a shopper sees (plan 0080), so stale rows lose to newer ones
   as soon as new runs write them.

## Stage 1: staging copied to the slot

- Staging was only read. `pg_dump -Fc` of the catalog and harvester databases was taken at
  2026-10-03T00:16:54Z. Auth and core were not copied, because they hold personal data.
- Staging held 139 brands, 5 supermarkets, 102 price scopes, 40 locations, 29 categories
  and no products.
- The slot ran one migration staging did not have, `DiaCategoryTree1758500000000`, which
  replaced the 29 categories with DIA's 275.
- The slot was always started with the reference seed switched off. At the time a plain
  `--up` ran that seed, which added about 238 seeded products to the copy. That happened
  once by accident and was undone by restoring the dump again. Plan 0180 has since removed
  the seed, so a plain `--up` no longer adds anything and there is no switch to set.

An earlier pass on the same day read the Deza leaflet first and created 71 products from
it. The owner then asked for the opposite order: the websites and APIs first, as the source
of truth, and the leaflet last, linked to them. The slot was restored from the staging
dump, which removed that pass completely.

## Stage 2: the harvests

Each chain got a `supermarket_sources` row (enabled) and one `CATALOG_DISCOVERY` run,
started together at 2026-10-03 01:19 UTC.

| Chain | Adapter | Workers, requests per second | Scope | Rows | Duration |
| --- | --- | --- | --- | ---: | --- |
| Mercadona | `mercadona-api` | 4, 4 | 3 Córdoba warehouses: 3769, 4661, 4694 (LOCAL_AREA scopes) | 4,289 | 20 min |
| LIDL | `lidl-api` | 2, 2 | The week's offers, 59 offer regions | 121 | 1 min |
| Deza | `deza-web` | 2, 2 | NATIONAL. The site prints no prices. | 14,236 read, 14,228 rows | 23 min |
| El Jamón | `eljamon-web` | 6, 4 | NATIONAL | 6,891 (28 failed reads) | 2 h 37 min |

The owner limited Mercadona to Córdoba. Deza and El Jamón print no EAN.

No row resolved by itself. An earlier version of this document said that rows whose EAN
matched a product did, and that was wrong. A run matches a barcode only against the
products that exist when it starts, and the catalog held none. A curator's decision in
stage 4 bound every row, and each of the 21,751 bound rows says `matchedBy: MANUAL`
(plan 0184). The second Mercadona run, on 2026-10-06, also bound no row by its barcode.

## Stage 3: brands

The brand registry decides what a curator can write as a brand (curation plans 0004 and
0005). Every printed spelling that was not registered went to an Opus 5.5 decider, in
chunks of about 300, with one answer per spelling:

- `REGISTER`: a real brand, with its display label and, when it is one, the chain whose
  private label it is.
- `SPELLING_OF`: the same brand written differently. It is registered as a link.
- `NOT_A_BRAND`: a season, a section, a product type or a range word. Nothing is sent.
- `REVIEW`: left for a person.

The rules given to the deciders: the brand is the line, not the maker (Elvive, not
L'Oréal). A line is never a spelling of its maker. A private label never crosses chains.

| Round | Spellings | Result |
| --- | ---: | --- |
| LIDL, Mercadona, Deza (11 chunks) | 3,127 | The registry grew from 139 to 2,243 brands |
| El Jamón (2 chunks) | 505 | 480 registered, 18 spellings, 3 not brands, 4 review |
| Deza wines (after D.O. was removed, see below) | 43 wineries | 32 sent (31 new, 1 already registered), 11 held for a person |

Private labels set: Hacendado, Bosque Verde, Deliplus, Delikuit (Mercadona). Alteza (Deza).
Ifa Eliges, Ifa Sabe, Ifa Unnia, Ifa Amigo, Eco Eliges, El Jamón (El Jamón). Several LIDL
labels (Milbona, Pikok, Cien, Deluxe and others).

## Stage 4: products

### How the queue was decided

The queue was split into lanes by brand, so two lanes never held the same brand and ran
at once. Each batch held about 100 rows. For each row, the batch showed the name search
hits and up to ten catalog products of the same brand. An Opus 5.5 decider answered every
row with one of:

- `CREATE`: a new product, with name (Spanish and English), brand, size, unit, categories
  and the row's EAN.
- `LINK`: the same product as a candidate, or as a product created earlier in the batch.
- `REVIEW`: left in the queue for a person, with an issue code.

A driver checked every answer with the curation library's validator
(`libs/luna-shopper/tools/curation/suggestions`, `validateDecision`) and sent the batch to
`POST /v1/admin/harvest/entries/decisions`, which applies a batch completely or not at all.
A `CREATE` or `LINK` writes the row's prices.

The order mattered: LIDL and Mercadona first (they print EANs), then Deza, then El Jamón,
so each chain linked to the products the chains before it created.

| Work | Batches | Rows |
| --- | ---: | ---: |
| LIDL, Mercadona, Deza | 184 in 8 lanes | 18,646 |
| El Jamón | 72 in 8 lanes | 6,891 |
| Deza leaflet | 4 | 190 |
| Deza D.O. wines | 1 | 92 |

### The rules every decider followed

These are the catalog's merge rules, as the curation prompt states them, plus the owner's
rules for this work:

- The harvested website or API is the source of truth for name, brand, size and EAN. A
  `CREATE` copies the row's EAN.
- Same brand plus same format merges, and nothing else does. A flavour, scent, shade,
  range or pack size is another product.
- Brand and size never go in a product's name. A line, range, shade or variant word stays.
- A private label never crosses chains.
- No size: `unitSize` null, `UNIT`. Sold loose by weight: `unitSize` null, `KILOGRAM`.
  Never invent a size.
- Laundry and dishwasher products sized in washes: the wash count as a `UNIT` size.
- A multipack is sized as the pack total only when each piece's size is printed.
  Otherwise it goes to review.
- Never the catch all `uncategorised` slug. No fitting category means `REVIEW` with
  `NO_CATEGORY`. (About 30 products from the first batches were created under it before
  this rule existed. They are listed in plan 0179.)
- El Jamón's category paths are unreliable, so its categories came from the product name.

### Sections skipped without a decider

Deza sections where deciders had sent 90% to 100% of the rows to review, because DIA's tree
has no category for them, were skipped without a call: `BAZAR>Papeleria`,
`BAZAR>Textil persona`, `BAZAR>Disfraces`, `BAZAR>Textil hogar`, `BAZAR>Bazar` and all of
`KIOSCO`. About 1,100 rows. Plan 0179 adds the categories they need.

### Result per chain

| Chain | Linked to a product | Left in the queue | Share linked |
| --- | ---: | ---: | ---: |
| Mercadona | 4,144 | 145 | 97% |
| El Jamón | 6,270 | 621 | 91% |
| Deza website | 11,153 | 3,075 | 78% |
| LIDL | 78 | 43 | 64% |

Why rows were left, across all work (log lines, a row decided twice counts twice):

| Reason | Count |
| --- | ---: |
| The decider answered `REVIEW` (unsure, several products in one offer, sizes in cm, gift sets, packs with no piece size, no category) | about 2,670 |
| Deza section skipped (no category) | 1,097 |
| The brand is not registered | about 245 |
| The name carried a size or a brand | about 30 |
| Other validator refusals (`EAN_CONFLICT`, `FORMAT_MISMATCH`, `UNKNOWN_CATEGORY`) | about 30 |

## Stage 5: the Deza leaflet, last

- The leaflet was Folleto Deza Octubre 26 (44 pages), read by `claude-sonnet-5` through the
  leaflet CLI into a HarvestDocument of 196 offers (sha256 `2baa4be9…7877`). An audit of 47
  offers on 21 pages found every headline price correct. The validity window, 2026-09-24
  to 2026-10-08, is borrowed from the SuperCash leaflet of the same chain and is not
  confirmed by Deza.
- It was imported with `POST /v1/admin/harvest/imports` (Deza, Deza NATIONAL scope,
  `OFFICIAL_LEAFLET`) after every other batch, so its offers linked to the harvested
  products. 6 offers resolved on import.
- Opus 5.5 deciders took the other 190. A candidate carried `soldAtDeza: true` when Deza's
  own website lists it. The rule was: a leaflet offer is normally a link to an existing
  product, and rarely a new one.
- Result: 88 linked (79 of them to a product Deza's website lists), 12 created, 106
  `ACTIVE` with the leaflet price written, 90 left (mostly offers covering several
  products, home textiles with no category, and sizes in centimetres).

## The owner's decisions applied on 2026-10-03

### Brands

| Decision | Applied as |
| --- | --- |
| Ron Barceló is the brand | Barceló is a spelling of Ron Barceló |
| Cola Cao and Cola Cao Energy are one brand | Cola Cao Energy is a spelling of Colacao, relabelled "Cola Cao" |
| Hidalgo and Hnos. Hidalgo are one brand | Hnos. Hidalgo is a spelling of Hidalgo |
| Biscoff is the brand of the line (Lotus Bakeries is replacing "Lotus" with "Biscoff" on its packs), Lotus stays for its other products | Lotus Biscoff is a spelling of Biscoff. Five Lotus products named Biscoff moved to Biscoff. Lotus keeps its waffles. |
| Nike Man is Nike | Nike Man and Nike Man Gold Edition are spellings of Nike |
| Nivea Men is Nivea | Nivea Men is a spelling of Nivea |
| L'Oréal Men and Women are L'Oréal | LOREAL MEN and L'Oréal Men Expert are spellings of Loreal |
| Hero is the brand, Hero Solo and Hero Baby are lines | Kept as separate brands. Five Hero products named Baby moved to Hero Baby. |
| Ristorante (Dr. Oetker), YoPro and Oikos (Danone), Naturarte (Campofrío), Bifrutas (Pascual), Dentalife (Purina) are lines | Kept as separate brands. 13 Dr. Oetker pizzas named Ristorante and 8 Danone products named YoPro moved to their line. |
| Esencia Única is its own brand, not Covap | Four Covap products named Esencia Única moved to it |
| Pantera Rosa is a Bimbo product, not a line | Pantera Rosa is a spelling of Bimbo. The product is "Pastelitos Pantera Rosa". |
| EXTRÊME is Nestlé's ice cream line, Extrem is another brand | EXTRÊME unlinked from Extrem and relabelled "Extrême" |
| Poseidon Food (fish) is a brand besides Poseidon (cologne) | Poseidon Food registered. Choosing between them needs plan 0178. |
| Royal (desserts, fish) and Noel (charcuterie, biscuits) | Left as they are |
| D.O. is not a brand | The brand was deleted. See below. |

A product that moved to a line lost the line word from its Spanish and English name
("Pizza Ristorante mozzarella" became "Pizza mozzarella" under Ristorante).

### D.O. removed, and the 92 wines it blocked

Deza's website puts the brand in capitals inside the name, and its brand reader takes the
first capitalised word. In "Vino tinto D.O Toro PRIMA crianza" that is "D.O", which means
Denominación de Origen, a protected region. A brand "D.O." was registered on staging,
so the validator forced all 92 wines to be created under "D.O." or refused them. The owner
confirmed it is not a brand. It was linked away and deleted (it held no product). An Opus
5.5 agent then read each wine's real brand from its name, the confident new wineries were
registered, and the wines were curated: 56 products created, 13 rows linked to existing products and 23 left for review (22 of them because the brand is unsure). Plan 0178 fixes the reader.

### Weighed products are one product, sold by the kilo

Mercadona lists products sold by approximate weight (cheese pieces, meat trays, some fruit)
once per piece, each with its own weight and an in-store barcode starting with 2. The
first pass created one product per weight (a semicured cheese at 1.54 kg and another at
0.42 kg). The owner's rule: a weight that is not the same on every pack is not a format,
so these are one product. A fixed weight (always 200 g, always 300 g) stays a format.

Applied: Mercadona's public product API was read for the 212 linked rows with an in-store
barcode. 179 answered `approx_size: true`, 29 are fixed packs and 4 no longer exist. The
179 products are now sold by the kilo with no size (133 changed). Six pairs with the same
brand and name were merged into one product each: three Hacienda del Ibérico cured meats,
two Hacendado cheeses and chicken wings. Their rows were accepted onto the kept product
and the empty product was deleted. The merged product keeps every piece's price side by
side. Note that two pieces of one cheese can cost a different amount per kilo (9.41 against
9.70 euros). Products of other chains linked to a resized product follow it.

### Other corrections

- The two Aquarel waters now carry the EANs their rows print (3700123300014,
  3700123300021).

## What is left for a person

- 3,974 queue rows, each with its reason in the review queue: unregistered brands,
  offers covering several products, products told apart only by a size in centimetres,
  packs with no piece size, and rows with no fitting category. Plan 0179's categories
  unblock about 1,400 of them. After the repairs of 2026-10-06 the queue holds 4,077
  `UNRESOLVED` rows and 25 `CANDIDATE` rows, because the two new runs found 131 rows that
  the first runs had not seen.
- 11 winery labels held as unsure (801, 822, C.B., Solera 13, Heredad 26 and others).
- Products created twice because of the size defects below, such as Dolce Gusto capsule
  boxes sized in grams at Mercadona and in units at Deza and El Jamón.
- Make-up filed under `facial-care` until plan 0179 gives it its own branch.

"What stays wrong" in the last section is the list as it stands after the repairs.

## Defects found, and their plans (PR #599)

| Plan | Defect |
| --- | --- |
| backend 0177 | Sources disagree on the unit of a size. LIDL and the leaflet store "75 cl" as 750 ml, El Jamón stores "6x33cl" as 198 cl, and the validator multiplies every cl size by 10, so correct links were refused. The validator also cannot match "16 ud" with a 160 g box of 16. |
| backend 0178 | Appellation and season words ("D.O.", "HALLOWEEN") read as brands, and one printed name cannot answer two brands (Poseidon). |
| backend 0179 | DIA's tree has no category for make-up, books, stationery, home textiles, garden, DIY, party goods, toys, birds, rodents, shoe care or fortified wines. |
| leaflet cli 0005 | The page census counts 85 pages for a 44 page PDF, the reader writes 1 kg on per kilo offers, and it writes the maker as the brand of a line. |

## Local changes that are not in the dumps

On slot 1 only, in git ignored `.env` files: `ADMIN_DEV_AUTOLOGIN` false on the gateway
(so the curation admin's password is checked) and `HARVEST_ENABLED` true on the harvester.
The curation admin `admin@curation.local` exists only in slot 1's auth database.

## Final counts

Read from slot 1 on 2026-10-03, after the last change, which is the state the dumps of
that day hold. "Counts after the repairs" in the next section holds the same tables for
2026-10-06.

Catalog:

| Table | Rows |
| --- | ---: |
| `items` | 19,791 (4,190 with an EAN, 31 under `uncategorised`) |
| `brands` | 2,782 (478 of them spellings of another brand, 33 private labels) |
| `item_prices` | 22,335 |
| `supermarket_items` | 183,414 |
| `categories` | 275 |
| `price_scopes` | 103 |
| `supermarket_locations` | 40 |

Harvester queue (`source_catalog_entries`):

| Chain | Kind | `ACTIVE` | `UNRESOLVED` | `CANDIDATE` |
| --- | --- | ---: | ---: | ---: |
| Mercadona | `OFFICIAL_API` | 4,144 | 134 | 11 |
| LIDL | `OFFICIAL_API` | 78 | 43 | 0 |
| Deza | `OFFICIAL_WEB` | 11,153 | 3,075 | 0 |
| Deza | `OFFICIAL_LEAFLET` | 106 | 88 | 2 |
| El Jamón | `OFFICIAL_WEB` | 6,270 | 607 | 14 |
| **Total** | | **21,751** | **3,947** | **27** |

Harvest runs: one `CATALOG_DISCOVERY` per chain, one `FILE_IMPORT` (the leaflet) and six
`STORE_DISCOVERY` runs that came with staging.

## Repairs after the audit (plan 0186, 2026-10-06)

An audit of this catalog on 2026-10-03 found defects in the data and in the code that
wrote it. Backend plans 0177 to 0185 fixed the code. Plan 0186 repaired the data that was
already written, on slot 1 only, in two stages on 2026-10-06. It changed no code.

Every change went through the gateway of slot 1 as the curation admin
(`admin@curation.local`), so `catalog_audit` holds it. SQL was used to read, in sessions
set read only. No SQL write was made. The scripts were job local, as in October. They and
their logs are in the git ignored folder `.curation-runs/2026-10-audit-repair/` on the
developer's machine.

### Slot 1 now runs the code of `dev`

The first start of the slot for this work ran six migrations, three in each database. They
are the migrations of plans 0177 to 0185:

| Database | Migrations before | Migrations now | New, in the order they ran |
| --- | ---: | ---: | --- |
| catalog | 26 | 29 | `CategoriesBeyondDia1758600000000`, `BrandHomonyms1758700000000`, `ItemEans1758800000000` |
| harvester | 17 | 20 | `SourceEntrySizeUnit1758000000000`, `SourceEntrySoldByWeight1758100000000`, `SourceEntryAvailability1758200000000` |

The migrations changed two things that this document states:

- The catalog holds 309 categories, not 275.
- A new table, `item_eans`, holds the barcodes of a product (plan 0185). It held 3,977
  rows after the migrations and holds 3,979 now.

Condition 1 of "What production must do" thus reads differently for the new dumps. A
release that restores them must contain exactly these 29 and 20 migrations. The dumps of
2026-10-03 still need a release with 26 and 17.

### Stage A: repairs that needed no other plan

Stage A ran in two passes. The first pass made the repairs that need no judgement and
wrote a proposal for each of the others. The second pass applied the proposals after the
owner's decisions of 2026-10-06:

- A merge may delete a product that still holds price rows, when the kept product already
  holds each of those rows. The delete then cascades duplicates only.
- For the two pairs of products that only a capacity tells apart, the capacity goes in the
  name.
- The Nivea roll-on pair and the brand Gotitas de Oro stay as they are.
- The session decided the rest on the owner's word. It answered the brand questions of
  section 1 of the plan with the plan's own proposals.

The first pass sent 25 writes and all succeeded. The second pass sent 73 that succeeded
and 1 that the gateway refused. The stage started no harvest run and no import.

| Step | Repaired | Left, and why |
| --- | --- | --- |
| A1, no English name | 96 of 100 products got `name.en`, in one batch. | 4 names that the proposal marked as unsure. |
| A2, a pack count read from a dimension | `packCount` set to null on 9 products. | Nothing. |
| A3, a sized `KILOGRAM` or any `LITER` | 192 of 199 in the first pass: 22 to `GRAM`, 148 to `MILLILITER`, 22 capacities to `UNIT` with no size. Then the two pairs (4 products) took the capacity in the name, in both languages, and became `UNIT` with no size. | 3 Mercadona pieces with no known weight. Stage B answered them. |
| A4, a code that is not a barcode | 213 products in one batch: 211 in-store codes set to null, and 2 codes of 11 digits given their leading zero. | 3 codes of 12 digits, for a person. |
| A5, a size that the unit price contradicts | 1 correction: Hacendado "Postre lácteo Lemon Cake" from 1600 to 160 `GRAM`. | The 2 unlinks of the proposal were not applied, and 143 products were left as the proposal says. |
| A6, the same product twice | All 21 exact pairs merged (7 in the first pass, 14 in the second) and 6 near pairs merged. The exact merges of the second pass cascaded 14 price rows and the near merges 4, each a duplicate of a row on the kept product. | 1 exact pair that is two products, 4 near pairs that a person decides, 7 near pairs marked as two products, and 729 other candidates. |
| A7, a row bound to the wrong product | The El Jamón row "chocolatinas pk-3" moved from the F1 figurine to the KitKat bars, and its stale price row was deleted from the figurine. The BBQ skewers became two products (20 cm and 32.5 cm). Pepsi stayed one product. | The availability of the figurine. |
| A8, one brand registered twice | 5 links: 3 Brujas to Las 3 Brujas, Sierra de Montoro to Sierra Montoro, Liviana to Fuente Liviana, One to Purina One, CH Carolina Herrera to Carolina Herrera. | Gotitas de Oro is not linked, by the owner's decision. |
| A9, a wrong brand on a product | 8 renames in one batch, and 1 merge. | The Fiesta mini pizzas did not change, as decided. |
| A10, a name that says "pack" | 78 of 103 names lost the word, in one batch. | 25 products with no pack count, or where "pack" is part of what the product is. |
| A11, the owner's brand decisions | 2 product batches and 18 brand calls. 16 brands became a spelling of their house. | 1 link was refused, and 7 lines were left. |

The notes below add what the table cannot hold.

**A5.** The Mercadona row of the lemon cake prints 1.6 kg, and 1.70 euros at 10.63 per
kilo is 160 g. The two unlinks that were not applied are the Fanta naranja row on the
1.5 L product and the El Pozo burger "king" row. "What stays wrong" explains both.

**A6.** A merge is the two steps of October: the queue rows of one product are accepted
onto the other, then the empty product is deleted. Before each delete a read showed that
no queue row named the product, and that every price row it still held existed on the kept
product with the same source kind, scope, price, unit price and validity. The 14 exact
pairs of the second pass are Aguacates, Nestlé Chocolate con leche Extrafino, Espinazo de
cerdo salado, Jamoncitos de pollo, Manzana Granny Smith, Melocotón amarillo, Patata,
Pepino, Pimiento rojo, Pluma de cerdo ibérico, Coca Cola zero azúcar zero cafeína at
330 ml, 1250 ml and 2000 ml, and Schweppes Tónica original 1 L. The 6 near pairs are
Cebollas and Cebolla, Berenjena and Berenjenas, Tomates pera and Tomate pera, Chuletas
aguja de cerdo and Chuletas de aguja de cerdo, the YoPro strawberry and raspberry drinking
yogurt, and the Fuente Liviana 2 L water. The kept YoPro product is now named "Yogur
líquido con proteínas fresa y frambuesa". Check A6 reads 1 after the 21 merges: the Nivea
roll-on and the Nivea Men roll-on, which hold two barcodes and are two products.

**A9.** The three Nordic Mist tonics moved to `Nordic Mist` and are named "Tónica Blue
lata", "Tónica original lata" and "Tónica zero calorías lata". The dog snack moved from
`Tasty` to `San Dimas`. Three Nestlé products moved to `KitKat`: "Chocolate salted
caramel", "Chocolate double chocolate" and "Cereales". "Queso afinado curado de leche
termizada" lost the maker from its name. The Deza row of the Gourmet salmon mousse was
accepted onto the product of `Gourmet Revelations`, and the empty product was deleted.

**A11, a product name registered as a brand.** The word went into the product name first,
and the brand was then linked to its house, as with Pantera Rosa in October.

| Brand | Now a spelling of | Products moved |
| --- | --- | ---: |
| Black Label | Johnnie Walker | 1 |
| White Label | Dewar's | 2 |
| Red Label | Johnnie Walker | 0 |
| Boss Bottled | Hugo Boss | 1 |

The link of `Invictus` to `Paco Rabanne` was refused with `brand_link_too_deep`, because
the spelling `INVICTUS P.RABANNE` points at `Invictus`. Its one product moved to
`Paco Rabanne` through its own brand field and is named "Invictus eau de toilette". The
brand `Invictus` stays registered with no product and one spelling.

**A11, the line rule.** A word that names who the product is for, or a variant, is a range
and joins the house:

| Line | Now a spelling of | Products moved |
| --- | --- | ---: |
| Nike Woman | Nike | 8 |
| Nivea Q10 | Nivea | 1 |
| Colgate Total | Colgate | 3 |
| Nescafé Gold | Nescafé | 4 |
| Payot Homme | Payot | 1 |
| ClarinsMen | Clarins | 7 |
| Oral-B 3D White | Oral-B | 1 |
| Oral-B Pro-Expert | Oral-B | 2 |
| Oral-B Pro-Flex | Oral-B | 1 |
| Vanish Oxi Action | Vanish | 4 |
| Norit Complet | Norit | 1 |

The product names did not change, because the range word is not in them. Kinder Bueno,
Kinder Joy, Hero Baby and YoPro stay separate brands by decision.

**A11, the other questions.**

- `Nordic`, the hair brand, was renamed `Nordic Blonde` (key `nordic` to `nordicblonde`).
  Its two products are now "Aclarante intensivo L1" and "Mechas radiantes M1".
- `Palette Intensive` is a spelling of `Palette`, which moved 30 products. Palette holds
  35 products.
- "Margarina sabor mantequilla" moved from `Flora` to `ProActiv` through its own brand
  field. `Flora` was not linked, because it holds 7 other products.
- The label of `Loreal` is now `L'Oréal`. The key stayed `loreal`. 375 products carry the
  new label.
- The wine labels `Cebolla`, `409` and `Frizz` are held. `Excellence`, the licence names
  and the 178 brands with no product are kept.

Stage A left the row counts close to those of October: 19,764 products, 2,782 brands,
22,335 price rows and 25,725 queue rows. The first pass deleted 7 products and created 1.
The second pass deleted 21. The spellings of another brand grew from 478 to 499.

### Stage B: repairs that needed the new code

Stage B sent 13 writes that succeeded and 1 that the gateway refused. `HARVEST_ENABLED`
was true on slot 1 only while the two runs went.

**B1, the Mercadona run (plan 0181).**

- Run `b3a3f87d-9fc3-44ce-b95e-38bf3fd97dac`, a `CATALOG_DISCOVERY` with `details: "ALL"`.
- It was limited by `priceScopeIds` to the three Córdoba scopes. Its report names the
  warehouses 3769, 4694 and 4661.
- It ran for 20 minutes, from 2026-10-05T23:50:23Z to 2026-10-06T00:10:22Z, and ended
  `COMPLETED` with no warning and no error.
- Counts: 4,293 planned and processed, 17 created, 5,285 updated, 25 unchanged, 0 failed.
- Report: 12,758 prices recorded, 11,245 confirmed, 1,034 published, 0 conflicted. 47
  products took a pack count.
- It bound no barcode without review.
- The plan expected 605 price rows on 197 products to carry the per kilo price. The run
  wrote 526 rows on 178 products. 66 current rows on 22 products did not change.

**B1, the three pieces that stage A left.** After the run, the Mercadona row of each one
says that it is sold by weight and states no size. One batch set the three to `KILOGRAM`
with no size: Covap "Chorizo cular de bellota ibérico", Covap "Jamón de bellota 100%
ibérico" and Juan del Roble "Lomo de bellota ibérico". Check A3 then read nothing.

**B1, the Deza leaflet import: refused.** The plan expected a second import of the same
document to give 21 offers a price. The gateway answered 409 `conflict`: the document was
already imported for this chain by run `794056b6-d61d-464f-b442-cdab962920a6`, and that
run must be reverted first. That run is the `FILE_IMPORT` of 2026-10-03. A revert removes
prices and is a decision of the owner, so nobody reverted it. The 21 offers still have no
price.

**B2, the Deza run (plan 0182).**

- Run `960a32c5-7caf-4405-9dab-359a7e01dded`, a `CATALOG_DISCOVERY` of the whole chain.
  Deza prints no price, so nothing limits the run by scope.
- It ran for 23 minutes, from 2026-10-06T00:14:03Z to 2026-10-06T00:37:01Z, and ended
  `COMPLETED` with no warning and no error.
- Counts: 14,097 planned and processed, 114 created, 8,598 updated, 5,385 unchanged, 0
  failed.
- Report: 10,989 offers with no price written and 0 failed. 31 products took a pack
  count. 155,067 availability claims stored, 0 written. 28 sections that the query budget
  did not finish.
- The plan expected every product that a Deza website row is bound to to have a row in a
  Deza scope. Check B2 fell from 11,047 of 11,141 to 58 of 11,147. The run did not see the
  only Deza website row of those 58 products.
- The run stored the availability of each shop and published none of it. "What stays
  wrong" explains why.

**B3, products sized 1 `UNIT` (plan 0183).** All 417 were read against their queue rows.
131 took the size that their rows agree on, in one batch. 269 were left because the row
itself says 1 unit, 15 because no row states a size, and 2 because the size could not be
read with confidence. The plan expected 395 to take a size. Check B3 reads 286. Two merges
followed, both Evax pads: "Compresa normal Liberty con alas" (12) and "Compresa super
Liberty con alas" (10) each absorbed the Deza product of the same pad. Neither deleted
product held a price.

**B4, rows left as `CANDIDATE` (plan 0185).** The plan expected the 11 Mercadona rows to
be a second barcode of their products. None is. Before the run both rows of each pair
printed the same size. After it, the row and its sibling differ in size, or they cost a
different amount in the same three warehouses, which makes them two articles of the
chain. 0 of the 11 were accepted. Of the other 17 candidates, 3 were accepted: the
Mercadona "Melón piel de sapo" row, which the new run found, and two Deza leaflet rows
(Flor del Genil "Vinagre de vino gran reserva D.O. Montilla-Moriles" and Despierta "Vino
blanco de Castilla verdejo"). The three accepts wrote 3, 1 and 1 price rows. No barcode
was taught, because none of the three rows holds a real one. The plan expected check B4 to
read 16. It reads 25: 11 Mercadona rows and 14 El Jamón rows.

**B5, products created twice in grams and in units (plan 0177).** 1 merge: Bref "Colgador
WC Power Activ limón". The product of 100 `GRAM` from Deza was kept, and the product of 2
`UNIT` from El Jamón was deleted. The Dolce Gusto boxes that the plan names were not
merged. 47 pairs of this kind stay, because only the Bref pair had the same name word for
word.

The two runs found 131 queue rows that the runs of 2026-10-03 had not seen: 17 from
Mercadona and 114 from Deza. A new row is bound to nothing, so 130 of them are
`UNRESOLVED`. The other one is the melon row.

### The checks of the plan

Section 2 of plan 0186 defines each check.

| Check | 2026-10-03 | End of stage A | End of stage B |
| --- | ---: | ---: | ---: |
| A1, no English name | 100 | 4 | 4 |
| A2, a pack count beside a dimension | 9 | 0 | 0 |
| A3, `LITER` | 174 | 0 | 0 |
| A3, sized `KILOGRAM` | 25 | 3 | 0 |
| A4, a code that starts with 2 | 211 | 0 | 0 |
| A4, a length that is not 8, 13 or 14 | 5 | 5 | 5 |
| A6, equal in brand, name, size, unit and pack count | 21 | 1 | 1 |
| A10, a name that says "pack" | 103 | 25 | 25 |
| B1, current rows, Mercadona | not read | 587 | 66 |
| B1, current rows, Deza | not read | 21 | 21 |
| B1, current rows, El Jamón | not read | 1 | 1 |
| B2, Deza website products with no row in a Deza scope | 11,061 of 11,140 | 11,047 of 11,141 | 58 of 11,147 |
| B3, a size of one `UNIT` | 417 | 417 | 286 |
| B4, rows `CANDIDATE` | 27 | 27 | 25 |
| Queue rows that name a product that does not exist | 0 | 0 | 0 |

B1 is read on current rows, which are the newest row of each product, scope and source
kind. `item_prices` keeps history, so a run inserts a new row beside the old one, and the
SQL of the plan counts both and cannot fall. That SQL read 627 on the data of 2026-10-03
(Mercadona 605, Deza 21, El Jamón 1) and reads 632 now (610, 21, 1). The B1 figures in the column of stage A were read at the start of stage B, before its
first write.

A4 still reads 5 because the check accepts only 8, 13 and 14 digits. The two padded codes
are now 12 digits long, and three more codes of 12 digits wait for a person.

### Counts after the repairs

Read from slot 1 on 2026-10-06, after the last change, which is the state the dumps of
`after-stage-b-final/` hold.

Catalog:

| Table | Rows |
| --- | ---: |
| `items` | 19,761 (3,979 with an EAN) |
| `brands` | 2,782 (499 of them spellings of another brand) |
| `item_prices` | 23,374 |
| `item_eans` | 3,979 |
| `supermarket_items` | 194,571 |
| `supermarket_location_items` | 0 |
| `categories` | 309 |
| `price_scopes` | 103 |
| `catalog_audit` | 69,045 |

Harvester queue (`source_catalog_entries`, 25,856 rows):

| Chain | Kind | `ACTIVE` | `UNRESOLVED` | `CANDIDATE` |
| --- | --- | ---: | ---: | ---: |
| Mercadona | `OFFICIAL_API` | 4,145 | 150 | 11 |
| LIDL | `OFFICIAL_API` | 78 | 43 | 0 |
| Deza | `OFFICIAL_WEB` | 11,159 | 3,191 | 0 |
| Deza | `OFFICIAL_LEAFLET` | 102 | 86 | 0 |
| El Jamón | `OFFICIAL_WEB` | 6,270 | 607 | 14 |
| **Total** | | **21,754** | **4,077** | **25** |

The harvester also holds 155,067 rows of `source_entry_availability` and 13 harvest runs:
the 11 of October and the two runs of stage B.

### The new dumps

The dumps are in the git ignored folder `.curation-runs/2026-10-audit-repair/` on the
developer's machine. Each is a `pg_dump -Fc`, and each was listed with `pg_restore -l`.
Each folder holds a `VERIFY.txt` with the sizes and hashes.

**The dumps that this document named before, in `final-dumps/`, no longer match slot 1.**
They hold the state of 2026-10-03. The dumps of `after-stage-b-final/` hold the state
that slot 1 holds now.

| Folder | Dump | Bytes | sha256 |
| --- | --- | ---: | --- |
| `backup-before-stage-a/` | `catalog.dump` | 15,187,104 | `83b6d29e9d61a9f9fc21595a3db3757561ebcf5130304b0f1b86e85dc028288d` |
| `backup-before-stage-a/` | `harvester.dump` | 3,990,282 | `b70f0e23007ef745e42f506efbd08c57ce1bb4847c419517fd9f04a43bdbfc28` |
| `after-stage-a/` | `catalog.dump` | 15,333,408 | `efede26c8bcfc5d1ca16ccc0c3185e905eeadf80fe630c44f861773fdf01034d` |
| `after-stage-a/` | `harvester.dump` | 4,001,134 | `2b5b3749ffdf8b44c14c36270020a522360204673a44c3a35e91f1aadd07147c` |
| `backup-before-stage-b/` | `catalog.dump` | 15,333,408 | `cf084c9f6545ec1229dbdb76b1b267344b8b8639824d6cf9051f488f2c9b7db9` |
| `backup-before-stage-b/` | `harvester.dump` | 4,001,134 | `7afa0d41ebd8989e1122bfc606a1fac3d5171f269a74c59f74c1b519c0df8b2c` |
| `after-stage-b/` | `catalog.dump` | 17,699,873 | `07927495bcce68c87701838979613dddf828f4f3458f958b79809e36d02490d6` |
| `after-stage-b/` | `harvester.dump` | 11,521,978 | `abd5d6d25fd18a7a35eb3e0890a6309809bf8f691a0592e99b3bdcc21be3814e` |
| `after-stage-b-final/` | `catalog.dump` | 17,702,457 | `9eeef558592714a5bdb246af6c2c40ca0b35143b7537cb6f42a7608122f74288` |
| `after-stage-b-final/` | `harvester.dump` | 11,522,385 | `bafd895cd03976cc5b60d3e139773ff32756dedb0df48c03763337f407a2807f` |

- `backup-before-stage-a/` was taken before the six migrations ran. It holds the data of
  2026-10-03 under the old schema.
- `after-stage-a/` holds the end of stage A: 19,764 products, 2,782 brands, 22,335 price
  rows and 25,725 queue rows.
- `after-stage-b/` holds the state before the three accepts of B4: 19,761 products, 23,369
  price rows and 25,856 queue rows.
- `after-stage-b-final/` holds the end of stage B: 19,761 products, 2,782 brands, 23,374
  price rows, 194,571 rows of `supermarket_items`, 25,856 queue rows and 13 harvest runs.
- Every folder except `after-stage-a/` also holds `auth.dump` and `core.dump`.

Slot 1 is down and locked, with its databases kept.

### What stays wrong

Each item has its own title, so that it can be found and fixed later. The first two are
recorded at the owner's request.

#### Mercadona unit prices labelled per 100 ml or per 100 g

Mercadona price rows labelled "100 ml" or "100 g" hold the per litre or per kilo figure.
1,497 rows were of this kind on 2026-10-06. The cause is in
`libs/luna-shopper/mercadona/src/lib/normalize.ts`: `unitPrice` is `bulk_price`, and the
label is `reference_format`. Two defects of the same kind sit beside them: 9 egg products
that are priced per dozen carry a per egg figure, and 23 El Jamón rows are ten times off.
This needs its own plan. No plan covers it today.

#### Three conversions of A3 to look at again

- Carbosur charcoal "10l" is now `MILLILITER`, and it is not a liquid.
- Vitakraft cat litter "8 L" is now `MILLILITER`, and it is not a liquid.
- Incarlopsa "Jamón serrano pieza" is 7500 `GRAM`, while its unit price implies about
  6.8 kg.

#### The Deza website run turned 8 leaflet rows into website rows

The run of B2 changed `sourceKind` from `OFFICIAL_LEAFLET` to `OFFICIAL_WEB` on 8 rows
whose printed name and format are the same in the leaflet and on the website. It also
rewrote their name, brand and size. The rows are "Leche COVAP entera", "semidesnatada" and
"desnatada", "Filetes de caballa girasol TEJERO", "Atún en aceite de oliva TEJERO",
"Multiusos+quitagrasas SANYTOL", "Muñeco BOO CREW HALLOWEEN" and "Globo ESQUELETO". 6 are
bound and keep their product and its leaflet price row. 2 are `UNRESOLVED`. The leaflet
queue thus fell from 196 rows to 188, and the `ACTIVE` rows of the website rose by 6. The
likely cause is that the two sources key a row on the same hash of chain, name and format,
so they share one row and the last writer wins. A second leaflet import would probably
turn the rows back. This is a defect in code, and no plan covers it.

#### The refused leaflet import, and 21 Deza offers without a price

21 `OFFICIAL_LEAFLET` price rows of offers by the kilo hold no `price` and a per kilo
`unitPrice` (El Pozo turkey breast at 6.95, La Perla chicken churrasco at 6.90,
Torremilano cheese at 16.90, Galician mussels at 3.99, and 17 more). They get their price
only after run `794056b6-d61d-464f-b442-cdab962920a6` is reverted
(`POST /v1/admin/harvest/runs/:id/revert`) and the document is imported again. A revert
removes the prices of that run, which are 108 `OFFICIAL_LEAFLET` rows today, until the
import puts them back. Read the item above first: it changes what a second import does to
8 rows.

#### 22 frozen fish and seafood products need a size

22 Mercadona products are `KILOGRAM` with no size in the catalog, while the row of
Mercadona is a fixed pack with no size sent. In each of the 3 warehouses the price row
holds the price of the pack, so 66 current rows fail check B1. The price is right and the
product is wrong. The repair is a size in `GRAM` on the product, not a run. Mercadona
sends no size to prove it. Hacendado "Porciones de merluza del Cabo sin piel
ultracongeladas" costs 4.90 at 9.80 per kilo, which implies a bag of 500 g. After the 22
have a size, check B1 reads 0 for Mercadona.

#### 11 unmapped Deza shop codes, and the stored claims that wait for them

The Deza run stored 155,067 availability claims, one for each of 14,097 rows and each of
11 shop codes. 78,341 say available and 76,726 say not. None reached the catalog:
`supermarket_location_items` holds 0 rows. All 11 rows of `source_locations` are
`UNMAPPED`, so no code names a shop of the catalog.

- The codes are `T1` Jesús Rescatado, `T2` Ctra. de Castro, `T3` Ronda del Marrubial, `T4`
  Isla Fuerteventura, `T5` Camino de la Barca, `T6` Avda. de Libia, `T7` Fuente de la
  salud, `Z1` Zoco, `C1` SuperCash (Quemadas), `C2` SuperCash (Sector Sur) and
  `CONSULTAR`.
- `CONSULTAR` is "Disponibilidad diaria según mercado". It is not a shop and must be
  ignored, not mapped.
- 122,111 claims sit on 11,101 bound rows and wait only for the shop. 32,956 sit on 2,996
  rows that are not bound and wait for the binding too.
- Nothing is lost, because the claims are stored. A person maps the ten codes to the ten
  Deza shops in the back office queue behind `/v1/admin/harvest/shops`. Nobody checked
  that the waiting claims are then written without a new run.

#### 11 Mercadona candidates that are other articles

The 11 Mercadona rows of B4 are not second barcodes. Each needs a product of its own, or a
rule that says two containers of one milk are one product. That rule must come first,
because one product would then hold two Mercadona prices in one scope.

| Row prints | The product it proposes | Why it was left |
| --- | --- | --- |
| "3 Bocadillos", 0.39 kg | None. Its sibling row is `UNRESOLVED`. | No product to accept onto. |
| "Compresa normal Deliplus con alas", 10 | "Compresa normal con alas", 32 | Another pack size. |
| "Guantes de látex Bosque Verde talla mediana-grande", 50 | The same gloves, 2 | A box of 50 against a pair. |
| "Guantes de látex Bosque Verde talla pequeña-mediana", 50 | The same gloves, 2 | A box of 50 against a pair. |
| "Leche entera Hacendado", 1 L, 1.15 | "Leche entera", 1000 ml, 0.96 | The same size at another price in the same warehouses. |
| "Leche semidesnatada Hacendado", 1 L, 1.09 | "Leche semidesnatada", 1000 ml, 0.83 | The same reason. |
| "Mantequilla con sal Hacendado", 0.25 kg, 2.45 | "Mantequilla con sal", 250 g, 2.05 | The same reason. |
| "Mantequilla sin sal añadida Hacendado", 0.25 kg, 2.05 | "Mantequilla sin sal añadida", 250 g, 2.45 | The same reason. |
| "Refresco Coca-Cola", "2 L", 5.60 | "Refresco de cola", 2000 ml, 2.15 | 5.60 for 2 litres is not the 2 L bottle. |
| "Refresco Coca-Cola zero azúcar", "2 L", 5.60 | "Refresco de cola zero azúcar", 2000 ml, 2.15 | The same reason. |
| "Vela perfumada Chai Bosque Verde", 1 | "Vela perfumada Chai", 18 | The sizes differ, and neither reading is certain. |

#### 14 El Jamón candidates across two brands

All 14 are `NAME_SIZE` hits between two brands. El Jamón prints the product name without
the brand, so the name and the size match and the brand does not. Each needs a create or a
reject, not an accept. They are one Coren product, three Dolce Gusto capsule boxes, two
Nescafé soluble coffees, a Mahou beer pack, three Búfalo shoe creams, Campofrío sausages,
two wines (Despecho and Pata Negra) and an Activia yogurt pack.

#### Pairs left for a person

- **47 pairs in grams and in units.** One product by weight or volume and one by count, in
  the same brand. They include the Dolce Gusto and Tassimo capsule boxes.
- **2 near pairs after B3** that may be one product each: Tampax "Tampones regular Pearl
  con aplicador" and "Tampones Pearl regular" (24 and 24), and Oral-B "Recambios cepillo
  dental eléctrico Pro Precision Clean" and "Recambio cepillo eléctrico Precision" (4 and
  4).
- **4 near pairs of A6:** Kiwi verde and Kiwis verdes, Manzana Golden and Manzanas Golden,
  Aguacate and Aguacates, Manzana roja dulce and Manzanas rojas dulces.
- **Aguacates.** The loose avocado of El Jamón, sold by the kilo, was merged onto
  Mercadona's "Aguacates". Mercadona also lists "Aguacate". If that one is the loose
  fruit, the El Jamón row belongs there.
- **Manzanas Golden.** The El Jamón row is a 1.5 kg bag (2.39, at 1.59 per kilo) bound to
  the product sold by the kilo. It is the one El Jamón row of check B1.
- **729 other near candidates of A6** that nobody read.
- **Pairs that the brand links of A11 made visible,** each probably one product stored
  twice. Their names were kept different, so check A6 does not count them:
  - Johnnie Walker "Whisky escocés Black Label" (Mercadona, 700 ml) and "Whisky Black
    Label 12 años" (Deza and El Jamón, 700 ml).
  - Dewar's "Whisky escocés White Label" (El Jamón) and "Whisky White Label" (Deza), at
    700 ml and again at 1 L.
  - ProActiv "Margarina original" (El Jamón, 225 g, 3.19) and Flora "Margarina Proactiv"
    (Mercadona and Deza, 225 g, 3.19). The second still stands under `Flora`.

#### Names and codes left for a person

- **4 products with no English name:** Alteza "Besitos", Hidalgo "Negrito", Hidalgo
  "Negrito gigante" and El Cateto "Panales de cabello sin azúcar".
- **25 names that still say "pack".**
- **5 codes of 12 digits** that are not a valid barcode length.
- **The Fuente Liviana 2 L water** is still named "Agua mineral". The proposal remarks
  that "Agua mineral natural mineralización débil" is the better name.
- **286 products still sized 1 `UNIT`.** 269 are one unit by the chain's own row. 15 have
  no row that states a size, and 2 carry a size that could not be read with confidence.

#### Brands left for a person

- **`Invictus`** holds no product and is pointed at by `INVICTUS P.RABANNE`. A new Deza
  row printed that way still resolves to `Invictus`. A person unlinks the spelling, links
  both to `Paco Rabanne`, or deletes the brand.
- **Lines left separate,** because the session was not sure: `Nike Ultra Blue` (1
  product), `Vileda Turbo` (2), `Vileda Duactiva` (1), `Nescafé Farmers Origins` (3),
  `Puleva Max` (3), `Neutrex Transpirex` (1) and `Lenor Unstoppables` (1). `Vileda Turbo`
  and `Nescafé Farmers Origins` are each pointed at by a spelling, so a link would be
  refused.
- **Links that the owner may want to look at:** the Oral-B, Vanish and Norit links. The
  session read each word as a variant of the kind that `Total` is for Colgate. An unlink
  brings the products back.
- **The key `nordic` is no longer registered.** Deza prints `NORDIC` on the three tonics
  and on the two lighteners. Those five rows are bound, but a new row printed `NORDIC`
  will probably ask for a brand.
- **Gotitas de Oro** is not linked to Gotas de Oro, by the owner's decision.
- **The wine labels `Cebolla`, `409` and `Frizz`** are held, as the 11 unsure wineries of
  October are.

#### Price rows and lines left for a person

- **Fanta naranja.** The Mercadona row on the 1.5 L product prints 1.5 as its size beside
  a unit price that says 1.25 L (1.55 at 1.24 per litre). The row does not prove that it
  is another format, so it was not unlinked.
- **The El Pozo burger "king".** Two articles of El Jamón, at 2.45 and at 2.95, are bound
  to one product ("Burger de pavo con espinacas bienStar", 240 g, pack 2), which thus
  holds two El Jamón price rows in one scope. A person must say whether the "king" pack is
  240 g, as printed, or 260 g, as the unit price says.
- **143 products whose size the unit price contradicts,** left as the proposal of A5 says.
- **The F1 figurine** still shows as available in 20 El Jamón scopes with no price. The
  rows come from the wrong bind of October.
- **58 Deza website products with no row in a Deza scope.** Deza no longer lists them, or
  they sit in one of the 28 sections that the query budget did not finish.
- **LIDL's per kilo rows** carry no unit price, because LIDL sends none. Check B1 does not
  count them.

#### The queue

4,077 rows are `UNRESOLVED`: 3,191 from the Deza website, 86 from the Deza leaflet, 150
from Mercadona, 607 from El Jamón and 43 from LIDL. 25 are `CANDIDATE`. The 131 rows that
the two runs found are among them, except the melon row. They include 16 Mercadona
articles that are new to the three warehouses since 2026-10-03, and 114 Deza rows, 52 of
them stationery.
