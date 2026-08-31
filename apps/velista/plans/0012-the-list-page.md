# 0012. The list: its lines, and editing them

> Prerequisite reading: `0004` (the transport, rules D1 to D5, and **section 7.2**,
> the optimistic overlay that no screen has used yet), `0007` section 3 (the two
> states a line carries), and `0010` (the group page this one opens from, rules G1
> to G3, and the four things it deferred to "the list screen", which is here).
>
> **This is a page plan** and follows the template in `0001` section 9.
>
> It covers one destination, `zones/:zoneId/lists/:listId`, and the four sheets over
> it. Section 4.1 says why the zone id is in that URL and is not decoration.
>
> **Revised by `0043`, which is now in the build order.** That plan makes a line's
> quantity its state and takes the trip status off it entirely, so three things here stop
> being true when it lands: the row is no longer a checkbox and section 7's accessibility
> mapping is rewritten, marking a line ready or not available leaves this page, and the swipe
> direction is reclaimed for a quantity reel. Everything else, including the composer, the
> reorder mode, the comment sheet, the optimistic overlay and every problem state, is
> unchanged. Until that plan lands, this one describes what is built.

## 1. Purpose

`0010` made every group tappable and every list inside it a row that goes nowhere.
This is the screen behind that row, and it is the one the product exists for: **the
list, its lines, and the aisle**.

Everything before this plan was arrangement. A person can have an account, a group,
other people in the group, and a list with a name, and they still cannot write down
that they need milk. This plan is where they can, where somebody else sees it a
second later, and where one of them ticks it off standing in front of the shelf.

Two properties make it unlike every screen before it:

1. **It is used one handed, walking, on bad signal.** `0002` said so at the top and
   nothing has had to honour it yet. Here the primary gesture is a thumb landing on
   a moving row, and the primary failure is a request that has not come back.
2. **Two people edit the same record at the same time.** `0004` section 7.2 designed
   the overlay and the version reconciliation for exactly this and no screen has
   needed it. A line is the only record in the product that carries `version`, and
   this is the only page that writes one.

Catalog items are out of scope on purpose (section 9). `itemId` stays null on every
line this screen creates, and a line is free text plus a quantity, which is what the
backend already permits: `AddLineDto` requires `content` and nothing else.

## 2. Mock

https://claude.ai/code/artifact/59311ab0-2a5f-4169-a115-af8f56f939be

`mocks/list/`, built and published the way `mocks/README.md` describes.

| Artboard | Frames |
| --- | --- |
| `List.dc.html` | The list loaded, three ways: a writer, a reader with no composer, and staff with the approve controls showing |
| `LineStates.dc.html` | The row spec, measured. Every combination of the two state machines, plus the optimistic, failed and overwritten treatments |
| `AddAndEdit.dc.html` | The composer with the keyboard up, a run of adds, and the edit sheet |
| `Comments.dc.html` | The comment sheet: loaded, empty, and the author whose name the API cannot give back |
| `ReorderAndSwipe.dc.html` | Reorder mode with a drag in flight, the same without a pointer, the swipe actions, and the row overflow |
| `ListStates.dc.html` | Loading from the cache, loading cold, and empty |
| `ListProblems.dc.html` | Not live, failed, and gone |
| `ListSettings.dc.html` | Rename, share, and both delete confirms |
| `DayTheme.dc.html` | The loaded list on Day, and why every status role changes primitive |

Phone frames are 390 by 844, per the mock conventions.

**Night, and a Day artboard is mandatory here.** `mocks/README.md` asks for a Day
artboard only when a page introduces a colour role that `0003` has not proven on
Day, and this page introduces four at once: success, danger, attention and neutral
all appear as row states on a raised surface, next to each other, which is a
combination nothing has drawn. It is also the one screen genuinely used in a bright
supermarket, which is what Day exists for. Drawing it Night only would repeat exactly
the mistake `0002` records: the bright ramps are correct as a fill and unreadable as
text on white, and this screen uses them as both.

## 3. States

### 3.1 The page

| State | Behaviour |
| --- | --- |
| Loading | The header draws from `ListStore`'s cache when the caller arrived from the group page, so the common path shows a named list immediately and skeletons only the lines. A cold arrival skeletons the title too, and the lines still load (rule L2) |
| Loaded | Header, lines in `position` order, composer |
| Empty | The list has no lines. One sentence, and the composer is already focused, because there is exactly one thing to do here |
| Read only | The caller holds READER access. Every line renders, nothing is tappable, the composer is absent rather than disabled. See 3.2 |
| Failed | The `0003` error panel, reused unchanged, with the correlation id and a retry |
| Not live | The list room was refused or the connection dropped. The page is correct and not live, and it says so in the header the way `0010` draws it on a group |
| Gone | The list was deleted, or the caller's access to it was withdrawn, while the page was open. See 3.5 |

