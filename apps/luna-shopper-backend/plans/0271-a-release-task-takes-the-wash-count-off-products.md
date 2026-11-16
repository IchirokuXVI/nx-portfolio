# 0271: a release task takes the wash count off the products made from wash rows

> The owner's answer to O1 of plan `0270`, 2026-11-16: the products already made from wash rows
> are corrected by a release task in a plan of its own. His explicit yes to rewriting these
> rows is decision 27b of the same day (D1 below). Plan `0270` makes a wash state no size from
> now on. This plan corrects what was written before it. Checked against `origin/dev` and the
> branch of PR #997 on 2026-11-16.
>
> Prerequisite reading: plan `0270` (on the branch of PR #997 until it merges), plan `0244`
> section 7 (release task `0006`, the shape this task copies), plan `0245` (the comparable
> price), plan `0075` (the catalog audit trail), `k8s/release-tasks/README.md`,
> `k8s/release-tasks/check-tasks.mjs`, `k8s/release-tasks/tasks/0006-kilo-pieces-state-their-weight/`
> and the section "A release task runs in a window, on data it expects" in `CLAUDE.md`.
>
> **Builds after plan `0270` is merged into `dev`.** Cut the branch from `dev` after that
> merge. The release that carries this task then carries plan `0270` too, so no new product
> is made from a wash row after the task has run.

## Brief for the agent

### Objective

Add the next free release task under `k8s/release-tasks/tasks/` (expect `0007`, verify) and
the command it runs. The task takes the wash count off every product whose size came from a
printed wash count and that no person sized. It changes no price, deletes nothing, and counts
before it writes.

### Context

- **What plan `0270` leaves behind.** Before it, `40 lavados` was read as 40 `UNIT` by DEZA,
  Carrefour, DIA and El Jamón, and by a leaflet whose `size.unit` was `lavados`. A product
  created from such a row is 40 `UNIT` (`createdSize`, `harvester/src/app/harvest/source-entry-size.ts`,
  near line 87). A walk never rewrites a product's size. So such a product keeps 40 `UNIT`
  after plan `0270`, and its comparable price (plan `0245`) stays a price per wash.
- **Mercadona and LIDL are not involved.** Neither table reads a wash (`mercadona/src/lib/units.ts`,
  `lidl/src/lib/size.ts`).
- **Who set a size, as catalog records it.** `items` has no column that says who wrote
  `unitSize`, `defaultUnit` or `packCount`. Only `approxWeight` has one (`approxWeightSetBy`,
  plan `0244`). The record is the audit trail of plan `0075`: `catalog_audit`
  (`catalog/src/app/entities/catalog-audit.entity.ts`), one row per write, in the transaction
  of the write, with `actorKind` `ADMIN` (a person in the back office, or a tool that uses an
  admin login) or `SERVICE` (the harvester), `entity` `items`, `entityId`, `action`, and
  `before` and `after` holding **the changed fields only**. So an `ADMIN` row whose `after`
  holds `unitSize`, `defaultUnit` or `packCount` is a person who set that field.
- **What the trail cannot tell.** A product created from the queue is created by the
  harvester (`SourceEntryService.createItem`, `source-entry.service.ts`, near line 557). The
  person pressed the button, but the write goes through `CatalogClient` with the harvester's
  actor, so its `CREATE` row is `SERVICE`. The request's named size is not stored anywhere. A
  queue create where the person typed `40` and one where the person named nothing look the
  same (open question O1).
- **How long the trail reaches.** The retention sweep deletes `catalog_audit` rows older than
  `RETENTION_AUDIT`, 180 days by default (`catalog/src/app/retention/retention-config.ts`, near
  line 75). Task `0001` emptied the catalog on 2026-09-25, so every product today has its
  `CREATE` row until about 2027-03-24.
- **How a write reaches catalog.** Task `0006` runs a node command in the harvester pod, which
  reads the harvester database and writes through the ordinary item update message
  (`item.update`, `contracts/src/lib/messages/catalog.messages.ts`, near line 190) with the
  harvester's actor. That update recomputes the comparison pair of the product's
  `supermarket_items` rows in its own transaction (`item.service.ts`, near line 3317,
  `sizeMoved`, and `recomputeComparablePrices` in `comparable-price.sql.ts`).

### Target state

1. A task directory `k8s/release-tasks/tasks/<NNNN>-wash-count-leaves-products/` with
   `task.env`, `check.sh` and `post.sh`, in the shape of task `0006`.
2. A command `wash-sizes.js` in the harvester bundle with `--count` (writes nothing) and a
   write mode with `--max <n>`.
3. Every product that section 1 selects has no size after the task, and a pack count only
   when section 2 keeps it. Every product a person sized is unchanged.
4. No price row, no `source_catalog_entries` row, and no product outside the selection changes.

### Scope

- `k8s/release-tasks/tasks/<NNNN>-wash-count-leaves-products/`: `task.env`, `check.sh`,
  `post.sh`.
- `apps/luna-shopper-backend/harvester`: the command `wash-sizes.js` (a second webpack entry,
  as `kilo-pieces.js` is), its selection, and its specs.
- `apps/luna-shopper-backend/catalog`: one read subject that answers, for a list of item ids,
  whether the trail holds each item's `CREATE` row and whether any `ADMIN` row changed
  `unitSize`, `defaultUnit` or `packCount`. The builder names it in `catalog.messages.ts`.
  It is a NATS subject and no gateway route, so `openapi.json` does not change.
- `k8s/release-tasks/README.md`: a section for the task, like the one of task `0005`.
- No migration, no change to any adapter, no change to `item.update` itself.

### Constraints

- **It deletes nothing.** Every write is an item update. No row of any table is removed.
- **A size a person set is never touched** (section 3).
- **The task decides nothing from a name.** It reads the printed `sizeFormat` of `ACTIVE`
  rows and the stored size of the product, and nothing else (the harvester rule of
  2026-11-11: no inference from names).
- **No price changes.** The effective price and every `item_prices` row stay as they are.
- Every write goes through `item.update` with the harvester's actor, so it is audited and
  refused by the same rules as any edit. No raw SQL into catalog.
- `task.env` holds only comments and `NAME="value"` lines, with no blank line.
- The windows and `PRODUCTION_RELEASE` are written in the pull request that ships the task,
  within 14 days of that commit (`check-tasks.mjs` enforces it).

### Action boundaries

- Rehearse on a copy of real data, never on a cluster: the locked slot 4 copy dumped into an
  ephemeral slot (`luna-slot.sh --ephemeral`), or a staging dump restored into one. Do not
  unlock or start slot 4.
- Run `--count` on the copy first and put its output in the PR before any write.
- Stop and report if the count of any chain is more than twice the wash rows that the replay
  of plan `0270` counted for it, or if the check of section 1.3 fails on the copy.

### Progress evidence

The `--count` output on the copy before and after a write run, the second run printing 0
everywhere, the specs, `node k8s/release-tasks/check-tasks.mjs`, and `check.sh` and `post.sh`
run against the copy through the override.

## 1. Which products qualify

### 1.1 The rows

In the harvester database, every `source_catalog_entries` row with:

- `status` `ACTIVE` and an `itemId`;
- a `sizeFormat` that is a printed wash count, and nothing wider. The pattern, case
  insensitive, on the stored text: an optional `N x` (`x` or `X`, spaces allowed), then a whole
  number `Q`, then `lavado` or `lavados`, then at most a full stop. `40 lavados`,
  `2x40 lavados`, `44 Lavados.` qualify. `23+12 lavados` does not (a sum never had a size),
  and neither does a row whose `sizeFormat` is `ud`, whatever its name says.

The row's count `C` is `Q`, or `N × Q` for `N x Q`. Its pack `P` is `N`, or none. These are
what the parsers of `dev` before plan `0270` read from the same text. The rehearsal proves it
(1.3).

### 1.2 The products

A product qualifies when all of these hold:

- one of its qualifying rows has `C` equal to the product's `unitSize`;
- its `defaultUnit` is `UNIT`;
- the trail holds its `CREATE` row;
- no `ADMIN` row of the trail changed its `unitSize`, `defaultUnit` or `packCount` (section 3).

Nothing wider. A product whose size is 40 `UNIT` and whose rows print no wash count is not
selected, whatever it is.

### 1.3 The check of the reading on the copy

On the rehearsal copy, before plan `0270` has rewritten the rows by a walk, assert for every
qualifying row: its stored `unitSize` is `C` and its `sizeUnit` is `UNIT`, per chain. A row
where that fails means the rule of 1.1 is not the reading of `dev` for that chain, and the
builder stops and reports it.

## 2. The corrected value

- `unitSize` becomes null. `defaultUnit` stays `UNIT`.
- `packCount` becomes null when it equals `P` of the row that qualified the product. Any other
  pack count stays. Plan `0270` D1 says `2x40 lavados` states no pack count.
- `approxWeight`, the name, the brand, the categories and the images stay.

**Why no size, and not the content another row states** (choice C1). A product can have
another `ACTIVE` row that states a real content, a Mercadona `3 l` for example. The task does
not copy it. To pick one row's content for a product is a decision about the product, and
that is the curator's work (memory rule of 2026-11-11: the harvester records, the curator
decides). Two rows of one product can also disagree, and a task cannot know which bottle the
product is. No size is the answer that claims nothing. The command lists these products, so
the curator finds them (section 5).

