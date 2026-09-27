# 0017 (backlog) What shoppers submit is moderated

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-09-27 while `0168` (a shop has a map) was planned. The user decided that
> user submitted maps need review and that the review system belongs in the backlog beside
> user submitted prices (backlog `0001` section 2). `0168` builds the one gate a map cannot
> ship without: a submission is `PENDING` until an admin accepts it. Everything else about
> handling what strangers send is here.

Two kinds of shopper submission exist or are planned: prices (backlog `0001` section 2,
stored as entered, a moderation queue reserved and not built) and maps (`0168`, accepted one
by one in the back office). Both are user generated content, both need the same handling,
and neither must get it twice.

## Brief for the agent

### Objective

Give shopper submissions one moderation model: quotas per person, reports, trust that
earns lighter review, a diff view for a resubmitted map, merging of several walks of one
shop, and the abuse handling backlog `0001` section 2 reserved for prices.

### Context

- `0168` stores maps with a status and a submitter, throttles the upload route, and lets a
  person supersede their own pending map. It reviews every map by hand.
- Backlog `0001` section 2 stores prices from shoppers exactly as entered and reserves a
  moderation queue, rate limiting per user (`0004` section 8) and abuse handling.
- The admin has `QueueFrame` and `decideMany` for queues with a partial failure rule.
- Backlog `0016` learns availability from shoppers once enough distinct people agree, which
  is a trust rule of the same family.

### Target state, in outline

- A `submissions` view over maps and prices with one status vocabulary and one queue
  screen.
- Per person quotas per day and per shop, a report action on the phone, and a trust level
  that grows with accepted submissions and lets a trusted person's map go current with a
  review after the fact.
- A resubmitted map is reviewed as a diff against the current one, not as a whole.
- Several walks of one shop are merged into one draft, weighting segments by confidence,
  before review.

## Open questions

- Whether prices from shoppers are ever shown before review, given `0080`'s rule that every
  source's price is stored side by side and nothing overwrites.
- Whether trust is per person or per household.
