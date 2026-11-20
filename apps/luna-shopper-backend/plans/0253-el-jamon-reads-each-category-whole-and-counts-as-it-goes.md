> **PR:** [#945](https://github.com/IchirokuXVI/nx-portfolio/pull/945)

# 0253: El Jamón reads each category whole and counts as it goes

> Found on 2026-11-06 by a scheduled walk of El Jamón on Luna slot 4 (run
> `cd99272b-76f8-4645-820d-1ea425cbc37d`, locked with `--keep-data`). Two defects. Five of eleven
> categories read fewer rows than the chain printed, by 80, 80, 60, 80 and 20, with no failed page
> and no warning: about 320 products the walk never saw. And the run's `processed` counter stayed
> at 0 for the whole detail stage, 6,798 product pages and about an hour, so only the heartbeat
> proved the run alive.
>
> Seen again on 2026-11-08, with a third defect. Two walks on ephemeral slots 6 and 9 (the
> verification walks of plans `0250` and `0251`, run `14d81510` on slot 9) both listed every
> category to its printed count, 7,125 products in eleven categories, so the short read of
> 2026-11-06 is intermittent. Both walks then sat in the DETAIL stage, with `processed` at 0,
> working through `ElJamonTimeoutError` failures of 30 seconds each, and were abandoned after
> 100 and 108 minutes. The walk of 2026-11-06 had finished its detail stage in 66 minutes at
> six workers. A detail stage that cannot tell a slow chain from a chain that has stopped
> answering runs for hours and ends with nothing written, because the runner writes at the end.
>
> Prerequisite reading: plan `0169` (El Jamón, sections 5.1 to 5.3: the listing form, the
> filters, one page per new product), plan `0215` (the refusal guard: a run stops when a chain
> keeps refusing it), plan `0217` (a run counts each kind of write once, each runner reports
> progress in its own unit), plan `0220` section 2.3 (a whole national listing), plan `0251`
> (`LISTING_SHORT`), `libs/luna-shopper/eljamon/src/lib/eljamon.client.ts` (`walkCategory`,
> `pageBody`, `pageUrl`), `transport.ts` (`ELJAMON_REQUEST_TIMEOUT_MS`, `ElJamonTimeoutError`),
> `listing.ts` (`parseListingPage`, `pageCountOf`, `ELJAMON_PAGE_SIZE`),
> `apps/luna-shopper-backend/harvester/src/app/harvest/eljamon-catalog.runner.ts`
> (`listCategory`, the DETAIL worker pool, `DETAIL_FAILED_KEY`, `declareListing`) and
> `harvest/run-context.ts`.

## Brief for the agent

### Objective

Find why a category ends before its printed count and fix it so a walk reads every row the chain
prints, make the DETAIL stage of the El Jamón runner move `processed` as each product page is
read, and make that stage stop, with its reason on the run, when the chain stops answering
product pages instead of running for hours on timeouts.

### Context

- `walkCategory` ends a category on a page with no rows **or on a page whose rows repeat a code
  already seen in this category**, a guard against a page number the server clamps. Every shortfall
  of 2026-11-06 is a multiple of 20, which is `ELJAMON_PAGE_SIZE`: whole pages were dropped. Which
  of the two exits ended each category is what the builder proves first.
- The report of that run, `categories[]`:

  | Code | Name | Read | Printed |
  | --- | --- | --- | --- |
  | 01 | DESPENSA | 1,218 | 1,298 |
  | 04 | FRESCOS | 965 | 1,045 |
  | 05 | CONGELADOS | 318 | 378 |
  | 06 | BEBIDAS | 712 | 792 |
  | 11 | HOGAR | 111 | 131 |

  The other six (`02`, `03`, `07` to `10`) read exactly their printed count. The printed
  counts add up to 7,118 and the rows read to 6,798, which is also the distinct count: no
  product was read in two categories, and the gap of 320 is the shortfall alone. `failed` was 0,
  so no page was skipped by `onPageError`.
- A plausible cause, unproven: a product listed on two pages of one category (the order shifts
  between requests, or the chain files it twice), which the repeat guard reads as a clamped page.
  Then the guard drops every later page.
- **The short read does not happen on every walk.** On 2026-11-08 run `14d81510` read `01`
  DESPENSA 1,296 of 1,296, `04` FRESCOS 1,046 of 1,046 and `11` HOGAR 130 of 130, and every
  other category whole. The printed counts had moved since 2026-11-06 (1,298 to 1,296, 1,045 to
  1,046, 131 to 130), so the listing changes between days. A cause that depends on the order of
  rows shifting between two requests fits both days; a cause that depends on a product filed
  twice fits only if that product left the chain in between. Section 1 thus asks for a capture
  that compares two requests of one page, and not only one walk of one category.
- Progress: `setTotalPlanned(walk.rows.size)` is called after the listing, and products are
  reported to the sink only in the INGEST stage, so `processed` moves from 0 to 6,798 at the end.
  The DETAIL pool calls `context.heartbeat()` per page and nothing else.
- **Timeouts.** `transport.ts` ends a request that stays silent for `ELJAMON_REQUEST_TIMEOUT_MS`,
  30 seconds, with `ElJamonTimeoutError`. The DETAIL pool treats it as one failed page: the
  product keeps `DETAIL_FAILED_KEY` and the next walk asks again (plan `0169`, section 5.3).
  Nothing counts the timeouts and nothing stops the stage. With six workers, a thousand pages
  that time out cost about 83 minutes and write nothing. On 2026-11-08 neither walk reached the
  INGEST stage, so the rows their listing stage read (7,125) were lost with the abort. The
  number of timeouts was not counted on either slot, because nothing counts them; the harvester
  log shows them one by one.
- The refusal guard of plan `0215` is the pattern that exists for a chain that stops answering:
  a policy per chain, a count in a row, a stop with `stopReason` on the run and the alert of plan
  `0218`. It counts refusals (403, 429) and not timeouts.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and a walk on an ephemeral
slot reads every category to its printed count, or names the category on its report (plan
`0251`) when the chain itself prints fewer rows than its count.

### Scope

`eljamon.client.ts`, `listing.ts` and their specs; `eljamon-catalog.runner.ts` and its spec; the
refusal guard only if D1 picks (a) and the guard is where the timeout count lives. A capture
with the library's `capture-fixtures` target of the pages around the point a short category
ended, and of one page requested twice.

### Constraints

- The clamp guard stays in some form: a server that answers the last page for every page number
  above the last must not loop the walk.
- `processed` stays in the unit of `totalPlanned` (plan `0217`).
- No request beyond what reading the missing pages costs.
- `ELJAMON_REQUEST_TIMEOUT_MS` stays 30 seconds. A shorter timeout turns a slow page into a
  failed one on a day the chain is merely slow.
- A page that timed out keeps `DETAIL_FAILED_KEY`, as today, whatever stops the stage.

### Action boundaries

Stop and ask before changing the request rate, the session handling, what the INGEST stage
writes, or the numbers of a guard policy beyond the one D1 names.

### Progress evidence

The capture that shows the cause, quoted in the PR (page numbers, the repeated codes), the specs,
and the category table of a walk on an ephemeral slot.

## 1. Proving the cause

On an ephemeral slot, walk category `11` (the smallest short one) with a capture of every page,
and state in the PR which exit ended it and on which page. Because the short read did not
happen on 2026-11-08, also request one page of a large category (`01`, page 3) three times a
minute apart and compare the codes and their order: a page whose order shifts between requests
proves the repeat guard can meet a code of the page before. Then design the fix for what was
found. If the cause is a repeated code, the expected fix is: a page whose rows are **all**
already seen ends the category; a page with some seen rows yields the new ones and continues;
the page count from the printed total is the upper bound. That fix is right for a shifting
order too, so build it even if the capture catches no short read that day, and say so.

## 2. Progress during DETAIL

Each product page read, or failed, moves `processed` by one through the run context, in the unit
of `totalPlanned`, through the hook plan `0217` gave runners that count their own progress
(`countProgressItself`, `run-context.ts` near line 112). The INGEST stage then does not count those products a second time. Known
products, which need no page, count when the stage starts.

## 3. A detail stage that stops when the chain stops answering

The DETAIL pool counts its timeouts, in a row and in total, across its workers. The report
gains `detail: { pages, failed, timeouts }`. When the timeouts in a row reach the number D1
names, the stage stops: the pool drains, no new page is asked, and what D1 decides happens to
the run. Either way the rows the listing stage read reach the INGEST stage, so a walk that lost
its detail stage still writes its listing (plan `0169` writes a row with no detail for a known
product already; a new product with no page is written the same way, with `DETAIL_FAILED_KEY`,
and the next walk asks for its page). The run carries the reason: `stopReason` when the run
stops, a warning on the row when it continues. A single timeout, or a few spread over a stage,
changes nothing: the page fails as today.

## Tests

- Client spec: a category whose page 3 repeats one code of page 2 reads every row of pages 3 and
  later; a server that clamps (every page above the last answers the last) still ends.
- Runner spec: `processed` rises during DETAIL and ends at `totalPlanned`, once.
- Runner spec: a DETAIL pool that meets the D1 count of timeouts in a row stops asking for
  pages, the listing rows reach INGEST, the report states the counts, and the run carries the
  reason. A stage with timeouts under the count finishes as today.

## Acceptance criteria

- [ ] The cause is stated in the PR with the capture that proves it.
- [ ] A walk reads each of the five categories to its printed count, or names it.
- [ ] `processed` is above 0 within one minute of the DETAIL stage starting.
- [ ] `processed` ends equal to `totalPlanned` on a whole walk.
- [ ] A walk whose detail stage is stopped by timeouts still writes its listing rows and
  states the timeout counts on its report.

## Verification

Walk El Jamón on an ephemeral slot with `details: NEW` against an empty source table and quote
the `categories[]` of the report and two progress reads taken during DETAIL. Quote `detail`
from the report. If the chain times out that day as it did on 2026-11-08, quote the stop and
the rows written; if it does not, the runner spec is the proof of section 3.

## Decisions

- **D1 (owner): what a wave of timeouts does to the run.** (a) the run stops as the refusal
  guard stops one: `FAILED`, `stopReason` names the timeouts, the mail of plan `0218` is sent,
  and the failure counts toward the three that stop the chain's schedules; (b) the detail stage
  stops, the run goes on to INGEST with the listing rows, ends `COMPLETED` with a warning of
  plan `0251`'s kind (`DETAIL_UNREAD`, one per stage, with the counts), and the next walk asks
  for the pages. The count in a row: 20 across the pool, about 100 seconds of six workers with
  nothing answered. Recommended: (b). The listing is the part of the walk that was whole, a
  retry next week is what `DETAIL_FAILED_KEY` already does, and a chain that is slow for an
  evening is not a chain that refuses us. Pick (a) if you would rather be mailed the same
  evening.
- The cause of the short read and its fix are the builder's to state in the PR, as before.
