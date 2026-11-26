> **PR:** [#1113](https://github.com/IchirokuXVI/nx-portfolio/pull/1113)

# 0006 A replay carries local edits to a cluster

> Asked for by the owner on 2026-11-25. The owner works on a local copy of the production
> catalog (copied 2026-11-19, through staging). On that copy, product fixes are made through the
> admin API (99 so far), the owner records judgments on 176 more products, and later a person or
> the curation model decides waiting queue rows. This plan carries that work to production or to
> staging without doing it again by hand. A change is written only when the target product
> still holds what the change expected, and a report says what was applied and what was
> skipped, and why.
>
> **It replaces backend backlog plan `0019`** (local curation merges into a cluster that also
> changed), which is deleted in the PR that adds this plan. `0019` designed a three way SQL
> change set, applied by `psql` on the VPS. That bypasses the services, so it writes no
> `catalog_audit` row and repeats every guard the services already hold. This replay sends
> every write through the admin API, so each write is audited with the operator as its actor,
> and it reuses the two guards that exist: the `expect` of the items batch (backend plan `0237`
> section 3.2) and the `expect` of the decisions route (backend plan `0100`). It needs no
> snapshot of the base: the "before" of each local edit is the base, and the audit trail of the
> local copy already holds it.
>
> Every anchor below was read on `origin/dev` at `dc0632aa5` on 2026-11-25. Line numbers are of
> that commit.
>
> **Dependency.** Section 6 (queue decisions) needs backend plan `0277` (a decision that
> survives a walk) built first. Sections 1 to 5 and 7 do not, and are built without it. If
> `0277` is not merged when this plan is built, build everything except section 6, and say so
> in the PR.
>
> Prerequisite reading: backend plan `0237` (sections 1, 3.2 and 3.7), backend plan `0100`,
> backend plan `0239` section 2 (a merged product answers its survivor), backend backlog plan
> `0029` sections 1.1 and 1.2 (the wash rule), plan `0005` of this directory (the split of
> `--apply`), and `README.md` beside `src`.

## Brief for the agent

### Objective

Add two modes to the curation CLI. `--export-changes` writes the product edits one operator
made on a local slot, read from that slot's `catalog_audit`, to a change list file. `--replay`
reads a change list file (and, after backend plan `0277`, a decisions file), sorts each change
by what the target holds, and in a write run sends the changes that still fit through
`PATCH /v1/admin/catalog/items/batch` with an `expect`, so a product that moved on the target is
never overwritten. Dry run is the default. Every run writes a report.

### Context

What exists and is reused. Each line was verified in the code:

- **The items batch edits a product under a guard.** `PATCH /v1/admin/catalog/items/batch`
  (`apps/luna-shopper-backend/gateway/src/app/catalog/catalog-admin.controller.ts` lines 618 to
  636) takes at most `BULK_DECISION_MAX_OPERATIONS` (1,000,
  `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts` line 333) entries, each what
  `PATCH :id` takes (lines 772 to 790) plus `itemId` (`catalog.dto.ts` lines 822 to 852). It is
  all or nothing: the first refusal refuses the request and nothing is written.
- **The `expect` covers eight fields, not every field.** `ItemExpectationDto` (`catalog.dto.ts`
  lines 636 to 696; contract `ItemExpectation`, `catalog.messages.ts` lines 2598 to 2609) holds
  `name` (both halves, trimmed), `brand` (compared by brand key), `unitSize`, `approxWeight`,
  `quantityStep`, `defaultUnit`, `packCount` and `categorySlugs` (in order). An edit can also
  set `ean`, `sku`, `imageUrl`, `productGroupId` and `categoryIds` (`UpdateItemDto`, lines 698 to
  819), and no `expect` field guards those.
- **The guard runs under a lock and names every failure.** Catalog locks every product of the
  batch in id order, then compares each `expect` before any edit is written
  (`apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts` lines 3264 to 3287). One
  failure refuses the whole request with `item_expectation_failed`, and `details.failures`
  lists each product with each field, the value expected and the value held
  (`refuseFailedExpectations`, lines 3896 to 3918; `ItemExpectationFailure` and
  `ItemExpectationMismatch`, `catalog.messages.ts` lines 2611 to 2624).
- **A merged product cannot be edited.** `refuseMergedEdit` runs on every entry (line 3246).
- **The lookup reads products as they stand.** `POST /v1/admin/catalog/items/lookup`
  (`catalog-admin.controller.ts` lines 655 to 676) takes up to 1,000 ids
  (`AdminLookupItemsDto`, `catalog-admin.dto.ts` lines 87 to 99), caches nothing, and asks
  catalog in pages of 500 (`ITEM_LOOKUP_LIMITS.maxIds`, `catalog.messages.ts` line 2939). An id
  that names nothing is absent from the answer. A merged id answers the survivor's view under
  the asked id, with `mergedInto` set to the survivor (`item.service.ts` lines 1402 to 1441).
- **The audit trail holds before and after, and no route returns them.** `catalog_audit`
  (`apps/luna-shopper-backend/catalog/src/app/entities/catalog-audit.entity.ts` lines 53 to 113)
  holds `actorId`, `actorKind`, `entity`, `entityId`, `action`, `before`, `after` and `at`.
  `before` and `after` hold the changed fields only, by property name (`snapshot`,
  `catalog-audit.service.ts` lines 278 to 300), and a product's categories as `categories`, a
  list of slugs (`categoryAudit`, `item.service.ts` lines 3862 to 3866). The one read,
  `recent()` (`catalog-audit.service.ts` lines 114 to 130), drops `before` and `after` on
  purpose and feeds the dashboard. No export exists.
- **The CLI already reads a slot's catalog database.** `catalogDumpCommand`
  (`cli/src/slots.mjs` lines 179 to 192) runs `docker exec <project>-catalog-db-1 pg_dump`,
  with the project name from `slotProject` (line 115).
- **The CLI already talks to a gateway as an admin.** `auth/src/session.mjs` (one login, the
  bearer header, one refresh after a 401, line 212). `--main-user` and `--main-password` reach
  it (`cli/src/cli.mjs` lines 519 and 520).
- **The rate limits.** A request with a verified admin token is counted per operator at 1,200 a
  minute (`ADMIN_THROTTLE_LIMIT`,
  `apps/luna-shopper-backend/gateway/src/app/throttling/gateway-throttler.guard.ts` lines 33 to
  36). Login is 5 a minute per address (`THROTTLE_LIMITS.login`,
  `libs/luna-shopper/platform/src/lib/throttling/throttler-config.ts` line 108). The default
  bucket of 120 a minute (line 96) is for a caller with no admin token. Both numbers scale with
  `THROTTLE_MULTIPLIER`. Backend plan `0237` section 1.1 still says "the bucket is 120"; that
  was true before the operator bucket.
- **A product's source rows are one read.** `GET /v1/admin/harvest/items/:itemId/entries`
  (`gateway/src/app/harvest/harvest.controller.ts` line 817) answers every row bound to or
  proposing the product, with `status` and `sizeFormat`.
- **The wash rule.** Backend backlog plan `0029` section 1 selects a product when an `ACTIVE`
  row's trimmed `sizeFormat` matches `WASH_SUM` or `SHORT_WASH_WORD`
  (`apps/luna-shopper-backend/harvester/src/app/release-tasks/wash-sizes.ts` lines 157 and 149),
  the count `C` of that text equals the product's `unitSize`, and its `defaultUnit` is `UNIT`.
  Owner decision 2 of 2026-11-25: those 73 products stay with that release task.
- **Walk results need no plan.** The harvester's import (`POST /v1/admin/harvest/imports`,
  controller line 308) and run export (`GET /v1/admin/harvest/runs/:id/export`, line 248)
  already carry entries, prices and category paths from one side to the other. Neither can
  correct a product field, which is why this plan exists.

