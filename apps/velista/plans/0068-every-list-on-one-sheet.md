# 0068: every list on one sheet

> Two sheets answer one question today. The units sheet (`0055`) shows what each list asked
> for, but only lists that already hold the line. The send sheet (`0056`) offers every list,
> but only once, to an added line, and only as a name to tap. A shopper who added "batteries"
> and wants three for the flat and two for the parents cannot say so anywhere.
>
> Backend `0092` made it one write: a number per list, raised from zero to send, created or
> adopted as the list needs. This plan makes it one sheet. The send sheet goes, the units sheet
> takes every list the reader can write, and the lists that ask for nothing yet sit behind one
> control so the common case is still a screen of the lists that matter.
>
> Prerequisite reading: `0055` (the sheet this widens, especially sections 4.2, 5 and 6), `0056`
> (the sheet this deletes, and section 5 for the copy that survives), backend `0092` (the read
> and the write), backend `0093` (the purchases that come home when a list is raised, which
> section 6 says out loud) and `0044` section 4.1 (the all or nothing rule).

## 1. What is being built

| Piece                                                   | Where                              |
| ------------------------------------------------------- | ---------------------------------- |
| The sheet: three groups, two columns, one show control   | `line-units-sheet`                 |
| The way in, for every line                              | `settle-sheet`                     |
| The send sheet and its route, deleted                   | `line-list-sheet`, `feature-shell/src/lib/routes.ts` |
| The read's third collection and the write without a line | `BasketApi`, `BasketStore`, `basket-memory` |
| The models and the mapper                               | `libs/velista/models`, `basket-view.ts` |
| The copy                                                | `en.json`, `es.json`               |

The route stays `…/sheet/lines/:lineId/units`. `lines/:lineId/list` is removed, and so are
`BasketApi.getLineTargets`, `BasketApi.bindLine`, their fakes and the `basket.send.*` keys
that named the picker, since the row's "waiting for approval" caption now reads the origin.

## 2. Who sees it

Unchanged from `0055` section 2: a reader who passes the all or nothing rule, and nobody
else. The entry is now drawn for **every** line, added or derived, with origins or without,
because an added line with nothing yet is exactly the line that most needs it. It is still
absent for a guest, and still absent rather than disabled (`0030`).

## 3. The names of the numbers

Nine quantities were named while this was designed, and the sheet draws three of them. The
rest are the row's, and the two sheets must not be able to read as the same thing.

| On the sheet   | Meaning                                                | Served as        |
| -------------- | ------------------------------------------------------ | ---------------- |
| **Asked for**  | what this list asked for through this basket. A snapshot: buying does not move it, only this sheet does, and a finished basket freezes it | `contributed`    |
| **Bought**     | what this basket bought for this list                  | `settledHere`    |
| a caption      | what the list's own line asks for now, when it differs from asked for minus bought | `listQuantity`   |

"Asked for" and not "needed": needed reads as outstanding, which is the number on the reel one
screen up, and that reel means bought when it goes down. This one never does.

## 4. The sheet

### 4.1 The total, at the top

As `0055` section 4.1: the line's content, and the sum of what the lists asked for beside the
basket's own quantity when the two differ, which is `0056`'s extra.

### 4.2 The lists that asked

One row per origin with asked for above zero, the run's own lists first (`fromRun`), then by
zone name and list name. Each row:

- the list name, the zone name under it
- the **Asked for** reel, bound to `contributed`, floored at `settledHere` (`0057` section 5.2)
  and capped at `LINE_QUANTITY_MAX`
- the **Bought** number, read only
- a caption when the list's own line has moved: "its list now asks for 2"
- a caption when `approvalStatus` is pending: "waiting for the list to agree"
- a row with `writable` false draws its numbers and no reel (`0055` section 4.2)

### 4.3 The lists that did not, behind one control

One collapsed container, closed by default, labelled with its count: "5 more lists". Opening
it shows two runs of rows, in this order, with no second heading between them:

1. **Lists holding this line at zero from this basket**: `origins` at zero, and `candidates`.
   Same row shape, reel at zero, and the caption says what the list asks for on its own: "asks
   for 5 on its list". Raising the reel to that number takes over the demand and raises the
   list by nothing; above it, by the difference (backend `0092` section 4.1).
2. **Lists with no such line**: `others`. Reel at zero, no caption. Raising it creates the
   line in that list, under that list's own approval rule.

A candidate that cannot be taken is drawn with its reason and no reel, as `0055` section 4.3
already does, with the reasons that remain after `0092` section 3.2:

