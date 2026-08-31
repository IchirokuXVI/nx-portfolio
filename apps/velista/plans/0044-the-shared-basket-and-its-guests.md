# 0044 The shared basket, and the people you send it to

> Server half: `apps/luna-shopper-backend/plans/0051`, which owns every rule this
> plan renders. Depends on `0043` for the quantity control and on backend
> `0047` for settlements.

## 1. Purpose

The basket is the thing you carry around the shop, and the person carrying it is often not
the person who wrote the list. A flatmate, a partner, somebody's mother who is passing the
supermarket anyway. **None of them should need an account, and none of them should be
handed the household's data.**

So a basket is shared by a link, the link mints one identity per person who opens it, and
what each of them can see is decided by what they can prove. The screen has three jobs: be
usable one handed by somebody who has never seen this app before, tell four people working
one list apart, and never leak a zone.

This is also the app's best acquisition moment, and section 3 is careful about it: a person
holding a real list in a real shop is the most engaged user velista will ever have, and
making them register would kill the feature that got them there.

## 2. Mock

Drawn in `mocks/basket/`, published at
<https://claude.ai/code/artifact/bdc42e90-243f-4cdd-aaf4-54ca73d12ef6>, awaiting
approval. Not ready for development until it is.

| Artboard | Frames |
| --- | --- |
| `Join.dc.html` | The join screen, and the hierarchy in section 3. Also the revoked link and the expired link |
| `Basket.dc.html` | The basket as owner, as a registered participant who passes the rule, and as a guest. The three differ by what is absent |
| `Settle.dc.html` | Full settle, partial submit, and a line showing what was submitted against what is outstanding |
| `Allocate.dc.html` | The per list allocation sheet, and the default it starts from |
| `People.dc.html` | Presence with guests and registered people together; a participant's details on tap |
| `Share.dc.html` | Creating a link, several links with labels, and both revoke confirmations |
| `DayTheme.dc.html` | The basket on Day |

Phone frames 390 by 844.

## 3. The join screen

The first thing a stranger sees, and the hierarchy is decided rather than discovered.

Top to bottom: what this list is, a name field marked clearly **optional**, and directly
under it **"Continue as guest" as the primary action of the page**. Below that, and
visibly secondary, sign in and register with Google or email. An install prompt for the
app sits lower still.

- **The name field is optional and looks it.** The word "Optional" is on the field, not
  buried in a hint. Somebody who skips it becomes "Guest 2" and nothing about their
  experience is degraded.
- **Register is never in the way.** It is offered because this is the right moment to
  offer it, and it is never a step. A join screen that reads as a signup wall turns a
  favour into a chore, in a shop, on somebody else's phone.
- **The preview discloses nothing.** The list's name, how many people are on it, and
  whether it still accepts people. No lines, no zone, no list names, no members. That is
  backend `0051` section 4 and the screen must not ask for more.
- **A revoked or expired link says so plainly** and offers nothing to try. It does not
  distinguish a link that was revoked from one that never existed.
- Somebody who is already signed in **does not see this screen**. They are attached as
  themselves and land in the basket.

### 3.1 Installing, from here

The install prompt from `0033` is offered on this screen, because a guest who is about to
walk around a shop with this open is exactly who benefits from it. It is the lowest of the
four actions and it is never a condition of anything.

A guest who installs and later registers keeps their identity, which is backend `0051`
section 11's open decision; the screen is drawn so that outcome is possible and does not
depend on it.

## 4. The basket

A list of lines with quantities, which the guest can work through and nothing else.

### 4.1 What is absent, per reader

The three views differ by **absence, not by disabled controls**. `0030` settled this for
the list page and it holds here: a control you may not use should not be drawn.

| | Owner | Registered, passes the rule | Guest |
| --- | --- | --- | --- |
| The lines, quantities, outstanding amounts | yes | yes | yes |
| Settle, partial submit | yes | yes | yes |
| Which list a line came from | yes | yes | **no** |
| Settlement history | yes | yes | **no** |
| The allocation sheet | yes | yes | **no** |
| Another participant's device and join time | yes | yes | **no** |

"Passes the rule" is `WRITE` on **every** source list of the run, checked on each request
(backend `0051` section 5.2). It is all or nothing today and the cliff is known: one source
where they hold only `READ` collapses the column to the guest's. The per line version is
recorded as the target in that plan's open decisions, and this screen is drawn so it can
arrive without a redesign.

### 4.2 Settling, and the two buttons

A line shows its quantity and, once anything has been submitted against it, **what was
submitted and what is outstanding**. Settling is cumulative, so a line can be finished
across two shops.

- **Settle** closes the whole outstanding amount. One tap, and it is the common case.
- **Partial submit** asks for a number. Available to everybody, guests included, and it
  asks nothing about zones.