### 3.2 Read only is a state, not a disabled screen

`requireWrite` refuses a caller without a WRITER row, so a READER can open the list,
read every line, and change nothing. Two rules follow, and the second is the one that
is easy to get wrong:

- **The composer is absent.** A disabled text field at the bottom of the screen is an
  invitation that does not work, and it costs the person a tap to find that out.
- **Tapping a line does nothing, and says so once.** The tick gesture is the whole
  interaction model of this page, so a reader tapping a row and getting silence would
  read as a broken app. The first tap shows one quiet line at the top of the list,
  "You can read this list, not change it", and later taps are silent.

A reader may still comment: `comment.add` requires only `requireApproved` on the
zone, not write access on the list. That is deliberate on the backend's part and it
is the one thing a reader can do, so the comment affordance stays on every row.

### 3.3 A line that has not landed yet

This is the state `0004` section 7.2 was written for and no page has drawn.

Every write is optimistic: the row changes the instant the thumb lifts, and the
request goes out behind it. Three endings, and all three are visual:

| Ending | What the row does |
| --- | --- |
| Confirmed | Nothing. The overlay is dropped, the server copy is identical, and the row was already right. **No success feedback anywhere**, because the feedback was the change |
| Failed | The row snaps back to the server value and a quiet inline message appears under it. Not a toast: a toast about a row is read after the row has scrolled away |
| Overwritten | The write succeeded and came back with a version older than somebody else's. The row shows the other person's value with a note that it was changed elsewhere, which the caller dismisses |

A row with an in flight write is drawn at 70% and is still tappable. Blocking it
would make the app feel slow on precisely the connection it was designed for, and the
second tap simply supersedes the first.

### 3.4 The two state machines, in one row

A line carries approval and item status independently, and both have to be legible
without the row becoming a dashboard.

| Approval | Status | Row |
| --- | --- | --- |
| APPROVED | PENDING | The ordinary row. Hollow ring, primary text |
| APPROVED | READY | Ring filled mint with a check, text struck through and muted |
| APPROVED | NOT_AVAILABLE | Ring in coral with a slash, text struck through, caption "Not in the shop" |
| PENDING | any | A violet edge on the leading side and the caption "Waiting for approval". Staff also get the two decision buttons |
| REJECTED | any | Text muted and struck, caption "Turned down". Staff can put it back |

**A rejected line stays on the list.** Removing it would make somebody's line vanish
with no explanation, and the person who wrote it is the one least likely to be
looking at the screen when it happens. It goes quiet, it sorts last, and staff can
undo it, which is the same argument `0010` made for a rejected membership.

**A line waiting for approval can still be ticked off.** `setStatus` requires WRITER
and nothing more, so the backend permits it, and a rule invented here that the
backend does not enforce would be a lie the next client exposes.

### 3.5 The states that arrive without being asked for

Realtime, landing on an open page:

| Event | What the page does |
| --- | --- |
| `line.added` | The row appears at its position. If the caller added it, the optimistic row is reconciled rather than duplicated, matched on the id the response returned |
| `line.updated` | Section 3.3's third ending, per field |
| `line.deleted` | The row leaves. Nothing is announced when somebody else deleted it: the list is shared and this is what sharing looks like |
| `line.reordered` | The whole order is rewritten. **Not animated**, because animating somebody else's reorder while a thumb is over the list moves the target under the thumb |
| `comment.added` | The count on the row goes up. The open sheet appends |
| `list.updated` | The header renames in place |
| `list.deleted` | Leave for the group page with a plain notice |
| `list.accessChanged` | The caller's access may have changed, including to none. `ListStore` already refetches the zone's lists on this event (`0010` section 5.2). If the list is no longer in the answer, the page is gone, the same as a delete, with the copy for it |

## 4. Anatomy

### 4.1 Rule L1: the zone id belongs in the URL, and `:listId` must decline `new`

> **Rule L1.** The list route is `zones/:zoneId/lists/:listId`, and `:listId` matches
> only a UUID, enforced by a `canMatch` guard.

Both halves are load bearing and neither is style.

**Why the zone is in the path.** `routes.ts` sketched `lists/:listId` at the top
level, and that sketch was written before this screen had a data plan. There is **no
`GET /v1/lists/:id`**: the only route that names a list is
`GET /v1/zones/:zoneId/lists`. So a top level `lists/:listId` arrives holding an id
and can resolve nothing from it: not the list's name, not its zone, not the caller's
role in that zone, and therefore not whether to draw the approve controls, and not
which realtime room to join. Every one of those is free when the zone is in the URL,
and none of them is reachable when it is not. Section 5.6 records the endpoint that
would make the shorter URL possible, and until it exists the longer one is the honest
shape.

