# 0098 A model works the entry queue

## Where this starts

A harvest run leaves rows in `source_catalog_entries` that no rung of the matching
ladder could settle: status `CANDIDATE` (the ladder proposed something at
confidence 0.6) or `UNRESOLVED` (it proposed nothing). Today a person works that
queue in the back office, one row at a time, through three gateway routes:

- `GET  /v1/admin/harvest/entries` lists the queue per chain.
- `POST /v1/admin/harvest/entries/:id/accept` binds an entry to an existing item.
- `POST /v1/admin/harvest/entries/:id/item` creates a catalog item and binds in one call.
- `POST /v1/admin/harvest/entries/:id/reject` marks a row junk.

The judgment the person applies is written down twice: in
`apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts` (the
deterministic rungs) and in closed PR #226, which stated the six naming and
merging rules and shipped a human-in-the-loop tool shaped as packet, judgment,
validated apply. That PR was closed, but its rules are the ones this repo works
by, and its shape is the one this plan reuses with a model in the judgment seat:

1. Same brand plus same format merges. Nothing else does.
2. A name never carries its brand.
3. A name never carries its size. Size goes to `unitSize` and `defaultUnit`.
4. A range name stays when two products need telling apart (Intensive, Flex, Total).
5. The brand is the line, not the maker. `Elvive`, not `L'Oréal`.
6. A private label never crosses a chain. Hacendado on two chains is two products.

The standing rule in `matching.ts` and plan 0086 is that only an EAN or a person
ever makes a row `ACTIVE`. This plan changes that policy on purpose, and narrowly:
a model may decide, but every write still goes through the same admin routes the
person uses, under the operator's own admin session, with a decision log the
operator can read afterward. The tool is the operator's delegate, not a new
actor in the backend.

## What this plan builds

A workspace CLI, no backend change of any kind:

