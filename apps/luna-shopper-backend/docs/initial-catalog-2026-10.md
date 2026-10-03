# The initial production catalog (October 2026)

This document records how the catalog and harvester databases that production starts from
were built, on 2026-10-03, and what a person must know before and after that state is
copied to production. The work is not meant to be repeated. Read this document instead.

The data was built on a local Luna slot (slot 1) from a copy of staging. It was then
harvested, curated by model deciders under a person's rules, corrected by the owner's
decisions, and dumped. The dumps are the only artifact production needs. They are
`catalog.dump` and `harvester.dump` (`pg_dump -Fc`, taken 2026-10-03 20:44 Madrid time) in
the git ignored folder `.curation-runs/2026-10-deza-staging/harvest-curation/final-dumps/`
on the developer's machine. Slot 1 still holds the same data, locked with
`luna-slot.sh --down --keep-data`. The scripts that
drove the work were job local and are not in the repository. Their logic is described
here.

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

"Final counts" at the end splits them by chain.

## What production must do before it serves this state

1. **Run the same code.** The catalog database holds 26 migrations, the last one
   `DiaCategoryTree1758500000000` (plan 0173, PR #597). The harvester database holds 17,
   the last one `DiscoveredPlaceFootprint1757900000000` (plan 0176). Production's release
   must contain exactly these migrations, or the services will try to run or miss one.
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
- The slot was always started with `LUNA_REFERENCE_SEED=0`. A plain `--up` runs the
  reference seed, which adds about 238 seeded products to the copy. That happened
  once by accident and was undone by restoring the dump again.

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

The owner limited Mercadona to Córdoba. Rows whose EAN matched a product resolved by
themselves. Deza and El Jamón print no EAN.

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
  unblock about 1,400 of them.
- 11 winery labels held as unsure (801, 822, C.B., Solera 13, Heredad 26 and others).
- Products created twice because of the size defects below, such as Dolce Gusto capsule
  boxes sized in grams at Mercadona and in units at Deza and El Jamón.
- Make-up filed under `facial-care` until plan 0179 gives it its own branch.

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

Read from slot 1 on 2026-10-03, after the last change, which is the state the dumps hold.

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
