# 0271: a release task takes the wash count off the products made from wash rows

> The owner's answer to O1 of plan `0270`, 2026-11-16: the products already made from wash rows
> are corrected by a release task in a plan of its own. His explicit yes to rewriting these
> rows is decision 27b of the same day (D1 below). Plan `0270` makes a wash state no size from
> now on. This plan corrects what was written before it. Checked against `origin/dev` and the
> branch of PR #997 on 2026-11-16.
>
> The owner's answers of 2026-11-17: the task sets no size and copies no content from another
> entry (D3); it corrects every qualifying product, with no skip for a size a person may have
> set (D4); and it leaves a review list of what it corrected for the curator (D5, section 5).
>
> Prerequisite reading: plan `0270` (on the branch of PR #997 until it merges), plan `0244`
> section 7 (release task `0006`, the shape this task copies), plan `0245` (the comparable
> price), `k8s/release-tasks/README.md`, `k8s/release-tasks/check-tasks.mjs`,
> `k8s/release-tasks/tasks/0006-kilo-pieces-state-their-weight/` and the section "A release
> task runs in a window, on data it expects" in `CLAUDE.md`.
>
> **Builds after plan `0270` is merged into `dev`.** Cut the branch from `dev` after that
> merge. The release that carries this task then carries plan `0270` too, so no new product
> is made from a wash row after the task has run.

## Brief for the agent

### Objective

Add the next free release task under `k8s/release-tasks/tasks/` (expect `0007`, verify) and
the command it runs. The task takes the wash count off every product whose size came from a
printed wash count. It changes no price, deletes nothing, counts before it writes, and leaves
a review list of every product it corrected.

### Context

- **What plan `0270` leaves behind.** Before it, `40 lavados` was read as 40 `UNIT` by DEZA,
  Carrefour, DIA and El Jamón, and by a leaflet whose `size.unit` was `lavados`. A product
  created from such a row is 40 `UNIT` (`createdSize`, `harvester/src/app/harvest/source-entry-size.ts`,
  near line 87). A walk never rewrites a product's size. So such a product keeps 40 `UNIT`
  after plan `0270`, and its comparable price (plan `0245`) stays a price per wash.
- **Mercadona and LIDL are not involved.** Neither table reads a wash (`mercadona/src/lib/units.ts`,
  `lidl/src/lib/size.ts`).
- **Who set a size is not asked.** `items` has no column that says who wrote `unitSize`,
  `defaultUnit` or `packCount`, and the audit trail of plan `0075` cannot tell a queue create
  where the person typed the size from one where the person named nothing. The owner answered
  that this does not matter (D4): he has edited none of these products by hand, and every
  corrected product is reviewed after the task (section 5). So the task reads no audit trail.
- **How a write reaches catalog.** Task `0006` runs a node command in the harvester pod, which
  reads the harvester database and writes through the ordinary item update message
  (`item.update`, `contracts/src/lib/messages/catalog.messages.ts`, near line 190) with the
  harvester's actor. That update recomputes the comparison pair of the product's
  `supermarket_items` rows in its own transaction (`item.service.ts`, near line 3317,
  `sizeMoved`, and `recomputeComparablePrices` in `comparable-price.sql.ts`).
- **Where a task may keep what it found.** The runner keeps the ledger in the ConfigMap
  `release-tasks` of the namespace, and the dumps in the backup bucket for 14 days
  (`k8s/release-tasks/README.md`, "The ledger"). The output of `check.sh` and `post.sh` reaches
  the deploy workflow's log, and the repository's Actions logs are public (`CLAUDE.md`, k8s
  plan 0018). So a task prints counts there and nothing that names a product.

### Target state

1. A task directory `k8s/release-tasks/tasks/<NNNN>-wash-count-leaves-products/` with
   `task.env`, `check.sh` and `post.sh`, in the shape of task `0006`.
2. A command `wash-sizes.js` in the harvester bundle with `--count` (writes nothing),
   `--review <file>` (writes nothing to a database, writes the review list of section 5 to a
   file) and a write mode with `--max <n>` that also writes the review list of what it
   corrected.
3. Every product that section 1 selects has no size after the task, and a pack count only
   when section 2 keeps it.
4. The review list of section 5 is in the ConfigMap `release-task-<NNNN>-review` of the
   namespace after `post.sh` ran, and no line of it reached the deploy log.
5. No price row, no `source_catalog_entries` row, and no product outside the selection changes.

### Scope

- `k8s/release-tasks/tasks/<NNNN>-wash-count-leaves-products/`: `task.env`, `check.sh`,
  `post.sh`.
- `apps/luna-shopper-backend/harvester`: the command `wash-sizes.js` (a second webpack entry,
  as `kilo-pieces.js` is), its selection, its review list, and its specs.
- `k8s/release-tasks/README.md`: a section for the task, like the one of task `0005`, which
  also says how to read the review list.
- No change to catalog: no new subject, and `openapi.json` does not change. No migration, no
  change to any adapter, no change to `item.update` itself.

### Constraints

- **It deletes nothing.** Every write is an item update. No row of any table is removed.
- **The task decides nothing from a name.** It reads the printed `sizeFormat` of `ACTIVE`
  rows and the stored size of the product, and nothing else (the harvester rule of
  2026-11-11: no inference from names).
- **It sets no size.** Ultimately `2 L` should be listed, in the owner's words, but that is the
  curator's work (D3). The task never copies the content another entry states.
- **No price changes.** The effective price and every `item_prices` row stay as they are.
- Every write goes through `item.update` with the harvester's actor, so it is audited and
  refused by the same rules as any edit. No raw SQL into catalog.
- **No product name, id or size reaches the deploy log.** `check.sh` and `post.sh` print the
  counts of section 4 only.
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
everywhere, the review list of the rehearsal and its counts, the specs,
`node k8s/release-tasks/check-tasks.mjs`, and `check.sh` and `post.sh` run against the copy
through the override.

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

A product qualifies when both of these hold:

- one of its qualifying rows has `C` equal to the product's `unitSize`;
- its `defaultUnit` is `UNIT`.

Nothing wider, and nothing narrower. Every product that meets both is corrected, whoever set
its size (D4). A product whose size is 40 `UNIT` and whose rows print no wash count is not
selected, whatever it is.

### 1.3 The check of the reading on the copy

On the rehearsal copy, before plan `0270` has rewritten the rows by a walk, assert for every
qualifying row: its stored `unitSize` is `C` and its `sizeUnit` is `UNIT`, per chain. A row
where that fails means the rule of 1.1 is not the reading of `dev` for that chain, and the
builder stops and reports it.

### 1.4 A person who edits in between

The command reads each product again right before its update, and skips it if it no longer
holds `C` `UNIT`. That is not a rule about who set a size: it only keeps the task from writing
over a value that changed after the count.

## 2. The corrected value

- `unitSize` becomes null. `defaultUnit` stays `UNIT`.
- `packCount` becomes null when it equals `P` of the row that qualified the product. Any other
  pack count stays. Plan `0270` D1 says `2x40 lavados` states no pack count.
- `approxWeight`, the name, the brand, the categories and the images stay.

**No size, and never the content another row states** (D3). A product can have another
`ACTIVE` row that states a real content, a Mercadona `2 l` for example. The task does not copy
it. To pick one row's content for a product is a decision about the product, and that is the
curator's work (memory rule of 2026-11-11: the harvester records, the curator decides). Two
rows of one product can also disagree, and a task cannot know which bottle the product is. No
size is the answer that claims nothing. The review list puts every size text the product's
rows state beside it, so the curator sees the `2 l` (section 5).

**What the shopper sees after.** The comparable price of plan `0245` divides a `UNIT` product
by its `unitSize`, else its `packCount`, else 1. A corrected product is thus compared per pack
and no longer per wash. Lines on lists and baskets keep their product and their quantity.
Nothing in core changes.

## 3. The safety net

The task does not try to tell a size a person set from a size a row wrote (D4). What keeps it
safe is:

- the dry count before any write, refused above the ceiling of the environment (section 4.3);
- `check.sh`, which refuses data the task was not written for (section 4.3);
- the dump of `catalog` the runner takes before the task (section 4.2);
- **the review list** of section 5: every corrected product, with its old size and every size
  text its rows state, for the curator to fix after the task runs. A product that a person had
  sized by hand, if one exists despite the owner's account, is on that list with its old size,
  and one item update puts it back.

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
the task, so the README section says to prefer a second item update for a single product,
with the old size the review list names.

### 4.3 `check.sh`

Copy task `0006`. It reads only, and:

- passes where there is no harvester deployment;
- passes where the harvester pod has no `wash-sizes.js` yet, because it runs before
  `helm upgrade`, and prints that `post.sh` counts after the rollout;
- refuses a ceiling that is not a number;
- runs `wash-sizes.js --count` and refuses when `products` is above
  `MAX_PRODUCTS_<ENVIRONMENT>`;
- refuses a qualifying row whose `C` is not a whole number above 0, which is a stored text the
  pattern of 1.1 was not written for;
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

**The review list.** The write run writes the list of section 5 to a file inside the pod, and
`post.sh` copies it into the ConfigMap `release-task-<NNNN>-review` of the namespace with
`kubectl create configmap ... --from-file=review.tsv --dry-run=client -o yaml | kubectl apply -f -`,
so a second run replaces it and never stacks a second copy. `post.sh` prints only the line
count of the list and the name of the ConfigMap, never a line of it. A run that corrected
nothing leaves an earlier list in place. The ceiling keeps the list far below the 1 MiB a
ConfigMap holds. The runner never deletes that ConfigMap. The owner deletes it when the
curator has worked through it.

### 4.5 Safe to run again

A corrected product has no size, so it no longer equals `C` and is not selected. A second run
counts 0 and writes nothing. No marker is needed.

## 5. The review list (required)

The owner's words of 2026-11-17: "a note to review the products currently saved as lavados to
fix them". Each line is one corrected product, grouped by chain (the chain of the row that
qualified it; a product qualified by two chains is listed under each), then ordered by name.
The columns, tab separated:

