> **PR:** [#1112](https://github.com/IchirokuXVI/nx-portfolio/pull/1112)

# 0279 A release task takes the wash count off sums and short words

> Picked up on 2026-11-26 from backlog `0029`, after the owner answered O1 to O3 (see
> "Decisions"). It is built as release task `0009`.

> Found on 2026-11-20 by the rehearsal of the harvester round on a copy of the staging data of
> that day (itself a copy of production of 2026-11-19, after release tasks `0006` to `0008` ran
> on staging). Release task `0007` (plan `0271`) left 73 products that hold a wash count as their
> size. The owner decided on 2026-11-25 (decision 140a of the harvester round) that a wider
> release task fixes them on production. This plan designs that task.
>
> Every anchor below was read on `origin/dev` at `b0f22b124` on 2026-11-25. Line numbers are of
> that commit. `wash-sizes.ts` means
> `apps/luna-shopper-backend/harvester/src/app/release-tasks/wash-sizes.ts`.
>
> Prerequisite reading: plan `0271` (all of it: this task copies its shape and its decisions),
> plan `0270` (a wash is no size), `k8s/release-tasks/README.md` (the rules, and the sections
> "Task 0007" and "Task 0008"), `k8s/release-tasks/tasks/0007-wash-count-leaves-products/`, and
> the section "A release task runs in a window, on data it expects" in `CLAUDE.md`.
>
> The evidence of the rehearsal stays in `tmp/harvester-round/staging-rehearsal/` of the main
> checkout, ignored by git: `findings.md` (sections 3 and 4), `fixes-applied.tsv`,
> `evidence/fix-candidates.tsv` and `evidence/fix-needs-owner.tsv`. Those files hold production
> ids and names. Nothing from them goes into a commit.

## Brief for the agent

### Objective

Add the next free release task under `k8s/release-tasks/tasks/` (expect `0009`, verify) and the
command mode it runs. The task takes the wash count off every product whose size is a wash
count printed as a sum (`35+18 lavados`, `30+6lav`) or as El Jamón's short word (`40lav`,
`60lv`). Task `0007` did not select these rows. The task sets no size, changes no price,
deletes nothing, counts before it writes, and leaves a review list of what it corrected.

### Context

- **What `0007` selects.** An ACTIVE bound row whose `sizeFormat` matches `WASH_FORMAT`
  (`wash-sizes.ts` line 87): an optional `N x`, a whole number, `lavado` or `lavados`, at most a
  full stop. Its comment says so plainly: "`23+12 lavados` does not match" (line 85). The plan
  says the same, "`23+12 lavados` does not (a sum never had a size)" (plan `0271`, line 128).
  `planWashSizes` reads only `readWashFormat` to qualify a product (lines 446 to 454), so a row
  that matches no `WASH_FORMAT` never qualifies its product.
- **Why it missed the 73.** `0007` does read both shapes, but only as notes. `SHORT_WASH_WORD`
  (line 149) and `WASH_SUM` (line 157) are read by `readNoteFormat` (lines 170 to 187), and
  `noteKindOf` (lines 531 to 545) turns a match on a product that holds the count into a note of
  kind `short-wash-word` or `sum`. A note is never corrected (comment, lines 31 to 35 and 46 to
  49). The comment on the short word gives the reason: "No old parser read these as a size, so
  where the product's size came from is not known" (lines 47 and 48). So the miss is a choice of
  the plan, not a bug in the code. The data then proved the premise wrong: such products do hold
  the count.
- **What the counts said.** On the copy, before any fix, `wash-sizes.js --count` printed
  `products 0`, `short-wash-word 60`, `sum 15` (`evidence/release-task-counts-before.txt`). A
  note counts rows, not products. The 75 rows belong to 74 products: 12 DEZA sums, and 62 El
  Jamón products (59 short words, 3 short sums such as `30+6lav`). One of the 62 is a capsule
  product whose `10lav` a DEZA row confirms as `10 ud`; decision 156b holds it back (section
  1.5), so the task corrects 73: 12 DEZA and 61 El Jamón (58 short words, 3 short sums). The
  build measured these on the copy of 2026-11-20.