The cost is one line in `feature-home`: `StorageKeys.lastList` stores a list id today
and stores `zoneId/listId` after this plan, so the resume card still works. It is
worth naming that this is a **stored value changing shape**, so a device that
remembers the old form must not break. A stored value with no separator in it is read
as "a list id with no zone", and the resume card simply does not render, which is a
missing card once rather than a broken navigation.

**Why the UUID guard.** `lists/new` is already a child of `zones/:zoneId` (`0010`
section 4.2), and `lists/:listId` declared beside it is offered `/lists/new` first,
matches it with `listId` set to the string `new`, and wins. This is rule G1 exactly,
one level deeper, and it has the same fix and the same reason `canMatch` rather than
`canActivate`: a declined match carries on to the next route, so `lists/new` reaches
`CreateListSheet`. `listIdGuard` reads the segment positionally, since at `canMatch`
time there are no params, and it lives beside `zoneIdGuard` in `zone-guards.ts`.

The `routes.spec.ts` assertions this adds:

- `zones/<uuid>/lists/new` still resolves to `CreateListSheet`.
- `zones/:zoneId/lists/:listId` declares a `canMatch`.
- A non UUID list segment does not match the list page.

### 4.2 The routes

| Route | Renders | Access |
| --- | --- | --- |
| `zones/:zoneId/lists/:listId` | `ListPage` | Authenticated, approved member |
| `.../lines/:lineId/edit` | `EditLineSheet` | Writer |
| `.../lines/:lineId/comments` | `CommentsSheet` | Approved member, readers included |
| `.../settings` | `ListSettingsSheet`: rename, share, delete | List creator, zone admin, or owner |
| `.../lines/:lineId/confirm/delete` | `ConfirmSheet`, reused from `0010` | Writer |

Every one of the four is a route and not a template flag, which is rule E1 from
`0008` unchanged: each covers the page without losing it, and Android's back button
has to dismiss it.

Ticking a line off is not in that table and never will be. It is one tap, it is
reversible by the same tap, and it is the thing this screen is for.

### 4.3 Rule L2: the lines never wait for the name

> **Rule L2.** The lines request is issued from the list id alone and never waits on
> the request that names the list.

They are two independent calls. `GET /v1/lists/:id/lines` needs only the list id, and
finding the list's name means paging `GET /v1/zones/:zoneId/lists` until it turns up,
which on a cold arrival is a second round trip and possibly a third.

Sequencing them would mean a person opening the app in an aisle waits for a title
before they see what to buy. So the header degrades and the body does not: the title
skeletons, fills in when the name arrives, and the lines are already on screen. When
the caller came from the group page, `ListStore` has the list cached and the title is
there on the first frame, which is the common path.

### 4.4 Rule L3: staff approve their own line as they add it

> **Rule L3.** When the caller is OWNER or ADMIN, `addLine` is followed immediately by
> `setApproval(APPROVED)` on the id that came back. If that second call fails, the
> line is simply pending and **nothing is reported**.

Core starts every line at `approvalStatus = PENDING` and lets only a zone OWNER or
ADMIN approve one. Taken literally, the owner of a two person household adds milk and
watches it sit there waiting for the owner to approve it, which is nonsense produced
by a rule that was written for a different case.

The rule is not wrong, it is just aimed at somebody else: it exists so a flatmate or a
child can put something on the list and have it confirmed. For the person who already
holds the power to confirm, the confirmation is a formality, and the client performs
it. This is two requests where one would do, and it is done with the caller's own
permissions, so nothing is bypassed. Section 5.6 records the `autoApprove` flag that
would make it one.

The failure is silent on purpose. The line exists, it is on the list, and the only
thing that did not happen is a state change the person did not ask for.

### 4.5 Rule L4: reordering is a mode, and it is a whole list write

> **Rule L4.** Reordering is a **mode**, entered from the header, in which ticking off
> is off and every row grows a grip. Dragging inside it is enabled only once every page
> of lines is loaded, which means `nextCursor` is null.

The mode is forced by the tap gesture and is not a preference. If a press on a row can
mean both "tick this off" and "pick this up", the list will regularly do the wrong one,
and the wrong one here is destructive of somebody's attention in an aisle. Long press is
already taken by editing. So the two gestures are separated in time instead of in space:
the header offers Put them in order, the rows stop being checkboxes for as long as that
lasts, and a Done button ends it. Android's back ends it too.

It is page state rather than a route, which is the one place this plan does not follow
rule E1. E1 is about screens drawn over a page that must not lose the page underneath; a
mode does not cover the page, it changes what the page's rows do, and there is nothing to
restore on the way back except a flag.

`line.reorder` takes `orderedLineIds` and rewrites each named line's position to its
index in that array, leaving every line not named alone. Send one page of a two page
list and the first twenty lines are renumbered 1 to 20 while the rest keep positions
that deletes have already left non contiguous, so two lines can land on the same
number and the order becomes whatever the id tie break says.

