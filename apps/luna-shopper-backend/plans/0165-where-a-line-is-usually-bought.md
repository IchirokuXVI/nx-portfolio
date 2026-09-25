> **PR:** [#480](https://github.com/IchirokuXVI/nx-portfolio/pull/480)

# 0165: where a line is usually bought

> Frontend half: velista `0104`, the filter for what you usually buy here. Needs `0163`
> first: this plan counts the chain `0163` copies onto each settle.
>
> Prerequisite reading: `0143` and `0151` (the shop on a settlement, and who is told it),
> `0141` (the walk order, the other thing learned from past trips), and `0123` and `0125`
> (due lines, the other "you usually" answer).

A person standing in a Mercadona wants to see the lines their household buys at Mercadona,
and not the ones it buys at LIDL. The basket read at a shop (`0163` section 2) answers, for
each row, how often its lines were bought at that shop's chain in their last six purchases.
The client filters on it. The filter never changes the order of the rows.

## Brief for the agent

### Objective

When the basket read has a shop, answer for every row whether and how often its lines were
bought at that shop's chain, by the rules of section 1, as counts only.

### Context

- **Settlements** are `line_settlements` in core
  (`core/src/app/entities/line-settlement.entity.ts`). `ix_settlements_line`
  (`lineId`, `settledAt`) already exists and answers "the last six of a line". After `0163`,
  a settle made at a chosen shop carries `supermarketLocationId` and `supermarketId`, and a
  settle made in "any shop" mode carries neither.
- **A basket row** can merge lines from several lists. Its entries carry `lineId`
  (`BasketRowView` in `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts`).
- **The read is composed in the gateway** (`gateway/src/app/baskets/basket.controller.ts`,
  `get`, around line 185). After `0163` it knows the read's shop, and so its chain, before or
  beside the core call.
- **Every settle on a line counts**, whoever made it and through whichever basket or list
  page, because a line belongs to one list in one zone. That is the household scope the user
  asked for: a basket generated from two lists gets the usual lines of those two lists.

### Target state

- `GetBasketRequest.supermarketId?: string`, sent by the gateway when the read has a shop.
- Each row in a read with a shop carries `usual` (section 2). A read with no shop carries
  `usual: null` on every row.
- The OpenAPI document and the admin wire types are regenerated.

### Scope

Work only in:

- core: one query over `line_settlements` for a basket's line ids, the pure function of
  section 1 with its spec, and the basket view mapper
- gateway: passing the chain to core in the basket read
- `libs/luna-shopper/contracts` for the field
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, how a settle is written, the walk order, due lines, or the item
history routes.

### Constraints

- **Counts only.** `usual` never names a person, a time, a shop other than the read's, or a
  chain other than the read's. `0143` keeps a shop and a time private for a reason.
- **The chain decides, not the shop.** A purchase at any Mercadona counts for every
  Mercadona, as the user decided on 2026-09-24. The read's shop only chooses the chain.
- **The rule is a pure function** of the per line windows, with a table spec, so the rounding
  and the states are tested without a database.
- **One query per read**, a window function over the basket's line ids, not one query per row.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- counting `NOT_AVAILABLE`, skips, or reverted settles
- counting by shop rather than by chain
- returning anything per person
- changing the window of six or the threshold of five

### Progress evidence

After each step, state what was built and paste the output that proves it:

- The table spec of section 1, including every row of section 3.
- A core spec against an ephemeral Luna slot: settles from a basket, from a list page and from
  a guest all count, and the window keeps the newest six.
- `EXPLAIN` of the query on a basket of 100 lines, using `ix_settlements_line`.
- The regenerated documents.

## 1. The rule

For each line of the row, take its last six settles with outcome `BOUGHT` and `revertedAt`
null, newest first. That is the line's window. For each line with a window that is not empty:

- `of` is the size of the window (1 to 6)
- `bought` is how many settles in the window have `supermarketId` equal to the read's chain

Then, for the row:

| Condition | `state` | Shown when the filter is on |
| --------- | ------- | --------------------------- |
| no line of the row has a settle | `NEVER_BOUGHT` | yes, with no message |
| no settle in any window names a chain | `NO_SHOP_KNOWN` | no |
| some settle names a chain, but the row's `bought` is 0 | `ELSEWHERE` | no |
| the row's `bought` is 1 or more | `HERE` | yes, with a message if `bought` is under 5 |

The row's numbers are averages over the lines that have a window:

- `bought` is the average of the lines' `bought`, rounded half up. If the average is above 0,
  it is at least 1, never 0.
- `of` is the average of the lines' `of`, rounded half up.

So three merged lines with 18 settles in total still answer a number from 1 to 6, as the
user asked. Lines that were never bought do not enter the averages. That is this plan's
reading of the user's rule, and section 3 lists it for confirmation.

## 2. The field

```ts
usual: {
  state: 'NEVER_BOUGHT' | 'NO_SHOP_KNOWN' | 'ELSEWHERE' | 'HERE';
  bought: number; // 0 to 6
  of: number; // 0 to 6, 0 only for NEVER_BOUGHT
} | null; // null when the read has no shop
```

The client decides what to draw. The server does not filter rows, because the filter is a
choice of the viewer and the rows are shared.

## 3. Open questions

- **The first weeks hide almost everything.** The user's first description said a line
  with no record of where it was bought is shown, and the answer on 2026-09-24 said it is
  hidden (`NO_SHOP_KNOWN`). No settle before `0163` names a chain, so on the day this ships
  every line that was ever bought is hidden, and only lines never bought stay. A line heals
  after one purchase at a chosen shop. Build the table as written, and keep `NO_SHOP_KNOWN`
  a separate state, so that the choice is one line in the client if it is reversed.
- **Averages ignore lines that were never bought.** Confirm this reading of "go with the
  average".
- **A settle is a purchase.** Buying two of a line in two taps on one trip, when the first
  tap bought fewer, writes two settles, and both count. Collapsing them by trip is not in this
  plan.
