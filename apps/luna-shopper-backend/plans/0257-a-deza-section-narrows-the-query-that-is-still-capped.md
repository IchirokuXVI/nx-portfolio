> **PR:** [#946](https://github.com/IchirokuXVI/nx-portfolio/pull/946)
>
> Section 1, item 2 (the newest capped query first) is withdrawn by plan 0258, section 2: the weight decides across every open capped query.

# 0257: a DEZA section narrows the query that is still capped

> Found on 2026-11-08 by the walk that verified plan `0251` on Luna slot 9 (run `a8a48505`,
> COMPLETED in about 15 minutes, 15,255 products). With the report of `0251`, every one of the 27
> sections it names as unfinished stopped on `BUDGET` after its 25 queries, and 25 of them had
> no open query left: every capped query had been narrowed at least once, yet each pass was
> still adding products. None ended `BARREN`. The budget is not the cause. The narrowing is. It
> always takes the oldest capped query, which is the whole section, and it spends one shared set
> of terms, so a capped single term query is never split by a second term, and 24 of the 25
> queries of a section are single terms drawn from the first 300 rows the section showed.
>
> Prerequisite reading: plan `0085` section 3 (the split and the budget; step 4 says a query
> still at the ceiling "is itself a candidate for further narrowing by a second term"), plan
> `0251` (`queries`, `stoppedBy`, `narrowing`, `termsTried` on the report),
> `apps/luna-shopper-backend/harvester/src/app/harvest/deza-catalog.runner.ts` (`enumerateSection`
> near line 205, `Crawl.begin` and its `narrow` near line 340, `learn`, `mostFrequentUnused`,
> `readBudget`, `DEFAULT_SECTION_BUDGET`, `BARREN_QUERIES`), `libs/luna-shopper/deza/src/lib/rows.ts`
> (`DEZA_CEILING_PAGES`, 20 pages of 15 rows) and CLAUDE.md, "One mode, two adapters".

## Brief for the agent

### Objective

Make the narrowing of a capped DEZA section spend its queries where rows are still hidden
behind the ceiling: narrow the newest capped query by a term from its own rows, with a set of
tried terms per query, so that a section ends because its passes stop adding products and not
because a counter ran out. Then measure how many queries a section needs, and let the owner set
the budget from that number.

### Context

- `narrow()` walks `state.capped` oldest first and returns the first query that still has an
  unused term. The whole section is capped first and its vocabulary grows with every row seen,
  so it always has an unused term. In practice every narrowing is `[term]` and no `[term,
  term2]` query is ever issued until the section's whole vocabulary is spent, which the budget
  prevents.
- `used` is one set for the section. A term spent under one query cannot be spent under another.
  `[leche, desnatada]` would make `desnatada` unavailable to `[yogur]`.
- The vocabulary is one map for the section, learnt from every row seen. The term chosen for a
  capped query is thus the most frequent word of the section, not of that query's rows. The
  rows hidden behind a query's ceiling are only reachable through a term those rows carry.
- A capped query returns 300 rows (20 pages of 15). The frequent single terms of a section
  overlap heavily, so each new single term query adds a shrinking number of products and a
  section of several hundred products saturates slowly. The run of 2026-11-08 averaged about 500
  products a section.
- The budget is read from the source row (`config.sectionQueryBudget`, `readBudget`), default 25.
  An operator can raise it today with no deploy. Raising it alone spends more single term
  queries on the same saturation curve. That is why this plan changes the narrowing first and
  the number second.
- `BARREN_QUERIES` is 3: a section stops after three passes in a row that add nothing. With a
  narrowing that reaches hidden rows, this becomes the usual end of a section.
- Plan `0251` made the report say `queries`, `stoppedBy`, `narrowing` and `termsTried` for each
  unfinished section. That report is the measurement this plan reads.
- Completeness still cannot be proven against this source (CLAUDE.md). This plan does not add a
  number that claims it. It makes the budget stop fewer sections and leaves the report honest.

### Target state

On a walk on an ephemeral slot with the default budget, most sections end `BARREN` or
`NO_TERM`, the ones that end `BUDGET` name a two term query as their `narrowing`, and the
product count is not below the run of 2026-11-08 (15,255).

### Scope

`deza-catalog.runner.ts` (`Crawl`, `SectionState`, `enumerateSection`) and its spec. No change to
the DEZA library, the client, the token bucket or the ceiling.

### Constraints

- The number of requests a section may spend stays bounded by the budget. A section never
  issues the same query twice.
- A term is still a word of at least `MIN_TERM_LENGTH` letters that is not a number, and a
  query never repeats one of its own terms.
- The report shape of plan `0251` does not change. `openQueries` keeps the meaning that plan
  gave it.
- `bulk_price` and prices are not involved: DEZA writes no price.

### Action boundaries

Stop and ask before changing the rate, the ceiling, the barren count or the default budget. The
default budget changes only through decision D1 after the measurement.

### Progress evidence

`npx nx test luna-shopper-backend-harvester`, and the per section table of section 3 from one
walk on an ephemeral slot, quoted in the PR.

## 1. The narrowing

1. Each capped query keeps its own vocabulary, learnt from the rows that query returned, and its
   own set of tried terms. The section's vocabulary stays for the whole section query.
2. `narrow()` takes the **newest** capped query that still has an untried term of its own, and
   adds that query's most frequent untried term. A query's own terms are excluded, as today.
3. A query that is capped and has no untried term of its own is closed. It stays in `capped`
   for the report (`openQueries` of plan `0251` lists it if it was never narrowed).
4. The stop rules of `enumerateSection` do not change: three barren passes, no term left, or
   the budget.

A barren pass under a two term query is still a barren pass for the section. That is the
intended end: when the narrowings of the newest capped query add nothing three times, the rows
behind that ceiling are already seen through other terms.

## 2. The measurement

The report of plan `0251` already states, per unfinished section, `queries`, `stoppedBy`,
`narrowing` and `termsTried`. Add the same `queries` and `stoppedBy` for the sections that
finished, under a `sections` list beside `incompleteSections`, so a walk states for every
section how many queries it took and why it ended. Nothing else is added.

## 3. What the PR quotes

From one walk on an ephemeral slot, with the default budget:

| Section | Products | Queries | Stopped by | Narrowing at the stop |
| --- | --- | --- | --- | --- |

one row per section, then the totals: products found, sections by stop reason, queries spent,
and the run time. Beside it, the same figures from the run of 2026-11-08 (15,255 products, 27
of 30 sections on `BUDGET`, 25 queries each). The owner reads D1 from this table.

## Tests

- A capped section whose rows carry a term `t1` that returns 300 rows: the next query is
  `[t1, t2]` with `t2` from the rows of `[t1]`, not a second single term.
- A term tried under `[t1]` can still be tried under `[t3]`.
- A capped query with no untried term is closed and the narrowing moves to the next newest.
- The three stop rules each end a section with the right `stoppedBy`.
- The existing `0251` cases keep their answers.

## Acceptance criteria

- [ ] No section issues the same query twice.
- [ ] On the walk of section 3, the sections that end `BUDGET` name a query of two or more
  terms as their `narrowing`.
- [ ] The product count of that walk is not below 15,255.
- [ ] The report of plan `0251` keeps its shape and gains the `sections` list.

## Verification

Walk DEZA on an ephemeral slot with `details: ALL` on the default budget and quote the table of
section 3. If more than a third of the sections still end `BUDGET`, run it again with
`sectionQueryBudget` 50 on the source row and quote both.

## Decisions

- **D1 (owner): the default budget, after the measurement.** (a) keep 25; (b) the number the
  table of section 3 shows ends most sections `BARREN`, rounded up to a multiple of 5; (c) set
  it per chain on the source row only and leave the default. Recommended: decide from the
  table, not before it. The request cost of 25 queries of up to 20 pages a section is the figure
  plan `0085` named (about 5,000 page fetches and 630 MB a run).
- **D2 (owner): count pages, not queries.** A capped query costs 20 pages and a finished one as
  few as one. (a) keep the budget in queries, which is what the report and the owner's number
  speak in; (b) a page budget. Recommended: (a) now, because the narrowing change is what moves
  the result, and a page budget is a second change to measure on its own.