The fix is not a cleverer payload, it is not reordering a list the client has not
finished reading. In practice this costs nothing: `MAX_PAGE_SIZE` is 100, the page
asks for it, and a shopping list with more than a hundred lines is not the case this
product is for. The lines load in one request, `nextCursor` is null, and drag is on.
A list long enough to page keeps every other function and loses drag until the last
page arrives, which it does in the background.

### 4.6 The screen, top to bottom

| Region | Component | Library |
| --- | --- | --- |
| App bar: back to the group, the list name, the overflow | `ListHeader` | `libs/velista/ui` |
| The group's name and "7 of 12 ready", with the progress bar | `ListHeader` | `libs/velista/ui` |
| The not live badge | reuses `0010`'s treatment | `libs/velista/ui` |
| The lines | `LineRow` inside `LineList` | `libs/velista/ui` |
| The reader notice (3.2) | `ListNotice` | `libs/velista/ui` |
| The composer, pinned above the safe area | `LineComposer` | `libs/velista/ui` |
| The sheets | `EditLineSheet`, `CommentsSheet`, `ListSettingsSheet` | `libs/velista/feature-lists` |

The back control and the sheet open and close treatment are `0011`'s, not new work:
defect 4 made back a caret button shared by both zone pages, and defect 5 fixed
`SheetShell`'s transition. This page uses both as they stand.

### 4.7 The row

56 tall when it is ordinary, taller when it has something to say.

```
 (o)  Sourdough loaf                       x2   (...)
```

- **The state control on the leading side is an indicator, not a target.** The whole
  row is the target, which is what makes the gesture work with a thumb on the move.
- **The quantity is drawn only when it is greater than one**, right aligned and in
  tabular numerals so a column of them lines up.
- **The overflow is the only separate target in the row**, 44 square, and it holds
  everything that is not ticking off: edit, mark not available, comments, delete.
- **Captions add a second line**, and only three things produce one: waiting for
  approval, turned down, and not in the shop. An ordinary row never grows.
- **The comment count sits with the overflow** and is absent at zero rather than drawn
  as a zero.

### 4.8 The composer

Pinned to the bottom, above the safe area, and it is the reason this screen does not
have a floating action button. Adding things happens in runs: somebody stands in the
kitchen and enters six items. So the field keeps focus after a submit, the keyboard
never dismisses between two adds, and the new row animates in above the composer.

The quantity is a stepper beside the field, defaulting to 1 and resetting after each
submit. `AddLineDto` caps content at 400 characters and quantity at 100000; the field
shows a counter only past 350, and the stepper simply cannot be driven past the cap.

### 4.9 Libraries

| Library | Adds |
| --- | --- |
| `libs/velista/feature-lists` **(new)** | `ListPage`, `EditLineSheet`, `CommentsSheet`, `ListSettingsSheet`. The only things here that touch a store, per rule D1 |
| `libs/velista/ui` | `ListHeader`, `LineList`, `LineRow`, `LineComposer`, `LineStateControl`, `QuantityStepper`, `CommentRow`, `CommentComposer`, `ListNotice`, `ShareRow` |
| `libs/velista/data-access` | `LineApi` / `LineMemory` / `LINE_SERVICE`, `CommentApi` / `CommentMemory` / `COMMENT_SERVICE`, the `LineStore`, the member name cache in section 5.4, and the three list writes `ListServiceI` deferred |
| `libs/velista/models` | Nothing new. `Line` and `Comment` are already in `domain.ts`, written for this screen |
| `libs/velista/feature-zones` | The list row on the group page becomes a real link. `pendingRoutes` empties |
| `libs/velista/feature-home` | The resume card's stored value gains the zone (section 4.1) |
| `libs/velista/feature-shell` | The five route entries and `listIdGuard` |

Layering is unchanged: `models -> platform -> {ui, data-access} -> feature-*`.
`feature-lists` is lazy loaded by `feature-shell` and must never import it back.

Icons needed: a check, a slash or a crossed circle, a speech bubble, a drag handle,
and a plus. All go in `libs/velista/ui/src/lib/icons`, and the chevron and ellipsis
`0010` added are reused.

## 5. Data

### 5.1 The calls

