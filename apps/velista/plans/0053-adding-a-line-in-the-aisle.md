# 0053: adding a line in the aisle

> Server half: `apps/luna-shopper-backend/plans/0055`, which owns every rule this plan renders.
>
> The basket has no composer. Somebody standing in a shop with the list open, remembering the
> milk, has nowhere to put it: the field at the bottom of a list page is a list page's, and this
> screen ends at its last line. So the thing people do while shopping, which is remember
> something, is the one thing the shopping screen cannot do.
>
> Prerequisite reading: `0044` sections 4 and 7 (the basket, and that it is used one handed by
> somebody who has never seen it), `0043` section 6 (free text is first class, and the
> suggestion list is an offer) and `0038` sections 2 and 2.1 (the composer's one slot and two
> jobs, which this plan takes one of away).

## 1. What is being built

The composer from the list page, at the bottom of the basket, **for everybody on it including
guests**, with a typeahead, a quantity, and no microphone.

| Piece | Where |
| ----- | ----- |
| The composer, drawn for every participant | `basket-page` |
| A composer that can be told not to offer voice | `libs/velista/ui`, `line-composer` |
| Suggestions from the participant surface | `BasketApi`, `BasketStore` |
| The added line, appended and attributed | `BasketStore`, `basket-line-row` |

## 2. It is drawn for everybody, and that is the unusual part

The list page draws its composer from certainty: `myPermissions` arrives with the list and
somebody without `WRITE` never sees a field (`0030`, and `0038` section 2.1). The basket inverts
it. **Every participant may add a line, guests included**, so there is no permission to read and
no branch to write.

That is not a relaxation of the rule the basket is built on. Backend `0055` section 3.1 is the
argument: a line added here has no target list, so it changes nothing shared, names no zone and
claims no zone line. It is a note on the list somebody is carrying. The gate that matters is the
one on **binding** it to a household's list, and that is `0056` with a list picker in front of it.

The one absence: a basket whose status is finished draws no composer at all, because the server
refuses the add and a field that cannot submit is the invitation `0038` section 2.1 refuses to
draw.

## 3. No microphone, and the reason is not the shop

`0038` gave the composer one button that is a plus when the field has text and a microphone when
it is empty. Here it is always the plus, disabled while the field is empty.

The reason is **where a recording goes**. `spoke` hands the audio to the page, and the page posts
it to the **list scoped assistant**, which is an account authenticated service that resolves
zones, lists and access to decide what a sentence means (`0041`, backend `0039`). A basket has no
such surface and cannot have one cheaply: the assistant would have to accept a participant
credential, understand a basket, and be reachable by anybody holding a link. Offering a
microphone that has nowhere to send its audio is worse than offering nothing.

Three supporting reasons, none of which would have been enough on their own:

- The phone is very often **not the speaker's**, so a microphone permission prompt arrives in
  the middle of somebody doing a favour, on somebody else's device.
- A shop is loud, and `0038`'s silence detection is tuned for a kitchen.
- The line is going into a basket rather than a household's list, so the assistant's real value,
  which is resolving "we need more of the usual milk" against a list, has nothing to resolve
  against.

### 3.1 What the ui library needs

`LineComposer` gains **`voice = input(true)`**. False keeps the button as the plus and disables
it on an empty field; `button()` returns `'add'` unconditionally, the microphone, the listening
row, the level meter and the recorder are never reached, and `spoke` never fires.

An input rather than a second component: the field, the run behaviour across a submit, the
counter, the quantity stepper and the suggestion list are all the same, and a copy of this
component would be a second place for the six things above to drift. `line-composer.spec.ts`
gains the case that the button never becomes a microphone with `voice` false, so the flag cannot
quietly stop working.

## 4. The typeahead

Identical in behaviour to the list page's, and deliberately so: somebody who has used velista's
list screen must not have to learn a second search.

- The container owns the debounce, the three character floor and the sequence number, exactly as
  `list-page.ts` does. `LineComposer` emits raw keystrokes and knows nothing about requests
  (rule D1).
