# 0001 A file of product edits, applied through the admin API

Part of the curation toolchain: `curation-auth` (sessions), `curation-suggestions` and
`curation-groups` (the deciders), `curation-cli` (the orchestrator). This plan adds a
fourth library, `curation-edits`, for a kind of work the toolchain cannot do today: take
a list of corrections to products that already exist (a new name, a brand, a size, a
category list, a split, a merge) and write it to a catalog through the admin API, with
the checks of backend plans `0186` and `0192` built in rather than typed again.

> **The occasion.** The catalog audit of 2026-10-27 read the 22,203 products of
> production and kept 879 proposals over 1,097 of them. Its findings are in the artifact
> "Velista Catalog Audit", and the analysis of how they can reach production is the
> artifact "Velista Audit Import". That analysis found no tool in the repository that
> applies such a file: the repairs of October and of plans `0186` and `0192` were done by
> job local scripts in the git ignored `.curation-runs/`, and the production catalog
> itself was shipped as whole database dumps (release task `0003`), a road that is closed
> now that production holds products and harvests of its own.
>
> Prerequisite reading: backend plans `0186` and `0192` (the method, and the rules that
> each check comes from), `0191` (what an accept does to the product a row leaves),
> `0183` (the unit rules the service does not enforce), `0184` (what a created product
> must carry), backlog `0020` (why a merge by delete is unsafe in a cluster with
> shoppers), the register `apps/luna-shopper-backend/docs/first-catalog-decisions-2026-10/README.md`
> (the data file format and rules R1 to R33), `libs/luna-shopper/tools/curation/cli/README.md`
> and `cli/src/apply.mjs` (the part splitter), `auth/src/session.mjs` (the admin session),
> and `gateway/src/app/catalog/catalog.dto.ts` (`UpdateItemDto`, `CreateItemDto`).

## Brief for the agent

### Objective

Build `libs/luna-shopper/tools/curation/edits`, Nx project `luna-shopper/curation-edits`:
a converter that turns the audit artifact into a decision file in the register's format,
and an applier with three commands, `convert`, `plan` and `apply`, that writes that file
to a gateway as a named operator, leaves every product that the file cannot be sure of,
and logs each call. Both are framework free `.mjs` with zero npm dependencies, as the
other curation libraries are.

### Context

- **What the audit file is.** A JSON object with `summary` and `proposals`. Each proposal
  has `fid`, `kind` (`RENAME`, `RECATEGORIZE`, `SIZE`, `BRAND`, `SPLIT`, `DUPLICATE`,
  `OTHER`), `verdict` (`ACCEPT`, `AMEND`, `UNVERIFIED`), `confidence`, a `change` object,
  the prose `reason` and `check`, and `rows`: the products as the audit read them, each
  with `id`, `nameEs`, `nameEn`, `brand`, `size`, `unit`, `pack`, `categories` (slugs)
  and `prices` (one figure per chain). The ids are production ids. The seven shapes of
  `change`, and every irregularity the converter has to absorb, are in section 2.
- **What the gateway offers.** One batch route for every field edit,
  `PATCH /v1/admin/catalog/items/batch`, at most 1,000 entries and 2 MB in one call, all
  or nothing. `POST /v1/admin/catalog/items/batch` creates products the same way. There is
  no merge and no split. A merge is the two step procedure of plan `0192`:
  `POST /v1/admin/harvest/entries/:id/accept` for each queue row of the product that goes,
  then `DELETE /v1/admin/catalog/items/:id`. The routes are listed in section 3.
- **What catalog does not check.** A sized `KILOGRAM`, a `LITER`, a `UNIT` with a size, a
  name that makes two products equal, a brand the registry does not hold (it is stored as
  free text with `brandId` null and nothing says so). Each of these is a rule of the
  register that the applier enforces itself. A name patch replaces the whole name, so a
  patch that sends one language deletes the other (rule R17). Category changes are not
  written to `catalog_audit`.
