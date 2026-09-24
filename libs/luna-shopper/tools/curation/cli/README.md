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