The data this is for:

- The 99 fixes of the 2026-11-20 rehearsal were made by `dev-admin` through
  `PATCH /v1/admin/catalog/items/{id}` on ephemeral Luna slot 7, so they are in that slot's
  `catalog_audit`, as long as its database is kept. They are 73 wash counts cleared (class F1,
  excluded here), 4 stated volumes (F2), 16 contents from the name (F3), 6 counts (F4). The
  log is `tmp/harvester-round/staging-rehearsal/fixes-applied.tsv` of the main checkout, with
  the columns `at_utc route item_id item_name field before after body http result reason`.
- Product ids are equal on the copy and on the target, because the copy is a restore.
- Release tasks `0007` and `0008` ran on staging before the copy was taken, and have not run on
  production (they wait for `velista-v0.20.0`). So a local edit whose "before" is what `0007`
  wrote meets the value `0007` would have replaced on production. Section 4.4 says what follows.

### Target state

1. `--export-changes <file>` writes a change list from a local slot's audit trail (section 2).
2. `--replay <file> --target-url <url>` sorts every change into one class of section 4 and
   writes the report of section 5, sending nothing that writes.
3. The same with `--write` sends the changes of class `apply` through the items batch with an
   `expect`, drops the products a refusal names, and sends the rest again (section 4.3).
4. `--replay-identity <report>` sends, in a second explicit pass, the changes a report put in
   class `identity changed` (section 4.5).
5. After backend plan `0277`: `--decisions <file>` with `--replay` replays a local decisions
   file under the content guard (section 6).
6. `cli/README.md` has a section "Carry local edits to a cluster" with the commands of section 7.
7. Specs for every class and every refusal path, against fakes, with no network.

### Scope

- `libs/luna-shopper/tools/curation/cli/src/`: new `changes.mjs` (export, file reading, folding)
  and `replay.mjs` (lookup pass, classes, batches, report), their `*.test.mjs`, and the flags in
  `cli.mjs`.
