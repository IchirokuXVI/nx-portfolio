# 0055: a participant adds a line, and searches for one

> The basket is the thing somebody carries around a shop, and the one thing they cannot do
> with it is put something in it. Every write on the participant surface today settles a line
> that was already there or swaps its product; creating a line is on the **owner's account
> surface**, resolved by `ownerUserId`, and so is the catalog search behind it.
>
> That is backwards for the screen `0051` built. A guest in an aisle who remembers the milk is
> exactly the reader this feature exists for, and telling them to text the owner is telling
> them to use the app the way the app is not for.
>
> Prerequisite reading: `0050` section 5 (adding a line, and the write back rule), `0051`
> sections 5 and 6 (what a participant may see and do), and `0048` section 1.1 (product sets,
> which is what a suggestion attaches). Velista `0053` is the other half and the only consumer.

## 1. What is being built

| # | Thing | Surface |
| - | ----- | ------- |
| 1 | Adding a line as any live participant, guests included | participant |
| 2 | Catalog suggestions for a participant with no account | participant, composed at the gateway |
| 3 | Who put the line there, kept apart from who touched it last | one column |
| 4 | Settling a line that has no origins, which today can never finish | core, a two line fix |
| 5 | The caps and the rate limit that a link reachable surface needs | gateway |

Section 5 is not padding. Everything else here widens a surface anybody holding a URL can
reach, and the widening is only safe with it.

## 2. What is wrong

`GeneratedListLineService.addLine` starts with `this.generatedLists.load(req.userId,
req.generatedListId)`, which resolves a basket **by its owner**. A guest holding a valid
participant session has no `userId` to put in that call and would get a not found from it if
they invented one. The same is true of `updateLine`, `deleteLine` and `reorderLines`: the whole
editing surface of a basket is the owner's, and the participant surface `0051` added is a read,
a settle and a pick.

The search has the same shape for a different reason. `GET /v1/catalog/suggest` sits behind the
JWT guard and resolves its scope from the caller's shopping profile (`0049`). A guest has
neither. This is the same problem the basket read already solved for product **names**, in
`GeneratedListParticipantController.productsOf`: the gateway holds the account free route and
composes the catalog answer on the participant's behalf. Searching is that idea again.

## 3. Adding a line, as a participant

**`GENERATED_LIST_SHARING_PATTERNS.addLine`**, and `POST /v1/generated-lists/:id/lines` under
`ParticipantGuard`.

The request carries `participantId` and never a `userId`, and core resolves the basket by its id
alone, exactly as `basketGet` and `settleLine` already do. The participant is checked live
through `livePresenceEntry`, which is the same one indexed read every other participant write
makes, so a revoked guest is refused on their next action with no cache to wait out.

| Field | Rule |
| ----- | ---- |
| `content` | required, through the existing `checkContent` |
| `quantity` | optional, defaults to 1, through `checkQuantity` |
| `itemId` | optional, the pick |
| `options` | optional, the product set a group suggestion attaches |
| `targetListId` | **refused on this surface**, with a named code. `0058` owns it |

The line is created `origin = ADDED`, `targetListId = null`, `settledQuantity = 0`, at the end
of the basket. It lives in the basket and nowhere else, which is what makes it safe to hand to a
guest: an `ADDED` line names no zone, claims no zone line, and emits no zone event.

### 3.1 Why a guest may do this at all

Because the alternative is worse and because it costs nothing.

The rule `0050` section 5 protects is that **a basket never changes a shared list unless somebody
says which one**. An added line has no target, so it changes nothing shared. It is a note the
shopper wrote on the list they are carrying, and the household sees it only if somebody with an
account and the access binds it later.

The disclosure runs the other way too: a guest typing "batteries" tells the basket nothing about
any household, and the line they created carries no list name for anybody to read.

### 3.2 The basket's default target does not apply to a guest

`addLine` currently applies `GeneratedList.defaultTargetListId` when the request names no target.
That default is the owner saying "everything I add today also goes in the flat list", and it is
their standing intent about their own additions.