**What the shopper sees after.** The comparable price of plan `0245` divides a `UNIT` product
by its `unitSize`, else its `packCount`, else 1. A corrected product is thus compared per pack
and no longer per wash. Lines on lists and baskets keep their product and their quantity.
Nothing in core changes.

## 3. A size a person set

**The rule.** A product is skipped when any `catalog_audit` row with `actorKind` `ADMIN`,
`entity` `items` and its `entityId` holds `unitSize`, `defaultUnit` or `packCount` in `after`.
That covers an edit in the back office and a product a person created there, since a create
stores every field in `after`. It covers the curation tools too, which write under an admin
login (open question O2).

**What a person's edit looks like**, for the spec: an `UPDATE` row,
`{ actorKind: 'ADMIN', entity: 'items', action: 'UPDATE', before: { unitSize: 40 },
after: { unitSize: 3000, defaultUnit: 'MILLILITER' } }`. The harvester's create is
`{ actorKind: 'SERVICE', action: 'CREATE', before: null, after: { ..., unitSize: 40, defaultUnit: 'UNIT' } }`.

**What the trail cannot tell** is a queue create where the person typed the size. It is
`SERVICE`, like a create where the person named nothing (open question O1). Until the owner
answers, the task treats a `SERVICE` create as the row's size.