| Call | Route | Answers |
| --- | --- | --- |
| The lines | `GET /v1/lists/:id/lines?order=position&limit=100` | `LinePage`, cursor paged, ordered by `position` by default |
| Name the list | `GET /v1/zones/:zoneId/lists` | `ListPage`. Also fills `ListStore` for the group page |
| Add a line | `POST /v1/lists/:id/lines` | `LineView` |
| Edit a line | `PATCH /v1/lines/:id` | `LineView`, version bumped |
| Tick it off | `POST /v1/lines/:id/status` | `LineView` |
| Approve or turn down | `POST /v1/lines/:id/approval` | `LineView` |
| Reorder | `POST /v1/lists/:id/lines/reorder` | `{ listId }` |
| Delete a line | `DELETE /v1/lines/:id` | `{ id }` |
| Comments | `GET /v1/lines/:id/comments` | `CommentPage`, newest first |
| Add a comment | `POST /v1/lines/:id/comments` | `CommentView` |
| Rename the list | `PATCH /v1/lists/:id` | `ListView` |
| Delete the list | `DELETE /v1/lists/:id` | `{ id }` |
| Set who can read and write | `PUT /v1/lists/:id/access` | `ListView`. See 5.5, this one has a problem |
| Who is in the group | `GET /v1/zones/:zoneId/members?statuses=APPROVED` | `MembershipPage`, and the only source of a username. See 5.4 |

All of them require a bearer token, all map through rule D4 into this app's own
models, and every write goes through `Mutations.run` per rule D2. `LineMemory` and
`CommentMemory` mirror the lot, so every state in section 3 is buildable and testable
with no gateway running.

### 5.2 `LineStore`, and the overlay that finally gets used

`LineStore` goes in `data-access` beside `ListStore`, for the reason `ListStore`'s own
header gives: a store owned by a feature library is destroyed on navigation, so
opening a comment sheet as a route would leave the room and throw the lines away.

It holds lines by list id, applies `line.added`, `line.updated`, `line.deleted` and
`line.reordered`, and it is the first consumer of `Mutations`' overlay. Everything in
section 3.3 lives here and nowhere else, which is the entire argument for a store:
two writers are reconciled once, not in every component that draws a row.

The reconciliation is `0004` section 7.2 applied literally, and the one addition this
plan makes is the **identity problem on an optimistic add**. A row created locally has
no server id, so the `line.added` event for it cannot be matched by id and would
duplicate the row. The overlay carries a client key, the response carries the server
id, and the store keys the pending add by the client key until the response returns.
An event arriving for a line whose id the store does not know, in a list it has
loaded, is somebody else's line and is inserted.

### 5.3 Rooms

The page joins `list:{listId}`, and the group's room `zone:{zoneId}` as well, because
`list.deleted` and `list.accessChanged` are zone events and losing the list while
looking at it is a state this page has to render (3.5). Both are refcounted and
released on destroy.

Rule G3 still holds and is not relevant here: nothing on this screen wants the staff
room, so nothing subscribes to it, and no stale badge appears for a plain member.

### 5.4 Nobody has a name

`CommentView` carries `authorUserId` and no username. `LineView` carries
`createdByUserId` and no username. There is no profile endpoint (`0004` section 11
item 2). So a comment sheet built from the comment endpoint alone can only say that
`e3f1...` wants the big one.

The only place a user id is paired with a human name anywhere in the API is
`MembershipView`, which carries both. So the page loads the zone's approved members
once, builds a `userId -> username` map, and caches it for the session beside the
other stores. One request per zone, on a screen that is already making two, and it is
reused by the share sheet, which needs the same list for a different reason.

Two consequences to hold:

- **A name can be missing** for somebody who has left the group since commenting. The
  row falls back to a neutral word rather than to an id, and never to "Unknown", which
  reads like an error.
- **Names are per zone.** The same person is called something different in another
  group, which is what `0010` already established. Nothing here may cache a name
  outside the zone it came from.

Section 5.6 records the field that would delete this whole subsection.

### 5.5 The share sheet needs an endpoint that does not exist

This is the one part of this plan that is specified and cannot be correctly built
today, and it is recorded here rather than quietly dropped or quietly bodged.

`PUT /v1/lists/:id/access` takes `entries: [{ membershipId, role }]` and **replaces
the whole set**. There is no `GET`. So a client opening the share sheet knows who is
in the group and does not know which of them can already read or write the list, and
a PUT built from that ignorance silently revokes everybody the sheet did not happen to
include.

Three ways out, and only one of them is honest:

1. **Send the full set from a sheet that shows unknown state.** Rejected. It makes
   every save a coin flip on other people's access, and the person saving cannot see
   what they took away.
2. **Infer it.** There is nothing to infer from. A manager's list of lists carries no
   access rows, and the only observable fact is that a caller who cannot read a list
   does not see it, which says nothing about anybody else.
3. **Specify the sheet in full, build it against `ListMemory`, and gate the real one
   on `GET /v1/lists/:id/access`.** Taken.

The sheet itself is settled and does not change when the endpoint lands: every
approved member as a row, three choices each (no access, can read, can add and tick),
the list's creator shown as a writer who cannot be demoted, and zone staff shown as
readers who always have access and are not in the payload. Save sends the complete
set, which is what PUT means, and it can only do that safely once it can read the set
it is replacing.

