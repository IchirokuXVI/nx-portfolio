# 0043 The line is a quantity, and it has a history

> **This plan revises `0012`**, the list page, which was built when a line carried a trip
> status. Section 1.1 lists what it takes back. `0012` carries a note pointing here.
>
> Server half: `apps/luna-shopper-backend/plans/0047`. Nothing here is buildable
> without it, and the composer's suggestions in section 6 additionally need backend
> `0048`. The basket that eventually settles these lines is `0044`.

## 1. Purpose

`0012` built a list you tick off. Two people who used it for a month ended up with a
screen full of ticked lines, because a tick is a fact about one shopping trip written
onto a record that outlives every trip, and the only ways out were deleting the line or
resetting it by hand every week.

This plan makes the quantity the state. You want two of something, you buy two, it goes
to zero, and the line stays exactly where it is holding everything it knows about itself.
Nothing is ticked and nothing is reset. **The primary gesture on the page stops being a
thumb landing on a checkbox and becomes a thumb dragging a number.**

The second half is that a line now has somewhere to go. Tapping one opens what the app
knows about it, and there is a page behind that with the whole history, which is only
worth building because backend `0047` finally records one.

### 1.1 What this takes back from 0012

- **The row is no longer a checkbox.** `0012` section 7 made it `role="checkbox"` with
  `aria-checked` reflecting `READY`. There is no `READY`. Section 7 here replaces the
  whole accessibility mapping, and it is a rewrite rather than an edit.
- **Marking ready and not available leave the page**, along with the swipe actions and
  overflow entries that reached them. Both are things you do from a basket now.
- **The status treatments in `LineStates.dc.html` are replaced** by the three indicators
  in section 3.3. The optimistic, failed and overwritten treatments survive untouched.
- **The swipe direction is reclaimed** for the quantity reel, which is why the actions
  above had to go somewhere else and not merely change label.

Reordering, comments, approval, presence, the composer and every problem state are
unchanged.

## 2. Mock

Drawn in `mocks/line/`, published at
<https://claude.ai/code/artifact/58c83512-3899-4200-bb2b-464c805084fd>, awaiting
approval. `0001` section 9's rule stands: it is not ready for development until the
mock is approved.

| Artboard | Frames |
| --- | --- |
| `Line.dc.html` | The row spec remeasured, with the quantity control and each of the three indicators, alone and combined |
| `Reel.dc.html` | The reel at rest, mid drag at three offsets, and snapping. **Needs a motion spec, not a static frame**: section 4 is a gesture and a still image cannot approve it |
| `LineDetail.dc.html` | The detail sheet, with and without a linked item, and with too little history to say anything |
| `LinePage.dc.html` | The full page: both history sections, the cross list indicator, and the empty state of each |
| `Suggest.dc.html` | The composer with the suggestion list open, a group result above an item result, and the no matches case |
| `Confirm.dc.html` | The delete confirmation |
| `DayTheme.dc.html` | The three indicators on Day, which is where they are actually read |

Phone frames 390 by 844, per the mock conventions. The Day artboard is mandatory for the
same reason `0012` gave: these are status colours on a raised surface, read in a bright
shop.

## 3. States

### 3.1 The page

Unchanged from `0012` section 3.1. Loading, loaded, empty, read only, failed, not live and
gone all behave exactly as they do, and the header is untouched.

### 3.2 A line

| State | Meaning |
| --- | --- |
| Wanted | `quantity > 0`. The ordinary state |
| Settled | `quantity = 0` with at least one purchase on record. Drawn quietly, still present, still tappable |
| Never wanted | `quantity = 0` with no purchase. Somebody typed it and it has not been needed yet. No indicator, because there is nothing to report |
| Awaiting approval | Unchanged from `0030`. Independent of the above |

The distinction between the middle two rows is why backend `0047` section 5 says "at
least once" rather than testing the quantity alone.

### 3.3 The three indicators

| Indicator | Shown when |
| --- | --- |
| Bought | The line is settled, per 3.2 |
| Not available | The most recent settlement said the shop did not have it |
| Somebody is buying this | The line is in an active basket, with whose |

The third arrives on a zone event and is the only one that comes from outside the list.
It is a presence style fact rather than a state: it appears and disappears while the page
is open, and it must never be mistaken for the line having been dealt with.

## 4. The reel

The heart of the page, and the one thing here that cannot be specified in prose alone.

