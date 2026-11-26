# curation-cli

This is the tool a person runs to curate the Luna Shopper catalog with a model.
It drives one of two deciders:

- `suggestions` works the harvester's queue of source entries. Each entry is
  linked to a catalog product, or a new product is proposed for it.
- `groups` works the catalog products that are in no product group. Each one is
  put in a group, or a new group is proposed for it.

A run never writes to the main catalog. It writes its decisions to a file. You
read the summary, and then you apply the file in a separate step.

## Before you start

The main API is the gateway the queue is read from. In development it is slot 0
on `http://localhost:3000`. Check that it is up:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

The run takes a rehearsal slot of its own, from slot 1 upwards. You do not start
it. The run brings it up and takes it down.

Always type `--` after the Nx target. Nx reads the flags in front of it as its
own, and drops the ones it does not know without a word.

## 1. Start a run

With Claude, which is the default engine:

```sh
npx nx run luna-shopper/curation-cli:curate -- --implementation suggestions --chain <supermarket id>
npx nx run luna-shopper/curation-cli:curate -- --implementation groups
```

With a model on this machine, through Ollama:

```sh
npx nx run luna-shopper/curation-cli:curate -- --implementation suggestions --engine ollama --model gemma4-32k --limit 30
npx nx run luna-shopper/curation-cli:curate -- --implementation groups --engine ollama --model gemma4-32k --limit 30
```

`--limit` sets how many rows the walk takes. To walk the whole queue, leave it
out. When you are finished, stop the model with `ollama stop gemma4-32k`.

The run makes its own directory under `.curation-runs/`. To name one yourself,
pass `--run-dir`.

## 2. Watch it

stderr names the slot, the run id and the number of rows. Then it prints one
line per row, `n/total - name`. With `--limit`, `total` is the limit.

stdout carries one JSON line per decided row.

## 3. Stop it, and resume it

Press Ctrl+C once. The row in flight is dropped. The report is written over the
rows already decided, and the slot comes down. `kill` and closing the terminal
do the same thing.

If the teardown is stuck, press Ctrl+C a second time. The process stops at once.
It prints the command that takes the slot down, for example:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down 1
```

To continue a stopped run, name its directory:

```sh
npx nx run luna-shopper/curation-cli:curate -- --resume .curation-runs/<run>
```

The resume takes a new slot. It writes the products the run already created
into that slot, so the model sees them again. Then it walks from the first row
that has no decision. It uses the decider, the chain and the main url the run
was started with. To change the engine, the model, the effort or the limit for
the rest of the run, pass `--engine`, `--model`, `--effort` or `--limit`.

## 4. When a row fails

A row that fails is recorded as a REVIEW with the issue `ROW_FAILED` and the
error text. The walk goes on. Three failures in a row stop the walk, because
that is not a problem with one row. The report is still written. Fix the cause
and resume the run.

## 5. Read the summary

The run ends with a summary on stderr. It gives:

- the number of rows of each kind, for example `LINK 12, CREATE 10, REVIEW 8`.
- the number of reviews that are rows that failed.
- the first 20 brands that the registry does not hold, and the file that holds
  all of them.
- the path of `report.json`.
- the exact `--apply` command to paste.

A run of reviews only says that there is nothing to apply.

## 6. Apply

Paste the command from the summary:

```sh
npx nx run luna-shopper/curation-cli:curate -- --apply .curation-runs/<run>/decisions.jsonl
```

This needs no slot and no model. It reads the decider from the run directory
and the main url from the file. For another spelling of the same gateway, pass
`--main-url`. If the main API is not a development slot, pass `--main-user` and
`--main-password`.

The route takes at most 1,000 operations in one request. A bigger file is split
into parts that each fit. A new product and every row that names it stay in the
same part. The parts are written beside the file as
`decisions.part-1-of-3.jsonl` and so on, and they are sent in order. If one part
is refused, the parts before it stay applied and nothing after it is sent. The
message names the parts that are left, one command each.

A 504 is not a refusal. The proxy stopped waiting, but the server can still
apply the part. To find out, wait a few minutes and send the same part again.
A part that landed is refused at `VALIDATE`, because its rows are no longer
queued. That refusal writes nothing. A part that did not land is applied.

## Carry local edits to a cluster

This is plan 0006. You fix products on a local copy of the catalog through the
back office or the admin API. The replay then carries those fixes to staging or
production. It writes a change only when the target product still holds what
the change expected. Every run writes a report, and a dry run is the default.

It carries the fields that an `expect` can guard: `name`, `brand`, `unitSize`,
`approxWeight`, `quantityStep`, `defaultUnit`, `packCount`, `pieceCount` and
the categories (sent as `categorySlugs`).

### Before the first write

- Take a backup of the target's catalog database.
- Replay to staging before production.
- Sign in as a named operator, so that `catalog_audit` on the target names who
  wrote.
- Run the replay after the release that runs release tasks `0007` and `0008`
  on the target. Before it, an edit made on top of what `0007` wrote meets the
  old value there and is reported as a `conflict`.

### 1. Export the changes from the local slot

```sh
npx nx run luna-shopper/curation-cli:curate -- --export-changes .curation-runs/<name>/changes.jsonl \
  --slot <n> --actor <admin id> --since <ISO time> [--until <ISO time>]
