# 0258: a DEZA section is narrowed by the products it has not seen

> Found on 2026-11-08 by the build of plan `0257` (PR #946, kept as a draft). That plan made the
> narrowing split the newest capped query, and the review found an older defect beside it: the
> barren rule compared the product count of the whole run while four sections crawl at once, so
> a neighbour's products kept every section alive until its budget. With that rule corrected a
> section stops when three of its own passes add nothing, 29 of the 31 capped sections stop
> within 4 to 10 queries, and the walk finds fewer products: 13,511 at budget 25 and 13,682 at
> budget 50, against 15,255 on 2026-11-08 and 13,977 for the same code before the correction.
> The old persistence found real products by brute force. The term that narrows a section is
> chosen by raw frequency among the rows already seen, so the first terms describe the products
> the section already returned and add little, and three such terms in a row end the section
> while rows are still hidden behind the ceiling. Charcuteria envasada went from 434 products to
> 273, Textil hogar from 423 to 354.
>
> Prerequisite reading: plan `0085` section 3 (the split and the budget), plan `0251` (the
> report of an unfinished section), plan `0257` (per query vocabulary and tried terms, the
> `sections` list with `firstSeen`, `products`, `queries`, `stoppedBy`; read it on the branch of
> PR #946, which this plan builds on), CLAUDE.md "One mode, two adapters",
> `apps/luna-shopper-backend/harvester/src/app/harvest/deza-catalog.runner.ts` on that branch
> (`enumerateSection`, `crawlQuery` and its `added`, `Crawl.record`, `Crawl.begin`, `narrow`,
> `mostFrequentUntried`, `issued`, `summaries`, `BARREN_QUERIES`, `DEFAULT_SECTION_BUDGET`,
> `readBudget`) and `libs/luna-shopper/deza/src/lib/rows.ts` (`DEZA_CEILING_PAGES`).

## Brief for the agent

### Objective

Choose the term that narrows a capped query by how many products it would reach that no query
of the section has returned yet, instead of by how often it was seen, and let a section that is
still growing spend queries past the floor while a section that has stopped growing ends. A walk
then finds at least what the walks before plan `0257` found, with fewer queries than they spent,
and the stop reason of each section stays true.

### Context

- After PR #946 each query returns `added`, the products new to the run; a pass is barren when it
  adds nothing; a section ends on three barren passes in a row, on no term left, or on the
  budget (25 by default, `config.sectionQueryBudget` on the source row). `sections[]` states
  `firstSeen`, `products`, `queries` and `stoppedBy` for every section.
- The vocabulary of a query is a map from word to how many times the word was seen, counted on
  each sighting of a row, and `mostFrequentUntried` takes the highest count that is neither
  tried under that query nor already issued. The section's own query (the root) is capped in 31
  of 63 sections, and in 29 of those no single term query reaches the ceiling, so the root is
  what gets narrowed, and its terms are drawn from the first 300 rows the site chose to show.
- A word that is frequent among products already returned describes products already returned.
  The rows hidden behind the ceiling can only be reached through a word they carry, and the
  best evidence for such a word is a product that few queries have returned so far: it sits
  near the edge of what the root query showed, and its words lead outward.
- The measurements of 2026-11-08 (DEZA, 63 sections, source defaults of 4 workers and 4
  requests a second):

  | Walk | Products | BUDGET | BARREN | COMPLETE | Queries | Time |
  | --- | --- | --- | --- | --- | --- | --- |
  | Before 0257, budget 25 | 15,255 | 27 of 30 reported | 0 | not reported | not reported | about 15 min |
  | 0257 before the barren fix, 25 | 13,977 | 27 | 4 | 32 | 787 | 12.9 min |
  | 0257 before the barren fix, 50 | 14,658 | 16 | 15 | 32 | 1,322 | 15.8 min |
  | 0257 with the barren fix, 25 | 13,511 | 2 | 29 | 32 | 365 | 9.6 min |
  | 0257 with the barren fix, 50 | 13,682 | 0 | 31 | 32 | 393 | 9.9 min |

  The listing moves between walks (Congelados gave 306 and 272 products the same afternoon), so
  a product count is comparable only within a few percent, and only against a walk of the same
  day.
- `firstSeen` adds up to the run's product count; `products` does not, because a product filed
  under two sections is counted in both.
- Completeness still cannot be proven against this source (CLAUDE.md). This plan adds no
  number that claims it. Its measure of success is a product count that is not below what the
  brute force found, for fewer queries.

### Target state

A walk on an ephemeral slot on the day of the build finds at least as many products as a walk
of the `dev` code the same afternoon, spends fewer queries than it, and every section's
`stoppedBy` is one of `BARREN`, `GROWTH`, `NO_TERM`, `BUDGET` or `COMPLETE` for the reason the
code really stopped on.

### Scope

`deza-catalog.runner.ts` (`Crawl`, the per query vocabulary, `narrow`, `enumerateSection`, the
report) and its spec. No change to the DEZA library, the client, the token bucket or the
ceiling. The contracts are not touched unless the DEZA report has become typed there (it was
`Record<string, unknown>` on 2026-11-08).

### Constraints

- A section never issues the same query twice. A term is still a word of at least
  `MIN_TERM_LENGTH` letters that is not a number.
- The barren rule of PR #946 stays: three passes in a row that add nothing to the run end the
  section, whatever the growth rule says.
- The floor of 25 queries a section is kept: no section is cut below it by the growth rule, so
  a walk never finds less than the code before this plan would have found with the same terms.
- The hard cap of D1 bounds every section whatever it adds.
- The report shapes of plans `0251` and `0257` keep their fields. New fields are added beside
  them.

### Action boundaries

Stop and ask before changing the rate, the ceiling, `BARREN_QUERIES`, the floor of 25, or the
numbers D1 and D2 name once the owner has set them.

### Progress evidence

`npx nx test luna-shopper-backend-harvester`, and the table of section 3 from one walk of this
branch and one walk of `dev` on the same afternoon on an ephemeral slot, quoted in the PR.

## 1. Coverage

Each section keeps a map from a product's `entryKey` to the number of issued queries of that
section that returned it. `crawlQuery` adds one for each product a query returned, once per
product per query, because the listing repeats rows inside one result set (plan `0085`, section
6). A product the section has never returned has no entry and a coverage of zero.

## 2. The weight of a term

The vocabulary of a query maps each word to the set of `entryKey`s of the products that carry
it, among the rows that query returned (the root query keeps the section's set). The weight of a
word at the time `narrow()` runs is the sum over its products of `1 / (1 + coverage)`. A word
carried only by products returned many times weighs little; a word carried by products returned
once weighs most. `narrow()` picks the untried, unissued word of the highest weight under the
newest capped query that has one, as plan `0257` orders the queries. A word whose products are
all covered three times or more is not offered at all. Ties fall to the word with more products,
then to the earlier word.

Nothing is recomputed per row. The weights are summed when `narrow()` runs, over the words of
one query, which is a few hundred words over a few hundred products at most.

## 3. A budget that follows growth

The budget of plan `0085` becomes a floor and a cap. A section may always spend the floor (25
queries, the number the owner set, `config.sectionQueryBudget` still overrides it). Past the
floor it goes on only while the last five queries together added at least one percent of its
`firstSeen` so far, and never past the hard cap of D1. A section that the growth rule ends has
`stoppedBy: GROWTH`. The barren rule ends it before that when three passes in a row add
nothing. `BUDGET` is then only a section that reached the hard cap.

## 4. What the report says

`sections[]` gains `coverageOnce` (products the section returned by exactly one query, the ones
the next term would be drawn from) and `growthAtStop` (what the last five queries added). The
`LISTING_UNREAD` warning of plan `0251` is written for `BUDGET` and `NO_TERM` as before, and not
for `GROWTH`: a section whose last five queries added under one percent is a section the
source has shown as far as this method reaches, and that is the honest end of plan `0085`.

## 5. What the PR quotes

Two walks on one ephemeral slot the same afternoon: the `dev` code (the harvester of
`origin/dev`, with its budget of 25 and the barren rule as it is there) and this branch. For
each: products, sections by stop reason, queries, time. Then the per section table of this
branch (`firstSeen`, `queries`, `stoppedBy`, `coverageOnce`, `growthAtStop`), and the five
sections with the largest gain and the five with the largest loss against the `dev` walk, by
`firstSeen`.

## Tests

- The weight: a word carried by two products returned once outweighs a word carried by three
  products returned four times each; after a query returns those two products, the word's
  weight falls and another word is chosen.
- Coverage counts a product once per query that returned it, also when the result set repeated
  the row.
- The growth rule: a section past the floor whose last five queries added under one percent
  ends `GROWTH`; one whose last five added more goes on; a section at the hard cap ends `BUDGET`;
  a section with three barren passes ends `BARREN` before the growth rule is consulted.
- No section issues the same query twice, and the plan `0257` and `0251` cases keep their
  answers where their fixtures do not depend on the frequency order (state in the PR which
  cases changed their expected term and why the new term is the right one).

## Acceptance criteria

- [ ] On the same afternoon, this branch finds at least as many products as `dev` and spends
  fewer queries.
- [ ] No section ends `BUDGET` below the hard cap, and no section is cut below 25 queries by
  the growth rule.
- [ ] `firstSeen` still adds up to the run's product count.
- [ ] A section that ends `GROWTH` writes no `LISTING_UNREAD` warning; `BUDGET` and `NO_TERM`
  still do.

## Verification

The two walks of section 5 on an ephemeral slot, in either order, within one afternoon, quoted
in the PR with their run ids.

## Decisions

- **D1 (owner): the hard cap.** (a) 100 queries a section, four times the floor, about 2,000
  pages at the ceiling in the worst case for one section; (b) 50. Recommended: (a), because the
  growth rule is what ends a section now and the cap is only a guard against a section that
  keeps adding one product a query for ever.
- **D2 (owner): the growth window.** (a) the last five queries add at least one percent of
  `firstSeen`; (b) the last three add at least one product. Recommended: (a), because one
  product in three queries is the brute force this plan replaces, at twenty pages a query.
- **D3 (owner): the weight.** (a) `1 / (1 + coverage)`, so a product returned once weighs half
  and one returned three times a quarter; (b) products of coverage one only, every other product
  weighs nothing. Recommended: (a). It degrades to (b) in effect when few products are covered
  once, and it still offers a term when every product has been returned twice.