| Column | What it holds |
| --- | --- |
| `chain` | The chain's slug. |
| `item_id`, `item_name` | The product's id and its Spanish name. |
| `old_unit_size`, `old_default_unit`, `old_pack_count` | The size the task took off, as it was. |
| `wash_size_format` | The `sizeFormat` of the row that qualified it (`40 lavados`). |
| `stated_sizes` | Every `sizeFormat` its `ACTIVE` rows state, of every chain, as `<chain>: <text>` joined by `; ` (`mercadona: 2 l; deza: 40 lavados`). |

**Where it lives and how the owner reads it.**

- **In a cluster:** the ConfigMap `release-task-<NNNN>-review` of the velista namespace, key
  `review.tsv` (section 4.4). The owner reads it over SSH on the host, as the `deploy` user:

  ```sh
  kubectl -n luna-shopper get configmap release-task-<NNNN>-review \
    -o jsonpath='{.data.review\.tsv}'
  ```

  It never goes through a workflow. A workflow prints counts only, because the Actions logs
  are public.
- **Again at any time:** `wash-sizes.js --review <file>` writes the same columns for the
  products that still qualify, which is the list before a write run. After a run the
  ConfigMap is the record.
- **For the rehearsal:** the builder keeps the list of the copy as
  `tmp/plan-0271/review.tsv` of the main checkout, ignored by git, and does not attach it to the
  PR.

