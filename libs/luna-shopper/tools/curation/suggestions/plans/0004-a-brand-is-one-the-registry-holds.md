# 0004 A brand is one the registry holds

> Depends on `apps/luna-shopper-backend/plans/0115`, which builds the brands registry and its
> routes. Nothing here can run before that plan is deployed to the environment the walk reads.

## Brief for the agent

### Objective

Make `curation-suggestions` read the brand registry once per run, send the registered brand in
the packet, demote a decision whose brand the registry does not hold, and replace
`private-labels.json` with the registry's private label chains, as sections 2 to 6 describe.

### Context

- The curator invents a brand per row today, and nothing checks it. It wrote `+Proteínas` as the
  brand of 24 Mercadona products, which is a range of Hacendado and belongs in the name (rule 4),
  not in `brand`.
- `private-labels.json` holds two entries, `{"Hacendado":"Mercadona","Ifa Unnia":"El Jamón"}`.
  `loadPrivateLabels` and `indexPrivateLabels` (`rules.mjs:161-176`) key it by `normalizeName`
  and compare chains by normalized **name** (`decision.mjs:296-312`). It is loaded as a default
  argument in `commands.mjs:106` and :513, and `buildSystemPrompt` appends it as
  `## Known private labels` (`rules.mjs:189-220`).
- Every validator issue demotes a decision to `REVIEW` (`commands.mjs:697`), and only
  `NAME_GLITCH` is retried (`RETRYABLE_ISSUE_CODES`, `decision.mjs:36`). A REVIEW writes nothing
  and leaves the row queued.
- `gateway.mjs` already pages a list with `pageThrough` (`listSupermarkets`, :40).
- Plan `0115` adds `GET /v1/admin/catalog/brands` (cursor paged, `limit` up to 100, each row
  `{ id, key, label, privateLabelSupermarketId, ... }`) and `brandKey(text)` in
  `libs/luna-shopper/contracts`, with its cases in
  `libs/luna-shopper/contracts/src/lib/brands/brand-key.cases.json`.
- Plan `0115` also makes catalog store a registered brand's label on every item written with
  its key, whatever spelling the request sent.
- Specs pin prompt text: `rules.test.mjs:95-101` and :121-128, `decision.test.mjs:13` and
  :448-468, `commands.test.mjs:35`, `fixtures.test.mjs:33-36`, and the literal strings
  `Brand never separates items` (groups) and any `rule` (suggestions).

### Target state

Every item in section 8 holds, and `npx nx test luna-shopper/curation-suggestions` and
`npx nx lint luna-shopper/curation-suggestions` pass.

### Scope

- Work only in: `libs/luna-shopper/tools/curation/suggestions/src/` (`rules.mjs`, `decision.mjs`,
  `packet.mjs`, `commands.mjs`, `gateway.mjs`, `run-dir.mjs`, `prompt.md`, `test-fakes.mjs`,
  their tests and fixtures), and deleting `private-labels.json`.
- Do NOT touch: the backend, `libs/luna-shopper/tools/curation/groups`, `curation-cli` beyond a
  flag it forwards if one is unavoidable, the engines, `tools/catalog/review-entries.mjs` and its
  own `private-labels.json` (legacy, left as is).

### Constraints

- The model stays blind: the registry is read by the library, never by the model, and the packet
  carries only the one brand the row resolves to.
- The full registry never goes into the system prompt. Every prompt word is billed on every row
  on the claude engine.
- The key is computed with a copy of `brandKey` in `rules.mjs`, proven equal to the contracts
  function by reading `brand-key.cases.json` in a test. This library is plain `.mjs` and cannot
  import the TypeScript.
- A decision with no brand stays valid. Null is a real answer.
- Keep `NAME_GLITCH` the only retryable code.

### Action boundaries

- Proceed with in-scope edits and tests.
- Stop and ask before calling a real gateway or a model, and before changing a pinned string
  other than the ones section 7 names.

### Progress evidence

Report after the registry snapshot, after the packet field, after the two validators, after the
private label replacement, and after the report counts, each with its test run.

## 1. What changes

| Today                                          | After                                                    |
| ---------------------------------------------- | -------------------------------------------------------- |
| The brand is whatever the model writes         | It must be a registered brand, or the row is a REVIEW    |
| `private-labels.json`, two brands, by name     | The registry's `privateLabelSupermarketId`, by chain id  |
| The packet names no brand the catalog knows    | `entry.brandMatch` names the registered brand, if any    |
| `report.json` counts decisions only            | It also counts unregistered brands by key                |

## 2. The registry snapshot

`start` reads the whole registry from the **main** gateway, the environment the decisions are
written to, with `pageThrough('/v1/admin/catalog/brands', { order: 'label', limit: 100 })`, and
writes it into the run directory as `brands.json`:

```json
{ "readAt": "2026-09-16T10:00:00.000Z",
  "brands": [{ "id": "...", "key": "hacendado", "label": "Hacendado", "privateLabelSupermarketId": "..." }] }
```

- Every later `decide`, `serve` and resume reads that file, never the gateway. A resumed walk
  applies the registry it started with, as it already does with `local` (plan `0003`).
- A brand registered while a walk runs is seen by the next walk. Say so in the `start` output:
  "Read 212 brands. A brand registered after this moment is not seen by this run."