- `tools/catalog/review-entries.mjs`, the tool.
- `tools/catalog/review-entries-prompt.md`, the system prompt the model runs with.
- `tools/catalog/private-labels.json`, the known private label to chain map
  (seed it with what PR #226 established: `Hacendado` is Mercadona's,
  `Ifa Unnia` is El Jamón's; the file exists so an admin can extend it).
- `tools/catalog/fixtures/`, checked in sample queue entries and catalog answers.
- `tools/catalog/review-entries.test.mjs`, run with `node --test`. No network.

The tool is plain Node with zero dependencies. That is a hard constraint, not a
preference: adding a package means running `npm install` on Windows, which prunes
other platforms' bindings from `package-lock.json` and fails CI at `npm ci`. The
Claude API is one `fetch` call, and the repo's own `tools/release/*.mjs` set the
zero dependency precedent.

## The loop

For each queued entry (statuses `CANDIDATE` and `UNRESOLVED`, oldest first so a
rerun continues where the last one stopped):

**1. Deterministic pre-pass, no model.** Resolve the entry's `supermarketId`
against the catalog's supermarket list once per run. Look up the entry's EAN in
catalog. Search catalog for candidate items with the normalized entry name
(reimplement `normalizeName` from `matching.ts` verbatim: NFD, strip combining
marks, lowercase, collapse non alphanumerics). Collect the top candidates with
their `name`, `brand`, `unitSize`, `defaultUnit`, `ean`, `category`.

**2. One model call.** `claude-sonnet-5`, `thinking: {"type": "adaptive"}`,
`output_config: {"effort": "medium"}`, `max_tokens` 8000, over raw
`POST https://api.anthropic.com/v1/messages` with headers `x-api-key`,
`anthropic-version: 2023-06-01`, `content-type: application/json`. The system
prompt is one stable block carrying the six rules, the decision contract, the
category and unit vocabularies, and the private label map, with
`cache_control: {"type": "ephemeral"}` on it so a 349 entry run pays for it
once. The user message is the entry (name, brand, EAN, unit size, size format,
category path, chain name, `extra`) plus the pre-pass candidates. The model
answers with exactly one JSON object:

```json
{
  "decision": "LINK" | "CREATE" | "REVIEW",
  "itemId": "uuid, LINK only",
  "item": {
    "nameEs": "…", "nameEn": "…", "brand": "… or null",
    "unitSize": 1, "defaultUnit": "L", "category": "…", "ean": "… or null"
  },
  "confidence": 0.97,
  "issues": [{ "code": "…", "detail": "…" }],
  "reasoning": "one or two sentences"
}
```

A reply that is not valid JSON, or that fails the local schema check, is retried
once with the parse error appended; a second failure records the entry as
`REVIEW` with issue `MODEL_OUTPUT_INVALID`. On 429 and 5xx, retry with
exponential backoff. Category and unit vocabularies are read at startup from
the committed `apps/luna-shopper-backend/gateway/docs/openapi.json`, never
hand copied, so they cannot drift.

**3. Threshold.** `confidence < 0.9` demotes any decision to `REVIEW`, and the
issue list must say what was uncertain. The model is told this in the prompt, so
it spends its reasoning on the borderline cases instead of rounding up.

**4. Validators, deterministic, before any write.** A decision that fails any
check is demoted to `REVIEW` with a named issue, whatever its confidence:

- `CHAIN_NOT_REGISTERED`: the entry's `supermarketId` matches no catalog
  supermarket. That case must not happen, which is exactly why it is checked.
- `NAME_CARRIES_BRAND`: a `CREATE` name contains the brand token (normalized compare).
- `NAME_CARRIES_SIZE`: a `CREATE` name matches a size pattern
  (`\d+ (ml|cl|l|g|kg|ud|uds|u)` and the common variants).
- `UNKNOWN_CATEGORY` / `UNKNOWN_UNIT`: a value outside the openapi vocabularies.
- `EAN_CONFLICT`: a `CREATE` whose EAN already belongs to a catalog item, or a
  `LINK` whose target's EAN disagrees with the entry's.
- `FORMAT_MISMATCH`: a `LINK` where entry and item disagree on unit size, rule 1.
- `PRIVATE_LABEL_CROSSES_CHAIN`: the brand is in `private-labels.json` under a
  different chain than the entry's, on either a `LINK` target or a `CREATE`.
- `LINK_TARGET_MISSING`: the `itemId` is not among the pre-pass candidates and
  does not resolve with a direct catalog get.

**5. Write, through the admin routes only.** `LINK` calls `accept` with the
item id; `CREATE` calls the `item` route with the payload the route's DTO
actually names (read it from the contracts, do not guess); `REVIEW` writes
nothing, so the row stays queued where the back office already shows it.
The tool never calls `reject`: junk is a human call, and a wrong reject hides a
row from the queue. It never writes a price; `accept` does that server side,
which is the point of going through the routes.

## Output, exactly as asked

- **stdout**: one JSON line per decided entry, the decision object above plus
  `entryId`, `entryName`, `applied: true|false`. Nothing else, so stdout pipes
  into `jq`.
- **stderr**: one progress line per entry, `52/349 - Leche Semidesnatada 1L`.
- `tools/catalog/out/review-<timestamp>.jsonl` keeps the same lines on disk, and
  `review-<timestamp>-report.json` summarizes: counts per decision, every
  `REVIEW` with its issues, token usage and cache hit totals from `usage`.
  The `out/` directory is git ignored.

## Modes and configuration

- Default is a dry run: the model decides, the log is written, nothing is applied.
- `--apply` performs the writes as decisions pass validation.
- `--limit <n>` and `--chain <supermarketId>` cut the run down.
- `--base-url` names the gateway, default `http://localhost:3000` (slot 0).
- Auth: `LUNA_ADMIN_TOKEN` if set; otherwise log in with `LUNA_ADMIN_EMAIL` and
  `LUNA_ADMIN_PASSWORD` through the same login route the back office uses.
- `ANTHROPIC_API_KEY` is required; the tool refuses to start without it rather
  than failing 52 entries in.

## What this deliberately does not do

- No backend change: no new route, no schema change, no new status. `REVIEW` is
  not a new state; it is the row staying `CANDIDATE`/`UNRESOLVED` with the
  reasons written to the report.
- No automatic `reject`.
- No price writes and no direct database access.
- No change to the matching ladder or to `FUZZY_CONFIDENCE`; runs keep proposing
  at 0.6, this tool decides afterwards at 0.9.

## Verification

`node --test tools/catalog/review-entries.test.mjs`, with `fetch` injected so no
test touches the network or spends tokens. Cover at least: `normalizeName`
agrees with the `matching.ts` cases; each validator fires on a crafted bad
decision and stays quiet on a good one; the confidence demotion; the invalid
JSON retry then `REVIEW` path; a full dry run over the fixtures producing the
expected stdout lines and report. A live smoke run against a dev slot is manual
and documented at the top of the tool file, not part of CI.
