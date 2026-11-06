# 0253: El Jamón reads each category whole and counts as it goes

> Found on 2026-11-06 by a scheduled walk of El Jamón on Luna slot 4 (run
> `cd99272b-76f8-4645-820d-1ea425cbc37d`, locked with `--keep-data`). Two defects. Five of eleven
> categories read fewer rows than the chain printed, by 80, 80, 60, 80 and 20, with no failed page
> and no warning: about 320 products the walk never saw. And the run's `processed` counter stayed
> at 0 for the whole detail stage, 6,798 product pages and about an hour, so only the heartbeat
> proved the run alive.
>
> Prerequisite reading: plan `0169` (El Jamón, sections 5.1 to 5.3: the listing form, the
> filters, one page per new product), plan `0217` (a run counts each kind of write once, each
> runner reports progress in its own unit), plan `0220` section 2.3 (a whole national listing),
> `libs/luna-shopper/eljamon/src/lib/eljamon.client.ts` (`walkCategory`, `pageBody`, `pageUrl`),
> `listing.ts` (`parseListingPage`, `pageCountOf`, `ELJAMON_PAGE_SIZE`),
> `apps/luna-shopper-backend/harvester/src/app/harvest/eljamon-catalog.runner.ts`
> (`listCategory`, the DETAIL worker pool, `declareListing`) and `harvest/run-context.ts`.

## Brief for the agent

### Objective

Find why a category ends before its printed count and fix it so a walk reads every row the chain
prints, and make the DETAIL stage of the El Jamón runner move `processed` as each product page is
read.

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
- Progress: `setTotalPlanned(walk.rows.size)` is called after the listing, and products are
  reported to the sink only in the INGEST stage, so `processed` moves from 0 to 6,798 at the end.
  The DETAIL pool calls `context.heartbeat()` per page and nothing else.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and a walk on an ephemeral
slot reads every category to its printed count, or names the category on its report (plan
`0251`) when the chain itself prints fewer rows than its count.

### Scope

`eljamon.client.ts`, `listing.ts` and their specs; `eljamon-catalog.runner.ts` and its spec. A
capture with the library's `capture-fixtures` target of the pages around the point a short
category ended.

### Constraints

- The clamp guard stays in some form: a server that answers the last page for every page number
  above the last must not loop the walk.
- `processed` stays in the unit of `totalPlanned` (plan `0217`).
- No request beyond what reading the missing pages costs.

### Action boundaries

Stop and ask before changing the request rate, the session handling, or what the INGEST stage
writes.

### Progress evidence

The capture that shows the cause, quoted in the PR (page numbers, the repeated codes), the specs,
and the category table of a walk on an ephemeral slot.

## 1. Proving the cause

On an ephemeral slot, walk category `11` (the smallest short one) with a capture of every page,
and state in the PR which exit ended it and on which page. Then design the fix for what was found.
If the cause is a repeated code, the expected fix is: a page whose rows are **all** already seen
ends the category; a page with some seen rows yields the new ones and continues; the page count
from the printed total is the upper bound.

## 2. Progress during DETAIL

Each product page read, or failed, moves `processed` by one through the run context, in the unit
of `totalPlanned`, through the hook plan `0217` gave runners that count their own progress
(`countProgressItself`, `run-context.ts` near line 112). The INGEST stage then does not count those products a second time. Known
products, which need no page, count when the stage starts.

## Tests

- Client spec: a category whose page 3 repeats one code of page 2 reads every row of pages 3 and
  later; a server that clamps (every page above the last answers the last) still ends.
- Runner spec: `processed` rises during DETAIL and ends at `totalPlanned`, once.

## Acceptance criteria

- [ ] The cause is stated in the PR with the capture that proves it.
- [ ] A walk reads each of the five categories to its printed count, or names it.
- [ ] `processed` is above 0 within one minute of the DETAIL stage starting.
- [ ] `processed` ends equal to `totalPlanned` on a whole walk.

## Verification

Walk El Jamón on an ephemeral slot with `details: NEW` against an empty source table and quote
the `categories[]` of the report and two progress reads taken during DETAIL.

## Decisions

None for the owner. The builder states the cause and the fix in the PR.
