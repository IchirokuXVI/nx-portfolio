# 0056: sending a line you added to a list

> Server half: `apps/luna-shopper-backend/plans/0058`, which owns every rule this plan renders.
> Depends on `0053`, which creates the lines this sheet is about.
>
> A line added in the shop lives in the basket and nowhere else. That is the right default and it
> is deliberately not the end: somebody buys batteries because the flat kept running out, and the
> flat's list should learn that batteries are a thing the flat runs out of.
>
> This is the sheet that says which list. It is one gesture, it is one way, and it is the only
> place in the basket where a line the shopper typed reaches a household.

## 1. What is being built

A sheet at **`…/sheet/lines/:lineId/list`**, reached from the settle sheet on an added line that
has not been sent anywhere yet.

| Piece | Where |
| ----- | ----- |
| The way in, on an added, unbound line | `settle-sheet` |
| The picker: zones, lists, this basket's own first | a new `line-list-sheet` |
| The read and the write | `BasketApi`, `BasketStore` |
| What the row says afterwards | `basket-line-row` |

## 2. Who sees it

The same reader as `0055`: the owner, or a registered participant holding `WRITE` on every source
list. Absent for everybody else rather than disabled.

**A guest never sees it**, and the reason is worth writing down because it is not distrust. Every
row of this sheet is a list's name, and naming a list to a guest is the disclosure the whole
basket is built to prevent. A guest's line stays where they put it, and anybody with an account
can send it on afterwards. The person who added it is still named on the row, so the credit does
not move with the permission.

It is also absent unless the line is `ADDED` and unbound. A line the run composed is already in
the lists its origins name, and sending it again would be asking a household for a second copy
of something it already has.

## 3. The picker

Lists, grouped by zone, in two groups.

- **"From this basket"** first: the lists the run drew from. The line was almost certainly
  remembered while shopping for these, so the answer is usually here and usually one tap.
- **Everything else** below, grouped by zone. Any list the reader can write to, including zones
  this basket has never touched.

A search field above the groups once there are more than a screenful, filtering on the list name
and its zone. Nothing is preselected: the whole gesture is somebody saying which list, and a
preselected row is a default that can be committed by accident.

The server's answer already carries which lists were sources and which zone each list is in, so
this sheet composes nothing and reaches no zone store. That matters: the basket screen must not
grow a way to read zones, because a screen that can name a household is a screen a template
mistake could show one to a guest (the same reasoning `0049` section 1.2 used for the skip
report's names).

## 4. It is one way, and the sheet says so before it commits

Under the chosen list, before the confirm:

> This adds "batteries" to Flat. It cannot be taken back out from here.

Taking it back out is done on that list, by somebody with access, as an ordinary delete. That is
the property that makes this safe to offer at all: the basket can put something in front of a
household, and only the household decides what stays. `0050` section 5 fixed that shape and this
sheet renders it rather than reopening it.

So the confirm is a real one, unlike the reels in `0054` and `0055`, which commit on release. The
difference is reversibility: those two move a number that can be moved back, and this one creates
a row on somebody else's screen.

## 5. What happens afterwards

- The row grows a **"from" caption**, because the line now has an origin, which is the same
  caption every derived line already draws and needs no new code.
- The units sheet (`0055`) becomes useful on it: the line has a list, so its contribution can be
  changed like any other.
- The line still names **who added it** (`0053` section 5), which does not move to whoever bound
  it. Two different people did two different things and the row can say both.

### 5.1 When the list has not agreed yet

A list that does not auto approve receives the line as a request, not as a line (backend `0058`
section 4.3). The response says so and the sheet says so, once, on the way out:

> Added to Flat. It is waiting for someone there to approve it.

And the row's caption reflects it until it is approved. Drawing "from Flat" for a line the flat
has not accepted would be the screen claiming an outcome it does not have, which is the class of
defect `0052` section 7 was written to close.

The basket keeps the line either way, and it is settle able either way, because the shopper is
buying it regardless and the household's decision is about their own list.

### 5.2 A line that was already bought

Somebody adds batteries, buys them, and only then sends them to the flat's list. The list is
created asking for what is **outstanding**, which may be nothing, and no purchase is written into
that household's history (backend `0058` section 4.1).

The sheet says which of the two happened, because "the flat now knows about batteries and does
not need any today" is a strange outcome to arrive at silently:

> Added to Flat with none outstanding. Nothing was recorded as bought there.

## 6. Accessibility

- The picker is a single selection list with the group headings as real headings, so a reader
  moving by heading reaches "From this basket" first.
- The search field is labelled and filtering is announced as a count, politely.
- The confirm sentence is in the same live region as the rest of the sheet's copy, so it is heard
  before the button rather than after the commit.
- The one way warning is text, never a colour or an icon alone.
- Everything here is reachable one handed, as `0044` section 7 requires of the whole screen,
  though this is the one sheet in the basket a person is unlikely to be using in an aisle.

## 7. Acceptance criteria

- An added, unbound line offers the entry; a derived line and a bound line do not.
- A guest never sees the entry, and a registered participant who does not pass the all or nothing
  rule does not either.
- The picker lists every list the reader may send to, grouped by zone, with the basket's own
  sources first, and a search once there are many.
- Nothing is preselected, and committing takes a deliberate confirm that says the gesture cannot
  be undone from here.
- Sending creates the line in that list and the row grows its "from" caption.
- A list that does not auto approve produces a line that is waiting, the sheet says so, and the
  row does not claim it was accepted.
- A line with nothing outstanding is sent with a zero quantity, records no purchase there, and the
  sheet says so.
- The line keeps naming whoever added it, and the binding does not overwrite that.
- Sending twice is not possible, because the entry is gone.
- Dismissing returns to the settle sheet, and the Android back gesture does the same.
