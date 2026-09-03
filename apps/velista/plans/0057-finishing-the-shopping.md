> **PR:** [#183](https://github.com/IchirokuXVI/nx-portfolio/pull/183)

# 0057: finishing the shopping

> Server half: `apps/luna-shopper-backend/plans/0059`, which owns every rule this plan
> renders. Depends on `0044` for the basket and its three readers, and on `0045` for the
> history listing.
>
> A trip ends when the person carrying the phone walks out of the shop. Nothing in velista
> can say so: `COMPLETED` has existed since `0044`, the route that sets it has existed just
> as long, and no screen has ever called it. So a basket stays live forever, and the
> household keeps reading "Ana is buying this" on ten lines Ana walked past.
>
> This plan is the button, and everything that has to be true around it.

## 1. What is being built

| Piece                                             | Where                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| The control, owner only                           | `basket-page`                                    |
| The confirmation, and what it warns about         | a new `finish-sheet` at `…/sheet/finish`         |
| The prompt when every line is settled             | `basket-page`                                    |
| A finished basket: what is absent, and the banner | `basket-page`, `basket-line-row`, `settle-sheet` |
| The refusal a guest gets if they tap anyway       | `basket-error-copy`                              |
| Undoing it                                        | `basket-page`                                    |
| The status on a history row                       | `shopping-list-row`                              |
| The one write                                     | `GeneratedListApi`, `GeneratedListStore`         |

## 2. Who sees the control

**The owner, and nobody else.** It is absent for a registered participant and absent for a
guest, not disabled, which is `0030`'s rule and the same treatment the share control on this
page already gets.

The server agrees rather than being trusted to: `PATCH /v1/generated-lists/:id` is behind
the account guard and scoped to `ownerUserId`, so a guest cannot reach it with any token
they hold. `isOwner` already exists on `basket-page` for the share control and this is its
second reader.

Finishing ends the trip for four people at once, which is why it is not a thing you hand to
whoever happens to be holding a link. Somebody who thinks the shopping is over and is not
the owner can say so in the basket's own chat, which is what it is for.

## 3. The control, and where it sits

In the page header's actions, beside share, and **not in the footer**.

The footer belongs to the line you are working on, and `0040` fought to keep it from
covering a sheet. A button that ends the whole trip must not sit a thumb's width from the
settle control that finishes one line: the two are one tap apart in the muscle memory and a
mis-tap on the wrong one is a screen full of controls disappearing.

Labelled **Finish shopping**. Not "settle": that word means a line in this product, in the
copy, in the enum and in a zone list's permissions, and a settled list full of unsettled
lines is a sentence nobody should have to parse in an aisle.

## 4. When everything is already settled

The last line being settled is **not** a status change and does not finish anything. The
server does not do it (`0059` section 1.1) and this screen does not pretend it did.

What it does is ask. Once every line is finished, the page draws one quiet row where the
outstanding total used to be: **All done. Finish shopping?** with the same action beside it.

This is the whole of what the automatic case needed, and it is a prompt rather than a lock
for one reason worth stating: the most common thing that happens after the last line is
settled is remembering milk. A screen that had closed itself would have to be reopened by
somebody standing in a dairy aisle, and a screen that asks is one tap for the person who is
done and nothing at all for the person who is not.

It is not a modal, it does not steal focus, and it does not appear over the lines.

## 5. The confirmation

A sheet at **`…/sheet/finish`**, stamped by `sheet()` in `feature-shell`'s `routes.ts` like
every other, never by writing the segment out.

It is a real question, not a courtesy, because the thing it is about to do is invisible from
this screen: **it closes the trip for everybody in it**, including three people who may be
still walking around a shop.

> **Finish shopping?**
> Nobody will be able to change this list any more, including the people shopping it with
> you.
> **N lines were not settled. They stay on your lists as they are.**

The third line is the one that earns the sheet. Those lines are not being bought, not being
dropped, and not being recorded as anything: they simply stop being claimed, which is `0047`
section 3's rule and is exactly what the person wants and cannot be expected to infer. It is
absent when nothing is outstanding, because the sheet in that case is confirming something
with no consequence to warn about.

The count is an input to the copy, so its spec asserts the input rather than rendered text.

`SheetNavigation.dismiss` names the basket as its fallback, because a sheet reached from a
shared link is the arrival, not a step within a session.

## 6. A finished basket

The screen still reads. It is the receipt for a trip somebody took, and the most likely
reason to open one is to see what was bought.

**Absent, per `0030`, not disabled:** the settle control on a row, the quantity reel, the
add field, the product swap, the units sheet and the send sheet. A row draws what it says
now, with no control on it.

**Present:** every line, what was settled against it and by whom, the history, the people,
the share sheet and the link.

A banner at the top says what happened and offers the way out, to the owner only:

> **This trip is finished.** _(owner)_ **Reopen**

### 6.1 It is not revoking

Finishing does not revoke the link, evict a guest, or drop anybody's socket. A guest who
was in the shop when the owner pressed the button keeps the basket open, keeps their
identity, and keeps their name on the rows they settled. The event arrives over the socket
they already hold and the screen redraws in place.

That is deliberate: the people in the shop at that moment are the ones who most need to see
that it happened, and disconnecting them would tell them nothing at all. Revoking a link is
a separate act with its own sheet, and `0044` section 5.2 already owns it.

## 7. The guest who taps anyway

Two phones, one basket, a second of latency. A guest holding a settle sheet open when the
owner finishes will tap it, and the server will refuse with `generated_list_finished`.

The copy names what happened and who did it, in one sentence with no jargon:

> **The owner finished this shopping trip.** It cannot be edited any more.

`basket-error-copy.ts` already maps that code to `basket.error.basketFinished`, so this is a
copy change and a check that every path which can now raise it maps to it, rather than new
machinery. `0059` section 3.1 widens the set of writes that can raise it from three to nine,
and the error copy spec grows a case per write.

The screen does not stop at the message. The store refetches on this code, so the basket
redraws as section 6 and the controls that just refused are gone. A refusal that left the
button sitting there would invite the same tap again.

**The owner is not named.** Core keeps no name for an owner's participant row, which
`basket-page` already works around for the owner's own face by reading their account, and a
guest has no account to read. Naming them would mean the server disclosing an account
holder's name to a guest, which is the disclosure `0044` is built to avoid. "The owner" is
who the guest thinks of them as anyway: they got the link from that person.

## 8. Undoing it

**Reopen**, on the banner, owner only, no confirmation.

One `PATCH` back to `ACTIVE`, which is the same write in the other direction, and the server
re-announces the claims (`0059` section 2.2). No confirmation because nothing is destroyed
and the act is trivially repeatable, which is the test `0031` applies to a confirmation.

This is what makes section 5's sheet honest. The owner is confirming something reversible,
which is why the sheet warns about the people rather than about the finality.

## 9. The history listing

A finished basket keeps its place in `shopping-lists`, marked. `0045` already draws a status
on the row and this is one more value for it.

It is **not** hidden from the listing. Hiding is what `ARCHIVED` is for, and the trip you
finished an hour ago is the one you are most likely to open next, to check what you got.

The sweep in `0059` section 4 means a basket nobody finished eventually shows the same mark.
Nothing on this screen distinguishes the two, and nothing should: the row says the trip is
over, which is true either way.

## 10. Data

- `PATCH /v1/generated-lists/:id` with `{ status }`, the only write this plan adds, on
  `GeneratedListApi`. It exists on the server and has never been called from here.
- `GeneratedListStore` gains the call and the optimistic status flip, rolled back on
  failure like every other write in this scope.
- `generatedList.updated` over the socket, already mapped by both `basket-store` and
  `generated-list-store`, is what redraws a guest's screen. No new event.
- **Nothing new is read.** `status` is already on the view model and already mapped.

`basket-page.ts` is listed in `no-rxjs-interop-in-the-live-basket.spec.ts`, so nothing added
to it may import `@angular/core/rxjs-interop`.

## 11. Accessibility

- The banner is a `role="status"`, announced once when the basket becomes finished, not per
  redraw and not per line that lost a control.
- The prompt in section 4 is announced politely when it appears, and is reachable in the tab
  order before the lines rather than after all of them.
- Finish and Reopen are 44 square, and Finish is not adjacent to anything that settles.
- The sheet's warning count is read as part of the question, not as a separate live region
  that fires after the person has already decided.
- The refusal in section 7 is announced, because the guest's attention is on a shelf and the
  control they tapped is about to vanish.
- Finished state is never conveyed by colour alone: the banner is words and the rows have
  lost their controls.

## 12. Open decisions

- Whether the refusal should name the owner, which needs the server to carry an owner
  display name on the basket view. Leaning no, per section 7, and it is the decision most
  likely to be asked for.
- Whether the prompt in section 4 should appear on a basket where every line was settled as
  `NOT_AVAILABLE`. Leaning yes, since the trip is equally over, though the copy "All done"
  reads oddly for a shop that had none of it.
- Whether a finished basket should offer a "shop this again" action that composes a new
  basket from what was left outstanding. Real, wanted, and out of scope here; it is a
  generation, not a status.

## 13. Acceptance criteria

- [ ] Finish is drawn for the owner only, in the header, and is absent rather than disabled
      for a registered participant and for a guest.
- [ ] The sheet is addressed at `…/sheet/finish` through `sheet()`, `routes.spec.ts` still
      passes, and its dismissal names the basket.
- [ ] The sheet states the unsettled count and omits that line when the count is zero,
      asserted on the component input rather than on rendered text.
- [ ] Every line is settled, the prompt appears, and the basket is still fully editable
      until somebody presses the button.
- [ ] A finished basket draws no settle control, no reel, no add field and no swap, and
      still draws every line, its settlements and the history.
- [ ] The owner sees the banner and Reopen; a guest sees the banner without it.
- [ ] Reopen returns the basket to `ACTIVE` and the controls come back.
- [ ] A `generated_list_finished` refusal renders the section 7 copy and refetches, with a
      case per write that can now raise it.
- [ ] A guest's screen redraws from `generatedList.updated` with no reload and no
      disconnection, and the share sheet still shows the link.
- [ ] A finished basket appears in the history listing, marked, and is not hidden.