- **What the toolchain already has.** `createAdminSession` in `curation-auth` signs in,
  sends a bearer token and signs in once more on a 401. `splitDecisions` and `partPath` in
  `cli/src/apply.mjs` cut a file into parts under a cap and keep a ref with the rows that
  name it. The run directory convention (`.curation-runs/<run>/`, one `jsonl` of answers
  per step, a `report.json`) is the one every plan since `0186` used.
- **What a production run needs that this plan does not give.** A data change in a cluster
  is its own plan in `apps/luna-shopper-backend/plans/`, as `0186` and `0192` were, with
  the owner's answers to the questions in section 7. This plan builds the tool and
  rehearses it on a local slot. It writes to no cluster.

### Target state

1. The library exists with `lint` and `test` targets, a `README.md` that a person can run
   from, and specs under `node --test` for every rule in sections 2 to 4.
2. `convert` reads the audit (the saved artifact HTML, or its `DATA` object as JSON) and
   writes `edits.json` in the register's format (section 1), one entry per product, with
   every proposal of that product folded into one decision and every irregularity of
   section 2 resolved or recorded as `left`.
3. `plan` reads the target gateway and writes `plan.json` and `plan.md`: for each entry,
   whether the product still is what the audit saw, which batch it goes in, or why it is
   left. It writes nothing to the gateway.
4. `apply` sends the plan in batches, in the order of section 3, one `jsonl` line per call
   with its body and its answer, and stops at the first refusal. A second `apply` on the
   same run directory resumes after the last answered call.
5. A merge is sent only with `--merge-by-delete`, which is the owner's written acceptance
   of what section 4 says a delete costs in a cluster with shoppers.
6. The password is never a command line argument.

### Scope

- Work only in `libs/luna-shopper/tools/curation/edits/` (new) and, for the one shared
  function section 3.4 names, `libs/luna-shopper/tools/curation/cli/src/apply.mjs`.
- Add the project to nothing else: no `tsconfig.base.json` alias (plain `.mjs`), no
  change to `curation-cli` commands, no change to any service, route, DTO or migration.
- Do NOT touch: `apps/luna-shopper-backend/*`, the register and its data files, the
  release tasks, `k8s/`, any cluster, slot 0.

### Constraints

- Zero npm dependencies, ESM `.mjs`, Node's own test runner, `eslint.config.mjs` as the
  sibling libraries have. Copy the `project.json` of `curation-auth` and rename.
- **Every write is a gateway call.** No SQL, no NATS, no database. The library reads two
  things outside the gateway: the audit file and its own run directory.
- **Nothing is sent that was not read first.** `apply` sends a product only after a read
  of it in this same run answered the `expect` of its entry (section 3.2).
- **Stay under the gateway's limits by design, not by luck.** At most 1,000 entries and
  2 MB per batch (`DEFAULT_BULK_DECISION_MAX_BYTES`); at most 100 requests a minute (the
  bucket is 120); sign in again when the token is 8 minutes old (it lasts 15); at most
  one login attempt per 15 seconds (the login bucket is 5 a minute).
- **The password comes from `CURATION_ADMIN_PASSWORD` or a prompt** when stdin is a
  terminal. A `--main-password` flag is refused with a message that names the variable.
  `createAdminSession` takes the password as an option, so nothing in `curation-auth`
  changes.
- Do not decide a question of section 7 in code. Each one is a `left` with a reason
  code, until the owner's data plan answers it.

### Action boundaries

- Proceed with the library, its specs, and rehearsals on a local slot (never slot 0).
- Stop and ask before any change to `cli/src/apply.mjs` beyond the extraction section
  3.4 names, and before adding any dependency.
- Never run `apply` against a gateway whose host is not `localhost`. The owner runs that,
  under the data plan.

### Progress evidence