- `libs/luna-shopper/tools/curation/cli/README.md`: the section of Target state 6.
- Section 6 only: `libs/luna-shopper/tools/curation/suggestions/src/commands.mjs`, the target
  url check of `apply` (lines 1391 to 1395).
- Nothing else. No gateway route, no contract, no catalog or harvester change, no
  `openapi.json` change.

### Constraints

- Zero npm dependencies, Node built ins only, as every file of the CLI.
- Every write goes through `PATCH /v1/admin/catalog/items/batch` with an `expect`. No write
  without one, and no other write route.
- The export only reads: it runs with `default_transaction_read_only` on, and only against a
  local slot through `docker exec`. There is no road from this machine to a cluster's
  database, and the export must not need one.
- No product id, entry id or product name is committed: not in code, a spec, a fixture, the
  README or a PR body. Spec fixtures use made up ids. The change list and the report are
  written under `.curation-runs/` (git ignored, `.gitignore` line 106) or `tmp/` (line 5).
- The excluded wash products are found by the rule of backlog plan `0029`, never by a list of
  ids.
- stderr prints counts and file paths only. Ids and names go only to the report file.

### Action boundaries

- Rehearse only against local slots. Never run `--write` against staging or production. The
  operator chooses the target url, and writing to production is the owner's act.
- Do not take a Luna slot without asking the person who started you which number to use.
- Stop and report before you change a backend service, a contract or the gateway, or before
  you add a dependency.
- Stop and report if backend plan `0277` is not merged, after building everything except
  section 6.

### Progress evidence

The `node --test` output of the CLI (`npx nx test luna-shopper/curation-cli`), `npx nx lint
luna-shopper/curation-cli`, and a rehearsal log (section 7.3) with the counts per class of a
dry run, a write run and a second dry run, kept in `tmp/` of the main checkout and summarized
in the PR by counts only.

## 1. What the replay carries, and what it does not

**It carries** edits of a product that already exists on the target, field by field, for the
fields an `expect` can guard: `name`, `brand`, `unitSize`, `approxWeight`, `quantityStep`,
`defaultUnit`, `packCount` and the categories (sent as `categorySlugs`). After backend plan
`0277` it also carries `accept` and `createItem` decisions of a decisions file (section 6).

**It does not carry**, and the report names each one as `not carried` with the reason:

- **A product created locally.** Its id is a random uuid that the target never had, so it has
  no twin. Every edit of it, and every `accept` that names it, is reported `no twin`. A person
  makes it on the target, or, when it came from a queue row, the `createItem` of a decisions
  file carries it (section 6), and that is a new product with a new id.
- **A merge.** An audit row that sets `mergedIntoId` is reported. The merge route exists
  (`POST /v1/admin/catalog/items/:id/merge`, controller line 831, with `dryRun`), and carrying it
  is decision O4.
- **A deletion.** Never carried. A product deleted locally stays on the target.
- **A reject of a queue row.** The decisions route carries no reject on purpose (controller
  lines 738 and 739): a reject settles the row's prices, and junk is a person's call.
- **A field no `expect` guards**: `ean`, `sku`, `imageUrl`, `productGroupId`. Without a guard,
  the replay could overwrite a value a person set on the target. The report lists each with
  both values, and the other fields of the same product are still carried. See O3.
- **Prices**, `supermarket_items` rows and every other table. The export counts the audit rows
  of other tables and the report prints those counts, so nothing is lost without a word.
- **A brand, category or product group created locally.** A change that names one is refused
  by the target (`brand_unregistered`, or a category slug that does not resolve) and lands in
  class `refused` with the code.

Fields the trail records that follow from another field are read and not sent: `brandKey` and
`brandId` follow `brand`, `approxWeightSetBy` follows `approxWeight`, `mergedAt` follows
`mergedIntoId`.

## 2. The export

### 2.1 How it reads the audit, and why that way

Options, with the surface each one adds:

- **A. Read the local slot's `catalog_audit` with `psql` in its container (chosen).** The CLI
  already runs `pg_dump` in that container (`slots.mjs` lines 179 to 192), so this adds one
  command builder beside it and nothing to any service. It only works on a local slot, which is
  the only place the edits to carry are made.
- **B. A new read only admin route** that answers audit rows with `before` and `after`, filtered
  by actor and time. It adds a contract pattern and schema, a catalog handler, a gateway route
  and DTO, a regenerated `openapi.json` and `wire-types.ts`, and specs on three projects. It is
  the right tool only if a change list must ever be read from a cluster, and nothing here needs
  that.
- **C. An existing route.** None returns `before` and `after`: `recent()` drops them
  (`catalog-audit.service.ts` lines 103 to 130) and answers the twenty newest rows of all
  actors. Not possible.

A is the least new surface, and it reads only. It goes past the comment of `recent()` that calls
the service "the only query path" into the table; that rule is about the services, and a read
only `COPY` on a developer's own slot changes nothing they hold. If the owner wants the route
anyway, that is O1.

### 2.2 The command

