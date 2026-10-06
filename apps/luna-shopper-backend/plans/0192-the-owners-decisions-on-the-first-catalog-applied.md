> **PR:** [#655](https://github.com/IchirokuXVI/nx-portfolio/pull/655)

# 0192: the owner's decisions on the first catalog, applied

> Plan `0186` repaired the first catalog on local slot 1 and left sixteen decisions for the
> owner. The owner answered them on 2026-10-06. The register is
> `apps/luna-shopper-backend/docs/first-catalog-decisions-2026-10/README.md`, section 4.
>
> This plan changes **data**, on slot 1 only, and no code. It applies ten of the sixteen
> answers, says why it leaves six alone, takes new dumps, and brings the restore manifest
> and the two documents to the new state.
>
> Prerequisite reading: the register above (all of it, and the data files it names), plan
> `0186` (the method), plans `0189`, `0190` and `0191` (the code that the repair found
> missing), `k8s/catalog-import/README.md` and k8s plan `0012` (what the dumps are held
> to), and the scripts of the repair in the git ignored folder
> `.curation-runs/2026-10-audit-repair/` of the main checkout (`stage-b/lib.mjs`,
> `stage-b/merge.mjs`, `stage-b/checks.mjs`, `dump.sh`, `stage-b/verify-dumps.sh`), which
> this work copies its method from.

## Brief for the agent

### Objective

Apply the owner's answers of 2026-10-06 to the slot 1 catalog, through the admin API, in
three stages. Stage 1 needs no code. Stage 2 runs only after plan `0191` is merged and
slot 1 runs that code. Stage 3 takes the dumps that ship and writes their checksums and
counts into the repository.

### Context

- **Where the data is.** Slot 1 is down and locked with its databases kept
  (`luna-slot.sh --list`). The dumps of the end of plan `0186` are in
  `.curation-runs/2026-10-audit-repair/after-stage-b-final/` of the main checkout:
  19,761 products, 2,782 brands, 23,374 price rows, 25,856 queue rows (21,754 `ACTIVE`,
  25 `CANDIDATE`, 4,077 `UNRESOLVED`).
- **Every local id below is an id of slot 1**, shortened to eight characters where the
  data file holds the whole id. Find each row again by its natural keys and check that
  the id still names it. The data can be different now.
- **How the repair wrote.** Every change went through the gateway of slot 1
  (`http://localhost:43000`) as `admin@curation.local`, so `catalog_audit` holds it.
  `stage-b/lib.mjs` signs in and logs each write. The admin token lasts 15 minutes, and
  that script signs in again when the token is 8 minutes old.
- **A merge is two steps.** The queue rows of one product are accepted onto the other,
  then the empty product is deleted. `stage-b/merge.mjs` does both, with a read before
  and after the delete.
- **Routes this plan uses.** Each was read in `gateway/src/app/catalog/catalog-admin.controller.ts`
  or `gateway/src/app/harvest/harvest.controller.ts`.

  | Route | What for |
  | --- | --- |
  | `POST /v1/admin/auth/login` | The login |
  | `GET /v1/admin/catalog/items`, `GET /v1/admin/catalog/items/:id`, `GET /v1/admin/catalog/items/:id/prices` | Reads of a product |
  | `PATCH /v1/admin/catalog/items/batch` | Names, sizes, units. All or nothing, at most 1000 entries |
  | `DELETE /v1/admin/catalog/items/:id` | The empty half of a merge |
  | `GET /v1/admin/catalog/brands`, `GET /v1/admin/catalog/brands/:id/spellings`, `PATCH /v1/admin/catalog/brands/:id` | Brand reads, and a link (`canonicalBrandId`) |
  | `GET /v1/admin/catalog/supermarkets/:id/locations` | The shops of a chain |
  | `GET /v1/admin/harvest/entries` | The queue, by chain, status and text |
  | `GET /v1/admin/harvest/items/:itemId/entries` | The rows that name a product |
  | `POST /v1/admin/harvest/entries/:id/accept` | Bind a row to a product. Reads a row of any status |
  | `POST /v1/admin/harvest/entries/:id/item` | Create a product from a row and bind it |
  | `GET /v1/admin/harvest/shops`, `PUT /v1/admin/harvest/shops/:id/location`, `POST /v1/admin/harvest/shops/:id/ignore` | The shop codes of a source |
  | `POST /v1/admin/harvest/items/:itemId/settle` | **Not confirmed.** Plan `0191`, target 5, names it. It does not exist until that plan is built. Read the route in the merged code before the first call |

- **What the code does today with a bound row that moves** (plan `0191`, context).
  `accept` and `createItem` overwrite `itemId` and read nothing of the old product. The
  new product gets the prices. The old product keeps its price rows, its offers and the
  barcode that the row taught it. No later run takes them back. A `CANDIDATE` row is
  different: it is not bound, it wrote nothing to catalog, and a decision on it leaves
  nothing behind.

### Target state

Each line is one answer of the owner. Section 2 and section 3 hold the rows and the calls.

**Stage 1 (no code needed)**

| Decision | What is done | Size |
| ---: | --- | ---: |
| 8 | An English name on the four products that have none | 4 products |
| 3 | `GRAM` and a weight on the frozen fish that the chain sells as a fixed pack | 21 of 22 products |
| 14 | The Incarlopsa ham piece becomes `KILOGRAM` with no size, if its row is sold by weight | 1 product |
| 12 | Six lines join their house, and `Invictus` joins `Paco Rabanne` | 7 links, 9 product names |
| 4 | Ten Deza shop codes get their shop, and `CONSULTAR` is ignored | 11 codes |
| 7 | Each El Jamón candidate is bound to the product of its own brand, or gets one | 14 rows |
| 2 | Each Mercadona candidate gets a product of its own | 11 rows |
| 6 | The pairs stored by weight and by count are read, and the certain ones are merged | 47 pairs |

**Stage 2 (after plan `0191` is merged and slot 1 runs it)**

| Decision | What is done | Size |
| ---: | --- | ---: |
| 10 | The El Pozo burger "king" gets a product of its own, 240 g | 1 row |
| 11 | The fruit pairs, for each pair that the test of the owner decides | 4 pairs |
| 6, 7 | The pairs and rows that stage 1 left because the move needs the new code | as found |

**Stage 3 (last)**

New dumps of all four databases, verified. `k8s/catalog-import/first-catalog.manifest` and
`k8s/catalog-import/README.md` state their checksums, migrations and counts. The register
and `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md` state what was done.

### Scope

- Work only on slot 1, through the gateway of slot 1. Scripts are job local. They live in
  a new git ignored folder of the main checkout, `.curation-runs/2026-10-owner-decisions/`,
  with one answers file per step and a `logs/` folder, as in plan `0186`.
- In the repository, change only these files, and only in stage 3:
  `k8s/catalog-import/first-catalog.manifest`, `k8s/catalog-import/README.md`, the
  register (`README.md`, the build scripts and the data files they write) and
  `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`. Add the `> **PR:**` line
  to this plan.
- Do not touch: any cluster, slot 0, slot 3, the staging dumps, application code, the
  dumps of plan `0186`, `k8s/catalog-import/expected-losses.txt`, the `task.env` of
  release task `0003`, k8s plan `0012`.

### Constraints

- **Slot 1 only, taken and given back the same way each time.** Take it with
  `LUNA_REFERENCE_SEED=0 bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 1`. Give it
  back with `--down --keep-data`. Never a plain `--down`, never `--unlock`, never a volume
  removal. Never touch slot 0 or slot 3, not even to read.
- **Back up before the first write of each stage.** Start only the four database
  containers (`docker start luna-slot1-{auth,core,catalog,harvester}-db-1`), `pg_dump -Fc`
  all four into the run folder and list each with `pg_restore -l`. Then bring the slot up.
  A full `--up` runs migrations, so the backup holds the state before them.
- **No SQL write.** Every change is a gateway call as `admin@curation.local`. SQL is for
  reading, in a session set read only (`q.sh` of the repair).
- **Turn the development login off first.** Set `ADMIN_DEV_AUTOLOGIN` to false in the
  gateway `.env` of the worktree and restart the gateway alone, before the first login.
  Check that a wrong password answers 401.
- **`HARVEST_ENABLED` stays false.** This plan starts no run and no import, and reverts
  none.
- **A name patch sends both languages.** A patch replaces the whole name.
- **A read before and after every delete.** Before: no queue row names the product, and
  each price row it holds exists on the kept product with the same source kind, scope,
  price, unit price and validity (rule R1 of the register). After: the product is gone,
  and no queue row names a product that does not exist.
- **Each write is logged** with its body and its answer, one line per call, in
  `logs/<step>.answers.jsonl`.
- **A new product never equals another** in brand, name, size, unit and pack count. Run
  the check of plan `0186` (A6) in memory before each create and each rename.
- **Until slot 1 runs plan `0191`, no call may move or reject a row that is `ACTIVE`.**
  Stage 1 decides `CANDIDATE` rows, and it moves bound rows only as the first half of a
  merge, where the delete takes the leftovers with the product.

### Action boundaries

- Proceed with reads, backups, and every step of stage 1 as section 2 writes it.
- Stop a step and leave the row for a person in each case that the step names. Write the
  row and the reason to the answers file. Do not widen a rule to fit a row.
- Stop and ask before: any delete that is not the empty half of a merge, any new brand,
  any step of stage 2 while `git log` of the checkout that serves the slot does not hold
  the merge of plan `0191`, and stage 3 while plan `0190` or plan `0191` is not merged.
- Stop and ask if a check of section 5 answers a count far from the one written here.
- Decision 9 is held by the owner. Do nothing on its four pairs, whatever a step finds.

### Progress evidence

After each step, report the check of section 5 before and after, the number of calls that
succeeded and failed, and each row left with its reason. End each stage with the dump
paths, their sizes and checksums, and the row counts of `items`, `brands`, `item_prices`,
`source_catalog_entries` (all and `ACTIVE`) and `supermarket_location_items`.

## 1. The order, and what waits for which plan

Three plans of PR #649 fix the code that the repair found missing. This is what each
means for the steps here.

- **Plan `0191`, a row that leaves a product takes its offers with it.** It decides the
  split between stage 1 and stage 2.
  - A `CANDIDATE` row is not bound. A create or an accept on it leaves nothing behind.
    Decisions 2 and 7 are therefore stage 1.
  - A merge moves bound rows and then deletes the product they left. The delete cascades
    its price rows and its offers, and plan `0191` says the same (section 1, "a deleted
    or merged product"). Decision 6 is therefore stage 1, with one exception: an accept
    that answers 409 `item_ean_held`. The product to delete then holds the barcode of
    the row. Target 4 of plan `0191` moves it with the row. Until then, leave the pair.
  - The burger (decision 10) and a fruit row that changes product (decision 11) move a
    bound row and keep the old product. Its price row and its offers stay behind today.
    Both are stage 2.
  - Plan `0191`, target 6, also decides what an accept does with a second article of one
    chain on one product. Stage 1 never makes such a pair: see the stop rules of
    decisions 6 and 7.
- **Plan `0190`, a price keeps the kind of the source that stated it.** No step of
  stage 1 or stage 2 waits for it. No row that this plan binds is one of the eight rows
  that a leaflet and the website share, and decision 1 says that nothing is imported
  again. Two things follow for stage 3:
  - The plan adds a harvester migration. The dumps that ship must hold the migrations of
    the release that carries the restore, so stage 3 waits for the merge.
  - Its section 3 leaves one read open: the leaflet price rows of the six bound rows.
    Stage 3 makes that read before the dumps.
- **Plan `0189`, a unit price label names what the figure is.** No step waits for it. It
  repairs its 1,497 rows with a new Mercadona run, and this plan starts no run. If the
  owner wants the shipped catalog to carry the true labels, that run goes between
  stage 2 and stage 3, on the owner's word. The same run answers decision 15.

So the order is: stage 1 at once, stage 2 after `0191`, stage 3 after `0190` and `0191`
and after any run the owner asks for. **Stage 3 is the last write to slot 1 before the
upload.** A later write means new dumps and a new manifest.

If plan `0191` is already merged when the work starts, do stage 1 and stage 2 in one
session, in the order of this file.

## 2. Stage 1

The order below puts the plain writes first and the merges last, so that a merge sees
every row that the steps before it bound.

### 2.1 Decision 8: four English names

Data: `a01-english-names.json`, the 4 entries marked low.

| Product | Brand, Spanish name | `name.en` to write |
| --- | --- | --- |
| `c7f4688f` | Alteza "Besitos" | Besitos |
| `4c6c59dd` | Hidalgo "Negrito" | Negrito |
| `a2736a53` | Hidalgo "Negrito gigante" | Negrito gigante |
| `6fdae9cd` | El Cateto "Panales de cabello sin azúcar" | Sugar free angel hair pastries |

- The owner took the recommendation of the register, not the names that step A1 proposed
  ("Negrito pastry", "Giant Negrito pastry", "Sugar free angel hair panales pastries").
- One `PATCH /v1/admin/catalog/items/batch`. Each entry sends `name.es` as it stands and
  `name.en`.
- Check: A1 goes from 4 to 0, and the four Spanish names did not change.
- Stop: a product whose Spanish name is no longer the one above.

### 2.2 Decision 3: the frozen fish

Data: `b01-prices-by-the-kilo.json`, the 22 entries with
`gramsThatPriceOverUnitPriceGives`. Each product is `KILOGRAM` with no size. Its only row
is a Mercadona row that says `soldByWeight` false, format `kg` and no size, so the price
is the price of a pack.

**The rule, as this plan reads "a round pack weight".** Work out price over unit price
times 1000, from the current price row, and do not round it. A round weight is a multiple
of 10 g or of 25 g. Write the weight when exactly one round weight lies within 1 percent
of the figure. The owner's words do not say what round means. This reading takes 21
products and leaves one, whose figure has two round weights in reach.

| Product | Row | Brand, name | Price | Per kg | Figure | Write |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `0768bab4` | ext 62103 | Hacendado, Porciones de merluza del Cabo sin piel ultracongeladas | 4.90 | 9.80 | 500.0 | 500 |
| `1d5a58ab` | ext 24274 | Hacendado, Sepia faraónica troceada limpia congelada | 5.90 | 16.39 | 360.0 | 360 |
| `2057de9c` | ext 24023 | MareDeus, Migas de bacalao sin piel ultracongeladas | 6.10 | 20.33 | 300.0 | 300 |
| `2a1a982d` | ext 24230 | Hacendado, Gamba pelada cruda tamaño grande ultracongelada | 5.95 | 16.53 | 360.0 | 360 |
| `2c55594a` | ext 24341 | Hacendado, Tiras de potón del Pacífico congeladas | 4.95 | 12.38 | 399.8 | 400 |
| `407bfb19` | ext 24477 | Hacendado, Langostino cocido y pelado ultracongelado | 5.00 | 22.73 | 220.0 | 220 |
| `4640c7e8` | ext 26762 | Hacendado, Medallones de merluza argentina ultracongelados | 4.00 | 8.00 | 500.0 | 500 |
| `4c375f01` | ext 62162 | Hacendado, Filetes de merluza argentina sin piel ultracongelados | 4.90 | 8.17 | 599.8 | 600 |
| `51c380e7` | ext 62049 | MareDeus, Porciones de bacalao sin piel ultracongeladas | 7.70 | 19.25 | 400.0 | 400 |
| `76e498f6` | ext 24712 | Hacendado, Langostino crudo ultracongelado | 5.95 | 9.92 | 599.8 | 600 |
| `7c42177d` | ext 63432 | Hacendado, Calamar patagónico pequeño ultracongelado | 5.50 | 11.00 | 500.0 | 500 |
| `85ee4cd2` | ext 26764 | Hacendado, Rodajas de merluza argentina ultracongeladas | 4.70 | 7.83 | 600.3 | 600 |
| `8f64517c` | ext 24486 | Hacendado, Langostino crudo y pelado ultracongelado | 3.95 | 17.95 | 220.1 | 220 |
| `9b2f060c` | ext 62275 | Hacendado, Escalopines de rosada sin piel ultracongelados | 8.60 | 17.20 | 500.0 | 500 |
| `9dfbfbee` | ext 62012 | Hacendado, Fritura de pescado ultracongelada | 5.45 | 9.08 | 600.2 | 600 |
| `aaa4231c` | ext 62048 | Hacendado, Preparado de paella y sopa ultracongelado | 4.50 | 6.57 | 684.9 | **left** |
| `c603f860` | ext 24016 | MareDeus, Filetes de bacalao ultracongelados | 7.40 | 19.73 | 375.1 | 375 |
| `cb48e1c9` | ext 62191 | Hacendado, Filetes de panga ultracongelados | 4.65 | 5.17 | 899.4 | 900 |
| `cfb19e90` | ext 62396 | Hacendado, Carne de mejillón cocido ultracongelado | 2.50 | 9.09 | 275.0 | 275 |
| `d5a82829` | ext 24242 | Hacendado, Calamar troceado limpio congelado | 5.90 | 12.42 | 475.0 | 475 |
| `ed4dabf2` | ext 24234 | Hacendado, Rodaja de potón del Pacífico cocido congelado | 6.50 | 13.68 | 475.1 | 475 |
| `fd9fefc1` | ext 24181 | Hacendado, Gamba pelada cruda tamaño mediano ultracongelada | 4.90 | 13.61 | 360.0 | 360 |

- Read each product first: its row still says `soldByWeight` false, and the current price
  rows of the three warehouses give the same figure. Work the table out again from that
  read. The figures above are those of 2026-10-06.
- One `PATCH /v1/admin/catalog/items/batch`: `defaultUnit` `GRAM` and `unitSize` for each.
  Send no name.
- Check: "B1, current rows only" of `stage-b/checks.mjs` goes from 66 Mercadona rows to 3.
  The 3 are the rows of `aaa4231c`.
- Stop, and leave the product: its row now says `soldByWeight` true, the three warehouses
  disagree, another row is bound to it, or the figure has no round weight or two.
  `aaa4231c` is left: 680 g and 690 g are both within 1 percent of 684.9.

### 2.3 Decision 14: the Incarlopsa ham piece

Data: `a03-units.json`, "Jamón serrano pieza". Product `47e4d9a0`, Incarlopsa, 7500
`GRAM`, barcode 8421384092375. Its Mercadona row is `40be5d70`, ext 58293.

- Read the row and the prices. The end snapshot of plan `0186` shows the row with
  `soldByWeight` true and no size. Apply only if that still holds, no other row is bound
  to the product, and each current Mercadona price row holds the per kilo price (`price`
  equals `unitPrice` rounded to the cent).
- One batch entry: `defaultUnit` `KILOGRAM`, `unitSize` null. This is what stage B did
  for the three Covap pieces.
- Check: the product reads `KILOGRAM` with no size, and check B1 does not count it.
- Stop: any of the three conditions fails. Then leave it at 7500 `GRAM`.

### 2.4 Decision 12: the brand lines and Invictus

Data: `a11-brand-decisions.json`: `linesLeftSeparate` in the header (the counts, with no
product ids), and the entry of the refused Invictus link.

| Line | House | Products | Blocking spelling |
| --- | --- | ---: | --- |
| Nike Ultra Blue | Nike | 1 | none |
| Vileda Turbo | Vileda | 2 | `VILEDA TURBO SMART` |
| Vileda Duactiva | Vileda | 1 | none |
| Nescafé Farmers Origins | Nescafé | 3 | `FARMERS ORIGINS NESCAFÉ` |
| Neutrex Transpirex | Neutrex | 1 | none |
| Lenor Unstoppables | Lenor | 1 | none |
| Invictus (`d31ddeef`) | Paco Rabanne (`af43b6be`) | 0 | `INVICTUS P.RABANNE` |

- `Puleva Max` stays a brand. The five links that an agent made in plan `0186` (Oral-B
  3D White, Pro-Expert, Pro-Flex, Vanish Oxi Action, Norit Complet) stay. Do not touch them.
- The order is the order of October, rule R18 of the register:
  1. Read the products of each line (SQL on `items` by `brandId`) and the spellings of
     each line (`GET /v1/admin/catalog/brands/:id/spellings`).
  2. **Names first.** One batch gives each of the 9 products the word of its line in the
     name, in both languages ("Ultra Blue", "Turbo", "Duactiva", "Farmers Origins",
     "Transpirex", "Unstoppables"), unless the name already holds it. The brand field does
     not change in this call.
  3. **Then the blocking spellings.** `PATCH /v1/admin/catalog/brands/:id` with
     `canonicalBrandId` of the house, for each of the three spellings.
  4. **Then the links.** The same call for each of the seven lines. Write `movedItems` of
     each answer to the log.
- **Not confirmed:** that one `PATCH` points a brand that is already a spelling at
  another house. `resolveLink` in `catalog/src/app/catalog/brand.service.ts` refuses a
  target that is a spelling and a row that something points at, and neither is the case
  here. If the call is refused, do not unlink to force it. Leave the line and report the
  code.
- Check: a read of the products of both brands before and after each link, as in step j
  of plan `0186`. `movedItems` equals the count of the table. No moved product equals a
  product of its house. The count of brands that are a spelling goes from 499 to 506.
- Stop: a house that is not registered, a line whose product count is not the one above,
  a rename that would make two products equal, or `brand_link_too_deep` after step 3.

### 2.5 Decision 4: the Deza shop codes

Data: `b02-deza-run.json`, the 11 `shopCode` entries. The chain is Deza, supermarket
`2df761c8-630a-4bcb-acc9-734c7c7beec3`.

| Code | Printed name | Row |
| --- | --- | --- |
| `T1` | Jesús Rescatado | `4fbf99af` |
| `T2` | Ctra. de Castro | `76780b44` |
| `T3` | Ronda del Marrubial | `5024689f` |
| `T4` | Isla Fuerteventura | `a5c060f4` |
| `T5` | Camino de la Barca | `2143fab5` |
| `T6` | Avda. de Libia | `16d3a493` |
| `T7` | Fuente de la salud | `61bd8913` |
| `C1` | SuperCash (Quemadas) | `d44a1059` |
| `C2` | SuperCash (Sector Sur) | `bf648fbc` |
| `Z1` | Zoco | `857ce47b` |
| `CONSULTAR` | Disponibilidad diaria según mercado | `bc260067` |

- **The condition of the owner is met.** `SourceLocationService.map` saves the mapping
  and then sends the stored claims of that shop, for the rows that are bound to a
  product, in the same request. No run is needed.
- Read `GET /v1/admin/harvest/shops?supermarketId=…&status=UNMAPPED`. Each row carries
  the shops of the chain it may be, with label, address and postal code. Read
  `GET /v1/admin/catalog/supermarkets/:id/locations` for the whole list.
- Map a code when exactly one Deza shop carries its printed name in the label or the
  address: the street for the seven `T` codes, the word in brackets for the two SuperCash
  codes, "Zoco" for `Z1`. Two codes never take one shop.
- `PUT /v1/admin/harvest/shops/:id/location` with `supermarketLocationId`, **one shop at
  a time**. Read `supermarket_location_items` for that shop before the next call.
- `POST /v1/admin/harvest/shops/bc260067…/ignore` for `CONSULTAR`. Never map it.
- **Not confirmed:** that one mapping finishes inside the request timeout. One shop is
  about 11,100 claims, sent in batches of 200. If the call fails or times out, the shop
  stays mapped. Wait, count the rows of the shop, and send the same `PUT` again only if
  the count is short. Catalog takes the same claims as many times as it is told.
- Check: `source_locations` holds 10 `ACTIVE` and 1 `IGNORED` where it held 11
  `UNMAPPED`. `supermarket_location_items` holds, for each shop, as many rows as the
  harvester holds claims of that code on rows bound to a product (read both counts). The
  10,989 offers with no price did not change.
- Stop, and leave the code `UNMAPPED`: no shop or two shops fit its name.

### 2.6 Decision 7: the El Jamón candidates

Data: `b04-candidate-rows.json`, the 14 El Jamón entries. Each is `CANDIDATE`, matched by
name and size to a product of another brand.

| Row | Prints | The candidate it is not accepted onto |
| --- | --- | --- |
| `7d346862` | COREN, albóndigas de pollo, 420g | Ifa Eliges `a1198a06` |
| `bdbecf16` | DOLCE GUSTO, café con leche, 16ud | Ifa Eliges `05180b2f` |
| `123c88fd` | DOLCE GUSTO, café cortado, 16ud | Ifa Eliges `c92afa26` |
| `7c0632a4` | DOLCE GUSTO, café espresso intenso, 16ud | Ifa Eliges `2462ee34` |
| `f6e9f49d` | NESCAFÉ, café soluble descafeinado, 200g | Ifa Eliges `42fcb7f0` |
| `d42e77cf` | NESCAFÉ, café soluble natural, 200g | Ifa Eliges `f16f26eb` |
| `bcc91898` | MAHOU, cerveza botellín 250ml, pk-6 | Victoria `d205c986` |
| `8508d462` | DESPECHO, vino d.o. r.duero tinto roble, 750ml | Celeste `2b6b4c43` |
| `a78ea010` | PATA NEGRA, vino d.o. rueda blanco verdejo, 750ml | Molongo `61ba698c` |
| `33d30cba`, `5e27b057`, `6154f9bd` | BÚFALO, crema calzado color blanco, marrón, negro, 50ml | none |
| `2d748b18` | CAMPOFRÍO, salchichas frankfurt, pk-4 | none |
| `786d7449` | ACTIVIA, yogur desnatado con melocotón, pk-4 | none |

- **"Reject the candidate" is not a call to the reject route.**
  `POST /v1/admin/harvest/entries/:id/reject` marks the row itself as a product that is
  not tracked. The proposal is dropped by the bind: an accept onto another product, or a
  create, overwrites it.
- For each row, read `brandMatches` of the row in the queue listing, then search the
  products of that brand (`GET /v1/admin/catalog/items?query=…`, and SQL by `brandId`).
  - **A product of the row's own brand exists** with the same name in meaning, the same
    size and the same count: `POST …/entries/:id/accept` with its `itemId`. The Dolce
    Gusto and Nescafé rows are the likely cases. Mercadona's capsule products are stored
    in grams with a pack count of 16.
  - **None exists:** `POST …/entries/:id/item`. Send `name` in both languages, by the
    rules of the curation prompt (no brand and no size in a name). Send `brand` as the
    label of the registered brand. Send `unitSize`, `defaultUnit` and `packCount` only
    where the default of the row is wrong: the Mahou row is 6 bottles of 250 ml, which is
    1500 `MILLILITER` with a pack count of 6, as its Victoria sibling is stored.
- Check, for each row: the row is `ACTIVE` and `MANUAL` on the right product,
  `pricesWritten` is above 0, the product of the other brand holds the same rows and the
  same prices as before, and the new product equals no other. At the end `CANDIDATE`
  holds no El Jamón row that was not left on purpose.
- Stop, and leave the row `CANDIDATE`:
  - `brandMatches` is empty. A new brand is a brand decision. List the row.
  - Two products of the brand fit, or one fits in name and not in size.
  - Another El Jamón row is already bound to the product that fits. That would put two
    articles of one chain on one product (rule R28). Leave it for stage 2, where an
    accept under plan `0191`, target 6, binds the row and withholds the price.
  - The accept answers 409 `item_ean_held`.

### 2.7 Decision 2: the eleven Mercadona candidates

Data: `b04-candidate-rows.json`, the 11 Mercadona entries. The chain is Mercadona,
supermarket `67f8bec7-f589-4afb-b9c6-e7bbb444b722`.

| Row | Prints | Proposed product, and the row bound to it | What tells the two apart |
| --- | --- | --- | --- |
| `e563bc0e` ext 11658 | 3 Bocadillos, 0.39 kg, 1.10 | none (sibling `59563a5e` ext 11633 is `UNRESOLVED`) | Nothing to tell apart yet. 390 `GRAM` |
| `52ad8ea4` ext 14322 | Deliplus, Compresa normal con alas, 10 ud, 1.20 | `2cef3507`, 32 ud (`0401fbfb` ext 14316) | The size |
| `e279bcf0` ext 71202 | Bosque Verde, Guantes de látex talla mediana-grande, 50 ud, 3.00 | `18e169ab`, 2 ud (`fc663b62` ext 14970) | The size |
| `3cc31ae7` ext 71203 | Bosque Verde, Guantes de látex talla pequeña-mediana, 50 ud, 3.00 | `6130110a`, 2 ud (`4bef3a3f` ext 14969) | The size |
| `3db62f48` ext 10933 | Hacendado, Leche entera, 1 L, 1.15 | `93c7ffc1`, 1000 ml, 0.96 (`332a71d6` ext 10380) | The container |
| `c2f6756e` ext 10922 | Hacendado, Leche semidesnatada, 1 L, 1.09 | `14a60b0a`, 1000 ml, 0.83 (`8752e0a7` ext 10382) | The container |
| `6253b6a3` ext 20727 | Hacendado, Mantequilla con sal, 0.25 kg, 2.45 | `dec3bf79`, 250 g, 2.05 (`044f639a` ext 20722) | The container |
| `ef0447c9` ext 20716 | Hacendado, Mantequilla sin sal añadida, 0.25 kg, 2.05 | `20f73e35`, 250 g, 2.45 (`cf569110` ext 60622) | The container |
| `8edbf906` ext 28113 | Coca-Cola, Refresco, "2 L", 5.60 | `f8a4d80d`, 2000 ml, 2.15 (`0518c0fc` ext 27342) | A pack count |
| `a3e11e05` ext 28115 | Coca-Cola, Refresco zero azúcar, "2 L", 5.60 | `1a674c8a`, 2000 ml, 2.15 (`58e3158c` ext 27445) | A pack count |
| `f408cb69` ext 14717 | Bosque Verde, Vela perfumada Chai, 1 ud, 1.90 | `021bec5a`, 18 ud, 1.85 (`dad26834` ext 72077) | Not known |

- Each row gets a product of its own: `POST /v1/admin/harvest/entries/:id/item`. The row
  is not bound, so the proposed product loses nothing.
- **Read the detail of both rows of a pair first.** The queue row holds the size, the
  format, the pack count and the link. It does not hold the container: the harvester
  does not store the `packaging` field of the chain. Where the row does not say what
  tells the two apart, read the public product page of the chain for the two external
  ids, one request for each. That is a read of two pages, not a run.
- **The container goes in the name, in both languages, on both products of the pair**
  (rule R26): the new product in the create, the old product in a batch after it. A name
  that already holds its container does not change.
- **The two Coca-Cola rows are multipacks.** 5.60 for 2 litres is not the 2 L bottle.
  Create each with the pack count that the detail states, the total volume in
  `MILLILITER` as the detail states it (six cans of 330 ml are 1980, not 2000), and the
  container in the name. The brand is the registered `Coca Cola`.
- Check, for each row: the row is `ACTIVE` and `MANUAL` on the created product,
  `pricesWritten` is 3 (the three Córdoba warehouses), the created product holds the
  barcode of the row when the code is a real one, the proposed product holds the same
  rows and prices as before, and no two products are equal. At the end `CANDIDATE` holds
  no Mercadona row that was not left on purpose.
- Stop, and leave the row `CANDIDATE`:
  - The detail does not say what tells the two apart. This is likely for the candle.
  - The detail of a Coca-Cola row states no count.
  - The create answers 409: another product holds the barcode. Report the product.
  - The detail shows that the two rows are one article after all (the same container,
    the same count). Then the answer of the owner does not fit the row. Report it.

### 2.8 Decision 6: one product stored by weight and by count

Data: `b05-grams-and-units.json`, the 47 entries with `decision` "no merge". Each names a
`measured` product (grams or millilitres) and a `counted` product (units), with the rows
of both.

**What the data shows.** No row of a counted product prints a weight, so no pair can
"agree on count and weight" as the words say. The 47 are also a cross of a few measured
products with many counted ones: 16 Dolce Gusto capsule pairs of one variant against
another, and the same for Tassimo and Nescafé. Most are two products.

**The reading this plan takes.** Merge a pair only when all of these hold:

1. The pack count of the rows is the same on both sides.
2. Every row that prints a weight or a volume prints the same one. A row that prints
   none does not disagree.
3. The two products are the same variant. Each word that names a flavour, a roast, a
   scent, a line, or "descafeinado" is on both sides, in the product names and in the
   printed names of the rows. "Café cortado" and "Café cappuccino" are two products.
4. No chain has a row on both products. One chain that lists both sells two articles.
5. A counted product is the pair of at most one measured product. If two measured
   products fit one counted product, leave all of them.

- Write the reading of all 47 to a proposal file first (`proposals/6-pairs.md`), one line
  per pair with the verdict and the reason, as plan `0186` did for A6. Then apply the
  pairs marked merge.
- A merge keeps the measured product (rule R30). Accept each row of the counted product
  onto it (`POST …/entries/:id/accept`), then set its pack count if it has none, then
  delete the counted product (`DELETE /v1/admin/catalog/items/:id`), with the reads of
  the constraints.
- Check, for each merge: the kept product holds every row of both, the deleted product
  is gone, each cascaded price row was a duplicate, and no queue row names a product
  that does not exist. `items` falls by the number of merges.
- Stop, and leave the pair:
  - Any of the five conditions fails. Expect this for most pairs.
  - An accept answers 409 `item_ean_held`. The pair waits for stage 2.
  - A price row of the counted product is not on the kept product after the accepts.
- The two near pairs that stage B left (Tampax Pearl regular, Oral-B Precision) are not
  part of decision 6. Do not merge them.

### 2.9 The end of stage 1

Run every check of section 5. Take dumps of all four databases into
`after-stage-1/`, verify them, write `VERIFY.txt`, and give the slot back with
`--down --keep-data`. These dumps do not ship. Do not write them into the manifest.

## 3. Stage 2, after plan 0191

Before the first write, prove that the slot runs the code: the merge of plan `0191` is in
`git log` of the checkout that serves the slot, the slot was brought up after it, and the
settle route answers a `dryRun` for one product. Take a backup first, as in stage 1.

### 3.1 Decision 10: the El Pozo burger "king"

Data: `a05-sizes-against-unit-prices.json`, El Pozo "Burger de pavo con espinacas
bienStar". Product `7541e849`, 240 `GRAM`, pack count 2. Two El Jamón rows are bound to
it: `0e539371` (article 93003284, 2.45) and `67a821e4` (article 93003273, "burger pavo
con espinacas king", 2.95). Both print 240 g. The product holds two El Jamón price rows
in one scope.

- **The size is 240 g, as printed.** The unit price of the chain (11.35 per kilo, which
  gives 260 g) is the figure of the chain and changes nothing. This is rule R32 of the
  register: a printed size wins over a size worked out from a unit price.
- `POST /v1/admin/harvest/entries/67a821e4-69c0-49be-9c52-15f6dbe25c23/item` with `name`
  in both languages, `brand` `El Pozo`, `unitSize` 240 and `defaultUnit` `GRAM`. The name
  holds the word "king", which tells it from the old product. Send the pack count only
  if the row prints one.
- Under plan `0191`, target 3, the create settles the old product: the 2.95 row leaves
  it with no manual delete, and row `0e539371` writes its 2.45 again.
- Check: the new product holds the row and one El Jamón price of 2.95. The old product
  holds one current El Jamón price of 2.45 and the rows `0e539371` and the Deza row
  `d0059f4b`. A `dryRun` of the settle route for the old product and the El Jamón chain
  answers nothing to delete.
- Stop: the old product still holds the 2.95 row after the create. Do not delete it by
  hand. Report it, because the code did not do what plan `0191` says.

### 3.2 Decision 11: the fruit pairs

Data: `a06-the-same-product-twice.json`, the 4 pairs left for a person, and
`b01-prices-by-the-kilo.json`, "Manzanas Golden".

| Pair | Singular | Plural |
| --- | --- | --- |
| Aguacate | `4797568b`, Mercadona `2b094ac7` ext 3830 | `e4caee7e`, Mercadona `be5de831` ext 3858, El Jamón `a90598fb` (loose, by the kilo) |
| Kiwi verde | `db60d97b`, Mercadona `6768c2f0` ext 3820 | `b0d8331d`, Mercadona `755e627b` ext 3832, El Jamón "kiwis" |
| Manzana Golden | `35b3cfa6`, Mercadona `48d80a80` ext 3028 | `7c039a16`, Mercadona `6150ac3d` ext 3269, El Jamón `95380a0e` ext 54008067 ("manzanas golden bolsa", 1.5kg, 2.39) |
| Manzana roja dulce | `d01f0c3a`, Mercadona `c8275279` ext 8177 | `6a119592`, Mercadona `a504a5bb` ext 8280 |

**The test of the owner, and what the data says.** The product whose Mercadona row is
sold by weight is the loose fruit. The other is the bag. In the snapshot of the end of
plan `0186`, **all eight Mercadona rows say `soldByWeight` true and no size.** The test
then tells no pair apart.

- Read the eight rows again. For a pair where exactly one Mercadona row is sold by
  weight:
  - That product is the loose fruit. Accept each loose row of the other chains onto it
    (a row sold by the kilo with no fixed size).
  - The other product is the bag. Give it the size that its rows print, in `GRAM`. Accept
    each bag row of the other chains onto it (a row with a fixed size, such as the
    El Jamón bag of 1.5 kg).
  - Each accept of a bound row settles the product it left (plan `0191`, target 3).
    Check the old product after each: no price row and no offer of that chain is left
    that no bound row states.
- For a pair where both Mercadona rows are sold by weight, or neither: **do nothing, and
  report the pair.** Do not move `a90598fb` and do not move the Golden bag. The move
  depends on which product is the loose one, and the rows do not say.
- Check: for each pair applied, check B1 no longer counts its rows, and no two products
  are equal. For the rest, nothing changed.

### 3.3 What stage 1 left for this stage

- A pair of decision 6 whose accept answered `item_ean_held`: do the merge now. Target 4
  of plan `0191` takes the barcode off the old product in the same call.
- A row of decision 7 whose own brand product already holds another El Jamón row: read
  the two rows. If they are two articles at two prices, the row gets a product of its
  own (rule R28). If they are one article listed twice, accept it. The answer names the
  row whose price was withheld.
- End the stage as stage 1 ended: every check, dumps into `after-stage-2/`, `VERIFY.txt`,
  `--down --keep-data`.

## 4. Stage 3: the dumps that ship, the manifest and the documents

Do this stage only after plans `0190` and `0191` are merged, after stage 2, and after any
harvest run that the owner asked for. Nothing writes to slot 1 after it.

### 4.1 Before the dumps

- Bring slot 1 up on the code of the release that will carry the restore, so that both
  `migrations` tables hold its migrations. Read both tables.
- Read: no harvest run is pending or running (step 3 of the restore refuses one).
- Make the read that plan `0190`, section 3, left open: for the six bound rows that a
  leaflet and the website share, the price row of run `794056b6` in `item_prices` has
  the kind `OFFICIAL_LEAFLET`. Report the six. Change nothing.
- Run every check of section 5 one last time.

### 4.2 The dumps

Stop the seven services, so that nothing writes, and keep the database containers up.
Dump all four databases with `dump.sh` of the repair into `final/`. For each file record
the size, the SHA-256 and the `pg_restore -l` counts in `VERIFY.txt`. Then restore copies
of `catalog.dump` and `harvester.dump` into a throwaway `postgres:16-alpine` and read the
eight counts of the manifest from the copies. Never rehearse on slot 1 or on its volumes.
Give the slot back with `--down --keep-data`.

### 4.3 `k8s/catalog-import/first-catalog.manifest`

Every value below changes, or is read again and confirmed. The object keys and the names
of the variables do not change.

| Variable | Value today (the dumps of 2026-10-03) | Read it from |
| --- | --- | --- |
| `CATALOG_SHA256` | `53caacd7…17aa8` | `sha256sum final/catalog.dump` |
| `HARVESTER_SHA256` | `841cf6df…06642` | `sha256sum final/harvester.dump` |
| `CATALOG_LAST_MIGRATION` | `DiaCategoryTree1758500000000` | The name with the highest timestamp in catalog's `migrations` |
| `CATALOG_MIGRATIONS` | 26 | `count(*)` of that table. `dev` held 29 on 2026-10-04 |
| `HARVESTER_LAST_MIGRATION` | `DiscoveredPlaceFootprint1757900000000` | The same, in the harvester. Plan `0190` adds one |
| `HARVESTER_MIGRATIONS` | 17 | `count(*)`. `dev` held 20 on 2026-10-04 |
| `EXPECT_SUPERMARKETS` | 5 | `supermarkets` |
| `EXPECT_PRICE_SCOPES` | 103 | `price_scopes` |
| `EXPECT_CATEGORIES` | 275 | `categories` |
| `EXPECT_BRANDS` | 2782 | `brands` |
| `EXPECT_ITEMS` | 19791 (19,761 at the end of plan `0186`) | `items` |
| `EXPECT_ITEM_PRICES` | 22335 (23,374) | `item_prices` |
| `EXPECT_SOURCE_ENTRIES` | 25725 (25,856) | `source_catalog_entries` |
| `EXPECT_SOURCE_ENTRIES_ACTIVE` | 21751 (21,754) | `source_catalog_entries` where `status` is `ACTIVE` |

Rewrite the comment at the top of the file too. It says that every value is provisional
and names the dumps of 2026-10-03 20:44. It must name the day and the hour of the new
dumps and say whether the owner declared slot 1 final (see section 7).

### 4.4 `k8s/catalog-import/README.md`

- **"When slot 1 is final".** The first paragraph and step 1 name the dumps of
  2026-10-03 and their 26 and 17 migrations. State the new dumps, their date and their
  migration counts. Say that the manifest now describes them.
- **"Why a restore and not an import".** "Only 4,190 of the 19,791 products have an EAN":
  read both numbers again (`items` with `ean`, and the rows of `item_eans`).
- **"What changes".** "The dumps hold four rows that are on": read `supermarket_sources`
  again.
- **"How it was tested"** describes the test of 2026-10-04 against the old dumps. Leave
  its rows as they are, and add one row for the restore of section 4.2 of this plan.
- Do not change the steps of the script, the split pair section or the revert.

### 4.5 The register and the report

- **The register.** In section 4 of its `README.md`, add to each of the ten decisions
  what was applied: the counts, the rows left and why. Add a data file for this plan
  with the build scripts, from the run folder of this plan, keyed as the other files are
  (`c01-…json` and on, one per decision). Do not edit a JSON file by hand. Build with
  `node build/build.mjs <run folder>` and confirm that the files of plan `0186` did not
  change.
- **The report**, `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`.
  - "The state in numbers" and "Final counts": the counts of the new dumps, with the day
    they were read.
  - "Repairs after the audit" (the section that plan `0186` adds): one part for this
    plan, with what each decision changed and what stays open. If that section is not on
    `dev` yet, add this part under its own heading.
  - "What is left for a person": the rows that this plan left, and decision 9.

## 5. The checks

Run them before stage 1 and after each step. The first seven are the checks of plan
`0186` (`stage-b/checks.mjs`). The count after the arrow is what the full plan expects
when no row is left.

| Check | At the end of plan `0186` | After this plan |
| --- | ---: | ---: |
| A1, no English name | 4 | 0 |
| A3, `LITER` and sized `KILOGRAM` | 0 | 0 |
| A6, equal in brand, name, size, unit, pack count | 1 | 1 (the Nivea pair) |
| B1, current rows only, Mercadona | 66 | 3 (the paella mix) |
| B1, current rows only, Deza and El Jamón | 21 and 1 | 21 (decision 1), and 1 or 0 (decision 11) |
| B4, rows `CANDIDATE` | 25 | 0 less the rows left |
| Queue rows that name a product that does not exist | 0 | 0 |
| `source_locations` `UNMAPPED`, `ACTIVE`, `IGNORED` (Deza) | 11, 0, 0 | 0, 10, 1 |
| `supermarket_location_items` | 0 | The claims of the ten codes on bound rows (about 111,000) |
| Brands that are a spelling | 499 | 506 |
| `items` | 19,761 | Plus each create, less each merge. State the sum |

```sql
-- catalog: the shop rows, by shop
select "supermarketLocationId", count(*) from supermarket_location_items group by 1;

-- harvester: the shop codes of Deza, by status
select status, count(*) from source_locations
 where "supermarketId" = '2df761c8-630a-4bcb-acc9-734c7c7beec3' group by 1;

-- catalog: brands that are a spelling
select count(*) from brands where "canonicalBrandId" is not null;
```

The column names of the harvester's claims table are in
`harvester/src/app/entities/`. Read the entity before the join of claims to bound rows.

## 6. What this plan does not do

| Decision | Why nothing is done |
| ---: | --- |
| 1 | The owner said no. Deza leaflet run `794056b6` is not reverted and the document is not imported again. The leaflet was valid until 2026-10-08, and a second import collides with the 8 rows that the website run took over. The 21 offers by the kilo keep no price. The next leaflet goes through the fixed code. |
| 5 | The owner said to leave them. The 58 Deza products that the second run did not see get no write. |
| 9 | **Held by the owner.** The owner wants to check that the four pairs are duplicates (Johnnie Walker Black Label 700 ml, Dewar's White Label 700 ml and 1 L, ProActiv margarine 225 g). No merge. `d38b02dd` stays under `Flora`. |
| 13 | The owner said to keep them. The charcoal "10l" and the cat litter "8 L" stay `MILLILITER`: the pack states its content by volume. |
| 15 | The owner said to leave it. Fanta naranja stays at 1500 ml until the next Mercadona run prints the size again. This plan starts no run. |
| 16 | The owner said to wait for the code and to write nothing by hand. The F1 figurine `b3827082` keeps its 20 El Jamón offers with no price. Plan `0191`, section 3, names the one call that removes them, and gives that call to the owner. If the owner asks for it, it goes in stage 2, before the dumps. Without it the dumps that ship hold the 20 offers. |

Also not done: the two near pairs of stage B (Tampax Pearl regular, Oral-B Precision),
the three codes of 12 digits of step A4, the 143 sizes that step A5 left, the BBQ skewers
that plan `0191` asks a `dryRun` for, and every row of the queue that is `UNRESOLVED`.

## 7. Where an answer does not apply as worded

The owner accepted the recommendations as written. Four of them meet data that the
wording did not expect. This plan says what it does in each case, and each is a
question the owner can still answer.

1. **Decision 3, "a round pack weight".** The words give no step. This plan takes a
   multiple of 10 g or of 25 g, and writes a weight only when exactly one lies within 1
   percent. 21 products pass. "Preparado de paella y sopa" (684.9) is left.
2. **Decision 6, "agree on count and weight".** No counted row prints a weight. This
   plan reads "agree" as "do not contradict", and adds that the two names must be the
   same variant. Few of the 47 pairs will merge. The rest are two products and stay.
3. **Decision 7, "reject each candidate".** The reject route rejects the row, not the
   proposal. The row is bound elsewhere, which drops the proposal. A row whose brand is
   not registered is left, because a new brand is a brand decision.
4. **Decision 11, "the product whose Mercadona row is sold by weight".** Both rows of
   each of the four pairs are sold by weight. The test decides no pair, so stage 2 moves
   no fruit row unless a new read differs. The owner can name the loose product of each
   pair, or say that the two are one product (rule R3 of the register would then merge
   them).

One more thing is the owner's alone. The manifest says "when the owner declares slot 1
final". Decision 9 is still held, and a Mercadona run for plan `0189` may follow. Stage 3
writes the values of its dumps and says in the manifest what is still pending. Dumps
taken after a later write replace them.

## 8. What was done (2026-10-06)

All three stages ran on 2026-10-06. The register
(`apps/luna-shopper-backend/docs/first-catalog-decisions-2026-10/README.md`, section 5) and
the report (`apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`, the last section)
hold the counts, the rows and the list of what stays open.

- **Before stage 1.** The Mercadona run of plan `0189` ran first, and not between stage 2
  and stage 3 as section 1 places it. Old labels on current price rows fell from 1,595 to 87.
- **Stage 1.** 43 writes: decisions 8, 3, 14, 12, 4, 7 and 2, and the read of the 47 pairs
  of decision 6. It left one fish product, five shop codes, three El Jamón rows and four
  pairs for a person.
- **Stage 2.** 6 writes: the burger "king" (decision 10), the two Nescafé cappuccino merges
  of decision 6, and the settle of the F1 figurine (decision 16).
- **Stage 3.** 32 writes: the owner's later answers to every row that stages 1 and 2 left,
  the four merges of decision 9, a store discovery, and the final dumps of
  2026-10-06T21:12:47Z. The manifest holds their values.

Where the four cases of section 7 ended:

1. **Decision 3, "a round pack weight".** The reading held. 21 products took a weight.
   The owner then said that the paella mix stays without a size.
2. **Decision 6, "agree on count and weight".** The reading held. The five conditions
   merged 2 pairs and left 4 for a person. The owner then said: the two Tassimo pairs
   merge with "Marcilla" in the name, the Nescafé vanilla pair stays two products, and the
   Bref pair waits for a barcode. 41 pairs are two products.
3. **Decision 7, "reject each candidate".** No reject route was called. 11 rows were bound
   or given a product in stage 1. No row was left for a brand that is not registered. 3
   rows were left because a product fit in part. The owner then said: Pata Negra verdejo
   and Campofrío frankfurt get a product of their own, and the Coren row is accepted onto
   the Coren product, which is renamed "Albóndigas de pollo".
4. **Decision 11, the fruit test.** The test decided no pair, as section 3.2 expected. The
   owner then said that the singular name is the loose fruit and the plural is the bag
   (rule R33 of the register). 2 El Jamón rows moved, and the 1.5 kg Golden bag got a
   product of its own.

The manifest, which section 7 leaves to the owner: it states the final dumps and says that
they ship unless slot 1 is written again. The owner has not said in words that slot 1 is
final, and the two files are not uploaded.

Where the work left the text of this plan:

- **The run folder.** The scripts and the logs are in
  `.curation-runs/2026-10-audit-repair/` (`after-0189/`, `stage-c1/`, `stage-c2/`,
  `stage-c3/`), not in a new `2026-10-owner-decisions/` folder.
- **Decision 9** was held when this plan was written. The owner lifted the hold the same
  day, and stage 3 merged the four pairs.
- **Decision 16** is in section 6 as not done. The settle route of plan `0191` existed in
  stage 2, its dry run answered the 20 offers and nothing else, and the call ran.
- **Decision 4.** The catalog held eight Deza shops, not ten. 9 codes are mapped, and
  `T7` has no shop. The shop rows are 99,801, not about 111,000.
- **Decision 2.** The container was read from the stored link of each row, not from a
  product page. The candle was created past the likely stop of section 2.7, and the owner
  then said that it stays.
- **Section 4.1.** The read of the six leaflet rows that plan `0190` left open is not in
  the files of stage 3.
- **Section 4.5.** The register has thirteen new data files: one for each of the twelve
  decisions with a write, and one for the categories. Decisions 1, 5, 13 and 15 have none.
- **k8s plan `0012`.** The scope says not to touch it. It got one dated line that says
  that the manifest now holds the values of 2026-10-06, and nothing else changed in it.

**Note of 2026-10-07 ([#656](https://github.com/IchirokuXVI/nx-portfolio/pull/656)).** After this plan the owner asked for two more changes on slot 1: the Deza code `T7` got a shop that was created by hand and is mapped to it, and the three Búfalo shoe creams went into the leaf `shoe-care`. New dumps were taken at 2026-10-06T22:33:14Z (2026-10-07 00:33 Madrid time), and the manifest holds their values, with 105 price scopes. The loose fruit rows wait for a later fix, and `apps/luna-shopper-backend/docs/first-catalog-decisions-2026-10/loose-fruit-rows.md` lists them. The sentences above describe 2026-10-06 and stay as they were written.
