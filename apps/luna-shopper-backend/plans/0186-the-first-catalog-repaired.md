> **PR:** [#648](https://github.com/IchirokuXVI/nx-portfolio/pull/648)

# 0186: the first catalog, repaired

> Found by the audit of the first catalog on local slot 1, 2026-10-03, the day it was
> built. The catalog is the one `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`
> describes: 19,791 products, 2,782 brands, 22,335 prices, 25,725 queue rows.
>
> This plan changes **data**, on slot 1 only, and no code. Plans `0181` to `0185` fix the
> code that wrote the defects. This plan repairs what is already written, takes new dumps
> and corrects the report.
>
> Prerequisite reading: the report above (all of it), plans `0180` to `0185`, plans `0115`
> and `0124` (brand links), `libs/luna-shopper/tools/curation/cli` (how a tool signs in and
> calls the bulk routes), and the scripts of the October work in the git ignored folder
> `.curation-runs/2026-10-deza-staging/harvest-curation/` (`owner-fixes.mjs`,
> `merge-weighed.mjs`, `api.mjs`), which this work copies its method from.

## Brief for the agent

### Objective

Repair the defects the audit found in the slot 1 catalog, through the admin API, in two
stages. Stage A needs no other plan. Stage B needs plans `0181` to `0185`. End each stage
with new dumps and an updated report.

### Context

- **Where the data is.** Slot 1 is locked with its databases kept
  (`luna-slot.sh --list`). A backup of 2026-10-03 23:09 is in
  `C:\Users\Ichi\Downloads\luna-slot1-backup-2026-10-03` (four `pg_dump -Fc` files, four
  plain SQL files, five raw volume archives). The dumps the report names are in the main
  checkout under `.curation-runs/2026-10-deza-staging/harvest-curation/final-dumps/`.
- **How to read it without changing it.** Start only the four database containers
  (`docker start luna-slot1-{auth,core,catalog,harvester}-db-1`), or restore the dumps into
  a throwaway `postgres:16-alpine`. A full `--up` runs migrations.
- **How the October work wrote.** Every change went through the gateway as the slot's
  curation admin (`admin@curation.local`), so `catalog_audit` holds it. A merge was two
  steps: the queue rows of one product were accepted onto the other, then the empty
  product was deleted.
- **Routes that exist:** `PATCH /v1/admin/catalog/items/batch` (all or nothing, at most
  1000 entries), `PATCH /v1/admin/catalog/brands/:id` (rename, link, unlink),
  `POST /v1/admin/catalog/brands`, `POST /v1/admin/harvest/entries/decisions`,
  `DELETE /v1/admin/catalog/items/:id`, `POST /v1/admin/harvest/runs`,
  `POST /v1/admin/harvest/imports`. There is no merge route and no route that moves chosen
  products between brands: a product changes brand through its own `brand` field.

### Target state

Each line names the defect, its size on 2026-10-03, and the repair. Find the rows again
with the checks in section 2. Do not trust the counts, because the data can be different now.

**Stage A (no other plan needed)**

| # | Defect | Size | Repair |
| --- | --- | ---: | --- |
| A1 | No English name | 100 products | Write `name.en`. One model call per chunk, the same rules as the curation prompt, a person reads the list before it is sent. |
| A2 | A pack count read from a dimension | 9 products | Set `packCount` to null. |
| A3 | A sized `KILOGRAM` or any `LITER` | 25 and 174 products | A weight or a volume becomes `GRAM` or `MILLILITER` times 1000. A capacity (21 bins, boxes, buckets) becomes `UNIT` with no size. |
| A4 | An in-store or invalid code as the product's EAN | 211, and 5 of 11 or 12 digits | Set `ean` to null for a code that starts with 2. For an 11 digit code, add the leading zero only when the result has a valid check digit, else null. |
| A5 | A size that the unit price contradicts | about 66 price rows | Read each against its queue row. Correct the product when the row proves it (Hacendado "Postre lácteo Lemon Cake" is 160 g, not 1600). Unlink the row when it is another format (Fanta naranja 1.25 L on the 1.5 L product). Leave the rest and list them. |
| A6 | The same product twice | 21 exact pairs, 14 near pairs | Merge the exact pairs the way October did. For a near pair (Berenjena and Berenjenas) merge when brand, size and chain data agree, and list every pair that is two products ("cola cero" and "cola cero cero"). |
| A7 | A row bound to the wrong product | 3 known | El Jamón "chocolatinas pk-3" (KitKat) leaves the 29 g F1 figurine. The BBQ skewers of 20 cm and 32.5 cm become two products. Pepsi can and bottle of 330 ml stay one. |
| A8 | One brand registered twice | 6 pairs | Link the spelling to the brand: 3 Brujas to Las 3 Brujas, Sierra de Montoro to Sierra Montoro, Liviana to Fuente Liviana, One to Purina One, CH Carolina Herrera to Carolina Herrera, Gotitas de Oro to Gotas de Oro (check that both are the same oil first). |
| A9 | A wrong brand on a product | about 15 products | The three Nordic Mist tonics move to `Nordic Mist` and lose "Mist" from the name. The snack under `Tasty` moves to `San Dimas`. Nestlé "Chocolate KitKat salted caramel" moves to `KitKat`. "Queso afinado curado G. Baquero" loses the maker from its name. The mousse under `Gourmet` moves to `Gourmet Revelations`. Read the frozen mini pizzas under `Fiesta` against their row. |
| A10 | A name that says "pack" | 103 products | Remove the word when the pack count or the size already says it. |
| A11 | The owner's brand decisions | section 1 | Apply only what the owner answered. |

**Stage B (after the named plan is merged and slot 1 runs that code)**

| # | Needs | Repair |
| --- | --- | --- |
| B1 | `0181` | Run Mercadona's `CATALOG_DISCOVERY` again for the same three Córdoba warehouses. 605 price rows on 197 products then carry the per kilo price. Import the same Deza leaflet document again: 21 offers get a price. |
| B2 | `0182` | Run Deza's `CATALOG_DISCOVERY` again. The 11,153 bound rows write their availability and a Deza offer with no price. |
| B3 | `0183` | After the new Mercadona run, every product sized `1 UNIT` (395) takes the size its row now carries. Then merge the pairs this uncovers (Evax pads at 1 and at 10). |
| B4 | `0185` | Accept the 11 Mercadona rows left as `CANDIDATE` for a second barcode (whole milk, semi skimmed milk, Coca-Cola 2 L, two butters and the rest) onto their products. |
| B5 | `0177` | Merge the products created twice in grams and in units (the Dolce Gusto boxes), which the report already lists. |

### Scope

- Work only on slot 1, through the gateway of slot 1. Scripts are job local and live in a
  new git ignored folder `.curation-runs/2026-10-audit-repair/`, with one answers file per
  step, as in October.
- In the repository, change only
  `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`: a new section "Repairs after
  the audit", corrected counts, and the corrected sentence about rows that "resolved by
  themselves".
- Do NOT touch: any cluster, slot 0, slot 3, the staging dumps, application code.

### Constraints

- **Back up first, every time.** Before each stage, `pg_dump -Fc` the catalog and harvester
  databases into the repair folder and check them with `pg_restore -l`.
- **No SQL writes.** Every change is an API call, so the audit trail records it. SQL is
  for reading.
- **Bring the slot up without a seed.** Until plan `0180` is merged in the checkout that
  serves the slot: `LUNA_REFERENCE_SEED=0 luna-slot.sh --up 1`. Stop with
  `--down --keep-data`. Never `--down` alone.
- **Sources stay as they are.** A new run needs `HARVEST_ENABLED` true and the source row
  enabled on slot 1 only. Mercadona stays limited to the three Córdoba warehouses.
- **A brand link moves products and cannot go two levels deep** (`brand_link_too_deep`).
  Read `movedItems` in every answer and write it to the log.
- **A product is deleted only when no queue row and no price names it**, which is what a
  merge leaves behind.
- A step a person must judge (A1, A5, A6 near pairs, A9) writes its proposal to a file
  first. Apply it after the owner, or the person running the work, read it.
- Do not decide a brand question from section 1 yourself.

### Action boundaries

Proceed with reads, backups, proposals and the repairs of A2, A3, A4, the exact pairs of
A6, A7 and A8. Stop and ask before A11, before any delete that is not the empty half of a
merge, and if a check in section 2 answers a count far from the one written here.

### Progress evidence

After each step, report the check of section 2 before and after, and the number of API
calls that succeeded and failed. End each stage with the new dump paths, their sizes and
the row counts of `items`, `brands`, `item_prices` and `source_catalog_entries`.

## 1. Brand questions for the owner

Nothing here is applied until it is answered. The proposal is the default this plan
recommends.

| Question | Evidence | Proposal |
| --- | --- | --- |
| Is a product name a brand? | `Black Label` (1), `White Label` (2), `Red Label` (0), `Invictus` (1), `Boss Bottled` (1) are registered beside `Johnnie Walker`, `Dewar's`, `Paco Rabanne`, `Hugo Boss` | No. Move the products to the house and keep the word in the name, as with Pantera Rosa. |
| How far does the line rule go? | Nike Man and Nivea Men were folded into the house. Still separate: Nike Woman (8), Nike Ultra Blue, Nivea Q10, Colgate Total (3), Oral-B 3D White, Pro-Expert and Pro-Flex, Vileda Turbo and Duactiva, Vanish Oxi Action, Nescafé Gold and Farmers Origins, Payot Homme, ClarinsMen, Puleva Max, Neutrex Transpirex, Norit Complet, Lenor Unstoppables | A word that names who it is for or a variant (Man, Woman, Men, Homme, Total, Gold, Q10) is a range and joins the house. A line with its own shelf identity stays: Kinder Bueno, Kinder Joy, Hero Baby, YoPro. |
| Which hair brand is `Nordic`? | 2 lightener products, "Blonde L1" and "Blonde M1" | Rename the brand to the line printed on the box after one look at the row. |
| Are these wine labels real? | `Cebolla` (2 Montilla finos), `409` (1 Ribera), `Frizz` ("Vino verdejo frizzante 5.5") | Hold them as the 11 unsure wineries of the report are held. |
| `Palette` and `Palette Intensive` | 5 and 30 products, one named "Tinte Intensive Age Care" under `Palette` | One brand, `Palette`. Intensive is a range word in the name. |
| `ProActiv` and `Flora` | "Margarina original" under `ProActiv`, "Margarina ProActiv sabor mantequilla" under `Flora` | `Flora ProActiv` is the line: one brand `ProActiv`. |
| `Excellence` | 12 L'Oréal dyes. El Jamón prints EXCELLENCE on Lindt chocolate, which went to `Lindt` | Keep. It is the homonym case of plan `0178`. |
| The label `Loreal` | 375 products | Rename the label to `L'Oréal` if the key stays `loreal`. |
| Licence names | Bluey, Mickey, Minnie, Paw Patrol, Stitch, Spider-Man and others hold products | Keep, until somebody shows a product whose maker matters. |
| 178 brands with no product | Mostly magazines, toys and stationery from the skipped Deza sections | Keep. Their rows are still in the queue. |

## 2. The checks

Each check is a read on the catalog database, or on the catalog joined with the harvester
queue. It answers the count written, measured on 2026-10-03, and 0 after its repair
unless the plan says some rows stay.

```sql
-- A1: no English name
select count(*) from items where coalesce(name->>'en','') = '';                    -- 100

-- A2: a pack count beside a dimension in the name
select count(*) from items
 where "packCount" is not null and name->>'es' ~ '\d+\s?x\s?\d+([.,]\d+)?\s?(cm|mm|m)\M';  -- 9

-- A3: units
select "defaultUnit", count(*) from items
 where "defaultUnit" = 'LITER' or ("defaultUnit" = 'KILOGRAM' and "unitSize" is not null)
 group by 1;                                                                       -- 174, 25

-- A4: codes that are not a barcode
select count(*) filter (where ean ~ '^2') in_store,
       count(*) filter (where length(ean) not in (8, 13, 14)) odd_length
  from items where ean is not null;                                                -- 211, 5

-- A6: the same brand, name, size and unit twice
select count(*) from (
  select 1 from items
   group by "brandId", lower(name->>'es'), "unitSize", "defaultUnit", "packCount"
  having count(*) > 1) t;                                                          -- 21

-- A10: names that say pack
select count(*) from items where name->>'es' ~* '\mpack\M';                        -- 103

-- B1: a product sold by the kilo whose price is not its per kilo price
select count(*) from item_prices p join items i on i.id = p."itemId"
 where i."defaultUnit" = 'KILOGRAM' and i."unitSize" is null
   and (p.price is null or p.price <> round(p."unitPrice", 2));                    -- 605 + 21 + 54 (LIDL stays)

-- B2: products a Deza website row is bound to, with no row in any Deza scope
--     (join source_catalog_entries on "itemId", status ACTIVE, sourceKind OFFICIAL_WEB)
--                                                                                    11,061 of 11,140

-- B3: a size of one
select count(*) from items where "defaultUnit" = 'UNIT' and "unitSize" = 1;        -- 417

-- B4: rows still waiting for a second barcode
--     harvester: select count(*) from source_catalog_entries where status = 'CANDIDATE';   27
```

A5, A7, A8 and A9 have no count that reaches 0. Their evidence is the list the step
writes: every row read, what was changed and why, what was left and why.

## 3. What stays wrong after this plan

- 3,974 queue rows wait for a person, as the report says. Plan `0179` unblocks about 1,400.
- LIDL's 54 per kilo rows carry no unit price, because LIDL sends none.
- Names of one line still differ between chains ("Coloración permanente Creme 7 rubio"
  from Mercadona, "Tinte 7.3 rubio dorado" from Deza). A rule for it belongs in the
  curation prompt, and nobody decided one.
- Deza products have no price. Deza prints none.