Rename and delete are unaffected and ship with this plan. They are `PATCH` and
`DELETE` on `/v1/lists/:id`, both limited to the list creator, a zone admin, or the
owner, which is `requireManage` and is a different rule from the write access that
gates lines. **A WRITER who did not create the list cannot rename it**, and the
overflow reflects that from the caller's own facts, per rule G2.

### 5.6 What this plan needs from the backend, and what it does without

Recorded, not assumed. Only the third one blocks anything.

1. **`GET /v1/lists/:id`.** One list by id, with its name, zone and counts. It would
   let the route be `lists/:listId`, delete rule L2's second request, and make a
   shared link to a list resolvable by somebody who has the id and not the zone. Core
   already has `ListAccessService.requireRead` and `toListView`, so this is a
   controller method and a message pattern.
2. **A username on a comment and on a line.** `authorUsername` on `CommentView` and
   `createdByUsername` on `LineView` would delete section 5.4 entirely. Core resolves
   the membership on every write already, so the name is in hand at the point the row
   is built.
3. **`GET /v1/lists/:id/access`.** Blocks the share sheet, for the reason section 5.5
   gives at length. It should answer the same `entries` shape the PUT accepts, so the
   sheet reads and writes one type.
4. **An `autoApprove` on `AddLineDto`**, or a rule that a staff member's own line
   lands APPROVED. Would replace rule L3's second request with nothing.
5. **Still no way to leave a group**, unchanged from `0010` section 5.8. It is not
   this screen's problem and it is still the most likely thing somebody looks for.

### 5.7 What a failure means, per operation

The gateway has seven codes and one message per code, so the server's `message` is
unusable as copy and the client keys its own on **code plus operation**, which `0004`
settled and `0008` first applied.

| Code | Where | Means | Copy |
| --- | --- | --- | --- |
| `not_found` | The lines request | The list is gone, or was never readable by this caller | This list is not available to you. It may have been deleted, or it may no longer be shared with you |
| `forbidden` | The lines request | A caller whose access was withdrawn between the group page and here. A READER opening a list they may read is **not** this: `requireRead` passes | The same copy as `not_found`, because the two are indistinguishable to the person reading them |
| `forbidden` | Add, edit, tick, delete a line | The caller is a READER, or their access was narrowed while the page was open | You can read this list, not change it, and the page switches to 3.2 in place |
| `forbidden` | Approve, turn down | The caller was demoted out of staff | Your role in this group changed, and the decision buttons leave |
| `validation_failed` | Add, edit | Content over 400 characters, or a quantity out of range | Caught in the field before the request, so this is the belt on top of the braces and shows the field's own message |
| `validation_failed` | Reorder | The order named a line the server does not have, which means somebody deleted one mid drag | **No message.** The list refetches and settles into the truth |
| `rate_limited` | Anywhere | A run of quick adds hitting a bucket | Slow down for a moment, and the composer keeps the text |
| `internal` | Anywhere | The generic panel with the correlation id `0003` already renders | |

The `validation_failed` on reorder is worth the same argument `0010` made for approve:
two people editing one list is the normal case, not the exotic one, and the person who
dragged has done nothing wrong. The list rereads and the drag is simply undone.

## 6. Localization

New keys nested under `list` in `libs/velista/ui/assets/i18n/{en,es}.json`. Rule N2
holds: the keys say list and line, the values say what a person says. Rule N1 holds:
no key contains the product name.

`home.list.items_one` / `_other` and `home.progress.ready` are reused unchanged, as
are the whole of `home.error` and `0010`'s `zone.confirm.*` frame.