```

The export reads the slot's `catalog_audit` with `psql` in the slot's own
catalog container, in a read only session. It writes the product edits of the
named operator only. Repeat `--actor` for several operators. `--since` is
required, so that a whole trail is never exported by accident.

### 2. Read the change list

The first line is a header. Then there is one line per audit row. To hold a
change back, delete its lines.

### 3. Dry run against the target

```sh
npx nx run luna-shopper/curation-cli:curate -- --replay .curation-runs/<name>/changes.jsonl \
  --target-url <gateway url>
```

`--target-url` has no default. Type it each time. The run signs in one time,
reads the products, and reads the source rows of the few products that the wash
rule asks about. It sends no write. stderr prints the counts per class and the
path of the report. The report is a JSON file beside the change list. To name
it yourself, pass `--report`.

The password is never a flag. At a terminal the run asks for it. In a script,
set `CURATION_TARGET_PASSWORD` for the one command. `--main-user` names the
operator, `dev-admin` by default.

### 4. Write

```sh
npx nx run luna-shopper/curation-cli:curate -- --replay .curation-runs/<name>/changes.jsonl \
  --target-url <gateway url> --write
```

The products of class `apply` go through `PATCH /v1/admin/catalog/items/batch`,
100 a request by default (`--batch-size`, at most 1,000). Each edit carries an
`expect` of the values it changes and of the product's name and brand. A product
that moved on the target after the lookup is refused by the server and is
reported, and the rest of the batch is sent again. A product refused only
because it already holds every new value is `already there`.

What each answer does:

- A 400, 409 or 422 with a problem code (an unregistered brand, a barcode
  rule, a category that does not resolve) is a refusal of the content. The
  batch is split in halves until the refused product is alone. It is
  `refused`, and the other products are written.
- A 502, 503, 504 or no answer can hide a write that landed. The run reads the
  batch back, counts what landed as `already there`, and sends the rest again,
  at most three times.
- A 413 halves the batch size once.
- Anything else stops the run: a 429 after three waits of the time the answer
  names, a 401 or 403 after one new login, a second 413, any other 5xx, or a
  fourth lost answer.

When the run stops, it still writes the report and then exits with an error.
The report holds every product written before the stop, the products of the
request it stopped on as `not written` with the answer (or `already there`
when a read back shows they landed), and every product after them as
`not sent`. A `not written` line with `checked: false` could not be read back,
so the target may hold it. The header names the answer under `error`. Fix the cause and run
step 3 again: what was written is `already there`, the rest is `apply`.

### 5. Dry run again

Run step 3 again. Every product that was sent is now `already there`.

### 6. Products whose identity changed

A product that was renamed or given another brand on the target is not written
by step 4. Look at the `identity changed` lines of the report. Put the ids of
the products that you want to send in a file, one id a line, then:

```sh
npx nx run luna-shopper/curation-cli:curate -- --replay-identity .curation-runs/<name>/<report>.json \
  --target-url <the same url> --only .curation-runs/<name>/ids.txt [--write]
```

The `expect` then carries the target's name and brand as the report recorded
them. A report written for another url is refused.

### Queue decisions

Add `--decisions <decisions.jsonl>` to steps 3 and 4 to replay a suggestions
decisions file after the product changes. Every decided row must carry
`expect.observed` (backend plan 0277), or the file is refused whole. A decision
whose product the target does not hold is reported `no twin`. A part refused at
`VALIDATE` loses the refused rows, and the rest is sent again. A queue row that
you decided by hand in the back office leaves no decisions file, so it is not
carried.

### The classes of the report

| Class                 | What it means                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `not carried`         | a product created, deleted or merged locally, or one whose only edits are to `ean`, `sku`, `imageUrl` or `productGroupId` |
| `local gap`           | someone not exported changed the product between two exported edits                                                       |
| `no twin`             | the target has no product with that id                                                                                    |
| `merged on target`    | the target merged the product; the report names the survivor                                                              |
| `excluded: wash task` | a wash count that release task `0007` corrects; found by its rule                                                         |
| `identity changed`    | the target's name or brand is not the one the edit was made on                                                            |
| `already there`       | the target holds every new value                                                                                          |
| `conflict`            | a field holds neither the old nor the new value                                                                           |
| `apply`               | at least one field holds the old value and none holds a third one                                                         |
| `refused`             | the target refused the write, with its code and message                                                                   |
| `not written`         | sent in the request the run stopped on, and not on the target after it; the line names the answer                         |
| `not sent`            | never sent, because the run stopped before it                                                                             |

A dry run cannot predict a refusal of the write itself, such as an
unregistered brand, because the route has no dry run.

The replay never carries a merge, a deletion, a reject, prices, or a brand,
category or product group created locally. Edits to `ean`, `sku`, `imageUrl`
and `productGroupId` are listed in the report and never sent, because no
`expect` guards them.

## What a run directory holds

- `decisions.jsonl`: a header line, then one line per decided row. This is the
  file you apply.
- `state.json`: where the walk is. The decider owns it.
- `report.json`: the counts, every review with its issues, and the unregistered
  brands. It is written when the run ends, however it ends.
- `curation-run.json`: which decider ran, on what engine and model, and what
  the run opened with. A resume reads it.
- `brands.json`: the brand registry as the run read it (suggestions only).
- `rehearsal-catalog.sql`: the rehearsal catalog, dumped when a run fails.