- The request goes to the **participant surface**, `BasketApi.suggest`, because the reader may
  hold no account token. Backend `0055` section 5 composes it at the gateway and scopes it to the
  run's own shopping profile, so the ranking is the basket's rather than the reader's.
- The result shape is `CatalogSuggestion`, unchanged, so `SuggestionList` and the item and group
  cases come across as they are. A group attaches its whole product set, an item attaches one.
- **The order is the server's** and is never re sorted here, for the reason already written on
  `CatalogApi.suggest`: the client holds none of the prices, scopes or synonyms that decided it.
- A failed search yields an empty list and no message. Free text is the fallback and always was.

## 5. What the added line looks like

It appends at the end, and it is an ordinary basket row with two things absent:

- **No "from" caption**, because it has no origins. The row already draws that caption only when
  `origins` is present, so this needs no code and no flag: the data decides (`0044` section 4.1).
- **No allocation**, for the same reason, and the settle sheet's allocate control is already
  drawn only when there is more than one origin.

It gains one thing. `BasketLine` carries **`createdBy: string | null`**, mapped from `unknown`
like everything else (rule D4), and the row names the person who added it when nobody has touched
it since. `touchedBy` answers "who got the bread" and moves the moment anybody settles; "who put
this here" is the question a shop asks about a line nobody recognises, and after one settle the
existing field can no longer answer it. Both use `participantName`, so a guest is visibly a guest
in both.

## 6. Where it sits, and what it must not cover

At the bottom of the page, above the safe area, in the same place the list page's composer sits,
so the two screens agree about where the field is.

`0040` is the rule it has to respect: **a footer does not cover a sheet.** The basket's sheets
are child routes drawn over the page, and a composer that stayed on top of them would put a text
field over the settle controls. The composer is hidden while a sheet is open, by the same
mechanism the list page's footer already uses.

The keyboard is the other half. On a phone, focusing the field raises the keyboard over the lower
third of the list, which the list page has lived with since `0012` and which the composer's own
rule about not stealing focus is the mitigation for: the field takes focus only where there is
exactly one thing to do. On the basket there is always something else to do, so it never does.

## 7. Optimism, and what happens on four phones

The line is **not** drawn optimistically. `BasketStore` appends when the server answers, and the
socket carries the same line to everybody else's phone through the new `generatedList.lineAdded`
event.

This is the opposite of the choice on the list page and the difference is the reader: four people
are working this list at once, and a row that appears locally and then reorders when the server
answers is a row somebody might tap in between. The composer stays usable while the request is in
flight, which is what the run property in `0038` actually needs, so the wait is not felt while
typing the next thing.

An add that fails leaves the text in the field. Losing six characters is nothing; losing the item
somebody just remembered in an aisle is the failure this screen cannot afford.

## 8. Accessibility and input

- `0044` section 7 applies unchanged: one handed, in a shop, by somebody who has never seen this
  app. The composer is already built to that standard for the list page.
- The submit target is 44 square and is not adjacent to anything that settles or deletes.
- The suggestion list is the existing listbox with its existing keyboard path, which comes free
  with `SuggestionList`.
- The composer keeps focus across a submit, so six things go in without the keyboard coming down
  between any two of them.
- The new line's arrival is announced politely, once, and not per line when several people add at
  the same time.

## 9. Acceptance criteria

- A guest with no account types a line into the basket, sets a quantity, and it appears for
  everybody else without a refetch.
- The composer is drawn for every participant and is absent on a finished basket.
- The button is never a microphone on this screen, and no recording path is reachable from it.
- Typing three characters offers catalog suggestions, in the server's order, scoped to the
  basket's run rather than to the reader.
- Choosing an item links the line to it; choosing a group links the whole product set; typing
  something the catalog has never heard of adds it as free text.
- A failed search leaves the composer working and shows no error.
- A row added in the shop names who added it, and a guest is visibly a guest.
- An added row shows no list name and offers no allocation, for anybody.
- The composer does not cover a sheet.
- A failed add leaves the typed text in the field.