Report each acceptance criterion of section 6 with the command and its output, and one
rehearsal on a local slot: the counts of `plan.md`, the number of calls `apply` made, and
the `items`, `item_categories` and `catalog_audit` counts of the slot before and after.

## 1. The decision file

One file, `edits.json`, in the shape of the register's data files, so that it can sit in
`docs/first-catalog-decisions-2026-10/` as the next data file when the owner's plan ships
it. A header, then `entries`, one per product, one entry on one line.

```json
{
  "step": "F01",
  "title": "The catalog audit of 2026-10-27",
  "sources": ["claude.ai/artifact/5aJAxXifLNVhjb5tfrG4rh"],
  "keys": "Each product is keyed as the audit read it on 2026-10-27. `id` is its production id.",
  "verdictsIncluded": ["ACCEPT", "AMEND"],
  "counts": { "entries": 0, "edit": 0, "split": 0, "merge": 0, "left": 0 },
  "entries": [
    {
      "product": { "brand": "Alteza", "nameEs": "Yogur 0% 0% con trozos de melocotón",
                   "size": 500, "unit": "GRAM", "packCount": 4, "barcode": null,
                   "id": "4e01712e-7879-4d63-9217-ac10d937374b" },
      "expect": { "nameEn": "0% 0% yoghurt with peach pieces",
                  "categories": ["flavoured-and-fruit-yoghurts"] },
      "decision": { "action": "edit",
                    "name": { "es": "Yogur 0% con trozos de melocotón",
                              "en": "0% yoghurt with peach pieces" } },
      "from": [398], "confidence": 0.93, "status": "pending"
    }
  ]
}
```

- `product` holds the natural keys the register uses (brand, Spanish name, size, unit,
  pack count, barcode) and the id. `expect` holds the rest of what the audit saw: the
  English name and the category slugs. Together they are the whole state the audit read,
  and `plan` compares every field of both against the gateway.
- `decision.action` is one of:
  - `edit`: any of `name` (always both languages), `brand` (a label or null),
    `unitSize`, `defaultUnit`, `packCount`, `categories` (slugs, the whole list in order).
    The field names are those of `UpdateItemDto`, so the applier maps nothing but slugs.
  - `split`: `variants`, a list of `{ nameEs, nameEn }`, and `keeps`, the index of the
    variant that keeps the original id, its queue row and its price.
  - `merge`: `into`, the id of the survivor, and `why` naming the rule that chose it.
  - `left`: `reason`, one of the codes of section 2.3, and the text of the audit.
- `from` lists the `fid` of each proposal folded into the entry. `confidence` is the
  lowest of them. `status` is `pending` when written and is never edited by hand; `plan`
  and `apply` write their own files.
- A product that a `split` creates is not an entry. It is in the `variants` of its
  original.

## 2. The converter

`convert --audit <file> [--verdicts ACCEPT,AMEND] [--out <dir>]`. The input is the saved
artifact HTML (the converter takes the one `const DATA = {...};` statement out of it) or
a JSON file that holds the same object. It writes `edits.json` and `convert-report.md`.

### 2.1 Folding

- One entry per product id. Every proposal of that id, over every kind, contributes its
  `change` to one `edit`. A `SPLIT` and a `DUPLICATE` do not fold: a product that is in a
  split or a merge and also in an edit is `left` with `MIXED_WITH_STRUCTURAL`.
- Two proposals that give one field two values make the entry `left` with `CONFLICT` and
  both values in the text. The audit has ten, all category lists. No rule in code picks
  one.