| Reason     | What the row says                                   |
| ---------- | --------------------------------------------------- |
| `CLAIMED`  | somebody is already buying this for that list       |
| `REJECTED` | that list said no to this line                      |

`NOT_APPROVED` and `SETTLED` are gone from the copy, because both rows now have a reel.

Collapsed by default for `0055` section 4.3's reason, and the reason is stronger now: for a
reader in many zones, the closed run is every list they can write.

### 4.4 The sentence

`0055` section 5's sentence stays, word for word, under the title:

> Changing these changes what each list wants. Nothing here is marked as bought.

And the reels here still narrate nothing on the drag, for the reason that section gives.

## 5. Committing, and what comes back

As `0055` section 6, per row, on release: one write with `from` as the number the row showed.
The only change is the request: a row from `others` sends no `sourceLineId`, and the answer
puts one on it, so the row becomes an origin and stays where it is.

The answer can also say the write landed on a line the read did not offer, when the names
fold together on the list (backend `0092` section 4.2). The row takes the answered line and
shows its approval, and nothing else on the sheet changes.

A refusal is drawn under the row it is about, as `0055` section 6 draws them, with two new
sentences: the stale case where a raise landed on a line already here ("this list already
has it, read again"), and the rejected case if it reaches the write.

## 6. Purchases that come home

When a list is raised for a line that was already bought in part, backend `0093` records
those units on it, and the row's **Bought** number arrives with a value on the very answer that
created the row. The sheet says it once, in the same slot a refusal uses, because "the flat
now knows about batteries and needs none" is the strange outcome `0056` section 5.2 refused
to arrive at silently:

> Added to Flat. 4 recorded as bought there.

And when the line has waiting units and the list asked for fewer than that, the caption says
how many are still waiting, off `waitingSettled`, so the shopper knows a second list would
take the rest.

## 7. The models and the mapper

`BasketLineOrigins` in `basket-view.ts` gains `others`, and its origin and candidate rows gain
`fromRun` and `approval`. The mapper reads them from `unknown` (rule D4), and unknown
`unavailable` reasons map to "cannot take" with no reel rather than to a reel, since the
absence rule fails safe.

`BasketStore.setOriginQuantity` takes `sourceLineId` as optional and passes it through.
`basket-memory` grows the create branch and the name fold, so the sheet can be walked
without a backend.

## 8. Accessibility

`0055` section 7 unchanged: one live region on the sheet, the reel's own name, and the
collapsed control as a disclosure button with `aria-expanded` and the count in its name.

## 9. Copy

| Key                              | en                                               |
| -------------------------------- | ------------------------------------------------ |
| `basket.units.askedFor`          | Asked for                                        |
| `basket.units.bought`            | Bought                                           |
| `basket.units.more`              | {count} more lists                               |
| `basket.units.listAsks`          | asks for {count} on its list                     |
| `basket.units.listNow`           | its list now asks for {count}                    |
| `basket.units.pending`           | waiting for the list to agree                    |
| `basket.units.rejected`          | that list said no to this line                   |
| `basket.units.cameHome`          | Added to {name}. {count} recorded as bought there |
| `basket.units.stillWaiting`      | {count} bought and not yet on any list           |
| `basket.units.alreadyHere`       | this list already has it, read again             |

Spanish beside each, and the `basket.send.*` keys that named the picker removed.

## 10. Tests

1. The mapper reads `others`, `fromRun` and `approval`, and an unknown reason draws no reel.
2. The selector orders: origins above zero with the run's first, then the collapsed run with
   zero origins and candidates before others.
3. An added line with nothing shows the entry, an empty first group and the collapsed control
   with the count of every writable list.
4. Raising an other sends no `sourceLineId`, and the row becomes an origin on the answer.
5. Raising a candidate to its own demand shows no zone change, and the row says it is
   waiting when the answer says so.
6. A row answered with `settledHere` above zero draws the came home sentence.
7. The send route is gone, and `basket-page` reaches the units sheet for a derived and an added
   line alike.
8. The e2e that shops (`0050`) gains: add a line as the owner, buy it, raise it for two lists,
   read both lists.

## 11. Acceptance criteria

- One sheet answers what every writable list asked for, and the send sheet does not exist.
- Lists that asked sit first, the rest behind one control with a count, in the order section
  4.3 states.
- Raising a list with no line creates it, and raising one that holds the line adopts it without
  doubling what it asks for.
- The Asked for column never moves on a purchase, and the Bought column never moves from this
  sheet.
- A list that receives units bought before it was raised says so, in one sentence.
- A guest sees none of it.