```sh
npx nx run luna-shopper/curation-cli:curate -- --export-changes .curation-runs/<name>/changes.jsonl \
  --slot <n> --actor <admin id> --since <ISO time> [--until <ISO time>]
```

- `--slot` names the local slot that holds the edits. Slot 0 is allowed here, because the export
  only reads. The container is `<slotProject(n)>-catalog-db-1`.
- `--actor` is the `admin_users.id` of the operator whose edits are carried. The export reads
  `actorKind = 'ADMIN'` rows of that actor only, so a harvest, a release task or another
  person's edits on the copy are never carried. Repeat the flag for several operators.
- `--since` is required, so a whole trail is never exported by accident. `--until` defaults to
  now.

The query, run with `psql -At -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on"`
and then a `COPY (...) TO STDOUT`:

```sql
SELECT json_build_object(
  'auditId', a.id, 'at', a.at, 'action', a.action, 'itemId', a."entityId",
  'before', a.before, 'after', a.after,
  'current', json_build_object('name', i.name, 'brand', i.brand))
FROM catalog_audit a LEFT JOIN items i ON i.id = a."entityId"
WHERE a.entity = 'items' AND a."actorKind" = 'ADMIN' AND a."actorId" = ANY(:actors)
  AND a.at >= :since AND a.at < :until
ORDER BY a.at, a.id
```

and one count per other `entity` in the same window and actors, for the header.

### 2.3 The change list file

JSON lines, as the decisions file is. The first line is a header:

```json
{ "header": true, "kind": "catalog-changes", "origin": "catalog_audit", "slot": 7,
  "actors": ["<id>"], "since": "...", "until": "...", "exportedAt": "...",
  "otherEntities": { "supermarket_items": 0 } }
```