**A trail that no longer reaches a product** is data this task was not written for. The
catalog read of the scope answers whether each candidate's `CREATE` row is still there. If one
is missing, the command reports `unknown <n>`, `check.sh` refuses, and `post.sh` writes
nothing. That cannot happen before about 2027-03-24 (Context), and a window is at most 14 days.

**A person who edits in between.** The command reads each product again right before its
update, and skips it if it no longer holds `C` `UNIT`.

## 4. The task

### 4.1 `task.env`

```sh
# Take the wash count off the products made from wash rows (backend plan 0271).
UNIT="velista"
RUN_UNTIL_STAGING="<a UTC date, at most 14 days after the commit that writes it>"
RUN_UNTIL_PRODUCTION="<a UTC date, at most 14 days after the commit that writes it>"
PRODUCTION_RELEASE="<the version, such as 0.19.0, without its v>"
DATABASES="catalog"
MAX_PRODUCTS_STAGING="<n>"
MAX_PRODUCTS_PRODUCTION="<n>"
```

The builder writes the two windows and the one `PRODUCTION_RELEASE` in the pull request that
ships the task, as the README says: windows chosen last, counted from that commit. The release
is the velista release that carries plan `0270` and this task. The ceilings are the rehearsal
count of each environment rounded up to the next ten, stated in the PR for the owner to
confirm. `DATABASES` is `catalog`, because the task writes only catalog. The harvester database
is read (choice C2).

### 4.2 The dump

The runner dumps `catalog` before `pre.sh` would run, through its backup CronJob, and keeps the
key in the ledger. The dump is the way back for 14 days. `k8s/helm/restore-database.sh`
restores it into a scratch database. A restore also removes what was written to catalog after
the task, so the README section says to prefer a second item update for a single product.

### 4.3 `check.sh`

Copy task `0006`. It reads only, and:

- passes where there is no harvester deployment;
- passes where the harvester pod has no `wash-sizes.js` yet, because it runs before
  `helm upgrade`, and prints that `post.sh` counts after the rollout;
- refuses a ceiling that is not a number;
- runs `wash-sizes.js --count` and refuses when `products` is above
  `MAX_PRODUCTS_<ENVIRONMENT>`, or when `unknown` is above 0 (section 3);
- refuses anything it cannot read: a deployment it cannot look up, a command that fails or
  prints no count;
- passes with `products 0`, which is also how it finds its own earlier run.

### 4.4 `post.sh`

Copy task `0006`. It counts with `--count`, prints the output, refuses as `check.sh` does, does
nothing when `products` is 0, then runs `wash-sizes.js --max <ceiling>`, which refuses too if
the count grew in between. It counts again for the record. It refuses where the pod has no
`wash-sizes.js`, so the runner leaves the task at `pre-done` and the next deploy finishes it.
One product is one catalog transaction, so a failure leaves the products before it done and
the next run finishes the rest.

### 4.5 Safe to run again

A corrected product has no size, so it no longer equals `C` and is not selected. A second run
counts 0 and writes nothing. No marker is needed.

## 5. The dry count

`wash-sizes.js --count` writes nothing and prints one line per fact:

```
chain deza 31
chain carrefour 12
chain dia 4
chain eljamon 0
products 47
pack 3
person 5
content 7
content-item 2f0c... deza 3 l
unknown 0
```