| Key | English | Spanish |
| --- | --- | --- |
| `list.header.inGroup` | in {{name}} | en {{name}} |
| `list.header.ready` | {{ready}} of {{total}} ready | {{ready}} de {{total}} listos |
| `list.header.notLive` | Not updating right now | No se está actualizando ahora |
| `list.add.placeholder` | Add something | Añade algo |
| `list.add.action` | Add | Añadir |
| `list.add.quantity` | How many | Cuántos |
| `list.empty.title` | Nothing on this list yet | Todavía no hay nada en esta lista |
| `list.empty.body` | Write the first thing and everyone here sees it | Escribe lo primero y todos lo verán |
| `list.readOnly.notice` | You can read this list, not change it | Puedes ver esta lista, no cambiarla |
| `list.line.awaitingApproval` | Waiting for approval | Esperando aprobación |
| `list.line.rejected` | Turned down | Rechazado |
| `list.line.notAvailable` | Not in the shop | No estaba en la tienda |
| `list.line.approve` | Add it | Añadirlo |
| `list.line.reject` | Not this | Esto no |
| `list.line.restore` | Put it back | Devolverlo a la lista |
| `list.line.markNotAvailable` | Mark as not in the shop | Marcar como que no estaba |
| `list.line.edit` | Change this | Cambiar esto |
| `list.line.delete` | Take off the list | Quitar de la lista |
| `list.line.overwritten` | {{name}} changed this while you were editing | {{name}} cambió esto mientras lo editabas |
| `list.line.failed` | That did not save. Tap to try again | No se ha guardado. Toca para reintentar |
| `list.line.move` | Move | Mover |
| `list.line.movedTo` | Moved to position {{position}} of {{total}} | Movido a la posición {{position}} de {{total}} |
| `list.reorder.enter` | Put them in order | Ponerlas en orden |
| `list.reorder.title` | Put them in order | Ponerlas en orden |
| `list.reorder.body` | Drag by the grip. Ticking off is off while you are in here | Arrastra por el asa. Mientras estés aquí no se puede marcar nada |
| `list.reorder.done` | Done | Hecho |
| `list.edit.title` | Change this line | Cambiar esta línea |
| `list.edit.content` | What is it | Qué es |
| `list.edit.save` | Save | Guardar |
| `list.confirm.deleteLine.title` | Take {{name}} off the list? | ¿Quitar {{name}} de la lista? |
| `list.confirm.deleteLine.body` | It goes for everyone, along with anything said about it | Se irá para todos, y también lo que se haya dicho de ella |
| `list.comments.title` | About {{name}} | Sobre {{name}} |
| `list.comments.placeholder` | Say something about this | Di algo sobre esto |
| `list.comments.empty` | Nothing said about this yet | Todavía nadie ha dicho nada |
| `list.comments.someone` | Someone in the group | Alguien del grupo |
| `list.settings.title` | List settings | Ajustes de la lista |
| `list.settings.name` | List name | Nombre de la lista |
| `list.settings.share` | Who can use this list | Quién puede usar esta lista |
| `list.settings.access.none` | No access | Sin acceso |
| `list.settings.access.reader` | Can read | Puede verla |
| `list.settings.access.writer` | Can add and tick off | Puede añadir y marcar |
| `list.settings.access.always` | Always has access | Siempre tiene acceso |
| `list.settings.access.shortNone` | None | Nada |
| `list.settings.access.shortReader` | Read | Ver |
| `list.settings.access.shortWriter` | Add &amp; tick | Añadir |
| `list.settings.access.creator` | Started this list | Empezó esta lista |
| `list.settings.access.staffNote` | Admins can open every list | Los administradores pueden abrir todas las listas |
| `list.confirm.deleteList.title` | Delete {{name}}? | ¿Eliminar {{name}}? |
| `list.confirm.deleteList.body` | Every line on it goes, for everyone in the group. This cannot be undone | Se irán todas sus líneas, para todo el grupo. Esto no se puede deshacer |
| `list.gone.deleted` | That list was deleted | Esa lista se ha eliminado |
| `list.gone.unshared` | That list is no longer shared with you | Esa lista ya no está compartida contigo |
| `list.error.notAvailable` | This list is not available to you. It may have been deleted, or it may no longer be shared with you | Esta lista no está disponible para ti. Puede que se haya eliminado o que ya no esté compartida contigo |
| `list.error.readOnly` | You can read this list, not change it | Puedes ver esta lista, no cambiarla |
| `list.error.roleChanged` | Your role in this group changed | Tu papel en este grupo ha cambiado |
| `list.error.tooFast` | Slow down for a moment and try again | Ve un poco más despacio e inténtalo de nuevo |

Every title that names a line or a list interpolates it as a whole phrase rather than
gluing a noun to a frame, per the Spanish gender rule in `0001`.

The `access.short*` trio exists because three segments have to fit across a 390 phone and
"Can add and tick off" does not. They are the **visible** labels only: each segment's
accessible name is the long key beside it, so a screen reader hears the whole phrase and
never the abbreviation. That is the one place in this app where the two diverge, and it
is written down here so nobody later "tidies" the long keys away as duplicates.

Deleting a list reuses `0010`'s **typed name** confirmation only when the list has
lines. An empty list is a two tap delete, because friction proportional to what is
lost is the rule `0010` set, and an empty list loses nothing.

## 7. Accessibility and input

- **The row is a `checkbox` in the accessibility tree**, not a button, because that is
  what it is: `role="checkbox"` with `aria-checked` reflecting READY. Its accessible
  name is the content plus the quantity, so "Sourdough loaf, 2" is what gets read, and
  the captions are in `aria-describedby` rather than in the name.
- **The state control is `aria-hidden`.** It is a picture of the checkbox state and
  announcing it would say everything twice.
- **NOT_AVAILABLE is not a third checkbox state**, because there is no such thing. It
  is `aria-checked="false"` with the caption in the description, which is the honest
  mapping and the one a screen reader user can act on.
