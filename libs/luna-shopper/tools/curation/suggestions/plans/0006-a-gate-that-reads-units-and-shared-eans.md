# 0006 A gate that reads units and shared EANs

> Found by `apps/luna-shopper-backend/plans/0150` (report findings 10 and 11, and
> `part1/curation/curation.md` in the report folder). Curation cli plan `0005` handles a row
> that fails. This plan stops the two rows `0150` saw fail and fixes two false readings of the
> gate. Backend plan `0155` fixes the `NAME_SIZE` candidates, which come from the harvester and
> not from here.
>
> In `0150`, the gate refused a correct link for Fabada because it compared 420 with 0.42 and
> ignored that one is grams and the other kilograms. Twenty EANs were shared by 56 Mercadona
> products, and the curator was not told, so two products sharing one EAN passed as a link and
> a batch of creates collided in the rehearsal. The brand registry was empty, so every brand
> became a review, and the operator registered 65 brands by script.

## Brief for the agent

### Objective

Make the suggestions decider cap its search text, compare sizes in base units, mark shared
EANs before it decides, refuse a link to an id it did not show the model, and write the list
of brands to register as a file an operator can act on.

### Context

- **Search.** `suggestions/src/commands.mjs:250-260` sends the whole `normalizeName(entry.name)`
  to `gateway.mjs:70-78` with no cap. The gateway limit is 120 characters
  (`catalog-admin.dto.ts:47`).
- **FORMAT_MISMATCH.** `decision.mjs:288-301` uses `sameNumber` (`:175-177`), which compares raw
  numbers. The units are there (`entry.sizeFormat`, `linkTarget.defaultUnit`) and ignored. The
  groups library already has `deriveUnitFamilies` (`groups/src/rules.mjs:144-157`). Tests:
  `decision.test.mjs:455-465`.
- **LINK_TARGET_MISSING.** It runs on every link (`decision.mjs:271-278`) and on refs
  (`commands.mjs:697-704`). But `main.getItem` as a fallback (`commands.mjs:689-690`) lets a
  real id that the packet did not show pass. The prompt says "not in the packet"
  (`prompt.md:166`). `getItem` swallows every error (`gateway.mjs:81-89`), which reads as a
  missing target.
- **Shared EANs.** Batches group by name only (`commands.mjs:331-346`). The rehearsal shows an
  EAN's owner as `eanMatch` (`:297-301`). `EAN_CONFLICT` checks the main catalog only
  (`:708-711`, `decision.mjs:261-268`). A duplicate create fails the rehearsal's unique EAN and
  becomes `REHEARSAL_WRITE_FAILED` (`:773-795`). A link where both sides share one EAN passes,
  because only a differing EAN is flagged (`decision.mjs:280`).
- **Brands.** `end` writes `unregisteredBrands` to `report.json` (`commands.mjs:897-924, 960`).
  An empty registry gets only a note (`:180-184`). Backend plan `0160` adds
  `brands/register-many`, and admin plan `0035` gives it a screen.
- The model walks `gemma4-32k` through Ollama by the developer's choice.

### Target state

- Every search text is cut to 120 characters at a word boundary.
- `FORMAT_MISMATCH` converts both sides to grams, millilitres or units before it compares. 420
  g equals 0.42 kg.
- `start` indexes the queue by EAN. Each entry whose EAN another queued entry of the chain
  shares carries `sharedEan: [ids]` in its packet, and a decision on it becomes a `REVIEW`
  with the issue `SHARED_EAN`, whatever the model answered.
- A link whose target was not in the packet is `LINK_TARGET_NOT_SHOWN`, a retryable issue, even
  when the id exists. `getItem` tells a missing item from a failed request.
- `start` with an empty registry stops and prints the command below, unless
  `--allow-empty-registry` is given.
- A new command, `propose-brands --run-dir <dir>`, reads the queue with no model and writes
  `brands-to-register.json`: each printed brand, its key, how many entries carry it, and a
  suggested label. The file is the body `brands/register-many` takes, after a person edits it.

### Scope

Work only in `libs/luna-shopper/tools/curation/suggestions/` (source, prompt, tests).

Do not touch: the orchestrator, the groups decider, the gateway, or the harvester.

### Constraints

- No new npm dependency. Copy the unit table from `groups/src/rules.mjs` or import it if the
  libraries already share code. Do not create a new shared library for this.
- No brand is registered by the CLI. The file is a proposal for a person.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing the decision format, `CONFIDENCE_THRESHOLD`, or the retry count.

### Progress evidence

- Tests: the cap, 420 g against 0.42 kg, a shared EAN turning a link into a review, a real but
  unshown id refused, the empty registry stop, and `propose-brands` output for a fixture queue.
- `npx nx test` passes for the suggestions project.
- A Mercadona walk of 300 rows that includes row 173 of the `0150` run, with its summary pasted
  in the PR. Use `--engine ollama --model gemma4-32k` and stop the model afterwards.