- `chain <slug> <n>`: the products that would change, by the chain of the row that qualified
  them. A leaflet row counts under its chain. A product qualified by two chains counts under
  each, so the lines can sum above `products`.
- `products`: the distinct products that would change.
- `pack`: of them, those whose pack count would be cleared.
- `person`: products skipped by section 3.
- `content` and `content-item`: corrected products with another `ACTIVE` row that states a
  weight or volume, with that row's chain and size, for the curator (choice C1).
- `unknown`: candidates whose `CREATE` row the trail no longer holds.

The numbers above are an example of the shape, not a measurement. The builder runs it on the
copy before anything is written, and the PR quotes the real output.

## 6. What is recomputed after

- **The comparable price (plan `0245`).** Nothing runs after the task. Each update is the
  ordinary `item.update`, and its transaction rewrites `comparablePrice` and `comparableBasis`
  of every `supermarket_items` row of the product, because the size moved
  (`recomputeComparablePrices`). The basis stays `UNIT`.
- **The shown price of `supermarket_items`.** It does not depend on the size, so nothing
  recomputes it, and no `item_prices` row changes. The sixty second sweep of plan `0080` is
  not needed.
- **The search vectors** follow by the trigger of every item write.
- **The source rows** keep their stored size until their chain's next walk, which states no
  size under plan `0270`. A size doubt on such a row clears on that walk.

## Tests

- The selection spec: `40 lavados` at 40 `UNIT` qualifies; `2x40 lavados` at 80 `UNIT` with
  pack 2 qualifies and clears the pack; `2x40 lavados` at 80 `UNIT` with pack 4 qualifies and
  keeps the pack; `40 lavados` at 42 `UNIT` does not; `40 lavados` at 40 `MILLILITER` does not;
  `23+12 lavados` does not; a `CANDIDATE` row does not; a row with `ud` does not.
- The person rule: an `ADMIN` `UPDATE` of `unitSize` skips; an `ADMIN` `UPDATE` of the name
  alone does not; an `ADMIN` `CREATE` skips; a `SERVICE` `CREATE` does not; a missing `CREATE`
  row counts as `unknown`.
- The command: `--count` writes nothing; a write run then a second `--count` print
  `products 0`; `--max` below the count refuses before any write; a product edited between the
  count and its update is skipped.
- The catalog read subject: an integration spec against Postgres with the four trail shapes
  above.
- `node --test k8s/release-tasks/check-tasks.test.mjs` and `node k8s/release-tasks/check-tasks.mjs`.

## Acceptance criteria

- [ ] The task directory has `task.env`, `check.sh` and `post.sh`, and `check-tasks.mjs`
      passes.
- [ ] `--count` on the copy is in the PR, per chain, before any write.
- [ ] After the write run on the copy, every selected product has no size, and a second run
      counts 0.
- [ ] No product a person sized changed, and no price row changed.
- [ ] Nothing is deleted.
- [ ] The windows and `PRODUCTION_RELEASE` are within 14 days of the commit that writes them.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "wash"
npx nx test luna-shopper-backend-catalog -t "size writers"
node k8s/release-tasks/check-tasks.mjs
node --test k8s/release-tasks/check-tasks.test.mjs
npx nx affected -t lint test
```

## Decisions

**D1 (owner, 2026-11-16, decision 27b):** the owner gives an explicit yes to rewriting the size
of these products. A release task does it, in this plan of its own, never a migration.

**D2 (owner, 2026-11-16, from plan `0270` D2):** plan `0270` rewrites no stored product. This
plan does, after `0270` is merged.

**C1 (builder choice, for the owner):** the corrected value is no size, never the content
another row states (section 2). The command lists the products that have such a row.

**C2 (builder choice, for the owner):** `DATABASES` is `catalog` only, because the task writes
only catalog. The harvester database is read and not dumped.

**C3 (builder choice, for the owner):** a missing `CREATE` row is a refusal, not a skip
(section 3). A task whose trail cannot speak for a product is data it was not written for.

## Open questions

**O1 (owner):** the trail cannot tell a queue create where the person typed the size from one
where the person named nothing. Both are a `SERVICE` `CREATE`. (a) Correct them (recommended):
the create writes the row's count when nothing is named, and a person who typed the same count
made the claim the owner ruled out on 2026-11-11, that a wash is a size. (b) Skip every product
created from the queue. That skips nearly every product the task is for.

**O2 (owner):** an `ADMIN` row is a person or a curation tool under an admin login, and the
trail does not separate them. This plan skips both. The dry count prints `person <n>`. If that
number is large, the owner can name the products to correct in a later task.