**It is applied when the acting participant is the `OWNER`, and never otherwise.** A guest's line
silently promoted into a household list would be a zone write the guest cannot see, cannot
explain and did not ask for, attributed to the owner's access under section 6.4's delegation
rule. That is precisely the accident `0050` section 5 exists to prevent, arriving through the
back door.

A registered participant who passes the all or nothing rule is in the same position as a guest
here: they can bind a line on purpose through `0058`, which is a gesture with a list picker in
front of it, and that is the honest way for their line to reach a list.

### 3.3 A basket that is finished takes no new lines

The add is refused when the basket's status is `COMPLETED` or `ARCHIVED`, with a distinct code
rather than `validation_failed`, so velista can say "this basket is finished" instead of "that
did not work". This follows `0054` section 4's reasoning exactly: a client that cannot tell a
state it can explain from a bug it cannot will show the wrong sentence for both.

## 4. Who put this here

`GeneratedListLine` gains **`createdByParticipantId: uuid | null`**, written on every add and
never afterwards.

It is a second column beside `lastEditedByParticipantId` rather than a reuse of it, because they
answer different questions and the second one moves. The moment anybody settles a line, or edits
its quantity, or swaps its product, `lastEditedBy` becomes them. "Who put this on the list" is
the question a shop full of people actually asks about a line nobody recognises, and after one
settle the existing column can no longer answer it.

Null for every line the run composed, which is honest: a `DERIVED` line was put there by the
generation, not by a person, and the person who ran the generation is the owner, who is already
named on the basket.

## 5. Searching, without an account

**`GET /v1/generated-lists/:id/catalog/suggest?q=`**, under `ParticipantGuard`, composed at the
gateway.

The gateway resolves the scope and forwards to catalog's existing `item.searchOffers`, then
returns the same body `/v1/catalog/suggest` returns, field for field, so velista's mapper and the
composer's suggestion list are unchanged.

### 5.1 The scope is the run's, never the caller's

A suggestion is ranked by prices at the shops in scope, and there are three candidate scopes
here. The choice matters because it decides what a stranger sees first.

| Candidate | Verdict |
| --------- | ------- |
| The caller's default shopping profile | **No.** A guest has none, and a registered participant's own profile ranks a stranger's basket by a different city's shops |
| The run's `sourceSnapshot` profile | **Yes.** It is what the basket was composed against and it is already stored |
| No scope at all | The fallback, when the snapshot names no profile |

`sourceSnapshot` exists for exactly this class of question. `0050` section 1 justified it as the
only way a three week old basket can be explained to the person looking at it, and ranking a
search inside that basket is the same explanation applied live.

### 5.2 A catalog product is not zone data

Worth stating rather than assuming, because everything else on this surface is gated. Catalog
items and product groups are public product facts: a brand, a size, a name in two languages.
They disclose no zone, no list, no household and no member, which is why `0051` section 6.1
already lets a guest see and switch a line's options freely. Search is the same data reached by
a different question.

### 5.3 It fails empty, never loudly

The route answers `{ suggestions: [] }` when catalog is unreachable, matching `CatalogApi.suggest`
on the client and `productsOf` beside it. A dropdown is an offer, and free text has been first
class since `0043`: adding a line must never fail because a search did.

## 6. A line with no origins can never finish, and that is a live defect this plan creates users for

`generated-list-settle.service.ts` computes `advance = applied` for a `BOUGHT` outcome, where
`applied` is the sum over the **origins** the allocation reached. A line with no origins has an
empty allocation, so `applied` is 0, so `settledQuantity` never moves, so the line is outstanding
forever and every settle on it writes nothing at all.

No such line exists today, because every line in a basket came from the run. Section 3 creates
them by the dozen.

