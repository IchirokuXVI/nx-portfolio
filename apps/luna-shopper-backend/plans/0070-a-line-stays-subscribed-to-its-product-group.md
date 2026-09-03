# 0070 A line stays subscribed to its product group

> **Backend half.** velista `0065` is the other one: the chip that says who put a product on the
> line, the adoption gesture, and the counter that reads `98/100`.
>
> This **revises `0048` section 1.1**, which made picking a group a one time copy and said so in
> the entity docs, in `LineView`'s doc comment and in the plan itself. Those three places are
> rewritten by this plan rather than left to disagree with the code.
>
> Prerequisite reading: `0048` (product groups, and the line's product set), `0050` section 4 and
> `0051` (baskets, which this must not touch, and section 8 is why), `0018` section 4.4 and
> `0011` (the identity reconciliation this borrows its whole shape from).

Somebody picks the **Milk** group in the composer and gets a line naming the eleven milks the
catalog knows about. A month later the catalog learns about three more. Their line still says
eleven, and nothing in the product will ever tell it otherwise: the copy was taken, and the line
forgot where it came from the moment it was written.

The same person takes two of the eleven off the line, because their household does not drink
lactose free milk, and adds a brand the catalog had filed under nothing. That edit is the reason
the copy exists, and it is the thing any sync has to be careful not to undo.

## 1. What `0048` decided, and the half of it that stays

Section 1.1 argued the copy like this:

> Picking a group in the composer **copies the group's members onto the line**. The line
> references no group afterwards, so removing a product the household never buys, or adding one
> the group missed, is an ordinary edit of that line. That is the point of the copy: the catalog
> does not have to curate a group for every household's version of "milk", because a line is its
> own hand made group.

Two claims are bundled there, and only the first survives:

1. **A household must be able to diverge from the group.** True, and this plan does not weaken it
   by a single gesture. Every edit a person could make to a line's product set before, they can
   still make, and the divergence still wins.
2. **Therefore the line must forget the group.** This does not follow. Forgetting is one way to
   protect a divergence, and it is the way that also throws away every correction the catalog will
   ever make. Recording the divergence protects it just as well and keeps the subscription.

So the line keeps a reference to its group **and** a record of how it differs. The catalog still
does not curate a group per household: it curates one Milk, and each line carries its own delta
against it.

## 2. What is being built

Three facts the model does not hold today.

| Fact                                            | Where it lives                                     |
| ----------------------------------------------- | -------------------------------------------------- |
| which group this line came from                 | `list_lines.productGroupId`, nullable, one at most |
| who put each product on the line                | `list_line_items.source`, `GROUP` or `USER`        |
| which of the group's products a person took off | `list_line_group_removals`, one row per pair       |

The third is the one that is easy to leave out and the one that breaks first without it. A person
who deletes a group added product leaves **no trace** under the current schema: the row is gone,
and the next sync sees a group member that is not on the line, which is exactly what it sees for a
product that was just added to the group. It would put the deleted product back, every time,
forever. A user deletion has to be a record, not an absence.

## 3. The invariant: provenance moves one way

**A product's source may go from `GROUP` to `USER` and never back.** Everything else falls out of
it, and the four cases that would otherwise each need an argument answer themselves:

| What happens                                               | Result                                             |
| ---------------------------------------------------------- | -------------------------------------------------- |
| a person adopts a group added product (velista `0065`)     | `GROUP` becomes `USER`; the sync stops touching it |
| a person adds by hand a product that later joins the group | stays `USER`; the group cannot claim it            |
| a person edits a line in any other way                     | nothing about source changes                       |
| the group loses a product a person has adopted             | it stays on the line                               |

Said once, in one sentence: **the app never takes ownership of something a person touched.** It is
also what makes the migration in section 10 correct without a backfill.

## 4. The schema

```
list_lines
  + productGroupId  uuid null            -- index, partial on NOT NULL

list_line_items
  + source          enum('GROUP','USER') not null default 'USER'

list_line_group_removals                  -- new
    id        uuid pk
    lineId    uuid not null  -> list_lines(id) on delete cascade
    itemId    uuid not null                    -- opaque, no FK into catalog
    createdAt timestamptz
    unique (lineId, itemId)
```

`productGroupId` is opaque and carries no foreign key, exactly as `ListLineItem.itemId` is and for
the same reason: it names a row in catalog's database, which core cannot reference.

**The removals are a table and not a `removed` flag on `list_line_items`**, for two reasons. The
membership table is read on every list read, and every one of those reads would grow a
`WHERE source <> ... AND removed = false` that is silently wrong the one time somebody forgets it,
where a tombstone in another table cannot leak a deleted product onto a screen at all. And
`uq_list_line_item(lineId, itemId)` means "this product is on this line"; a tombstone is the
opposite statement, and storing both in one table makes that unique constraint stop meaning
anything. The removals are read by the sync and by nothing else.

## 5. The trigger is `item.update`, not `productGroup.update`

Group membership is `items.productGroupId`. `ProductGroupService` says so in its own class doc:
"**nothing here assigns items to groups**". So "an admin adds three products to Milk" is three
`item.update` calls, and a plan that hangs the fan out off the group service watches a service
that will never fire.

Two events, in `libs/luna-shopper/contracts/src/lib/events/catalog.events.ts`, following
`POSTAL_CODE_EVENTS`:

```ts
export const CATALOG_EVENTS = {
  /** One product joined a group, left one, or moved between two. */
  itemGroupChanged: 'catalog.itemGroupChanged',
  /** A group no longer exists; every line bound to it must let go. */
  productGroupDeleted: 'catalog.productGroupDeleted',
} as const;
```

```ts
export interface ItemGroupChangedEvent {
  eventId: string;
  itemId: string;
  /** The group it left, or null if it belonged to none. */
  from: string | null;
  /** The group it joined, or null if it now belongs to none. */
  to: string | null;
}

export interface ProductGroupDeletedEvent {
  eventId: string;
  productGroupId: string;
}
```

**The delete event is not a convenience.** `ProductGroupService.delete` relies on the foreign key
to null every member's `productGroupId`, which happens inside Postgres and emits nothing. Without
its own event, deleting a group would be invisible to core, and the next unrelated `item.update`
would be the first hint. Worse, if the deletion did somehow arrive as a burst of per item changes,
core would read it as "the admin removed every product from Milk" and empty every subscribed line.

Catalog publishes both after its transaction commits and never waits for them, as core does for
`POSTAL_CODE_EVENTS`. A failure to announce must not fail the admin write that caused it.

### 5.1 Core consumes them the way it already consumes identity

There is a working precedent for a fact owned by another service being reconciled into core's
rows, and this should look like it rather than invent a second style:
`reconciliation.controller.ts` takes `IDENTITY_EVENTS.userUsernameChanged`, and
`UsernamePropagationService` wraps the whole handler in `runOnce(this.store, key, ...)` against the
`processed_events` inbox, so an at least once redelivery neither writes twice nor emits twice.

A new `ProductGroupSyncService` in `core/src/app/lists`, with a controller beside the existing one,
does exactly that. The idempotency key is `catalog.itemGroupChanged:${event.eventId}`, keyed on the
event id and not on the pair of group ids, so a product moved out of Milk and back into it later
still applies the second time.

## 6. What the sync does

### 6.1 `itemGroupChanged`

Both halves run, and because a line is bound to at most one group, at most one of them can touch
any given line.

**The product joined `to`.** For every line with `productGroupId = to`:

- it already holds the product, whatever the source: nothing. The set is a set.
- a removal row exists for the pair: nothing. That is a person's decision and it does not expire.
- otherwise: insert a `list_line_items` row with `source = GROUP`, positioned at the end.

**The product left `from`.** For every line with `productGroupId = from` that holds it:

- `source = GROUP`: delete the row, and write **no** removal row. A tombstone records a person's
  decision; this is the catalog's, and if the product rejoins the group later it should come back.
- `source = USER`: keep it. Adopted, or added by hand before the group ever had it. Section 3.

### 6.2 `productGroupDeleted`

For every line with `productGroupId = productGroupId`: set it to null, rewrite every `GROUP` row to
`USER`, and delete the line's removal rows.

Nothing is taken off the line. Undoing a curation decision must not delete products out of
households' shopping lists, and the group service already reasons this way about its own members
("Undoing a curation decision must not be blocked by the products it was about"). The line becomes
what `0048` shipped: a hand made set, owned entirely by the person holding it.

### 6.3 After a line changes

Per line touched, and only for lines actually touched:

- recompute `itemSetHash` through `itemSetHash()`. The one algorithm stays in one file. A sync that
  wrote products without refreshing the digest would break the dedup in `0050` section 3 and the
  cross list indicator in velista `0043` in a way nothing would notice for weeks.
- bump `version`.
- emit `RealtimeEvent.LineUpdated` to the list room.

The realtime event is the part to be deliberate about: **this is the first thing in the product
that changes a line with nobody having touched it.** A tab open on the list will redraw. That is
correct and it is also why velista `0065` marks the products rather than letting them appear
anonymously.

### 6.4 The fan out is bounded by the binding, not by the catalog

The query is `list_lines WHERE productGroupId = $1`, on an index, and one product joining a group
touches only lines bound to that one group. It is not a sweep over every line in the product. The
work is proportional to how many households subscribe to Milk, which is the number the feature is
about.

## 7. The cap

`LINE_ITEM_SET_MAX` stays 100 and gains a precise meaning: **the largest set a person may grow a
line to.** It is not, and cannot be, a bound on the set's size.

### 7.1 A client write is all or nothing

The rule, in one expression:

```
next.length <= max(LINE_ITEM_SET_MAX, current.length)
```

- at 98, adding a group of 10 asks for 108, which is more than 100, so **nothing is added**. Not
  the first two.
- at 104 (see 7.2), removing one asks for 103, which is at most 104, so it is allowed.
- at 104, adding one asks for 105, which is more than 104, so it is refused.

**All or nothing is the deliberate half.** The wire shape is a whole set replacement, so a partial
fill would mean the server choosing which 2 of a group's 10 products land on somebody's shopping
list. That is a curation decision, nobody asked for it, and the ordering it would use (English
name) is meaningless to the person looking at the result. Refusing tells the truth and leaves the
decision where it belongs, which is why velista `0065` spends a sentence explaining it rather than
hiding it.

### 7.2 The sync ignores the cap, and that has a consequence in the schemas

A line bound to a growing group can pass 100, and that is an accepted state rather than a bug: the
alternative is a subscription that silently stops working at a number the person cannot see.

But `updateLine`'s schema currently reads `itemIds: { ...array(nonEmptyString()), maxItems:
LINE_ITEM_SET_MAX }`, and **that makes an over cap line uneditable**. At 104, a person removing one
product sends an array of 103 and gets a 400 before any service sees it. They would be unable to
shrink the line back under the cap, by the rule that exists to keep it under the cap.

So:

- `updateLine` keeps a structural bound, `LINE_ITEM_SET_CEILING`, generous enough that no curated
  group approaches it and small enough that a request body stays bounded. The sync respects the
  same ceiling and truncates a larger group in English name order, which is the order
  `item.searchOffers` already caps by, so the two agree.
- `addLine` and `addLines` keep `maxItems: LINE_ITEM_SET_MAX`. A new line starts empty, so
  `max(100, 0)` is 100 and the schema is exactly right there.
- The real rule moves into `LineService.update`, which is the only place that knows the current
  size. This is the argument `ProductGroupService.validateSlug` already makes about the gateway
  being one caller among several rather than a wall.

The refusal is a `ValidationException` with `details` naming the cap, the current size and how many
were offered, and a `itemIds` field error so a client can key on something stable. velista refuses
before sending (`0065` section 3), so this is the belt on top of the braces, which is the posture
`list-error-copy.ts` already documents for every other write.

## 8. What the sync must not touch

- **Baskets.** A `GeneratedList` is a snapshot, argued three times over in its own entities:
  `GeneratedListLine` ("copies taken at generation time, not a view over the zone lines that fed
  them... a shopping list that rewrites itself while you are in the shop is hostile"),
  `GeneratedListLineOption` ("the zone line's set can change afterwards and this one does not move
  with it"), and `GeneratedListLineOrigin` (`lineVersion`, kept precisely so a reader can be told
  an origin moved rather than have the move applied to them). A person editing a line's products
  mid trip already does not disturb an active basket, so a group sync must not either. **This
  needs no code.** The requirement is negative: do not add a path from this sync into
  `generated_list_lines` or `generated_list_line_options`.
- **Settlements.** They hang off basket lines, so section 8's first bullet covers them, and a
  settled `itemId` is a record of what somebody actually bought. Nothing here rewrites history.
- **`quantity`.** Never touched, and in particular never resurrected from zero. Zero means the
  household is stocked (`0047` section 1), and three new milks in the catalog is not a reason to
  put milk back on the list.
- **`approvalStatus` and `content`.** Attaching products renames nothing and approves nothing.

## 9. Contracts

`LineView` gains two fields:

```ts
  /** The product group this line is subscribed to, or null for a hand made set. */
  productGroupId: string | null;
  /**
   * The subset of {@link itemIds} the group put there and nobody has adopted.
   * Empty for every line that is not subscribed, which is every line 0048 created.
   */
  groupItemIds: string[];