- **Drag has a keyboard and screen reader equivalent**, and it is not optional: in
  reorder mode the grip is a focusable button, up and down move the row, and
  `list.line.movedTo` is announced on each step through one `aria-live="polite"`
  region. A grip that only responds to a pointer would put the manual order out of reach
  of anybody without a working one.
- **Reorder mode announces itself on entry and on exit**, and the rows lose
  `role="checkbox"` while it lasts rather than keeping a role they no longer honour.
- **Swipe is never the only way to do anything.** Not available and delete are both on
  the overflow. Swipe is a shortcut for people who know it.
- **Every target is at least 44 by 44.** The row is 56 tall, its overflow is 44 square
  inside it, and the composer's send and stepper controls are 44.
- **The composer keeps focus across a submit** and the newly added row is announced, so
  somebody adding six things with a screen reader hears each one land without hunting
  for the field again.
- **A row with a write in flight is `aria-busy`** and keeps its accessible name.
- **The failed and overwritten notices are in the live region**, once each, and are not
  repeated on re render.
- **Reduced motion.** Rows appear and leave by fading rather than sliding, the drag
  ghost does not tilt, and somebody else's reorder is never animated at all, which is
  the default for everyone (3.5).
- **The tick colour is never the only signal.** READY strikes the text through,
  NOT_AVAILABLE adds a caption, and the state control's shape differs in all three
  states, so the row survives both a colourblind reader and a monochrome one.

## 8. Acceptance criteria

- [ ] `/en/velista/zones/<uuid>/lists/<uuid>` renders the list, and
      `/en/velista/zones/<uuid>/lists/new` still renders the create sheet. A third
      spec asserts a non UUID list segment does not match (rule L1).
- [ ] Arriving from the group page shows the list's name on the first frame, from the
      cache, and skeletons only the lines.
- [ ] A cold arrival renders lines before the name, and never blocks one on the other
      (rule L2). Verified on the service double by asserting both calls were issued
      without ordering between them.
- [ ] Tapping a row ticks it off immediately, before any response, and the progress
      counter in the header moves with it.
- [ ] A tick whose request fails snaps the row back and shows one inline message, not a
      toast, and the message is in the live region once.
- [ ] A `line.updated` event for a row with a pending overlay keeps the overlay for the
      field being edited and applies the event to every other field (`0004` 7.2,
      case 3).
- [ ] An optimistic add reconciles against its own `line.added` event and does not
      produce two rows.
- [ ] A staff member's new line is APPROVED without them doing anything, and a failure
      of that second call leaves the line pending and reports nothing (rule L3).
- [ ] A plain member's new line is PENDING and says so; the same line shows approve and
      turn down controls to an owner and an admin and to nobody else.
- [ ] A turned down line stays on the list, sorts last, and can be put back by staff.
- [ ] Reorder mode turns ticking off, and back ends the mode rather than leaving the
      page (rule L4).
- [ ] Drag is off while `nextCursor` is non null and on once it is null (rule L4).
- [ ] The grip reorders by keyboard and announces each step in the live region.
- [ ] A READER sees every line, no composer at all, and one notice on their first tap.
- [ ] A WRITER who did not create the list sees no rename and no delete in the
      overflow; the creator and zone staff do.
- [ ] Deleting a list with lines requires the typed name; deleting an empty one does
      not.
- [ ] `list.deleted` for the open list leaves for the group page with a plain notice,
      and `list.accessChanged` that removes the caller's access does the same with the
      other copy.
- [ ] Comment authors are named from the zone's members, and a comment from somebody
      who has left the group falls back to a neutral word rather than to an id.
- [ ] Every row of the section 5.7 table renders its own copy, verified against the
      in-memory services rather than a live gateway.
- [ ] The share sheet is built and passing against `ListMemory`, and the plan records
      that the live one waits on `GET /v1/lists/:id/access` (section 5.5).

## 9. Out of scope

- **Catalog items.** `itemId` stays null on every line this screen writes. Backend plan
  `0012` builds the catalog; picking an item, and everything that follows from one (a
  picture, a usual brand, a shop that stocks it), is its own page plan.
- **Presence.** `ListPresence` and `presence.listUpdated` exist and are advisory only
  (`0004` section 6.7). Showing who else is looking at the list is a good screen and it
  is not what makes this one work.
- **An offline queue.** Rule D2's choke point is used, and `0001` section 5 still puts
  the queue itself out of scope. A write made with no connection fails and says so.
- **Sorting the list by anything but `position`.** The endpoint offers `created` and
  `updated` and no screen here asks for them. A shopping list has a manual order for a
  reason: it is the order of the aisles.
- **Anything that clears the ticked lines**, such as finishing a shop and starting the
  next one. It is the obvious next thing to want and there is no endpoint for it: it
  would be a delete per line. Recorded as the first candidate for the plan after this
  one.