**It is positional.** The reel follows the finger, one to one, and there is no
acceleration and no auto repeat. Letting go snaps to the nearest number and that number is
the new quantity.

- An overlay sits above the quantity while the gesture runs: the previous number to the
  left, the current one in the middle, the next to the right. **At zero there is nothing
  to the left**, because there is no minus one, and the absence is the affordance.
- **40px per unit.** A 390px phone leaves roughly 280px of comfortable travel, so one
  uninterrupted drag covers about seven units, which is what makes two to five a single
  gesture rather than three.
- The snap is animated and short. It is the only confirmation the gesture gives, so it has
  to be felt.
- **The overlay does not close on release.** It stays up for a second or two so the thumb
  can keep adjusting, and a drag inside that window continues from the snapped number. It
  closes after that beat of idleness, and the close is what commits the result.
- Large changes go through the line editor, which still edits the quantity as a field.
  The reel is for the common case and is not asked to be a general purpose number entry.

### 4.1 It writes a delta, not a number

`POST /v1/lines/:id/quantity` takes a **signed delta** and applies it atomically. It was
built by backend plan `0040` for the assistant and has never had a second caller; this is
the caller it was shaped for.

Absolute writes from a moving control race each other, and the loser silently wins. One
delta per settled adjustment, sent when the overlay closes after its idle beat rather than
during the drag, is both correct and one request however many times the thumb went back
for more within the window.

### 4.2 The optimistic overlay applies unchanged

`0004` section 7.2 and `0012`'s reconciliation are reused as they are. The row shows the
snapped number immediately, the delta goes out, and a failure returns it with the failed
treatment `0012` already draws. A quantity that changed underneath is the overwritten
case, which also already exists.

## 5. Anatomy

Top to bottom, with what is new marked.

| Region | Component | Library |
| --- | --- | --- |
| Header, composer, reorder, comments | unchanged from `0012` | `feature-lists` |
| Line row | **rewritten**: content, indicators, quantity control | `feature-lists` |
| Quantity reel | **new** | `velista/ui` |
| Suggestion list | **new**, under the composer | `feature-lists` |
| Line detail sheet | **new** | `feature-lists` |
| Line page | **new**, its own route | `feature-lists` |
| Delete confirmation | the existing confirm | `shared/ui` |

The reel goes in `velista/ui` rather than beside the row because it is a general control
over a number and the basket in `0044` needs the same one.

### 5.1 The detail sheet

Opens on tapping a row. Answers the question you have while standing in the kitchen:

- Which products the line carries: one, a set picked from a group, or none
- When it was last bought and how many
- Roughly how long until it runs out, **absent entirely until there are three purchases**
- A way through to the full page

### 5.2 Recording a purchase, from the sheet and nowhere else

The rule in section 1.1 is that **the row** stops marking anything. It is not that the app
forgets how to record a purchase, and the difference matters: without one recorded
purchase, every history and estimate in this plan renders empty forever, and the page is a
promise it cannot keep until baskets exist.

So the detail sheet carries "I bought this", asking how many and defaulting to the whole
outstanding quantity. It is two taps behind a deliberate open, not a swipe, which is the
whole distinction being drawn. It writes a settlement with no basket attached, which is
what backend `0047` section 4.4 is for, and it is the reason this plan ships on its own. On a
line carrying more than one product it also asks **which one**, preselecting the last one
bought, because the settlement records the exact product (backend `0047` section 3.2).

Marking a line not available lives here too, for the same reason and with the same
weight: it is something you say afterwards, not something you flick past in an aisle.

### 5.3 The line page

Its own route, so it can be linked to and reached from a search later.

- **Two history sections, side by side and labelled.** "On this list" is every settlement
  of this line. "Everywhere you shop" is every settlement of the line’s products across
  the zones you can read. They are separate because one is a household's consumption and
  the other is yours, and a single merged number would be neither.
- The second section is **absent, not empty**, on a line with no products. Which is the
  argument for section 6.
- **The products on this line.** One chip per product, removable, plus the composer’s
  same search to add another. This is where a group picked from the suggestions becomes
  the household’s own version of it, and where a free text line gets its first product
  after the fact (backend `0048` section 1.1).
- **Also on other lists.** Which of your other lists carry this item, or something close
  enough to it, as an indicator rather than a link, filtered to lists you can read.
