# 0005 A linked brand is asked about again

> Depends on `apps/luna-shopper-backend/plans/0124`, which lets a registered brand point at the
> brand it is a spelling of (`canonicalBrandId`). Nothing here changes behaviour until that plan
> is deployed to the environment the walk reads, and a registry without the field reads exactly
> as it does today.
>
> `DEBORAH 48H` is registered as a spelling of `Deborah`. The curator reading the registry from
> plan `0004` sees two registered brands and accepts either, so a `CREATE` can write
> `Deborah 48H` as the brand of a new product and nothing objects. This plan makes the packet name
> the correct brand up front and, when the model still writes a linked spelling, asks it once more
> with the correct brand named. A second miss, or low confidence, leaves the row for a person.

## Brief for the agent

### Objective

Make `curation-suggestions` resolve linked brands to their canonical brand in the registry index,
the packet and the three brand checks, and add the retryable issue `BRAND_IS_LINKED`, as sections
2 to 6 describe.

### Context

- `start` reads the registry once (`commands.mjs:137`, `main.listBrands()`, which pages
  `GET /v1/admin/catalog/brands`) and writes the raw rows to `brands.json` (`commands.mjs:202`,
  `run-dir.mjs`). `loadBrands(runDir)` (`commands.mjs:510`) returns `indexBrands(...)`, the
  default of `next` and `decide`.
- `indexBrands(raw)` (`rules.mjs:188`) builds a `Map` by key and keeps only
  `{ id, key, label, privateLabelSupermarketId }`. `findBrand(brands, text)` (:206) looks a text up
  by `brandKey`. `privateLabelLines` (:237) feeds `## Known private labels` in `buildSystemPrompt`.
- `brandMatchFor` (`packet.mjs:66`) answers `{ label, privateLabelOf }` for the entry's printed
  brand, or null. `buildEntryPacket` sets `entry.brandMatch` (:103).
- `validateDecision` (`decision.mjs:173`) holds the brand checks on `CREATE` (:300 to :331):
  `BRAND_UNREGISTERED` and `BRAND_DIFFERS_FROM_SOURCE`. Rule 6, `PRIVATE_LABEL_CROSSES_CHAIN`, is
  at :338 and reads `linkTarget.brand` on a `LINK` and `item.brand` on a `CREATE`.
- `RETRYABLE_ISSUE_CODES` is `new Set(['NAME_GLITCH'])` (`decision.mjs:38`).
  `CONFIDENCE_THRESHOLD` is 0.9 (:21).
- The retry already carries feedback. `decide` (`commands.mjs:549`) answers
  `{ retryable: true, issues }` when a retryable issue fires and `final` is false (:736). The
  orchestrator (`cli/src/orchestrator.mjs`, `stepRow` :111) re asks the row once with
  `RETRY_INSTRUCTION` (:22), which puts the issues' `detail` text into
  `That reply could not be used: {error}. Answer again ...`. The second attempt passes `final`, and
  a retryable issue then records a `REVIEW` carrying its code. Both the single row path
  (`decideRow`) and the batched round in `runCuration` use `stepRow`.
- Prompt text is pinned by `rules.test.mjs` (:91 to :101, :166 to :176, :182 to :187). The brand
  section of `prompt.md` is :31 to :44, `entry.brandMatch` is described at :94, `item.brand` at
  :137, and the refusal codes at :155 to :175.
- The registry fixture is `src/fixtures/brands.json`, served by `test-fakes.mjs:120`.
- Tests run with Node's runner: `npx nx test luna-shopper/curation-suggestions` and the CLI's own
  `test` target.

### Target state

Every acceptance criterion in section 8 holds, and `lint` and `test` are green on
`luna-shopper/curation-suggestions` and on the curation CLI project.

### Scope

- Work only in: `libs/luna-shopper/tools/curation/suggestions/src/` (`rules.mjs`, `packet.mjs`,
  `decision.mjs`, `prompt.md`, `fixtures/brands.json`, `test-fakes.mjs` and their tests).
- Do NOT touch: the orchestrator, `RETRY_INSTRUCTION`, the gateway client, the run directory
  format, any backend or admin code.

### Constraints

- A registry row without `canonicalBrandId` is an unlinked brand. The tool keeps working against a
  gateway that predates `0124`.
- One level, as the backend enforces. The index resolves one hop and never loops.
- No second retry budget. `BRAND_IS_LINKED` uses the one retry a row already has, and the existing
  `final` path turns a second miss into a `REVIEW`.
- Keep every pinned prompt string, and add the new ones to the same tests.

### Action boundaries

- Proceed with in scope edits and tests.
- Stop and ask if a row can hit `NAME_GLITCH` and `BRAND_IS_LINKED` on its first attempt in a way
  that the single retry cannot answer both, and the fix needs an orchestrator change.

### Progress evidence

Report after the index and the packet with their tests, and after the validator with the retry
tests.

## 1. What changes