Then one line per audit row, in time order: `auditId`, `at`, `action`, `itemId`, `before`,
`after`, `current` (the local product's name and brand at export time).

A file from another origin is accepted when it has this header with another `origin` and lines
in this shape. `fixes-applied.tsv` turns into it with one line per row: `itemId` from
`item_id`, `before` and `after` as `{ <field>: <value> }`, numbers as numbers, and `current`
with `name.es` from `item_name` only. Such a file has a weaker identity guard (section 4.2), and
the report says so in its header. The CLI does not build a converter for that tsv: the 99 rows
are in slot 7's trail, and a person who lost that database writes the few lines by hand. A
person may also delete lines of a change list before the replay; that is how a change is
held back.

### 2.4 Folding a product's lines into one change

The replay reads every line of one product together, in order, and makes one change per
product:

- For each field, `from` is the `before` of the first line that names it, and `to` is the
  `after` of the last one.
- **The chain must hold.** When a line's `before` of a field differs from the previous line's
  `after` of it, somebody not exported changed it in between. The product goes to class
  `local gap` and nothing of it is sent.
- A field whose `to` equals its `from` is dropped. A product with nothing left is dropped.
- A `CREATE` or `DELETE` line, or a line that sets `mergedIntoId`, makes the whole product
  `not carried`.
- **The identity** is the name and brand the local side read before its first change: the
  `from` of `name` and `brand` when the list changes them, and `current` otherwise. Owner
  decision 4 of 2026-11-25.

## 3. The command line of the replay

```sh
npx nx run luna-shopper/curation-cli:curate -- --replay .curation-runs/<name>/changes.jsonl \
  --target-url <gateway url> [--write] [--batch-size 100] [--report <file>] \
  [--main-user <name> --main-password <p>]
```

- `--target-url` is required and has no default, and the replay never reads it from a file.
  The operator types it each time.
- Without `--write`, the run reads only: one login, the lookups, the entry reads of section
  4.4. It sends no `PATCH`.
- `--batch-size` defaults to 100 and may be at most 1,000. A smaller batch keeps one request
  well inside the gateway's timeout and makes a retry cheap.
- `--report` defaults to `replay-<target host>-<time>.json` beside the change list.
- The replay paces itself to at most 10 requests a second, under both buckets of section
  Context. On a 429 it waits the time the answer names and sends the same request again, at
  most three times, then stops and writes the report. It logs in once; `session.mjs` handles
  the 401 of an expired token.

## 4. The passes

### 4.1 Lookup

Every product of the change list is read on the target with `items/lookup`, 1,000 ids a
request, right before the classes are decided. Each product gets exactly one class, checked in
this order:

| Class | When |
| --- | --- |
| `not carried` | section 1 or 2.4 says so |
| `local gap` | section 2.4 |
| `no twin` | the lookup does not answer the id |
| `merged on target` | the answer carries `mergedInto`; the report names the survivor |
| `excluded: wash task` | section 4.4 |
| `identity changed` | the target's name or brand is not the identity of section 2.4 |
| `already there` | the target holds `to` for every field |
| `conflict` | a field holds neither its `from` nor its `to` |
| `apply` | every field holds `from` or `to`, and at least one holds `from` |

In class `apply`, the fields that already hold `to` are dropped from the edit. A product is one
judgment, so a `conflict` on one field holds back all of its fields.

### 4.2 How values are compared on the client

As catalog compares them, so the classes predict the answer: `name` as both halves, each
trimmed; numbers as numbers (`53.0000` equals `53`); `null` as no value; categories as an
ordered list of slugs. A brand is compared case blind and trimmed on the client. Catalog
compares it by brand key, which can join two spellings the client keeps apart; a refusal on
`brand` from the server is then read as `identity changed` (section 4.3), so the server stays
the authority. For a file with only `name.es` in its identity, the client compares that half,
and the `expect` sent carries no `name`.

### 4.3 The write

For each batch of class `apply` products:

- The entry is `{ itemId, <field>: to, ..., expect: { <field>: from, ..., name, brand } }`, with
  the identity as `name` and `brand`. A product whose edit changes `name` or `brand` expects
  their `from`, which is the identity.
- `requireRegisteredBrands: true`, so a brand the target's registry lacks is refused and not
  stored as loose text.
- On `item_expectation_failed`, every product of `details.failures` leaves the batch: to
  `identity changed` when a failing field is `name` or `brand`, else to `conflict`, with the
  value held from `actual`. The rest of the batch is sent again. Each round removes at least one
  product, so the loop ends.
- On any other refusal (`brand_unregistered`, `item_ean_invalid`, a base unit refusal,
  `item_merged`, a category that does not resolve), the batch is split in halves and each half
  is sent, until the refused product is alone. It goes to class `refused` with the code and
  message. A batch of 100 with one bad product costs at most seven more requests.
- On a 504 or a lost answer, the replay does not resend blind. It reads the batch's products
  again with `items/lookup`: a product that landed now holds `to` and is `already there`, and
  the rest is sent again. The `expect` makes a second send of a landed product a refusal, never
  a second write.

The same property makes the whole replay safe to run again: a second run classes everything it
wrote as `already there`.

**Dry run limits.** A dry run predicts only the classes of 4.1. It cannot predict the refusals
of the third bullet, because the route has no dry run. The report header says so.

### 4.4 The wash products of backlog plan `0029`

Owner decision 2: those products stay with the release task. The replay finds them by the
task's rule, read on the target:

1. A change is a candidate when it takes `unitSize` from a whole number `C` above 0 to null,
   and the target product holds `defaultUnit` `UNIT` and `unitSize` `C`.
2. For each candidate, the replay reads `GET /v1/admin/harvest/items/:itemId/entries` on the
   target (one request each; 73 on today's data).
3. It is `excluded: wash task` when an `ACTIVE` row's trimmed `sizeFormat` matches the sum
   pattern (count `N + M`) or the short word pattern (count `N`) with count `C`.

The CLI cannot import TypeScript, so `replay.mjs` holds the two patterns as literals, and a
test reads `wash-sizes.ts` as text and asserts that the source of each of its two regular
expressions is equal to the CLI's. A change to the task's rule then breaks this test, and the
rule keeps one meaning. See O2.

A product the task has already corrected on the target holds no size, so it is `already there`,
which is the right answer.

**Release tasks `0007` and `0008`.** Run the replay after the release that runs them on the
target (`velista-v0.20.0` on production). Before that, a local edit made on top of what `0007`
wrote (most of class F3 of the rehearsal) meets the old value on production and is a
`conflict`. Nothing is written wrongly, but the work is not carried until a later run.

### 4.5 The identity changed pass

Owner decision 4: a product that was renamed, merged or repurposed on the target is not
written by the first pass. Its own class in the report lists the local identity and the
target's name and brand side by side, so a person can tell a spelling fix from another product.

```sh
npx nx run luna-shopper/curation-cli:curate -- --replay-identity <report.json> \
  --target-url <the same url> [--only <file of item ids>] [--write]
```

- It reads only the `identity changed` lines of the report, and refuses a report written for
  another target url.
- `--only` takes a file with one product id a line (under `.curation-runs/`), so a person sends
  only the products they looked at. Without it, every line of the class is sent.
- The `expect` carries the changed fields' `from`, and the **target's** name and brand as the
  report recorded them. A product that moved again after the person looked is still refused.
- Everything else is as in 4.3, and it writes a report of its own.

The owner recommended this second pass. One reason against it: a person who looks at a
renamed product is often better served by the back office, which shows its rows and prices.
O5 holds that.

## 5. The report

One JSON file, never printed to stdout:

- `header`: the target url, `dryRun`, the change list's header, the start and end time, the
  CLI's commit if `git` answers, and the dry run limits of 4.3.
- `counts`: products per class, and fields sent.
- `lines`: one per product, with `itemId`, `class`, `fields` (each `field`, `from`, `to`,
  `target`, and `sent` in a write run), `identity` (`local` and `target`), and for `refused`
  the `code` and `message`, for `merged on target` the survivor.
- `notCarried`: the counts per entity of the header, and the unsupported fields of section 1.

stderr prints the counts per class and the report's path.

## 6. Queue decisions (after backend plan `0277`)

`--replay` with `--decisions <decisions.jsonl>` replays a local decisions file to the target
after the product changes. Today two things refuse it, and both are right for what they guard:

- `apply` refuses a file decided against another url (`suggestions/src/commands.mjs` lines 1391
  to 1395).
- A walk on the target after the copy moves `lastSeenAt` of every row it sees
  (`harvester/src/app/harvest/source-ingest.ts` lines 1536 and 1623), and the route compares it
  by exact equality (`source-entry-batch.service.ts` lines 514 to 523). One moved row refuses
  the file at `VALIDATE`.

Backend plan `0277` adds an `expect` of the row's content. With it, this section builds:

1. The replay refuses a decisions file unless every operation's `expect` carries the content of
   `0277`. It then sends the operations with that content and without `lastSeenAt`.
2. `apply` of the suggestions decider takes a `targetUrl` from the replay. It replaces the
   header url only when the replay passes it, and the replay passes it only under 1.
3. An `accept` whose `itemId` the lookup of 4.1 does not answer on the target is dropped as
   `no twin`, with the operations that name its `ref` (the units of `splitDecisions`,
   `cli/src/apply.mjs` lines 59 to 103).
4. The file is sent in parts of at most 1,000 operations, by `applyDecisions` as today.
5. A part refused at `VALIDATE` names each operation and its code. The replay drops the
   refused operations with their units, reports each with its code (`EXPECT_MISMATCH` as
   `conflict`, `NOT_PENDING` as `decided on target`, `NOT_FOUND` as `no twin`), and sends the
   rest again. This keeps the route's all or nothing promise and still lets one stale row stop
   only itself. Backend plan `0277` holds the owner's decision on that.

A queue row a person decided locally through the back office, one row at a time, leaves no
decisions file. See O6.

## 7. How to run it

### 7.1 Before the first write

As backend plan `0237` section 1.1: take a backup of the target's catalog database, apply to
staging before production, and sign in as a named operator so `catalog_audit` on the target
names who wrote. Run the replay after the release that runs tasks `0007` and `0008` there.

### 7.2 The order

1. `--export-changes` on the local slot.
2. Read the change list. Delete the lines that are not to be carried.
3. `--replay` against the target, dry run. Read the report.
4. `--replay --write` against the target.
5. `--replay` again, dry run: everything sent is `already there`.
6. `--replay-identity` for the products a person looked at, dry run, then `--write`.

### 7.3 Rehearsal on a local slot

1. Restore the newest nightly dump of the target's catalog and harvester databases (the backup
   bucket; memory note "Realistic catalog to measure on" has the recipe) into an ephemeral Luna
   slot that is not the slot holding the edits.
2. Export the changes from the slot that holds them.
3. Run 7.2 steps 3 to 6 with `--target-url` set to the rehearsal slot's gateway.
4. Change one product's name and another's size on the rehearsal slot through the back office
   between the dry run and the write, and see the first reported as `identity changed` and the
   second as `conflict`, with nothing written to either.
5. `--down` the rehearsal slot.

## 8. Specs

All with `node --test`, against fake gateways and fake processes (`cli/src/test-fakes.mjs`), no
network and no docker:

- Export: the `docker exec` command and the SQL for one and two actors; a header with the
  counts of other entities; a refusal without `--since`.
- File: a header with another origin is read; a line without `itemId` is refused with its line
  number.
- Folding: two edits of one field chain; a broken chain is `local gap`; a field put back to its
  `from` is dropped; a `CREATE`, a `DELETE` and a merge line are `not carried`; the identity is
  the `from` of a renamed product and `current` otherwise.
- Classes: one product per class of 4.1, and the order of the table when two apply.
- Comparison: `53.0000` equals `53`; a trimmed half of a name equals; categories in another
  order differ.
- Write: a dry run sends no `PATCH`; the `expect` holds `from` plus name and brand;
  `item_expectation_failed` on two of five products sends the other three again and classes the
  two by field; `brand_unregistered` in a batch of eight isolates the one product in at most
  three splits; a 504 reads the batch again and sends only what did not land; a 429 waits and
  retries.
- Wash rule: `35+18 lavados` at 53 `UNIT` is excluded; `40lav` at 42 is not; `40lav` at 40
  `MILLILITER` is not; a `CANDIDATE` row is not; the two literals equal the source of
  `wash-sizes.ts`.
- Identity pass: a report of another url is refused; `--only` sends only the named products;
  the `expect` holds the target's name and brand from the report.
- Section 6, when built: a file without the content `expect` is refused; an `accept` of a
  product with no twin drops its unit; a refusal at `VALIDATE` drops the refused units and
  sends the rest.

## 9. Acceptance criteria

- [ ] A dry run against a target sends only lookups and entry reads, and writes a report with
      one class per product.
- [ ] A write run changes only products of class `apply`, only the fields sent, each with a
      `catalog_audit` row on the target naming the operator.
- [ ] A second dry run after a write classes every product sent as `already there`.
- [ ] No product that moved on the target after the export is written, in the rehearsal of 7.3.
- [ ] The wash products are excluded by the rule, and a test ties the rule to `wash-sizes.ts`.
- [ ] Nothing committed names a product, an entry or a production id.
- [ ] `npx nx test luna-shopper/curation-cli` and `npx nx lint luna-shopper/curation-cli` pass.

## Decisions

The owner answered every open decision with its recommended option on 2026-11-26.

**O1 (owner, 2026-11-26): A.** The change list comes from the local `catalog_audit`, read by
`psql` in the local slot's container. No new route.

**O2 (owner, 2026-11-26): A.** The wash rule is two literals in `replay.mjs`, tied to
`wash-sizes.ts` by a test that reads it as text and compares the source and flags of
`SHORT_WASH_WORD` and `WASH_SUM`. The test finds each declaration by name, so code added around
them in that file does not break it.

**O3 (owner, 2026-11-26): A.** Edits to `ean`, `sku`, `imageUrl` and `productGroupId` are
reported, never sent.

**O4 (owner, 2026-11-26): A.** Local merges are reported only.

**O5 (owner, 2026-11-26): A.** `--replay-identity` is built.

**O6 (owner, 2026-11-26): B.** Queue rows decided by hand in the back office are not carried;
only decisions files are.

**O7 (owner, 2026-11-26): A.** The password is asked at the terminal when stdin is one, else
read from `CURATION_TARGET_PASSWORD` set for the one command. A replay refuses
`--main-password`.

**157a (owner, 2026-11-26): the wash exclusion.**

- (i) The report lists every excluded product as its own line of class `excluded: wash task`,
  with the product id and the source row text that excluded it (`washTask.text`), and the
  summary counts them. The README tells the operator to check those products after release
  task `0009` has run on the target: a product the task held back, for example one whose other
  chain states the same number as units, stays uncorrected and a person decides it.
- (ii) The exclusion drops only the size fields of the product's change: `unitSize`, and
  `defaultUnit` when the change moves it too. Any other carried field of the same product is
  still judged and sent under its guard, and the line carries a `washTask` that says the size
  was left to the task. A change whose only fields are the size is excluded whole, as before.

**158a (owner, 2026-11-26): confirmation before a write.**

- (i) Every `--write` (the replay, the identity pass and the decisions replay) needs
  `--confirm-host <host>`, equal to the host name of `--target-url`, compared case
  insensitively with no scheme, port or path. When it is missing or differs, the run stops
  before the password is asked, before login and before any request, with a message that names
  both hosts. A dry run needs no confirmation.
- (ii) `--replay-identity --write` needs `--only`. Without it the run stops before login.

**Builder choices, 2026-11-26:**

- The export runs a plain `SELECT` under `psql -Atq` instead of `COPY ... TO STDOUT`, because the
  text format of `COPY` doubles every backslash and so breaks a JSON string that holds a quote.
  The session is still set read only first.
- The carried fields are one list, `CARRIED_FIELDS` in `changes.mjs`, one line per field. It
  holds `quantityStep` too, because the `expect` guards it since plan 0261, and `pieceCount`,
  because backend plan 0278 (PR #1114) added it to the `expect` and joined it to the list as one
  line.
- A field the trail records that is neither carried nor derived (`linkedImages`, for example) is
  reported with the unguarded fields and never sent. The chain check of section 2.4 runs on every
  field that is not derived.
- A lost answer (a 502, 503, 504, or no answer) is read back and sent again at most three
  times; after that the run stops, and the products left are `not written` with the code
  `no_answer` (fix round, 2026-11-26).
- Fix round, 2026-11-26: a refused batch is split only when the answer is a 400, 409 or 422
  with a problem code. A 429 after the waits, a 401 or 403 after the new login, a second 413
  (the first halves the batch size once), any other 5xx and a fourth lost answer stop the
  run. The report is then still written: what was written before the stop, the request it
  stopped on as `not written` with the answer, the rest as `not sent`, and the process exits
  with an error.
- Fix round, 2026-11-26: a product refused by `expect` only because the target already holds
  the `to` of every field sent is `already there`, not `conflict`. That is what a resend meets
  when the first send committed after a 504 and the read back came too early.
- A 429 is waited out for `details.retryAfterSeconds` of the problem document, the number the
  gateway names, or 60 seconds when it names none.
- The session cuts a failed body at 500 characters, which can cut the failure list of a batch,
  so the replay wraps the fetch it gives the session and keeps the whole body. The auth package
  is not changed.
- `--replay-identity` reads the products again and judges them as the first pass does, with the
  target's recorded identity, and skips the wash rule (those products passed it already).
- In section 6, a dropped `createItem` takes every row that names its `ref` with it; a dropped
  `accept` takes nothing else. A part refused for a reason no single row carries stops the
  decisions replay, and the parts after it are reported `not sent`.
- The suggestions decider's `apply` takes `targetUrl`; when it is given, the header's url is not
  compared and the request goes to the target.

**Builder choices, review of the write path, 2026-11-26:**

- The report file is written again after every answer of a write, products and decisions parts
  alike, and once more at the end. Each write goes to a temp file beside the report and is renamed
  over it. While the run goes on, the header carries `inProgress` and `endedAt` is null.
- If such a write fails, the run stops before the next request, because a write the record cannot
  follow should not be made. If the last write fails, stderr prints the counts and the error the
  run stopped on, then the write failure, and the process exits with an error.
- SIGINT, SIGTERM and SIGHUP end a replay at once, without waiting for the request in flight: the
  report is written synchronously with that request as `not written`, `checked: false` and the
  code `interrupted`, every later product `not sent`, and the process exits with the signal's
  code (130, 143, 129). SIGHUP is handled too because a closed terminal is the same stop. The run
  writes nothing after that.
- Each request times out after 30 seconds, twice the 15 seconds after which the cluster's
  gateway answers 504 itself. The auth package has no timeout option, so the replay's own fetch
  wrapper sets the signal. A timeout is a lost answer.
- A 2xx answer whose body cannot be read is a lost answer: the batch is read back and classed by
  what the target holds.
- A product that landed through a lost answer keeps its class and is counted as
  `landedAfterLostAnswer`, apart from `written`. The README says how to reconcile the two with
  the target's audit.
- A 413 halves the group it refused, still once a run, and no later batch is larger than that
  half.
- After a lost answer to a decisions part, the rows are read back through the source rows of the
  product each `accept` names. A row no longer pending is `decided on target` with its
  `targetStatus`; a row still pending is a new class, `not written`; every row that cannot be read
  (a `createItem`, an `accept` onto a ref, a row its product does not list, a failed read) is
  `not written` with `checked: false`. The read back stops asking after one failed read. A thrown
  4xx still means nothing landed, so those rows stay `refused`. The route is not assumed all or
  nothing across its steps (it reports `orphanedItemIds`), so nothing is inferred for a row from
  another row of the part.
- `orphanedItemIds` of every decisions answer is copied into `decisions.orphanedItemIds` of the
  report, and stderr counts them.
- A decisions part refused twice in a row without dropping a row stops the run with an error: its
  rows are `refused` with the code `no_progress`, the parts after it `not sent`.

## Open decisions for the owner

**O1. Source of the change list (recommended, owner to confirm).** The local `catalog_audit` is
the source of truth: it holds every admin edit with actor, time, before and after, the edits
made by hand in the back office included, which a hand kept tsv misses.

- **A. The audit, read by `psql` in the local slot's container (recommended).** No new route.
  Works on local slots only.
- **B. The audit, read through a new read only admin route.** Three projects change and the
  OpenAPI document grows, for a read nothing else needs.
- **C. A hand kept tsv only.** Misses back office edits. Not recommended; it stays accepted as
  a second origin.

**O2. Where the wash rule lives for the replay.**

- **A. Two literals in the CLI, tied to `wash-sizes.ts` by a test that reads it as text
  (recommended).** One meaning, checked on every test run.
- **B. Wait for backlog plan `0029`'s command and run it in the target's pod.** It answers on
  the cluster, not to the CLI, and it is not built.
- **C. Do not exclude by rule; the operator deletes the lines.** Decision 2 asked for a rule.

**O3. Fields with no guard (`ean`, `sku`, `imageUrl`, `productGroupId`).**

- **A. Report, never send (recommended).** Few edits change them, and an EAN change has its own
  rules (plan `0184`) that a person reads.
- **B. Send when the lookup shows the target holds `from`.** Leaves a race between the lookup
  and the write that no lock covers.
- **C. Add those fields to `ItemExpectation`.** A backend change for its own plan.

**O4. Merges made locally.**

- **A. Report only (recommended for now).** A merge moves queue rows and shoppers' lines on the
  target, and the merge route refuses two articles of one chain unless told otherwise per pair.
- **B. Carry them through `POST items/:id/merge`, dry run first**, when both products are
  `already there` or `apply`.

**O5. The identity changed pass.**

- **A. Build `--replay-identity` (recommended, as the owner proposed).** Explicit, guarded by
  the target's identity, and restricted by `--only` to what a person looked at.
- **B. Report only; a person fixes each one in the back office.** Less to build, more clicks.

**O6. Queue rows decided by a person in the back office.** They leave no decisions file, so
section 6 cannot carry them.

- **A. A second export query** writes the local rows that turned `ACTIVE` with `matchedBy`
  `MANUAL` in the window as `accept` operations with the content `expect` of backend plan
  `0277`. The harvester records no actor on a decision, so the window is the only filter.
- **B. Decide such rows through the CLI only, so a file exists (recommended for now).**
- **C. Leave them; they are decided again on the target.**

**O7. The password.** Backend plan `0237` section 1.1 says the password is never typed on a
command line, and the CLI's `--main-password` is one.

- **A. The replay reads it from a prompt when stdin is a terminal, else from an environment
  variable the operator sets for the one command (recommended).**
- **B. Keep `--main-password` as `--apply` does.**