- **Where to buy it and for how much** is drawn here and is out of scope, per section 9.
- Delete, behind a confirmation, and it is the only thing on either screen that discards
  the history.

## 6. Suggestions, and why they matter more than they look

After **three characters**, debounced at 200ms, the composer offers catalog matches.
Choosing an item adds the line with that product attached; **choosing a group attaches
all of the group’s products** as the line’s own set, free to trim afterwards.

A line has never carried a product: `0012` section 1 put catalog items out of scope, and
the old single `itemId` was null on every line ever created. Backend `0048` section 1.1
turns it into a **product set**, and this dropdown is what finally fills it. It is not a
convenience: the cross list indicator, the item history, and every price this app will
ever show are keyed on that set.

Three rules, all of which come from the backend plans that own the search:

- **A group beats an item.** Somebody typing "milk" is offered the group, not one brand of
  it. Backend `0048` section 3 has `item.searchOffers` for exactly
  this, and backlog `0004` section 1.2 states the rule as a hard one: nothing is
  resolved to an item when a group would do.
- **The scope is where you shop.** The search takes a price scope set, so a product from a
  chain the user never visits is not a suggestion.
- **Free text stays first class.** Typing something and ignoring the list adds a plain
  line, with no warning and no nagging. "Something for dinner" is a legitimate line and
  the moment the composer starts insisting on a match, adding things becomes a fight.

## 7. Accessibility and input

This section replaces `0012` section 7's row mapping in full.

- **The row is a button** whose action is opening the detail sheet. It is not a checkbox,
  because it no longer has a checked state to report.
- **The quantity is a `spinbutton`** with `aria-valuenow`, `aria-valuemin` of 0 and an
  accessible name naming the line. Arrow keys step it, page keys step by five, and that is
  the non pointer path for the reel. `0012`'s rule holds unchanged: **a gesture is never
  the only way to do anything.**
- The reel's overlay is `aria-hidden`. It is a picture of a number that the spinbutton is
  already announcing.
- **The indicators are description, not name.** The accessible name stays the content plus
  the quantity, and "bought", "not available" and "Ana is buying this" go in
  `aria-describedby`, so a screen reader reads the thing and its number first.
- A quantity change is announced once, in the existing live region, as the settled result
  and not per step of the drag.
- **The 44 by 44 floor holds**, and the reel needs the row's full height as its target
  rather than the width of the number.
- Reorder mode, its keyboard equivalent and its announcements are unchanged.
- A row with a write in flight is `aria-busy` and keeps its name.

## 8. Acceptance criteria

- No control on the list page marks a line ready or not available.
- Dragging the quantity moves a reel that shows the neighbouring numbers, shows nothing to
  the left of zero, and snaps on release; the overlay stays up for a beat so a second
  drag continues it, and closes on idleness.
- One uninterrupted drag takes a line from 2 to 5.
- A settled adjustment sends one signed delta when the overlay closes, and a failure
  restores the previous number with the existing failed treatment.
- Arrow keys change the quantity without a pointer, and the change is announced once.
- A line at zero that has been bought shows the bought indicator; one at zero that never
  has shows nothing.
- A line in somebody's active basket says so, live, and stops saying so when the basket
  closes.
- Tapping a row opens the detail sheet; the sheet shows no estimate before three purchases.
- Recording a purchase from the sheet writes a settlement, decrements the quantity by what
  was bought, and leaves the line in place; recording it twice finishes a partial buy.
- Nothing on the row itself records a purchase or marks anything unavailable.
- The line page shows the two histories labelled separately, and omits the item history
  entirely when the line has no item.
- Typing three characters offers suggestions, a group ranks above an item for a bare
  word, choosing an item attaches it, and choosing a group attaches all of its products.
- The line page lists the line’s products, removes one by its chip, adds one through the
  same search, and a purchase recorded on a multi product line asks which one was bought.
- Typing free text and submitting adds a line with no item and no warning.
- Deleting a line is confirmed, and it is the only way to lose the history.

## 9. Out of scope

- **Prices and where to buy.** The line page has a region for them and draws nothing in it
  until the backend's backlog `0004` exists. With one chain harvested and disabled outside
  development, it would show one price at one shop.
- **The basket**, its sharing and its guests. Velista `0044`.
- **Settling from the row.** The row has no marking control of any kind, which is section
  1.1. Recording a purchase is a deliberate act from the detail sheet, per 5.2, and never
  something a thumb does in passing.