- **What the rehearsal did.** It cleared the 73 sizes on the local copy only, through
  `PATCH /v1/admin/catalog/items/{id}` (class F1 of `fixes-applied.tsv`). After that, and after
  the walks of the rehearsal, the count printed `short-wash-word 1` and `sum 0`. That one row is
  not explained in the findings. Nothing was written to staging or production.
- **The owner's rules that hold here.** A wash is not a unit (2026-11-11). The harvester records
  and the curator decides, with no inference from names. Plan `0271` D3: the task sets no size
  and never copies the content another row states. Plan `0271` D4: every qualifying product is
  corrected, whoever set its size. Decision 140a: fix the 73 on production.
- **How the check phase runs.** Both deploy paths run `run-release-tasks.sh --phase check` for
  every due task before any task writes. So the new task's `check.sh` can run while `0007` has
  not yet written on that cluster. Its count must not depend on `0007` having run (section 1.3).

### Target state

1. A task directory `k8s/release-tasks/tasks/0009-wash-sums-and-short-words-leave-products/`
   with `task.env`, `check.sh` and `post.sh`, in the shape of task `0007`.
2. A selection for this task in the harvester's wash command (section 3), with `--count`,
   `--review <file>` and `--max <n> --review <file>`, as `0007` has.
3. Every product that section 1 selects has no size after the task. Its pack count stays.
4. The review list is in the ConfigMap `release-task-0009-review` of the namespace, and no line
   of it reached the deploy log.
5. Task `0007` answers exactly what it answered before, on the same data.
6. No price row, no `source_catalog_entries` row, and no product outside the selection changes.

### Scope

- `k8s/release-tasks/tasks/0009-.../`: `task.env`, `check.sh`, `post.sh`.
- `apps/luna-shopper-backend/harvester`: the selection of section 1 in the wash command and its
  specs (section 3).
- `k8s/release-tasks/README.md`: a section "Task 0009", like the one of task `0007`.
- Nothing else. No catalog change, no migration, no adapter change, no `openapi.json` change.
  Classes F2, F3 and F4 of the rehearsal are not in scope unless the owner answers O1 otherwise.

### Constraints

- It deletes nothing. Every write is an `item.update` with the harvester's actor, one catalog
  transaction per product, under an `expect` of the product as the task read it.
- It reads the stored `sizeFormat` of ACTIVE rows and the stored size of the product, and nothing
  else. No name, no audit trail.
- It sets no size and copies no content (plan `0271` D3).
- It selects by rule. No product id, entry id or name is committed, in code, in a spec, in
  `task.env` or in a PR body. Spec fixtures use made up ids.
- `check.sh` and `post.sh` print counts only. The deploy log is public.
- `task.env` holds only comments and `NAME="value"` lines, with no blank line. The windows and
  `PRODUCTION_RELEASE` are written in the PR that ships the task, within 14 days of that commit.

### Action boundaries

- Rehearse on a fresh copy of real data in an ephemeral Luna slot, never on a cluster. Do not
  reuse the database of the 2026-11-20 rehearsal: its F1 rows are already fixed.
- Run `--count` on the copy first and put its output in the PR before any write.
- Stop and report if `products` on the copy is above 80, if a chain other than DEZA and El Jamón
  shows up, or if `0007`'s `--count` changes on the same data after your change to the command.
- Stop and report before you add a dependency, change catalog, or touch a task directory other
  than the new one.

### Progress evidence

The `--count` output of the new selection on the copy before and after a write run (the second
printing `products 0`), `0007`'s `--count` on the same copy before and after your change (equal
before the write run), the review list of the rehearsal kept in `tmp/plan-0279/` of the main
checkout, the specs, `node k8s/release-tasks/check-tasks.mjs`, and `check.sh` and `post.sh` run
against the copy through the `WASH_SIZES` override.

