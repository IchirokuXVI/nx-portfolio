# 0019 (backlog) Local curation merges into a cluster that also changed

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-10-03. The first catalog reaches both clusters as a whole database restore
> (k8s plan `0012`), and after that production harvests and curates by itself. The owner
> wants to keep one more road open: take a copy of a cluster, curate on the local machine,
> and bring that work back, while the cluster went on changing. This plan is that road. It
> is built when the owner needs it.
>
> Prerequisite reading: k8s plans `0011` and `0012`,
> `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`, plans `0080` (prices side by
> side), `0083` (a chain is a row), `0086` (the queue), `0115` and `0124` (brands and
> links), the entities under `catalog/src/app/entities` and `harvester/src/app/entities`,
> and `k8s/catalog-reset/cleanup-core-catalog-refs.sh` (every column in core that names a
> catalog id).

## Brief for the agent

### Objective

Build a tool that turns the difference between a snapshot of a cluster and the local copy
that was curated from it into a change set, and applies that change set to the cluster
only if nothing it touches changed there in a different way. One conflict stops the whole
move, and the cluster is left as it was.

### Context

Decisions the owner made on 2026-10-03. Do not reopen them:

1. Curation can happen on staging, on production and locally. No place is read only.
2. Prices travel with the products.
3. A row that changed on both sides **to the same result** passes. A row that changed on
   both sides to different results stops everything.
4. A product is never deleted by a move. It is added, edited, or merged into another
   product. A merge is allowed because it is marked as one: the merged row stays and names
   its survivor (backlog plan `0020`, which this plan needs first).
5. No duplicate of anything: EANs, shops, brands, chains, scopes, queue rows.
6. The queue ("suggested products") must stay linked: a queue row that is new locally is
   added, and one that differs is edited.

Facts about the data that decide the design, read from the code on 2026-10-03:

- **A product has no "approved" state.** `items` has no status column. The curation state
  is `source_catalog_entries.status` in the harvester database (`ACTIVE`, `CANDIDATE`,
  `UNRESOLVED`, `REJECTED`), with `itemId`, `matchedBy` and `decidedAt`. "Curated on both
  sides" therefore means: one queue row, decided in the cluster and decided locally since
  the snapshot.
- **Only the id identifies most products.** `uq_items_ean` makes an EAN unique, but 15,601
  of the 19,791 products of the first catalog have none, and nothing is unique on name,
  brand and size.
- **Every primary key is a random uuid**, except the categories (derived from the slug).
  So a row that is created on both sides after the snapshot has two ids.
- **What the database enforces:** brands by `key`, price scopes by
  `(supermarketId, kind, externalKey)`, chains by `externalBrandKey` when it is not null,
  shops by `externalRef` when it is not null, queue rows by `(supermarketId, externalId)`,
  categories and product groups by `slug`. A shop entered by hand and a chain with no
  Wikidata key have no rule at all. The service finds a shop again by "same chain within
  50 m".
- **`item_prices` has no unique key**, by design (plan `0080`). A price row names the
  harvest run that wrote it (`sourceRunId`, `lastObservedRunId`).
- **Core names catalog ids with no foreign key**, and so do phones in their caches.
- **There is no road to a cluster's Postgres from outside.** Everything runs on the VPS as
  `deploy`, through `kubectl exec ... psql`.

### Target state

1. `snapshot`: one command takes the base, which is a dump of a cluster's catalog and
   harvester databases plus a manifest (section 1).
2. `changeset`: one command compares the local databases with the base and writes a change
   set, or refuses and says why (sections 2 and 3).
3. `apply`: one script on the VPS runs the change set against the cluster, as a dry run by
   default (section 4).
4. A rehearsal recipe that runs `apply` on a local restore of a fresh dump of the cluster
   (section 5).
5. Specs that cover every row of the two tables in sections 2 and 3 against real Postgres.

### Scope

- Work only in: a new framework free library `libs/luna-shopper/tools/catalog-merge`
  (the comparison and the change set, with its specs), `k8s/catalog-import/` (the apply
  script and its README, beside the restore of k8s plan `0012`), and
  `apps/luna-shopper-backend/docs/` (one page that explains the procedure).
- Do NOT touch: any entity, any migration, any service route, core, the release tasks.
  Section 7 names the two places where that can turn out to be needed. Stop there.

### Constraints

- The library has no TypeORM, no Nest and no network, as the chain libraries have. It reads
  two Postgres connections and writes files.
- The apply step is SQL run by `psql`, through the `CATALOG_PSQL` and `HARVESTER_PSQL`
  overrides that the scripts in `k8s/catalog-reset/` use.
- Never match two products by name. A name match is a report for a person
  (`catalog-product-merge-rules`, and plan `0081`: no automated match binds a printed name
  to a product).