- **Allocate** opens the per list sheet and is the same act done precisely. Only for
  readers who pass 4.1.

**A guest is never asked which household a tin of tomatoes belongs to.** They are in a
shop with a list. The system allocates oldest origin first and the sheet exists for the
people who can see enough to correct it.

Marking something not available is here too, and it closes the outstanding amount without
claiming anything was bought.

### 4.3 Who touched this last

Every line carries who last edited or settled it, on the row, because the question in a
shop where four people are working one list is "who got the bread" and it should not cost
a tap.

Guests are shown as guests, always visually distinct from registered people. A typed name
is unverified text and two guests can both be "Dani": the name is for reading, the identity
is the participant. The screen must never present the two as the same kind of thing.

## 5. People, and sharing

### 5.1 Presence

Registered participants and guests in one row, guests marked as such. Tapping one shows
what is known about them, which for a guest is their device, when the link was made and
when they joined, and which is shown only to readers who pass 4.1.

**No sentence.** "Three anonymous users are shopping with you" was considered and dropped
for being a paragraph where a row of faces does the job; guests get the same treatment as
everyone else, with the count collapsing into a stacked chip when the row overflows, which
is the same "+X" pattern the price display uses.

The word "anonymous" appears nowhere in the product. They are guests.

### 5.2 Creating and revoking links

Several links per basket, each with an optional label, so "the flatmates" and "my mother"
are tellable apart afterwards. The link secret is shown once, on creation.

Revoking asks a real question, because there are two answers and the wrong default is
harmful:

> **Revoke this link?** Nobody new will be able to join.
> A second, explicit choice: **also remove the N guests who joined with it.**

**Revoking a link does not evict the people already shopping.** They keep working and the
same URL still opens the list for them, because their session is what authorizes them.
That is the common intent, and a screen that silently kicked three people out of a shop
would be the worst possible reading of a one word button.

Removing a single participant is separate, from their row.

## 6. Data

- The join pair, unauthenticated: preview by link secret, and join.
- The basket, its lines, settling, allocating and participants, all authenticated by the
  **participant** session rather than by an account token. Every request carries it and the
  server checks it against the database, so a revoked participant is refused on the next
  action with no cache to wait out.
- The socket. A guest holds a live connection with no account, which no path in the app
  supports today; backend `0051` section 9 is the design and this screen cannot work
  without it.
- Realtime: the basket's own room for lines, settlements and presence.

## 7. Accessibility and input

- **Everything here is used one handed, in a shop, by somebody who has never seen it.**
  That is stricter than the rest of the app, which at least assumes familiarity.
- The join screen's primary action is reachable with a thumb and is not below the fold on a
  small phone.
- Settle and partial submit are 44 square at minimum, and the settle target is not adjacent
  to anything destructive.
- The quantity control is `0043`'s reel and spinbutton, unchanged, so the
  keyboard path comes with it.
- Presence changes are announced politely and not per participant per second.
- Guest status is never conveyed by colour alone.
- The allocation sheet is a form with labelled numeric fields, and its total is announced
  as it changes so somebody cannot silently allocate more than they bought.

## 8. Acceptance criteria

- A person with no account opens a link, optionally names themselves, and reaches the
  basket in one tap from the join screen.
- Skipping the name gives a stable "Guest N" that persists across a reload.
- The join screen shows no line, list, zone or member before joining.
- Somebody already signed in is attached as themselves and never sees the join screen.
- A guest sees lines, quantities and outstanding amounts, and never sees a zone, a list
  name, a settlement history or the allocation sheet.
- A registered participant sees those only while holding `WRITE` on every source list, and
  loses them on the next request when that stops being true.
- Settle, partial submit and allocate all work, and the first two never mention a list.
- A partially settled line shows what was submitted and what is outstanding, and finishing
  it takes a second settle.
- Every line says who touched it last, and a guest is visibly a guest.
- Presence shows guests and registered people together, with no sentence and no use of the
  word anonymous.
- Revoking a link stops new joins and leaves the people already shopping working; the
  cascade is a separate, explicit choice.
- A revoked participant is refused on their next action.
- Three people opening one link are three participants, and their edits are told apart.

## 9. Out of scope

- **Prices, best location and the "+X same price" display.** Backlog `0004` on the backend
  and inert until a second chain is harvested. The basket is drawn with room for them.
- Splitting a basket across shops, which is the optimizer and is its own problem.
- Guests seeing anything per line rather than all or nothing (backend `0051` section 11).
- Handing ownership of a basket to somebody else.
- Any change to how a basket is generated, which is backend `0051` section 2 and has no
  screen of its own in this plan beyond choosing zones and lists.
