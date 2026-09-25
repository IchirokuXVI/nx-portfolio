# 0016 (backlog) Availability learned from shoppers

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-09-24 while `0163`, `0164` and `0165` (with velista `0102` to `0104`) were
> planned. Those plans mark a row unavailable at a shop only from what a crawl stored, and
> they draw no availability filter. This file holds the two things the user deferred.

Today `supermarket_location_items.available` is written by the DEZA runner and by an admin,
nobody else. Only DEZA publishes availability per shop, so for every other chain the value
stays unknown. Shoppers standing in a shop know more than any crawl, and two of their
actions already say it:

- **A purchase at a chosen shop** (`0163` section 5) says the shop had the product.
- **"They had none"** (`NOT_AVAILABLE`, velista `0092`) says it did not. Since `0163`, that
  settle can record the shop.

## Brief for the agent

### Objective

Write per shop availability from what shoppers record at a chosen shop, positive from
purchases and negative from "they had none", once enough distinct people agree, and add
availability filters to the basket.

### Context

- `supermarket_location_items` (catalog) has `available`, `availabilitySourceKind`,
  `availabilityObservedAt` and `availabilitySourceRunId`. An admin value is protected from
  crawls. The writer is `supermarket-location-item.service.ts`.
- `line_settlements` (core) carries `itemId`, `outcome`, `supermarketLocationId` and, after
  `0163`, `supermarketId`. A free text line has no `itemId` and can never count.
- `availabilityObservedAt` changes only when the value changes, so the age of a value is not
  known today (the review of 2026-09-24, point 9).

### Target state

- A new `availabilitySourceKind`, for example `SHOPPERS`.
- A rule that turns shopper facts into a value. To agree before building:
  - how many **distinct** people must agree (a threshold, for example three), and within how
    many days
  - whether one person's repeated reports count once
  - which wins when shoppers and a crawl disagree, and when a newer shopper fact contradicts
    an older one
  - that an admin value always wins, as it does over a crawl today
- Where the aggregation runs. Core holds the settlements and catalog holds the value, so a
  NATS event per qualifying settle, or a periodic sweep, is the choice to make.
- The two availability filters in velista's basket, drawn only when a shop is chosen:
  - hide the rows known to be unavailable
  - show only the rows known to be available (most rows are unknown, so this hides most
    of the basket, and the copy must say so)

### Constraints

- A shopper fact never names the person to anybody. Only the aggregate is stored.
- A guest's settle counts the same as a member's, or not at all. Decide which.
- Nothing here changes a price.

### Out of scope

Crawled availability for chains other than DEZA. That is an adapter question for each
chain.