- Only make the changes this plan names.

### Action boundaries

- Proceed with the library, the specs and local rehearsals on copies of dumps.
- **Stop and ask** when section 7 applies, before any change to a service or a schema.
- Never run `apply` or `kubectl` against staging or production. The owner runs it.

### Progress evidence

Report each acceptance criterion in section 6 with the command and its output.

## 1. Three states, not two

A comparison of the local copy with the cluster cannot tell "I changed this" from "they
changed this". The tool therefore keeps the state both started from.

- **Base (B):** the cluster at the moment of the snapshot. `snapshot` writes
  `catalog.dump`, `harvester.dump` and `base.manifest` (the cluster, the UTC time, and the
  names of both `migrations` tables in order) into one folder. The local slot is then
  restored from those files, started with `LUNA_REFERENCE_SEED=0`.
- **Local (L):** the slot after the work.
- **Cluster (P):** the cluster at the moment of the apply.

`changeset` restores B into two scratch databases and compares L with them. `apply`
compares P with what the change set says B held. The base folder must be kept until the
move is done. A lost base cannot be rebuilt from `updatedAt`, because a write in raw SQL
does not set it.

## 2. What identifies a row

| Table | Identity across databases | A local row with a new id whose key the cluster already holds |
| --- | --- | --- |
| `items` | id | conflict when the EAN is equal. Otherwise see "possible duplicates" below |
| `product_groups` | id | conflict on `slug` |
| `supermarkets` | id | conflict on `externalBrandKey` |
| `price_scopes` | id | conflict on `(supermarketId, kind, externalKey)` |
| `supermarket_locations` | id | conflict on `externalRef`, and on "same chain within 50 m" |
| `categories` | id (derived from the slug) | cannot happen |
| `brands` | **`key`** | the cluster's id wins, and `items.brandId` and `canonicalBrandId` are rewritten to it |
| `source_catalog_entries` | **`(supermarketId, externalId)`** | the cluster's id wins, and `candidateEntryId` and `source_entry_prices.entryId` are rewritten to it |
| `source_entry_prices` | `(entry, priceScopeId)` | follows its entry |
| `source_locations`, `discovered_places` | their unique key | the cluster's id wins |
| `harvest_runs` | id | cannot collide |
| `item_prices`, `item_price_details` | id | cannot collide |

Brands and queue rows are identified by their key, because both sides create them in the
normal course of work: a person registers the same brand twice, and two harvests of one
chain read the same product. A different id there is expected and is not a conflict.

**Possible duplicates.** A product with no EAN that is new locally is compared with the
products that are new in the cluster since the base, on the normalized name, the brand
key, `unitSize`, `defaultUnit` and the pack count. An equal pair is a conflict. The owner
answers it in `resolutions.jsonl` with one of two lines: "these are two products", or "use
the cluster's id for my local id". The second one makes every local reference to that
product follow the cluster's row.

## 3. What a difference becomes

For each row, on the columns that the local work changed since the base:

| Local since base | Cluster since base | Result |
| --- | --- | --- |
| new row | no such row | insert |
| changed | unchanged | update |
| changed | changed to the same values | pass, nothing to write |
| changed | changed to other values | **conflict** |
| changed | row is gone | **conflict** |
| unchanged | anything | nothing: the cluster's row stays |
| row is gone | anything | see "deletes" |

The owner's own example is one line of this table: a queue row that was `UNRESOLVED` in
the base, that the cluster bound to a product and that the local work also bound. The
same `status` and the same `itemId` (after the rewrites of section 2) pass. Anything else
is a conflict.

