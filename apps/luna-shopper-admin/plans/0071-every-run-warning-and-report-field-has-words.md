> **PR:** [#972](https://github.com/IchirokuXVI/nx-portfolio/pull/972)

# 0071: every run warning and report field has words

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. The run page drew new warnings as raw keys, for example
> `harvest.warning.LISTING_UNREAD`, and it drew none of the report fields that backend plans
> `0249`, `0251`, `0253`, `0257` and `0258` added. On `origin/dev`, 9 of the 19 codes of
> `HarvestWarningCode` have a key under `harvest.warning` in `en.json`.
>
> Prerequisite reading: backend plans `0249` (size doubts on the report), `0251` (what a
> completed run did not read), `0253` (the El Jamón detail stage), `0257` and `0258` (the
> DEZA sections), admin plan `0029` section 6 (the report section of the run page), admin plan
> `0067` (the voice of the harvest strings), and
> `libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts` (`HarvestWarningCode`). Backend
> plan `0268` (same PR) adds one DIA report block, `unslottedOnly`, and its copy. Section 2 of
> this plan draws it.
>
> Mock: none. The owner decided this on 2026-11-11 (D3).

## Brief for the agent

### Objective

Give every `HarvestWarningCode` a label in `en.json`, add a spec that fails when a code has no
label, and draw the report fields of the five backend plans in the existing report section of
the run page. Follow the "Angular conventions" section of `CLAUDE.md` and use the `antislop`,
`antislop-ui` and `antislop-copywriting` skills.

### Context

- The run page draws each warning as `'harvest.warning.' + warning.code | rokuT`
  (`libs/luna-shopper-admin/feature-harvest/src/lib/run-page.ts`, near lines 326 to 350),
  then the offer, the page, the name and the message. The label is a short title. The message
  from the backend carries the detail. `runWarningRows`
  (`libs/luna-shopper-admin/models/src/lib/harvest/run-warnings.ts`, near lines 47 to 63)
  passes the code through.
- **Codes with a label** (`libs/luna-shopper-admin/ui/assets/i18n/en.json`, `harvest.warning`
  near line 1004): `DUPLICATE_KEY`, `REJECTED_ALIAS`, `CANDIDATE_MATCH`, `NO_MATCH`,
  `ALREADY_QUEUED`, `EXTRACTOR`, `COPY_TARGET_GONE`, `COPY_SOURCE_NOT_WRITTEN`,
  `DETAIL_SKIPPED_UNKNOWN`.
- **Codes with no label**: `UNKNOWN_PRICE_SCOPE`, `NO_PRICE_SCOPE`, `SCOPE_KIND_MISMATCH`,
  `PRICE_SOLD_ANOTHER_WAY`, `SOURCE_PAUSED`, `SOURCE_RESUMED`, `APPROX_WEIGHT_ROWS_DISAGREE`,
  `LISTING_UNREAD`, `LISTING_SHORT`, `DETAIL_UNREAD`.
- `readRunReport` (`feature-harvest/src/lib/run-report.ts`, near lines 39 to 82) reads only
  `copies`, the three detail counts, `writes` and `details`. The run page calls it near line
  725 and draws it near lines 185 to 270.
- The report fields that are not drawn, by the runner that writes them
  (`apps/luna-shopper-backend/harvester/src/app/harvest`):
  - Carrefour, `describeRun` (`carrefour-catalog.runner.ts`, near lines 563 to 606):
    `unreadableCategories` (addresses), `askedAgain` (`{ id, name, read }`), `blockedAfter`.
  - DEZA, `toReport` (`deza-catalog.runner.ts`, near lines 843 to 870): `incompleteSections`,
    and `sections`, each `{ code, name, products, firstSeen, queries, stoppedBy, coverageOnce,
    growthAtStop, openQueries }`. `stoppedBy` is `BUDGET`, `BARREN`, `GROWTH`, `NO_TERM`,
    `COMPLETE` or null (near line 459).
  - El Jamón, `toReport` (`eljamon-catalog.runner.ts`, near lines 784 to 820): `categories`,
    each `{ code, name, printedCount, rowsRead, rowsRepeated }`, and `detail`, `{ pages,
    failed, timeouts, silentAttempts }`.
  - Every walk, from the sink (`run-executor.service.ts`, near lines 984 to 986):
    `sizesDisproved`, `probablePackCounts` and `sizesDisprovedExamples`, each example
    `{ entryId, externalId, name, stated, implied, unit, ratio, label, probablePackCount }`.
- **How a spec can read the enum.** The contracts barrel has broken an Angular build before.
  The admin imports only the deep alias `@portfolio/luna-shopper/contracts/brand-key` today.
  The committed `apps/luna-shopper-backend/gateway/docs/openapi.json` lists the 19 codes under
  `components.schemas['enums.HarvestWarningCode'].enum`. A spec can read that file with
  `readFileSync`, as `ui/src/lib/translations.spec.ts` reads its files, and no app code
  imports anything new.
- `run-page.spec.ts` asserts raw keys near lines 326, 327 and 649. Its testing translator
  answers the key, so those assertions stay true. Change them only if the translator changes.

### Target state

1. `en.json` has a label for each of the 19 codes (section 1).
2. A spec in `libs/luna-shopper-admin/ui` reads the enum from `openapi.json` and fails for a
   code with no `harvest.warning` label.
3. `readRunReport` maps the fields of Context into an admin model, read from `unknown`
   (rule D4). The run page draws them in its report section, each part only when the report
   holds it (section 2).

### Scope

`en.json`, the new spec, `run-report.ts` and its spec, `run-page.ts` and `run-page.spec.ts`,
and three runs with these report fields in the memory seed
(`data-access/src/lib/harvest/harvest-seed.ts`, whose runs near lines 80 to 252 carry little
or no report today).
No gateway change, no backend change, no new route. Out: `truncatedCategories`, `failedPages`,
`failedProducts` and `priceDisagreements`, which older plans own.

### Constraints

- The labels are short titles in the voice of the existing `harvest.warning.*` strings. No
  dash as punctuation.
- No new screen and no new section. The fields join the existing `section.report`.
- Every value of the report is read from `unknown`. A shape this build does not expect reads as
  absent and draws nothing.
- A probable pack count is drawn as a guess (backend plan `0249`, PR #942).
- Run `npx nx build luna-shopper-admin`. The PR checks never build the admin app.

### Action boundaries

- Use the copy of section 1 as written. The owner accepted it (D1).
- Stop and ask before you add a screen, a route or a gateway field.

### Progress evidence

The spec output, `npx nx build luna-shopper-admin`, and screenshots at 1360 px and 390 px of
the run page for one Carrefour, one DEZA and one El Jamón run of the memory back end.

## 1. Copy

| Key | English |
| --- | --- |
| `harvest.warning.UNKNOWN_PRICE_SCOPE` | A price named an unknown scope |
| `harvest.warning.NO_PRICE_SCOPE` | A price had no scope |
| `harvest.warning.SCOPE_KIND_MISMATCH` | A scope of another kind |
| `harvest.warning.PRICE_SOLD_ANOTHER_WAY` | Sold another way |
| `harvest.warning.SOURCE_PAUSED` | The chain refused, the run paused |
| `harvest.warning.SOURCE_RESUMED` | The chain answered again |
| `harvest.warning.APPROX_WEIGHT_ROWS_DISAGREE` | Two weights for one piece |
| `harvest.warning.LISTING_UNREAD` | A part was not read |
| `harvest.warning.LISTING_SHORT` | A part was read short |
| `harvest.warning.DETAIL_UNREAD` | Product pages stopped answering |
| `harvest.run.report.unreadable` | Not read |
| `harvest.run.report.askedAgain` | Asked again at the end |
| `harvest.run.report.askedAgainRead` | read the second time |
| `harvest.run.report.askedAgainLost` | still not read |
| `harvest.run.report.blockedAfter` | Stopped because the chain refused |
| `harvest.run.report.sections.caption` | Sections |
| `harvest.run.report.stoppedBy.BUDGET` | Out of queries |
| `harvest.run.report.stoppedBy.BARREN` | Nothing new to find |
| `harvest.run.report.stoppedBy.GROWTH` | Stopped growing |
| `harvest.run.report.stoppedBy.NO_TERM` | No term left to narrow by |
| `harvest.run.report.stoppedBy.COMPLETE` | Finished |
| `harvest.run.report.categories.caption` | Categories, read against printed |
| `harvest.run.report.detail` | Product pages: {{pages}} asked, {{failed}} failed, {{timeouts}} timed out |
| `harvest.run.report.sizesDisproved` | Sizes their own price disproves: {{count}} |
| `harvest.run.report.probablePackCounts` | Of them, probably a pack: {{count}} (a guess) |

## 2. What is drawn

In the report section, after the facts of today:

- A Carrefour run: the unread categories as a list, the categories asked again with the word
  of their outcome, and the stop sentence when `blockedAfter` is set.
- A DEZA run: a table of sections with name, products, queries and the word of `stoppedBy`,
  and the open queries under a `GROWTH` section. The table shows the unfinished sections
  first.
- An El Jamón run: a table of categories whose rows read differs from the printed count, and
  the detail sentence.
- Any walk with `sizesDisproved` above 0: the two counts, and the examples as a short table of
  name, stated, implied, unit and label, with a link to the entry when `entryId` is set.
- A DIA run whose report holds `unslottedOnly` (backend plan `0268`, section 2): the count, one
  line a leaf, and its examples, with the four `harvest.run.report.unslottedOnly.*` keys that
  backend plan `0268` section 2 states. Backend plan `0268` is in the same PR as this plan and
  is not built on 2026-11-11. If the field is not on `origin/dev` when this plan is built, this
  part waits for a short follow up, and the builder says so in the PR.

## Tests

- The new spec: every code of `openapi.json` has a label, and the spec fails for a made up code.
- `run-report.spec.ts`: each field from a valid bag, from a bag with the wrong shapes, and from
  an empty bag.
- `run-page.spec.ts`: one run of each chain draws its part. An import draws only the size
  doubts its report holds (D5), and an import with an empty report draws none of it.

## Acceptance criteria

- [ ] All 19 codes have a label, and a new code without one fails a spec.
- [ ] The report fields of the five backend plans are drawn on the run page.
- [ ] `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.

## Verification

```sh
npx nx test luna-shopper-admin/ui
npx nx test luna-shopper-admin/feature-harvest
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

## Decisions

The owner accepted every recommendation on 2026-11-11. No decision is open.

**D1 (owner, answered 2026-11-11):** the copy of section 1 as written.

**D2 (owner, answered 2026-11-11):** labels and report fields together, in this plan. The labels
of `LISTING_UNREAD` and `DETAIL_UNREAD` point at the parts that the report names.

**D3 (owner, answered 2026-11-11):** no mock, as admin plans `0067` and `0069`. The parts are a
list and two tables in a section that exists.

**D4 (owner, answered 2026-11-11):** this plan draws `sizesDisproved`. This plan owns every
report field, and admin `0072` draws the doubt on an entry only.

**D5 (owner, answered 2026-11-11):** an import run shows its size doubts. The harvester writes
`sizesDisproved` and `probablePackCounts` for an imported run, with no examples, and the run
page draws the sizes part for it and none of the chain parts.

**D6 (owner, answered 2026-11-11):** a DEZA section that threw reads "Failed" in the "Why it
stopped" cell (`harvest.run.report.stoppedBy.FAILED`). The runner names such a section in
`incompleteSections` with a null `stoppedBy`. An unknown stop word on a finished section stays
an empty cell.
