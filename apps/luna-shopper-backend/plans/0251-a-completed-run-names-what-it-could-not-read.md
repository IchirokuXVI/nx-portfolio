> **PR:** [#938](https://github.com/IchirokuXVI/nx-portfolio/pull/938)

# 0251: a completed run names what it could not read

> Found on 2026-11-06 by a scheduled walk of every chain on Luna slot 4 (locked with
> `--keep-data`). Three walks ended `COMPLETED` with no warning while part of the chain's listing
> was never read. Carrefour run `04203ecd-910e-4aa2-94ef-7e7457c93c6d` lost seven whole categories
> to isolated 403 answers: 1,879 of 18,280 listings. El Jamón run
> `cd99272b-76f8-4645-820d-1ea425cbc37d` read five categories short of the count the chain
> printed, about 320 products. DEZA run `db4b7b45-ea5a-4c9f-a9c9-b277207948a8` names 30 sections
> as unfinished in a shape that cannot tell a finished split from a stopped one. Each fact is in
> `harvest_runs.report`, under a different key per adapter, and nothing on the run row, the runs
> list or the mail of plan `0218` says that the run is partial.
>
> Prerequisite reading: plan `0085` (DEZA, section 3, the 300 row ceiling and the budget), plan
> `0090` section 13 (Carrefour: a refusal is never retried), plan `0215` (the refusal guard,
> isolated refusals, `stopReason`), plan `0217` (run counters), plan `0218` (alerts), plan `0220`
> (`declareListing`, whole and not whole listings), `harvest/run-context.ts` (`warn`),
> `harvest/run-executor.service.ts`, `harvest/carrefour-catalog.runner.ts` (`unreadable`,
> `describeRun`), `harvest/eljamon-catalog.runner.ts` (`declareListing`, the category summary),
> `harvest/deza-catalog.runner.ts` (`Crawl`, `SectionState`, `enumerateSection`), and
> `HarvestWarningCode` in `libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts`.

## Brief for the agent

### Objective

Give every catalog run that ends `COMPLETED` with a part of the listing unread one run warning
per unread part, with a code of its own, so the run row says it is partial; make the DEZA report
say why each section stopped; and, if the owner picks D1 (a), let a Carrefour crawl ask once more,
at its end, for each category refused once.

### Context

- `RunContext.warn` adds a `HarvestRunWarning` (`code`, `message`, `offerId`, `page`, `name`)
  that the store persists and the run view returns. A catalog walk writes one only for a pause
  of the refusal guard (`SOURCE_PAUSED`, `SOURCE_RESUMED`, `run-context.ts` near line 216) and
  for a copy target (`run-executor.service.ts` near lines 296 and 570). None of the walks of
  2026-11-06 wrote one, and nothing warns about an unread part of a listing.
- Carrefour (`carrefour-catalog.runner.ts`): a category whose paging throws anything but
  `SourceBlockedError` is logged, counted in `failed` and pushed onto `unreadable`; the report
  has `unreadableCategories` (paths) and `refusals.isolatedUrls`. Products read before the 403 in
  that category are kept (Pastas kept its first 168 listings). The seven of 2026-11-06:
  `cat20006` Bebé, `cat20073` Pastas (at offset 168), `cat26102048` Azúcar y Edulcorantes,
  `cat500001` Gazpacho y Salmorejo, `cat20108` Caldos, Sopas y Pure, `cat20117` Platos
  Tradicionales, `cat20110` Conservas de Frutas. Four of them came within 70 seconds, three in a
  row with good pages between, so `CARREFOUR_REFUSAL_POLICY` (3 in a row) never tripped.
- El Jamón: `report.categories[]` holds `rowsRead` and `printedCount`; `delisting.notWhole`
  holds `short-category`. On 2026-11-06: `01` DESPENSA 1,218 of 1,298, `04` FRESCOS 965 of 1,045,
  `05` 318 of 378, `06` 712 of 792, `11` HOGAR 111 of 131. Why they are short is plan `0253`.
- DEZA: `Crawl.begin` keeps every query that came back at the ceiling in `state.capped`, the
  section's own query first, and `finish` reports all of them as `openQueries`. A section whose
  narrowing then covered everything still reports `(the whole section)`, because the root query
  is capped by definition. All 30 sections of the run report it, 28 of them with nothing else
  open; the report has no count of
  queries spent and no reason the section stopped (budget, three barren queries, or no term left).
- Plan `0215` keeps `stopReason` for a run the guard stopped. An isolated refusal costs one item
  and is in `refusals.isolated`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and the
admin wire types are regenerated for the new warning codes.

### Scope

`HarvestWarningCode` (contracts) and its schema; the three runners named; `run-report.sink.ts` if
the DEZA section summary moves there; the alert rules of plan `0218` only if D2 picks (a).

### Constraints

- The run status does not change: a partial walk is still `COMPLETED` (D3 if not).
- No count claims a completeness the source cannot prove (CLAUDE.md, DEZA).
- A Carrefour retry, if any, is one request per refused category at the end, through the same
  guard, after every other category: never a retry inside the paging loop (plan `0090`, section
  13).

### Action boundaries

Stop and ask before changing a run status, a refusal policy number, or the delisting rules of
plan `0220`.

### Progress evidence

`npx nx test luna-shopper-backend-harvester`, and the run views of one walk per chain on an
ephemeral slot, quoted in the PR, showing the warnings.

## 1. The warnings

Two new codes:

- `LISTING_UNREAD`: a part of the listing was not read at all. Carrefour, one per entry of
  `unreadableCategories`, with the category name and the status that cost it. DEZA, one per
  section stopped by its budget or with no term left (section 2), naming the section.
- `LISTING_SHORT`: a part was read but returned fewer rows than the chain printed. El Jamón, one
  per short category, `rowsRead of printedCount`.

A walk with no such part writes none. The warnings are written before the run ends, so they are
on the row the alert of plan `0218` reads.

## 2. Why a DEZA section stopped

Each `incompleteSections` entry gains `queries` (spent), `stoppedBy`
(`BUDGET`, `BARREN`, `NO_TERM`) and `openQueries` keeps only the capped queries that were never
narrowed. A section that ended because three passes added nothing is not reported as unfinished
and writes no warning: that is the stop rule of plan `0085` working. A section that ran out of
budget or of terms is unfinished.

## 3. A Carrefour category refused once

Only with D1 (a): after the last category, each category in `unreadable` because of one isolated
refusal is paged again from the offset that failed, once, in the order they failed. Products read
are added. A category that fails again stays unread with its warning.

## Tests

- Carrefour runner spec: two categories refused once, one read on the second pass (with D1 (a)),
  one warning left.
- El Jamón runner spec: a short category writes `LISTING_SHORT` with both numbers.
- DEZA: a section whose split ends barren writes nothing; one that ends at the budget writes
  `LISTING_UNREAD` with `stoppedBy: BUDGET` and its open queries.

## Acceptance criteria

- [ ] The Carrefour walk of the Context would carry seven `LISTING_UNREAD` warnings (fewer with
  D1 (a)).
- [ ] The El Jamón walk would carry five `LISTING_SHORT` warnings.
- [ ] A DEZA section reports `queries` and `stoppedBy`, and `(the whole section)` appears only
  for a section that was never narrowed.
- [ ] No run status changes.

## Verification

Walk Carrefour, El Jamón and DEZA on an ephemeral slot and quote the `warnings` of each run view.

## Decisions

- **D1 (owner): Carrefour asks once more at the end.** (a) yes, once per category refused once,
  after every other category; (b) no, the next walk reads it. Recommended: (a). The refusals of
  2026-11-06 were isolated, spaced across 25 minutes, and plan `0090`'s concern is a retry
  that deepens a block, which a guarded single request at the end does not.
- **D2 (owner): does a partial walk alert.** (a) a mail of plan `0218` when the warnings cover
  more than 5% of the planned listings; (b) the run row only. Recommended: (b) until a week of
  scheduled walks shows how often it happens.
- **D3 (owner): a status of its own.** (a) keep `COMPLETED`; (b) a new `PARTIAL`. Recommended:
  (a), because the schedule rules and the failure count read `COMPLETED` and the warning says
  the rest.