- An empty registry is allowed and printed as a warning: every CREATE with a brand then becomes
  a REVIEW, which is the honest answer and the reason the back office screens exist.
- `indexBrands(raw)` in `rules.mjs` builds `Map<key, { id, label, privateLabelSupermarketId }>`.

## 3. The packet

`packet.mjs` adds one field to the entry:

```json
"brandMatch": { "label": "Hacendado", "privateLabelOf": "Mercadona" }
```

- `brandKey(entry.brand)` looked up in the snapshot. Null when the entry has no brand or the key
  is not registered.
- `privateLabelOf` is the chain's name (`chainName` of the supermarket with that id, from the
  supermarkets the walk already lists), or null.
- Candidates are not annotated. A LINK takes the candidate's brand as it is.

`prompt.md` names the field, in the numbered procedure, in one sentence each:

- When `entry.brandMatch` is present, a CREATE writes `brandMatch.label` as `item.brand`, exactly.
- When it is absent and the product plainly has a brand, write that brand. If it is not
  registered the tool sends the row to a person, which is the intended outcome. Never drop a
  printed brand to null to avoid that.
- A range, a flavour or a claim is never a brand (`+Proteínas`, `Sin lactosa`, `Listo para
  comer`). It stays in the name under rule 4.

## 4. Two validators

Both apply to a `CREATE` only, both demote to REVIEW, neither is retryable.

### 4.1 `BRAND_UNREGISTERED`

`item.brand` is not null and `brandKey(item.brand)` is not in the snapshot.

    BRAND_UNREGISTERED: "+Proteínas" is not a registered brand. Register it in the back office
    or correct the brand.

A brand whose key is registered but whose spelling differs (`HACENDADO`) passes. Catalog stores
the label (plan `0115` section 4), so the spelling is not worth a person's time.

### 4.2 `BRAND_DIFFERS_FROM_SOURCE`

`entry.brandMatch` is present and `brandKey(item.brand)` is not its key, including a null
`item.brand`.

    BRAND_DIFFERS_FROM_SOURCE: the chain prints "Hacendado", a registered brand, and the decision
    writes "+Proteínas".

The chain's field is not trusted on its own, but a person registered this key, so a decision that
contradicts it is one a person checks.

## 5. Private labels from the registry

- `private-labels.json` and `loadPrivateLabels` are deleted. The default arguments at
  `commands.mjs:106` and :513 read the snapshot instead.
- `PRIVATE_LABEL_CROSSES_CHAIN` compares `brand.privateLabelSupermarketId` with the entry's
  `supermarketId`, by id. The brand checked is the same as today: the LINK target's brand, or the
  CREATE item's brand. The name comparison through `supermarketKeys` is removed from this rule.
- `buildSystemPrompt` keeps its `## Known private labels` section, built from the snapshot's
  brands that have a chain, one line each as today. That list is short by nature: a chain has a
  handful of house labels. If it passes 40 lines, print a warning at `start`, because it is
  billed per row.

## 6. The report

`report.json` gains:

```json
"unregisteredBrands": [{ "key": "proteinas", "spelling": "+Proteínas", "rows": 24 }]
```

ordered by `rows` descending, from the `BRAND_UNREGISTERED` issues of the run. `spelling` is the
most frequent spelling the model wrote. The back office suggestions list reads the queue, not
this report, so this is only the run's own summary for the operator watching it.

## 7. Tests

- `rules.test.mjs`:
  - the `brandKey` copy agrees with every pair in `brand-key.cases.json`;
  - `indexBrands` keys by `brandKey`;
  - the known private labels section is built from a snapshot fixture, and the pinned
    `` `Hacendado` belongs to Mercadona `` line still renders from that fixture.
- `packet.test` (or the tests that build packets today): `brandMatch` present, absent for no
  brand, absent for an unregistered key, `privateLabelOf` named.
- `decision.test.mjs`:
  - `BRAND_UNREGISTERED` on a CREATE, not on a LINK, not on a null brand, not on a registered key
    in another spelling;
  - `BRAND_DIFFERS_FROM_SOURCE` for a different brand and for null;
  - `PRIVATE_LABEL_CROSSES_CHAIN` by id, for a LINK and a CREATE, and not for the owning chain;
  - neither new code is retryable.
- `commands.test.mjs`: `start` writes `brands.json` from a fake gateway, `decide` reads it and
  never calls the gateway for brands, a resumed run reads the same file, and `report.json` counts
  `unregisteredBrands`.
- `fixtures.test.mjs`: the fixture packets carry `brandMatch`.

## 8. Done when

- [ ] `private-labels.json` is gone, and private labels come from the registry by chain id.
- [ ] A run reads the registry once, into `brands.json`, and every decision of the run uses it.
- [ ] A CREATE with an unregistered brand, or with a brand contradicting a registered source
      brand, is a REVIEW with its own code.
- [ ] A CREATE with no brand is not demoted for it.
- [ ] `report.json` lists the unregistered brands of the run by count.
- [ ] `prompt.md` names `brandMatch` and the range rule.

## 9. Verification

```sh
npx nx test luna-shopper/curation-suggestions
npx nx lint luna-shopper/curation-suggestions
npx nx affected -t lint test
```