- A proposal with several rows applies its `change` to each row, as the audit means it.
  A proposal whose `check` text narrows the rows ("row 1 only", "apply as a rename on
  row 1") cannot be read by a program: its rows are `left` with `CHECK_NARROWS_ROWS`.
  There are three.
- `UNVERIFIED` proposals are out unless `--verdicts` names them. `OTHER` proposals are
  always `left` with `OTHER`.

### 2.2 Normalizing

Each rule below is one case the audit data holds, and each has a spec that uses that
case by its `fid`.

| Rule | What the audit sends | What the file holds | Why |
| --- | --- | --- | --- |
| Both languages | `nameEs` alone (76) or `nameEn` alone (123) | `name: { es, en }`, the missing half from the row | R17: a name patch replaces the whole name |
| KILOGRAM has no size | `unit: "KILOGRAM"` with the row's size kept (20) | `defaultUnit: "KILOGRAM", unitSize: null` | R9, `toBaseUnit` of plan `0183` |
| A sized kilogram is grams | `size: 5, unit: "KILOGRAM"` (fid 1947) | `unitSize: 5000, defaultUnit: "GRAM"` | the same |
| No LITER, no PACK | none in the audit; refused if met | the file is refused | `0183` |
| Pack 0 is no pack | `pack: 0` (fids 376, 377, 554) | `packCount: null` | `PACK_COUNT_MIN` is 2 |
| Pack 1 is no pack | none in the audit; mapped if met | `packCount: null` | the same |
| "(none)" is no brand | `brand: "(none)"` (fid 1375) | `brand: null` | the DTO takes null |
| Slugs stay slugs | `categories: [...]` | `categories: [...]` | the id lookup is the applier's, against the tree it reads |
| A name is at most 200 characters, non blank | | the file is refused on a longer one | `LOCALIZED_TEXT_MAX_LENGTH` |

### 2.3 Reason codes of a `left` entry

`CONFLICT`, `CHECK_NARROWS_ROWS`, `MIXED_WITH_STRUCTURAL`, `OTHER`, `UNVERIFIED`,
`MERGE_FORMAT_DIFFERS` (fid 1030: 80 ml against 300 ml, two products by rule 1 of the
curation prompt), `MERGE_TWO_ARTICLES_ONE_CHAIN` (fid 1605: a Mercadona row on each side,
rule R28). The applier adds its own in section 3.3. Every code is a line in the README.

### 2.4 Merges and splits in the file

- A `DUPLICATE` names no survivor in `change`; the prose does. The converter applies
  rule R25: the survivor is the row that holds a barcode, else the row that holds a
  price, else the first row, and `why` says which rule fired. When both rows hold a price
  from the same chain, the entry is `left` with `MERGE_TWO_ARTICLES_ONE_CHAIN`. When the
  sizes or units differ, `MERGE_FORMAT_DIFFERS`.
- A `SPLIT` keeps the original id on the first variant (`keeps: 0`), because the audit
  lists the variants in the order of the name. The owner can change `keeps` in the data
  plan; the converter never guesses which variant the chain's row is.

### 2.5 The report

`convert-report.md` gives the counts of the header, the number of proposals of each kind
and verdict that went in, every `left` entry grouped by reason with its audit text, the
brand labels that appear as a target (the audit has 60; forty appear nowhere as a
current brand) for the owner to read against the registry, and the product ids that
appear in more than one proposal (65) with how they were folded.

## 3. The applier

Both commands take `--main-url` (no default: a URL is required), `--main-user`, and the
password from `CURATION_ADMIN_PASSWORD` or a prompt. Both write into `--run-dir`, default
`.curation-runs/edits-<timestamp>/`, and both refuse a run directory whose
`edits-run.json` names another gateway or another file.

### 3.1 What `plan` reads, once per run

- `GET /v1/admin/auth/me`: who the operator is and which `environment` the gateway
  serves. Both go in `edits-run.json` and at the top of `plan.md`.
- `GET /v1/catalog/categories`: the tree. Every slug of the file must be a leaf of it.
  A slug that is not refuses the whole plan before any product is read: the file is
  wrong, not the product.
- `GET /v1/admin/catalog/brands`, paged to the end: the registry, as `brands.json`, as
  the suggestions decider keeps it. A brand label of the file is keyed with `brandKey`
  (copy the function as `rules.mjs` of the suggestions library does, held together by the
  same `brand-key.cases.json`) and looked up. A label whose key the registry lacks leaves
  its entry with `BRAND_UNREGISTERED`. A label whose key is a spelling (`canonicalBrandId`
  set) is written as the canonical label, and the plan says so, because that is what
  catalog would store anyway.

### 3.2 What `plan` reads per entry

- `GET /v1/admin/catalog/items/:id`. The answer's `name`, `brand`, `unitSize`,
  `defaultUnit`, `packCount`, `ean` and `categories[].slug` are compared with `product`
  and `expect`. Any difference leaves the entry with `CHANGED_SINCE_AUDIT` and both
  values in `plan.md`. A 404 leaves it with `GONE`.
- For an edit that sets `KILOGRAM`: `GET /v1/admin/harvest/items/:id/entries`. If any
  bound row says `soldByWeight` false and prints a fixed `sizeFormat`, the entry is left
  with `ROW_CONTRADICTS`. This is rules R31 and R32: a size the price implies is not
  proof, and a printed size wins.
- For a merge: the queue rows of both products and `GET /v1/admin/catalog/items/:id/prices`
  of both. The plan writes the rows that will move and the price rows of the loser that
  rule R1 needs to find on the survivor after the accepts.
- Check A6 in memory, over every entry of the plan that is not left: after the edits,
  no two products of the plan are equal in brand key, lower cased Spanish name, size,
  unit and pack count, and no product of the plan equals a product the gateway answers
  for `GET /v1/admin/catalog/items?query=<the new name>`. A collision leaves both with
  `NAME_COLLISION`.
- The reads are paced at 100 a minute. About 1,100 products is about twelve minutes; the
  plan prints progress as the CLI does, `n/total - name`.

### 3.3 What `plan` writes

- `plan.json`: every entry with its read (`seen`), its outcome (`batch <n>` or `left`
  with a code), and for an edit the exact batch entry that `apply` will send, with
  `categoryIds` already resolved. `plan.md`: the counts, the batches with their sizes
  in entries and bytes, and every `left` entry grouped by code.
- The reason codes of the applier: `CHANGED_SINCE_AUDIT`, `GONE`, `BRAND_UNREGISTERED`,
  `ROW_CONTRADICTS`, `NAME_COLLISION`, `HELD_MERGE` (a merge in a plan made without
  `--merge-by-delete`), `EAN_HELD` (a split or merge that would need a barcode to move
  and the move was refused with 409).
- A plan older than 24 hours is refused by `apply`, because `plan` is the read that
  `apply` relies on. `apply` also repeats the read of 3.2 for each entry just before its
  batch and leaves a product that changed in the meantime (the batch is sent without it
  and the entry is written to `apply-left.jsonl`).

### 3.4 What `apply` sends, in this order

1. **Edits**, in `PATCH /v1/admin/catalog/items/batch` calls. The parts are cut with the
   splitter of `cli/src/apply.mjs`, which this plan generalizes: `splitDecisions` today
   reads `itemRef`, `groupRef`, `ref` and `decision` off each record; extract the walk of
   units into a function that takes `unitOf(record)` and `refOf(record)`, so that both
   callers share the cap logic and the suggestions and groups behaviour does not change.
   This library adds the byte cap: a part is cut when its JSON would pass 1.9 MB as well
   as when it would pass 1,000 entries.
2. **Splits**, one at a time: `POST /v1/admin/catalog/items/batch` with the new variants
   (each with `name`, `brand`, `unitSize`, `defaultUnit`, `packCount` and `categoryIds`
   copied from the original), then one `PATCH` entry that renames the original to the
   variant it keeps. The ids the create answers are logged beside the variants.
3. **Merges**, one pair at a time, only with `--merge-by-delete` (section 4).

Every call is one line of `logs/<step>.answers.jsonl`: the time, the method and path, the
body, the status and the answer. A refused batch stops the run with the answer printed
and the command to resume. A 504 is handled as `cli/README.md` says: wait, then send the
same part again; a part that landed is refused because its products no longer match
their `expect`, and that refusal writes nothing.

`apply --resume <run dir>` reads the logs and continues from the first call that has no
200 answer. It does not re-plan.

### 3.5 What `apply` writes at the end

`apply-report.md`: calls made and refused, entries written per action, entries left per
code, and the three counts the register asks for after a stage: `items`, products whose
name changed, products whose categories changed, as read back through the gateway
(`GET /v1/admin/catalog/items/:id` for every entry of the plan, paced).

## 4. Merges, and why they wait for a flag

The procedure, for each `merge` entry, is the one of plan `0192` and rules R1, R15 and R25:

1. `GET /v1/admin/harvest/items/:loser/entries`. For each bound row,
   `POST /v1/admin/harvest/entries/:id/accept { itemId: survivor }`. Under plan `0191`
   the accept rebinds the row, writes its open prices on the survivor, moves the
   barcode the row taught, and settles the loser.
2. Read both products. Each price row of the loser that the plan recorded must now be on
   the survivor with the same source kind, scope, price, unit price and validity (R1). A
   row that is not leaves the pair with `MERGE_PRICE_LEFT` and the loser is **not**
   deleted.
3. A barcode still on the loser and not on the survivor: `DELETE /v1/admin/catalog/items/:loser/eans/:ean`,
   then `POST /v1/admin/catalog/items/:survivor/eans { ean }`. A 409 leaves the pair with
   `EAN_HELD`.
4. `DELETE /v1/admin/catalog/items/:loser`.
5. Read again: the loser answers 404, and `GET /v1/admin/harvest/items/:loser/entries`
   answers no row.

**Why the flag.** `ItemService.delete` is a hard delete with no event. Core names a product
in `list_line_items.itemId`, `list_lines.favoriteItemId`, `list_line_group_removals.itemId`
and `line_settlements.itemId` with no foreign key, and `getMany` leaves a missing id out
of its answer, so a shopper's line loses its product and nobody is told. On slot 1 that
cost nothing. In production it is a loss on every list that holds one of the fourteen
products. Backlog plan `0020` (`items.mergedIntoId`, a `merge` message, a
`catalog.item.merged` event that core rewrites from) is the designed answer and is not
built. Until it is, a merge by delete is the owner's decision, and `--merge-by-delete` is
how the owner states it to the tool. A plan made without the flag lists every merge
under `HELD_MERGE` with the rows and prices it would move, which is the reading the
owner needs to decide.

When plan `0020` is built, section 3.4 step 3 becomes one call of its merge route per
pair, and the flag goes.

## 5. Rehearsal

Before the owner's data plan runs anything against staging, the tool is rehearsed on a
local slot that holds a copy of production's catalog and harvester, taken from the
nightly dumps in the bucket of the cluster. The recipe goes in the README, and the parts
marked **not confirmed** are checked during this plan and corrected there.

1. Take a slot that is not 0: `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up <n> --services gateway,auth,catalog,harvester`,
   then `--down --keep-data`, so the four database containers exist and nothing writes.
2. `docker start luna-slot<n>-catalog-db-1 luna-slot<n>-harvester-db-1`, drop and
   recreate each database, `pg_restore` the two dumps into them. The dumps must hold the
   migrations of the code the slot runs, or the `--up` that follows runs the missing ones
   over them; the restore README of `k8s/catalog-import` states the same rule for the
   cluster. **Not confirmed:** that an ephemeral slot can be used instead; it brings its
   compose stack and its services up together, which leaves no step to restore between.
3. `--up <n>` again, with `LUNA_REFERENCE_SEED=0`, `ADMIN_DEV_AUTOLOGIN` false and an
   operator created with `nx run luna-shopper-backend-auth:admin:create`, so that the
   login path is the one production has.
4. `convert`, `plan`, `apply` against `http://localhost:<43000 + (n-1)*100>`. Read the
   slot before and after: `items`, `item_categories`, `catalog_audit` rows by action, and
   checks A1, A3 and A6 of plan `0186` on the slot's database, read only.
5. `--down --keep-data` while the dumps are of use; a plain `--down` when done.

The data plan then repeats steps 4 on staging, which was restored from the same dumps as
production on 2026-10-07 and therefore holds the same ids for every product that neither
cluster created since, and last on production, after a manual backup Job
(`kubectl create job --from=cronjob/luna-shopper-backend-catalog-db-backup`).

## 6. Acceptance criteria

- [ ] `npx nx run luna-shopper/curation-edits:lint` and `:test` pass.
- [ ] `convert` on the audit file writes an `edits.json` whose header counts are: 879
      proposals read, and the entries, `left` codes and folded ids that `convert-report.md`
      lists agree with a count made by hand on the same file (65 products in more than one
      proposal, 10 `CONFLICT`, 3 `CHECK_NARROWS_ROWS`, 20 kilogram entries with
      `unitSize: null`, 3 `packCount: null` from `pack: 0`, 1 `brand: null` from `"(none)"`,
      199 renames completed with the other language).
- [ ] A spec per row of the table in 2.2, each using the `fid` it names.
- [ ] `plan` against a fake fetch leaves an entry whose read differs from `expect` in any
      one field, leaves a `KILOGRAM` edit whose row says `soldByWeight` false, leaves an
      unregistered brand, resolves a spelling to its canonical label, refuses a slug that
      is not a leaf before any product read, and finds a name collision both inside the
      plan and against the gateway.
- [ ] `apply` against a fake fetch cuts parts at 1,000 entries and at 1.9 MB, sends them
      in order, stops at a refusal with the resume command, and resumes after the last 200.
- [ ] The merge sequence against a fake fetch refuses the delete when a price row of the
      loser is missing on the survivor, and never runs without `--merge-by-delete`.
- [ ] `--main-password` is refused; `CURATION_ADMIN_PASSWORD` is read; the password
      appears in no log line and no report.
- [ ] `splitDecisions` of `curation-cli` passes its existing tests unchanged after the
      extraction of section 3.4.
- [ ] One rehearsal of section 5 on a local slot, reported as the progress evidence asks.

## 7. What this plan does not do, and what the owner decides

- **The production run.** It is a data plan in `apps/luna-shopper-backend/plans/`, with
  its own backups, order and checks, as `0186` and `0192` were. It names the verdicts that
  ship (ACCEPT alone, or ACCEPT and AMEND), and answers each `left` of the convert report.
- **Backlog plan `0020`.** A merge that keeps the merged row and tells core. Until it is
  built, section 4 holds.
- **The seven script counted checks of the audit** (291 products sized 1 UNIT, 279 names
  that carry a size, and the rest). The artifact holds counts and eight samples each, and
  no ids. They need a read on the cluster first, and most of them need a person: rule R16
  takes a size from the queue rows, and rules R45 and R46 keep a measure in a name that
  tells two products apart.
- **Splits with the chain's row on one variant.** The file names which variant keeps the
  row and the price; the other variants have no source and no price until a chain lists
  them. Whether to split at all, and which variant keeps the row, is the owner's per
  split, in the data plan.
- **Brands the registry lacks.** Forty target labels of the audit may be unregistered.
  Registering them (`POST /v1/admin/catalog/brands/register-many`), linking a spelling
  (`PATCH /v1/admin/catalog/brands/:id` with `canonicalBrandId`) or leaving the products
  is a brand decision (R52, R60). The tool only reports them.
- **The ten category conflicts**, unless the owner wants a rule.
- **A `--main-password` flag on `curation-cli`.** It stays as it is; this plan only
  refuses the flag on its own commands.