The build PR body carries a heading **"To review after the task runs"**. Under it: the line
count of the rehearsal list per chain, its path, the ConfigMap name, and the command above.

## 6. The dry count

`wash-sizes.js --count` writes nothing and prints one line per fact, numbers only:

```
chain deza 31
chain carrefour 12
chain dia 4
chain eljamon 0
products 47
pack 3
content 7
```

- `chain <slug> <n>`: the products that would change, by the chain of the row that qualified
  them. A leaflet row counts under its chain. A product qualified by two chains counts under
  each, so the lines can sum above `products`.
- `products`: the distinct products that would change.
- `pack`: of them, those whose pack count would be cleared.
- `content`: of them, those with another `ACTIVE` row that states a weight or volume. Which
  rows those are is in the review list, not here (section 5).

The numbers above are an example of the shape, not a measurement. The builder runs it on the
copy before anything is written, and the PR quotes the real output.

## 7. What is recomputed after

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
- No skip by author: a product whose last write was a person's edit to 40 `UNIT` qualifies the
  same as one the harvester created.
- The review list: a corrected product with a Mercadona `2 l` row lists `mercadona: 2 l` in
  `stated_sizes`; the old size columns hold the values before the write; the lines are grouped
  by chain; `--count` prints no id and no name.
- The command: `--count` writes nothing; `--review` writes the list and no database row; a
  write run then a second `--count` print `products 0`; `--max` below the count refuses before
  any write; a product edited between the count and its update is skipped and is not on the
  list.