**The fix is one branch:** with no eligible origins, `advance` is the number of units the settle
asked for, clamped to the outstanding amount as it already is. No `LineSettlement` row is
written, and that is correct rather than a shortcut: a settlement is a **zone fact** (`0047`
section 3.1), and there is no zone line for this purchase to be a fact about. Nothing enters any
household's consumption history until `0058` binds the line to a list.

`NOT_AVAILABLE` already closes the outstanding amount by a separate branch and needs no change.

## 7. The caps, and the rate limit

This surface is reachable by anybody holding a link that anybody may have forwarded. The
existing controls carry most of it and the gaps are named here rather than discovered.

- **Lines per basket.** `checkRoom` already caps it and the add goes through it unchanged. It is
  now also the thing that stops one participant filling a basket with rubbish.
- **Content length and quantity bounds.** `checkContent` and `checkQuantity`, unchanged.
- **Writes per participant.** A per participant limit on the participant surface as a whole,
  which the settle route needs for the same reason and does not have. Keyed on the participant
  id from the guard, which is a value the caller cannot forge and which revocation already
  invalidates.
- **Suggestions per participant.** Tighter than the write limit and looser than a keystroke,
  because velista debounces at the composer and the server must not depend on it.

Revocation is the real control and it already exists: an owner who sees a basket being spoiled
revokes the participant, or the link with its guests, and section 3's `livePresenceEntry` check
refuses the next request.

## 8. Contracts, events, migrations

- `AddGeneratedListParticipantLineRequest` and its result in `libs/luna-shopper/contracts`,
  beside the existing sharing messages. The response is a `GeneratedListBasketLineView`, the
  same shape the basket read serves, so the client appends what it already knows how to draw.
- One event on the basket's own room: **`generatedList.lineAdded`**, carrying the new line.
  Reusing `lineUpdated` was considered and dropped, because a client receiving it has to decide
  whether to replace a row or append one, and that decision is exactly what the event name is
  for. **No zone event**, because an `ADDED` line claims nothing.
- Migrations, in core: one nullable `createdByParticipantId` column on `generated_list_lines`.
  Nothing else, and no backfill: a null there means the run created the line, which is true of
  every existing row.
- The OpenAPI document is regenerated.

## 9. Open decisions

- **Deleting a line you added.** Not built here, and it should be: somebody mistypes in a shop
  and the line is in front of four people for the rest of the trip. Leaning yes, scoped to
  `ADDED` lines with no target and no settlement, and to any participant rather than only the
  one who created it, since the person standing next to the phone is as entitled to fix a typo.
  It is out of this plan because the deletion of a **`DERIVED`** line is a different gesture with
  a different meaning (`0050` section 5) and the two should not be built by one message.
- **Editing the content of an added line**, for the same reason and with the same answer.
- Whether a guest's added line should be visually attributed on the zone side once `0058` binds
  it. Leaning yes, through the ordinary line author, which is the account that bound it and not
  the guest, since the household's list may only ever name accounts.
- Whether the suggest route should fall back to the **owner's** default profile when the snapshot
  names none, rather than to no scope. Leaning no: it is one more read on a hot path to improve
  the ranking of a search in an unscoped basket.

## 10. Exit criteria

- A guest holding a valid participant session adds a line to a basket, with a quantity and
  optionally a product, and the line appears for everybody else on the basket without a refetch.
- The same request naming a `targetListId` is refused with a code that says which field was
  wrong.
- A line added by a guest is never promoted into any shopping list, whatever the basket's
  `defaultTargetListId` says. The same line added by the owner is promoted, as it is today.
- Adding to a `COMPLETED` or `ARCHIVED` basket is refused with a distinct code.
- Every line records who added it, and that attribution survives somebody else settling it.
- A guest searches the catalog through the basket, gets the same suggestions an account holder
  scoped to the run's profile would get, and gets an empty list rather than an error when
  catalog is down.
- A line with no origins settles: the units land on the basket line, no `LineSettlement` is
  written, and the line finishes.
- A revoked participant's next add is refused.
- The OpenAPI document covers both new routes.