| Piece                                     | Where                     |
| ----------------------------------------- | ------------------------- |
| The index resolves a link                 | `rules.mjs`               |
| `brandMatch` names the canonical brand    | `packet.mjs`              |
| `BRAND_IS_LINKED`, retryable              | `decision.mjs`            |
| The brand checks compare canonical brands | `decision.mjs`            |
| The prompt explains a linked spelling     | `prompt.md`               |

## 2. The index

`indexBrands` also keeps `canonicalBrandId`, and a second lookup by id. Add:

- `canonicalBrand(brands, brand)`: the brand its `canonicalBrandId` names, or the brand itself
  when the field is absent or null, or when the id is missing from the registry (a snapshot read
  mid write). One hop.
- `findCanonicalBrand(brands, text)`: `canonicalBrand` of `findBrand`, or null.

`privateLabelLines` lists canonical brands only. A linked brand owns no chain (`0124` section 2).

## 3. The packet

`brandMatchFor` resolves through the link:

```js
{ label: canonical.label, privateLabelOf: /* canonical's chain */, printedAs: registered.label | null }
```

`printedAs` is the linked brand's label when the printed brand is a linked spelling, and null
otherwise. The `label` is the brand to write, as it already is, so a model that follows the
existing rule "write `brandMatch.label`" writes `Deborah` on the first attempt.

## 4. The validators

### 4.1 `BRAND_IS_LINKED`

On a `CREATE`, when `findBrand(brands, item.brand)` is a brand with a canonical brand other than
itself:

```js
issue('BRAND_IS_LINKED',
  `"${item.brand}" is registered as a spelling of "${canonical.label}", so the brand is "${canonical.label}". Review the decision again with that brand: a line, range or claim in the printed brand (such as "48H") belongs in the name, not in the brand.`)
```

Add the code to `RETRYABLE_ISSUE_CODES`. The detail is the whole message the model receives on the
retry, inside `RETRY_INSTRUCTION`, so it names the correct brand and says why the name can change
too.

The outcomes, all through machinery that exists:

- The second answer writes the canonical brand and passes every check: recorded as the model
  decided.
- The second answer still writes a linked spelling: `final` is set, so the row is a `REVIEW`
  carrying `BRAND_IS_LINKED`.
- The second answer's confidence is below 0.9: `LOW_CONFIDENCE`, a `REVIEW`. This is "the model is
  unsure".

A linked brand is registered, so `BRAND_UNREGISTERED` never fires for it.

### 4.2 The other brand checks

- `BRAND_DIFFERS_FROM_SOURCE` compares canonical brands: the canonical brand of the printed brand
  against the canonical brand of `item.brand`, or against `brandKey(item.brand)` when `item.brand`
  is unregistered. Printed `DEBORAH 48H` and written `Deborah` do not raise it.
- Rule 6 reads the chain of the canonical brand, on a `LINK` and on a `CREATE`.

## 5. The prompt

In `## The brand on a CREATE`, after the `brandMatch.label` sentence, add:

> When `entry.brandMatch.printedAs` is present, the chain printed a registered spelling of the
> brand. Write `brandMatch.label` as the brand, and keep what the spelling adds (a line, range or
> claim such as `48H`) in the name, by rule 4.

Describe `printedAs` beside `entry.brandMatch` (:94), and add `BRAND_IS_LINKED` to
`## What the tool refuses` with one line: the brand written is a registered spelling of another
brand.

## 6. The fixture

Add a linked brand to `fixtures/brands.json` (`Deborah 48H`, key `deborah48h`, pointing at a
`Deborah` row), so the packet, validator and prompt tests run against the real row shape.

## 7. Tests

- `rules.test.mjs`: `indexBrands` keeps the field, `canonicalBrand` answers one hop, a row without
  the field, an id missing from the registry, `privateLabelLines` skips linked brands. Pin the new
  prompt strings (`printedAs`, `BRAND_IS_LINKED`).
- `packet.test.mjs`: `brandMatch` for a linked printed brand, and unchanged for an unlinked one.
- `decision.test.mjs`: `BRAND_IS_LINKED` on a `CREATE` writing the spelling, none on a `CREATE`
  writing the canonical brand, `BRAND_DIFFERS_FROM_SOURCE` quiet for printed spelling and written
  canonical, rule 6 through a link.
- `commands.test.mjs`: `decide` answers `retryable` with the issue on the first attempt and records
  a `REVIEW` carrying `BRAND_IS_LINKED` with `final`.

## 8. Done when

- [ ] A registry row's `canonicalBrandId` is kept and resolved one hop, and a row without it reads
      as unlinked.
- [ ] `entry.brandMatch` names the canonical brand and `printedAs` names the linked spelling.
- [ ] A `CREATE` writing a linked spelling is asked once more with a detail naming the correct
      brand, and a second miss records a `REVIEW` carrying `BRAND_IS_LINKED`.
- [ ] `BRAND_DIFFERS_FROM_SOURCE` and rule 6 compare canonical brands.
- [ ] `prompt.md` explains `printedAs` and lists `BRAND_IS_LINKED`, and the pinned strings pass.

## 9. Verification

```sh
npx nx run-many -t lint test -p luna-shopper/curation-suggestions luna-shopper/curation-cli
```