**Deletes.** A row that the local work removed is never removed from the cluster, with
three exceptions that hold no identity of their own: `item_categories`,
`supermarket_item_sections` and `section_categories` follow their owner as a set (the set
is replaced when the cluster's set still equals the base). A local row that is gone from
any other table makes `changeset` refuse, and it names the row.

**Merges.** A product that was merged locally is not gone. Its row is still there, with
`mergedIntoId` set (backlog plan `0020`), so the comparison sees an edit and nothing flags
it. The change set carries it as one change of its own kind, `merge`, and the apply does
what the service does: it moves the cluster's prices of the merged product to the
survivor, moves the EAN, sets `mergedIntoId`, and rewrites `source_catalog_entries.itemId`.
Core needs no write, because a read by the old id answers the survivor. The rules of the
table above hold for it:

- The cluster merged the same product into the same survivor: pass.
- The cluster merged it into another product, or edited it since the base: conflict.
- The survivor is itself merged in the cluster: conflict.

A product that the base held and that the local work removed with no mark is still a
refusal. That is the case the mark exists to tell apart.

**Prices.** `item_prices` and `item_price_details` rows that the cluster does not hold are
inserted by id, with the `harvest_runs` rows they name. Nothing in the cluster is
overwritten: plan `0080` keeps every source's price side by side and decides on read. A
local price can be older than the cluster's own, and it then loses on read by itself.
`supermarket_items` is derived and is never copied. The catalog service recomputes it
(`recomputeEffectivePrices`, and the sixty second sweep).

**Never copied:** `catalog_audit` (it names local actors), `supermarket_sources.enabled`
(a cluster decides by itself which chain it fetches), `price_policies`,
`postal_code_points`, `shop_walks`, harvest presets and uploaded leaflets, and every
derived table.

## 4. Apply

`changeset` writes two SQL files, one per database, and `changeset.manifest` (the base it
was built from, the counts per table and kind, and the SHA-256 of both files). Each
statement carries its own guard: it changes the row only when the row holds the base
values or already holds the new ones, and the file raises an exception and names the row
when a statement finds anything else.

`k8s/catalog-import/apply-catalog-changeset.sh`, on the VPS:

1. Refuse unless both `migrations` tables of the cluster equal the ones in the manifest.
   Local work on newer code waits for the deploy that brings the cluster to it.
2. Dump catalog and harvester through their backup CronJobs, as the release task runner
   does.
3. Stop the harvester (scale to zero). It is the only writer that holds one decision in
   two databases at the same time. The catalog stays up, and shoppers keep reading.
4. Open one transaction on each database. Run the catalog file, then the harvester file.
   Every guard runs inside the transaction that writes, so an admin who edits a row in the
   back office during the apply either commits first and is seen as a conflict, or waits.
5. **Dry run (the default):** roll both back, and print every conflict and the counts.
   **`--apply`:** commit the harvester, then the catalog, back to back. Two databases share
   no transaction, so a failure of the second commit is reverted from the dumps of step 2.
6. Start the harvester. Read back the counts.

A dry run that reports conflicts is the normal first result. The owner resolves each one
locally (take a new snapshot for those rows, or write a resolution), builds the change set
again and runs the dry run again.

## 5. Where it is rehearsed

A change set fits one cluster at one moment, because it is built against that cluster's
base. So staging cannot rehearse a move to production, unless staging was restored from
the same production dump first.

The rehearsal that is always possible: take a fresh dump of the cluster, restore it into
two scratch containers on the local machine, and run `apply-catalog-changeset.sh` against
them through the `CATALOG_PSQL` and `HARVESTER_PSQL` overrides. That finds every conflict
the cluster holds at that moment, with no risk. The dry run on the cluster then covers the
hours in between.

## 6. Acceptance criteria

- [ ] An integration spec per row of the table in section 3, on two real Postgres
      databases, including the "same values on both sides" pass.
- [ ] A spec per row of the table in section 2: an EAN that both sides created refuses, a
      brand key that both sides registered rewrites `items.brandId`, a queue row that both
      harvests read rewrites `candidateEntryId`.
- [ ] A change set with one conflict among 1,000 changes leaves both databases byte
      identical to before (compare `pg_dump --data-only` output).
- [ ] `changeset` refuses a local database in which a product of the base is gone.
- [ ] A product that was merged locally (plan `0020`) applies as a merge: the cluster's
      copy keeps its row, names the survivor, and the survivor holds the prices of both.
- [ ] The same merge already made in the cluster passes, and a merge into another
      survivor stops the move.
- [ ] A dry run writes nothing: the same comparison passes.
- [ ] A round trip on the first catalog: snapshot, change 50 products and decide 50 queue
      rows locally, apply to a copy of the base, and the copy equals the local databases
      on every copied table.
- [ ] No row of `catalog_audit`, `supermarket_sources` or a derived table is in the files.

## 7. Open questions that can widen this plan

Stop and ask the owner when the work reaches one of these. Do not decide them.

1. **A local merge that was made before plan `0020` existed.** Such a product is gone
   with no mark, and the tool refuses it. The owner can declare it in `resolutions.jsonl`
   ("this id was merged into that id"), and `changeset` then writes it as a `merge`. The
   six pairs of October need nothing: they were merged before the first catalog reached a
   cluster.
2. **What the service derives on a write.** A write in SQL skips the service. Before you
   write the first statement, read how the search documents of `items`
   (`NormalizedItemSearch`, `StricterCatalogSearch`) and `supermarket_location_items` are
   kept. Generated columns and triggers need nothing. A value that only application code
   writes needs a way to compute it again after the apply, and that is a change to the
   catalog service that this plan does not hold.
3. **The audit trail.** The apply writes no `catalog_audit` row today, so an edit that
   arrives this way has no author in the back office. If the owner wants one, the actor
   must be an account that exists in the cluster's auth database.