## 1. Which products qualify

### 1.1 The rows

Every `source_catalog_entries` row with `status` `ACTIVE` and an `itemId`, whose trimmed
`sizeFormat` matches one of these two patterns of `wash-sizes.ts`, unchanged:

- **A sum**, `WASH_SUM` (line 157): `N+M lavados`, `N+Mlav`, `N+Mlv`, spaces allowed around the
  `+`, at most a full stop. Its count `C` is `N + M`.
- **A short word**, `SHORT_WASH_WORD` (line 149): a whole number, at most one space, `lav` or
  `lv`, at most a full stop. Its count `C` is the number.

The rows are found with `SELECT_WASH_ROWS_SQL` (lines 223 to 227) as today. Its prefilter
`WASH_PREFILTER` (line 220) already admits both shapes.

### 1.2 The products

A product qualifies when one of its qualifying rows has `C` equal to its `unitSize`, and its
`defaultUnit` is `UNIT`. This is `selects` (lines 415 to 421), unchanged. Nothing wider, and
nothing narrower but the hold of section 1.5 (decision 156b). A merged or missing product
counts as `held`, as in `0007`.

### 1.3 How this differs from `0007`, and why

| | `0007` | this task |
| --- | --- | --- |
| Qualifying text | `WASH_FORMAT` only | `WASH_SUM` and `SHORT_WASH_WORD` only |
| Sums and short words | noted, never corrected | corrected |
| `40 lavados`, `2x40 lavados` | corrected | not read |
| Pack count | cleared when it is the printed `N` | never cleared: neither shape prints a pack |

The two selections are disjoint by row on purpose, not by product. The check phase runs before
`0007` writes on a cluster, so a selection that also held `0007`'s rule would count `0007`'s
products too (76 on production on 2026-11-19, plan `0271`'s ceiling note) and refuse above its
own ceiling. With disjoint rules no row qualifies under both, and neither count depends on the
other task having run. A product bound to both shapes (one row `40 lavados`, another `40lav`,
both matching) is still counted by both check phases, because both run before either writes. It
is corrected by whichever task writes first (`0007`, in the order of release `0.20.0`), and the
other then finds it has no size and leaves it alone.

`pack-of-units` (Carrefour) and `mercadona-per-wash` stay notes. See O2.

### 1.4 A person who edits in between

As `0007`: the command reads each product again right before its update, and skips it if it no
longer holds `C` `UNIT`.

### 1.5 A count a chain confirms (decision 156b)

A product that section 1.2 selects is held back when another ACTIVE row bound to it states the
same number `C` as a count of units. The rule reads stored row fields only, never a name
(`statesUnitCount` in `wash-sizes.ts`). The other row:

- has a trimmed `sizeFormat` that is a count of pieces: a whole number, then `u`, `ud`, `uds`,
  `unid`, `unids`, `unidad` or `unidades`, at most a full stop (`10 ud`, `10 uds.`), or the bare
  word with no number, as Mercadona stores it (`ud`). A number it prints is `C`. So a wash text
  (`10 lavados`, `10lav`), a sum and a volume (`1.6 L`) never confirm, and neither do
  `10 dosis` or `10 cápsulas`, because a dose can be a wash;
- stores `C` as its size in `UNIT` (`unitSize`, `sizeUnit`), which is how DEZA stores `10 ud`;
- states no pack (`packCount` null);
- is not priced per wash (its latest price label is not `lv`).

Only ACTIVE bound rows are read, so a CANDIDATE row confirms nothing. A held product is counted
as `confirmed-units` in `--count` (after `held`, under this selection only), noted under the
kind `confirmed-units` with the confirming row's chain and text in `row_size_format`, and never
written. The ceiling counts `products` only. On the copy of 2026-11-20 the hold catches 1
product (El Jamón `10lav`, DEZA `10 ud`). The other 7 capsule products among the 74 have no
second row, so the task corrects them.

## 2. The corrected value

- `unitSize` becomes null. `defaultUnit` stays `UNIT`. `packCount` stays.
- Name, brand, categories, images and `approxWeight` stay.
- No size is set and no other row's content is copied (plan `0271` D3). The review list puts every
  size text the product's rows state beside it, for the curator.

After the task, the comparable price of plan `0245` compares such a product per pack, through the
ordinary recompute inside `item.update`. No price row changes. The source rows keep their text.

**Will a walk write the size back?** A walk never rewrites a product's size (plan `0271`,
Context). A new product made from such a row takes the row's created size. The builder asserts
in a spec that the current DEZA and El Jamón readings of `35+18 lavados`, `30+6lav` and `40lav`
state no size. If one of them states a size, stop and report: that is a parser defect for its own
plan, and this task would only clean up after it.