```

`itemIds` **stays** and keeps its meaning. It is what the hash is computed from, what `0050`
dedups on, what velista `0043` matches on, what a basket's options are built from and what `0065`
promotes; replacing it with an array of objects would rewrite all of those to derive the array
back. `groupItemIds` is a subset of it, and because there are exactly two sources, one subset
determines the other.

`line.update` gains an optional `adoptItemIds: string[]`: the products to move from `GROUP` to
`USER` without otherwise changing the set. A separate field rather than an inference from
`itemIds`, because a set replacement that happens to keep a product is not a statement about who
owns it, and reading adoption out of it would adopt the whole line every time somebody removed one
product.

`line.add` gains an optional `productGroupId`, which is how the composer says the set it is
sending came from a group. **The server does not re-derive the set from the group at creation.**
The suggestion already carries the members it offers, one tap adds the line, and a second read of
the group would let the line be created with different products than the row said it would add.

The doc comments on `ListLine`, `ListLineItem`, `LineView.itemIds` and `0048` section 1.1 all
currently state that a line references no group. Every one of them is rewritten in this plan's PR.

**Regenerate `gateway/docs/openapi.json`.** `LineView` changes, so the committed document is stale
the moment this lands, and `openapi-document.spec.ts` fails until it is regenerated.

## 10. Migration

One core migration, three DDL changes, **no backfill**.

Every existing `list_line_items` row takes the column default, `USER`, and every existing line
gets a null `productGroupId`. That is not a shortcut, it is the invariant in section 3 applied to
data whose provenance genuinely is not recorded anywhere: a product whose origin is unknown belongs
to the person holding it, because the failure mode of guessing wrong in that direction is a line
that syncs slightly less than it could, and the failure mode of guessing wrong in the other is the
app deleting products out of somebody's shopping list on the strength of a guess.

**Existing lines are not retro-bound to groups by `itemSetHash`.** A line whose set happens to
match Milk's members today was still assembled by a person, and enrolling it into a subscription
it never asked for is `0065`'s "an edit nobody asked for" applied to every household at once. A
person who wants the subscription can pick the group again.

## 11. Tests

In `product-group-sync.service.spec.ts`, with a fake repository per the house pattern:

1. A product joining a group lands on every line bound to it, with `source = GROUP`, and on no
   line bound to another group or to none.
2. A product joining a group does **not** land on a line that already holds it as `USER`, and does
   not duplicate it.
3. A product joining a group does not land on a line with a removal row for it. Re-delivering the
   event does not either.
4. A product leaving a group is removed from a line holding it as `GROUP`, and left on a line
   holding it as `USER`.
5. A product leaving a group writes no removal row, so rejoining puts it back.
6. Adoption moves `GROUP` to `USER`, and a subsequent removal from the group leaves it alone.
7. A user deleting a `GROUP` product writes a removal row; the group later re-adding it is a no op.
8. A user re-adding by hand a product they had removed clears the removal row and the row is
   `USER`.
9. `productGroupDeleted` unbinds, rewrites every `GROUP` row to `USER`, drops removal rows, and
   removes no products.
10. `itemSetHash` and `version` move on every line the sync touched and on no line it did not.
11. `runOnce`: a redelivered `itemGroupChanged` writes nothing a second time and emits nothing a
    second time.
12. Cap: at 98, an update to 108 is refused whole and the stored set is still 98. At 104, an update
    to 103 succeeds. At 104, an update to 105 is refused.
13. A line's sync does not write to `generated_list_lines` or `generated_list_line_options`. Asserted
    directly, because section 8's requirement is a negative one and nothing else would catch its
    violation.

## 12. Out of scope

- **Any admin surface.** Groups are curated through the existing platform admin gate and there is
  no screen for it, which does not change here.
- **Matching products into groups automatically.** Still backlog `0001` section 6.2, still needs
  the review queue that comes with it.
- **More than one group per line.** One binding, one column. Per item attribution of which of
  several groups contributed a product is a different feature and nothing asks for it.
- **Telling anybody a sync happened**, beyond the realtime redraw and the marks velista `0065`
  draws. No digest, no notification, no "3 products were added to Milk" banner.
- **Baskets learning that an origin moved.** `lineVersion` has been sitting there for it since
  `0050` and nothing reads it. Still nothing reads it.