- `post.sh` against the copy: the ConfigMap is written once, a second run replaces it, and the
  script's output holds no line of the list.
- `node --test k8s/release-tasks/check-tasks.test.mjs` and `node k8s/release-tasks/check-tasks.mjs`.

## Acceptance criteria

- [ ] The task directory has `task.env`, `check.sh` and `post.sh`, and `check-tasks.mjs`
      passes.
- [ ] `--count` on the copy is in the PR, per chain, before any write.
- [ ] After the write run on the copy, every selected product has no size, and a second run
      counts 0.
- [ ] The review list of the rehearsal exists at `tmp/plan-0271/review.tsv`, and the PR body
      has the heading "To review after the task runs" with its counts and the read command.
- [ ] No price row changed, and no product outside the selection changed.
- [ ] Nothing is deleted, and nothing that names a product is printed by `check.sh` or
      `post.sh`.
- [ ] The windows and `PRODUCTION_RELEASE` are within 14 days of the commit that writes them.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "wash"
node k8s/release-tasks/check-tasks.mjs
node --test k8s/release-tasks/check-tasks.test.mjs
npx nx affected -t lint test
```

## Decisions

**D1 (owner, 2026-11-16, decision 27b):** the owner gives an explicit yes to rewriting the size
of these products. A release task does it, in this plan of its own, never a migration.

**D2 (owner, 2026-11-16, from plan `0270` D2):** plan `0270` rewrites no stored product. This
plan does, after `0270` is merged.

**D3 (owner, answered 2026-11-17, decision 34a, was C1):** the task sets no size and never
copies the content another entry states (section 2). His words: "Ultimately, 2L should be
listed but that is work for the curator." He asked for "a note to review the products
currently saved as lavados to fix them", which is the review list of section 5, a required
output of the task.

**D4 (owner, answered 2026-11-17, was O1 and O2):** correct every qualifying product. His
words: "Do not worry about that, I haven't edited any of them by hand. Anyway, they will be
reviewed after the patch. Correct every product." So the task has no skip for an `ADMIN` audit
row, treats a `SERVICE` create like any other, and reads no audit trail at all. The dry count,
`check.sh`, the dump and the review list stay (section 3).

**D5 (owner, 2026-11-17):** the review list is required, lives in the ConfigMap of section 4.4
in a cluster, and is named in the build PR under "To review after the task runs".

**C2 (builder choice, for the owner):** `DATABASES` is `catalog` only, because the task writes
only catalog. The harvester database is read and not dumped.

**C4 (planner choice, for the owner, 2026-11-17):** with the skip gone, the catalog read
subject that answered the audit trail of each product, the `person` and `unknown` lines of the
dry count, and choice C3 (a missing `CREATE` row refuses the task) leave the plan. They served
only to attribute a size, which D4 no longer asks for. The task therefore changes nothing in
catalog.

**C5 (planner choice, for the owner, 2026-11-17):** the review list lives in a ConfigMap of the
namespace, beside the ledger the runner keeps there, and not in the deploy log or the backup
bucket. The log is public. The bucket drops a file after 14 days, and the curator can take
longer. The ConfigMap stays until the owner deletes it.

## Open questions

None.