## 3. The command

Plan `0271` built `wash-sizes.js` for task `0007`. This task reuses its reading, its review list
and its run logic, and adds a selection:

- `planWashSizes` takes the selection as an argument: `printed-count` (today's, the default) or
  `sum-and-short-word` (section 1). The default answers exactly what it answers today, so
  `0007`'s `check.sh` and `post.sh`, which pass no selection, are unchanged.
- A flag `--selection sum-and-short-word`, read by `parseWashSizesArgs` with the other flags.
  Anything else is refused, as today.
- Under the new selection, the notes keep `pack-of-units` and `mercadona-per-wash`, and drop
  `sum` and `short-wash-word`, because those are now corrections. A product the task corrects is
  not noted, as today.
- The ConfigMap name is a parameter of the run, not the constant `REVIEW_CONFIGMAP` (line 683),
  so the two tasks never write over each other's list.
- `--count` prints the same lines as today. `pack` is always 0 under the new selection.

The builder may instead add a second webpack entry if that is clearly simpler. The constraint
is the one of section 1.3 and Target state 5: `0007` answers what it answered before.

## 4. The task

### 4.1 `task.env`

```sh
# Take the wash count off the products whose size is a printed sum or short word
# (backend backlog plan 0029, built as plan 0279).
UNIT="velista"
RUN_UNTIL_STAGING="<a UTC date, at most 14 days after the commit that writes it>"
RUN_UNTIL_PRODUCTION="<a UTC date, at most 14 days after the commit that writes it>"
PRODUCTION_RELEASE="<the version, such as 0.21.0, without its v>"
DATABASES="catalog"
MAX_PRODUCTS_STAGING="<n>"
MAX_PRODUCTS_PRODUCTION="<n>"
```

The ceilings are the read only count of each cluster, measured with `--count` in the pod before
the PR, rounded up to the next ten. The rehearsal predicts 73 on both (staging held a copy of
production), so 80. Write other numbers only from a count you read, never to get past one.
`PRODUCTION_RELEASE` is the velista release that carries the command; see O3.

### 4.2 `check.sh`

Copy `0007`'s, with `--selection sum-and-short-word` appended to the command. It reads only, and:

- passes where there is no harvester deployment;
- passes where the pod has no `wash-sizes.js`, or one that does not know the flag (it runs before
  `helm upgrade`), and prints that `post.sh` counts after the rollout;
- refuses a ceiling that is not a number;
- refuses `products` above `MAX_PRODUCTS_<ENVIRONMENT>`;
- refuses a qualifying row whose `C` is not a whole number above 0 (`unread`);
- refuses anything it cannot read;
- passes with `products 0`, which is also how it finds its own earlier run.

To tell an old command from a new one, the builder may run `--selection sum-and-short-word
--count` and read a usage refusal as `old`. Anything else that fails is a refusal.

### 4.3 `post.sh`

Copy `0007`'s: count, refuse as `check.sh` does, do nothing at `products 0`, write with
`--max <ceiling>`, count again. Copy the review list into `release-task-0009-review` with
`kubectl apply`, merged with what an earlier run recorded, as `0007` does. Print only the line
counts and the ConfigMap name. Refuse where the pod has no new command, so the task stays at
`pre-done` and the next deploy finishes it.

### 4.4 Safe to run again

A corrected product has no size, so it no longer equals `C`. A second run counts 0 and writes
nothing. No marker is needed.

## 5. The review list

Same columns as `0007` (plan `0271` section 5). `wash_size_format` holds the sum or the short
word. Read it on the host as the `deploy` user:

```sh
kubectl -n luna-shopper get configmap release-task-0009-review \
  -o jsonpath='{.data.review\.tsv}'
```

The build PR body carries the heading **"To review after the task runs"** with the line counts
of the rehearsal list per chain, its path, the ConfigMap name and the command above. The list is
the curator's input. After this task, those products join the wash products with no size that
`fix-needs-owner.tsv` calls N2.

## 6. Verification on a staging copy

1. Take a dump of the staging `catalog` and `harvester` databases (the backup bucket, or the
   copy recipe of the memory note "Realistic catalog to measure on").
2. Restore both into an ephemeral Luna slot (`luna-slot.sh --ephemeral --up <n>`), run the
   migrations, and build the harvester bundle.
3. Run `0007`'s command with no selection, `--count`, before your change and after it. The two
   outputs are equal. On staging data of 2026-11-20 they print `products 0`, `short-wash-word
   60`, `sum 15`.
4. Run `--selection sum-and-short-word --count`. Expect `chain deza 12`, `chain eljamon 61`,
   `products 73`, `pack 0`, `unread 0`, `confirmed-units 1`. Explain any other number before you
   go on, including the one `short-wash-word` row that the 2026-11-20 rehearsal still saw after
   its fixes: it is the product section 1.5 holds back, and `0007`'s count still notes it after
   this task.
5. `--review tmp/plan-0279/review.tsv`, then the write run with `--max 80`, then `--count`
   again: `products 0`. `0007`'s count now prints `short-wash-word 0` and `sum 0`.
6. Assert on the copy: no `item_prices` row and no `supermarket_items` price changed; only the
   selected products changed, and only `unitSize`.
7. Run `check.sh` and `post.sh` against the copy through the override:
   `ENVIRONMENT=staging WASH_SIZES='node dist/apps/luna-shopper-backend-harvester/wash-sizes.js' bash check.sh`.
   Confirm their output holds no id and no name.
8. `node k8s/release-tasks/check-tasks.mjs` and `node --test k8s/release-tasks/check-tasks.test.mjs`.
9. `--down` the slot.

## Tests

- Selection: `35+18 lavados` at 53 `UNIT` qualifies; `30+6lav` at 36 `UNIT` qualifies; `40lav`
  and `60 lv.` at their number qualify; `40lav` at 42 `UNIT` does not; `40lav` at 40
  `MILLILITER` does not; `40 lavados` at 40 `UNIT` does not (it is `0007`'s); a `CANDIDATE` row
  does not; the pack count stays.
- Default selection: every existing `wash-sizes.spec.ts` case passes unchanged.
- Notes under the new selection: `pack-of-units` and `mercadona-per-wash` are noted; `sum` and
  `short-wash-word` are corrected and not noted.
- Arguments: an unknown `--selection` value is refused.
- The ConfigMap name of each task is its own.
- The parsers: the readings of section 2 state no size, also for `60lv` and `60 lv.`.
- The hold (section 1.5): `10lav` beside `10 ud` is held, counted as `confirmed-units` and
  never written; no hold when the other row states `12 ud`, is not ACTIVE, is a wash text
  (`10 lavados`) or states a volume (`1.6 L`); the default selection answers the same with such
  rows present.
- Near misses that are never selected: `40  lav`, `4x10lav`, `2+1`, `10 ud`, `40 toallitas`,
  `3+1 L`. A product whose rows disagree (`40lav` beside `1.6 L`) is corrected and counted
  under `content`.
- The usage text of the older command, which `check.sh` and `post.sh` match on, is pinned.

## Acceptance criteria

- [ ] The task directory has `task.env`, `check.sh` and `post.sh`, and `check-tasks.mjs` passes.
- [ ] `0007`'s `--count` on the copy is equal before and after the change.
- [ ] The new `--count` on the copy is in the PR, per chain, before any write.
- [ ] After the write run every selected product has no size, and a second run counts 0.
- [ ] No price row changed, and no product outside the selection changed.
- [ ] Nothing that names a product is printed by `check.sh` or `post.sh`, or committed.
- [ ] The windows and `PRODUCTION_RELEASE` are within 14 days of the commit that writes them.

## Open decisions for the owner

**O1. Classes F2, F3 and F4: in this task, or manual?** The rehearsal also prepared 26 writes
that set a value (`evidence/fix-candidates.tsv`):

- F2, 4 DEZA products that hold the wash count of their name as size while the row states a
  volume (`NORIT sensible 40 lavados`, row `2.12 L`, held as 40 `UNIT`). No row prints a wash
  count, so no rule on stored fields can tell this 40 from a real count without reading the name.
- F3, 16 DEZA wash products with no size (most from `0007`) whose own name ends with a content
  (`PLUS MAX azul 1.6 L`). Selecting them reads the name.
- F4, 6 Mercadona products with no size whose row states a count in `ud` (diapers 14 and 20,
  masks 10, denture tablets 32). These are no wash products. Fixing them copies the row's count.

Options:

- **A. Manual (recommended).** The curator or the owner applies them through the back office or
  `PATCH /v1/admin/catalog/items/{id}`, from the prepared list. Each is a judgment per row, they
  are few, and every one of them sets a value, which plan `0271` D3 keeps out of a task. F2 and
  F3 also read a name, which the rule of 2026-11-11 forbids.
- **B. A second task for F2 and F4 only**, which copies a content when the product's rows state
  exactly one. This needs the owner to lift D3 for that shape, and it still leaves F3 manual.
- **C. All in this task.** Needs D3 lifted and name reading allowed. Not recommended.

**O2. Carrefour `pack-of-units`.** `pack de 2 unidades de 50 lavados.` held as 100 `UNIT` is a
wash count as size too. Production has no Carrefour source, and the count was 0 on the copy.
Options: leave it a note (recommended: no data, so nothing to test against real rows), or add it
to the selection with the pack rule of `0007`.

**O3. Which release carries the task.** On 2026-11-25 the newest velista tag is `velista-v0.19.0`,
and `0007` and `0008` wait for `0.20.0`. Options: ship this task in `0.20.0` too, if it is built
before that release, so one deploy runs `0007`, `0008` and this task in order (recommended: the
selections are disjoint, so the order costs nothing); or the release after it.

## Decisions

Decision 140a (owner, 2026-11-25) asks for this task. The owner answered O1 to O3 on
2026-11-26:

- **O1: A.** Classes F2, F3 and F4 (the 26 writes that set a value) stay manual. They are not
  in this task.
- **O2: a note.** Carrefour `pack-of-units` stays a note, and is not in the selection.
- **O3: `0.20.0`.** The task ships in velista release `0.20.0`, in order after tasks `0007` and
  `0008`.

Decision 156b (owner, 2026-11-26), after the build counted 74 where the plan said 73: the task
holds back a product when another ACTIVE row bound to it states the same number as a count of
units. El Jamón prints `10lav`, the product holds 10 `UNIT`, and DEZA states `10 ud`: the 10 is a
real count a chain confirms (a capsule product, one capsule per wash), and the task must not
clear it. Section 1.5 states the rule. The owner approved 73 products on the staging copy; with
the hold the task corrects 73 and holds 1.
