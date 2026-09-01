# 0052: the basket screen names people, and finishes a line

> Ten reports against `/shopping-lists/:id`, the shared basket, collected from one pass over
> the screen. They are not one feature. Four are copy or naming, three are geometry, two are a
> control that is offered when it cannot work, and one is a control the screen does not have
> yet.
>
> What they share is a diagnosis: the basket was built for a guest in a shop (`0044`), and
> almost every one of these is the **owner's** view of it going slightly wrong. The owner is
> named by their role rather than their name, their own faces blend into the header, their
> revoke confirmation lands under the finger that opened it, and the sheet on a finished line
> offers them two buttons that both fail.
>
> Prerequisite reading: `0044` sections 4 and 5 (the screen and its sheets), `0048` section 5
> (live and not live), `0049` section 1.1 (the history pane), and `0051` (the participant
> naming this corrects). Luna `0054` is the other half of sections 2, 6 and 7, and nothing here
> waits for it: section 9 says what each looks like before it lands.

## 1. What is being built

| # | Report | Where |
| - | ------ | ----- |
| 1 | "you" should be the reader's own name | `basket-labels.ts`, `people-sheet`, `settle-sheet` |
| 2 | Other participants see "Owner", not a name | `basket-labels.ts`, luna `0054` section 2 |
| 3 | The face bubbles blend into the background | `basket-page.scss`, `people-sheet.scss` |
| 4 | Revoke can be double tapped by mistake | `share-sheet` |
| 5 | The cascade checkbox is enormous | `share-sheet.scss` |
| 6 | A line needs a status control on the row | `basket-line-row`, `basket-page`, luna `0054` section 3 |
| 7 | "Got all 0", and a failure with no sentence | `settle-sheet`, a new `basket-error-copy.ts` |
| 8 | "They had none" is offered at zero outstanding | `settle-sheet` |
| 9 | The history link is underlined and misnamed | `settle-sheet.scss`, `en.json`, `es.json` |
| 10 | The back button has a hover nothing else has | `basket-page.scss` |

Sections 3, 5, 9 and 10 are one declaration each and are written down because the **reason**
matters more than the value. Sections 2, 6 and 7 are the substantial ones.

## 2. The reader is named, and so is everybody else

### 2.1 "You" becomes a name

Three places on this screen say "you" about the reader:

- `people-sheet.html` draws `row.isMe ? ('basket.people.you' | rokuT) : row.label`.
- `touchedCaption` in `basket-labels.ts` is called with `{ you: line.touchedBy === meId }`, so
  the row under the bread says "you got it".
- `settle-sheet.html`'s history pane draws `'basket.history.you'` for a row where `row.mine`.

**All three draw the name instead.** The reason is the screen: four people are working one list
in a shop and reading it on each other's phones over a trolley. "You got it" is unreadable when
the phone in your hand is not yours, and it is the only caption on the screen that changes
meaning depending on who is holding the device.

- **The people sheet** draws `row.label` for every row, and keeps a quiet chip beside the
  reader's own name so they can still find themselves. The chip reuses `basket.people.you`,
  which already exists and is already translated in both files, and takes the `.guest-tag`
  treatment: the sheet already has a shape for "a word that qualifies a name".
- **`touchedCaption`** takes `ownName` where it took `you`. It already accepts
  `ParticipantNameOptions.ownName` for exactly this: core keeps no `displayName` for an owner, so
  the reader's own account name is the only thing that can name their own row. The caller,
  `BasketLineRow`, therefore needs the account name, which means one new input beside `meId`
  rather than a second `SessionStore` injection in a row component that is rendered once per
  line.
- **`ParticipantNameOptions.you` is deleted.** After the three callers above, nothing sets it.
  A flag with no caller is a flag that comes back wrong.
- **The history pane** resolves its own name for a `mine` row rather than changing
  `toSettlementRow`. That function is shared with the line page and the line detail sheet
  (`libs/velista/models/src/lib/line-detail-view.ts`), which are **zone** screens where "You" is
  correct and is not part of this report. `SettlementRowVm.who` is null for a `mine` row by
  construction, so the settle sheet fills it from `SessionStore.username()` in `_toRow`, where
  it already has the translator and the locale.

### 2.2 "Owner" and "Member" are not names

`participantName`'s last fallback returns `basket.people.owner` or `basket.people.member` for a
participant with an account, no `displayName` and no `guestNumber`. `0051` added it, correctly,
as the honest thing to say about somebody the reader had not been given a name for, and it
replaced a worse bug where the owner was listed on their own basket as "Guest".

It is still a role where a person belongs, and the reason it is reached at all is a **backend
absence**: core creates an owner's row with a null name and the join screen sends nothing for a
signed in joiner. Luna `0054` section 2 fixes that by carrying the account holder's username on
the participant.

On this side:

- `BasketParticipant` gains `username: string | null`, mapped in `basket-mappers.ts` from
  `unknown` like everything else (rule D4).
- `participantName` prefers, in order: `displayName`, the reader's own `ownName`, `username`,
  `Guest N`, and only then the role word.
- **The role fallback stays**, and this is deliberate. A basket generated before `0054` ships
  carries no username for anybody, and the fallback is what those baskets keep drawing. Deleting
  it would make them draw an empty string.

### 2.3 What is not changed

**A name is still not an identity.** Two guests may both type "Dani", the participant id is the
attribution, and the guest ring and the guest tag stay exactly as `0051` left them. A username
does not make somebody verified to the other people in the shop; it makes them nameable.

## 3. The bubbles need an edge

`.face` in `basket-page.scss` and `.avatar` in `people-sheet.scss` are both filled
`--app-surface-sunken`. The bar behind the faces is the page's `--app-surface-ground`, and the
two tokens are **one step apart on the ramp** in both themes: `--app-ink-900` on `--app-ink-950`
in dark, `--app-neutral-100` on `--app-neutral-50` in light. At `--app-avatar-sm` that is a
circle you have to look for.

The guest bubbles are the exception, and the giveaway: they carry `guest-ring`, a dashed
`--app-border-strong`, so the guests in the header are the only faces with an edge. The report
is describing the fix already being present on one third of the row.

**Every bubble gets a solid `1px var(--app-border-subtle)` edge, and its fill moves one further
step from whatever it sits on:**

- `.face`, on the bar's `--app-surface-ground`, is filled `--app-surface-raised`, which is two
  ramp steps rather than one. Its existing `box-shadow` ring in `--app-surface-ground` stays: it
  keeps overlapping faces separable and it sits outside the new border, so the two do not fight.
- `.avatar`, inside a sheet panel whose background is `--app-surface-raised`, keeps
  `--app-surface-sunken`, which is already the away direction there, and gains the same border.

**The guest ring stays `1px dashed var(--app-border-strong)`** and therefore stays the stronger,
differently shaped edge. Solid subtle against dashed strong is a bigger difference than nothing
against dashed strong, so marking a guest gets easier rather than harder, which is section 7 of
`0044`'s requirement and the reason this is not simply "give everything the strong border".

`--app-avatar-md` and `--app-avatar-sm` do not change. The border is drawn inside the box, so
nothing moves.

## 4. Revoke cannot be double tapped into

### 4.1 Why it happens

The sheet panel is **anchored to the bottom of the viewport** (`sheet-shell.scss`:
`inset-block-end: 0`) and grows upward. So the last control in a pane is always the same
distance from the bottom of the screen, whichever pane is showing.

The link pane ends `… note, [Revoke the link], [Close]`. The revoke pane ends
`… cascade, [Revoke the link], [Keep it]`. Both stacks are two buttons deep from the bottom
edge, so **the destructive confirm renders within a few pixels of the trigger that summoned
it**. A second tap of a double tap lands on it. The panes do not animate between each other, so
there is not even a transition to absorb the second press.

### 4.2 The fix is geometric, and it is exact

**The safe answer takes the position the trigger occupied.** The revoke pane's action stack is
reordered to `[Keep it]` then `[Revoke the link]`, so a stray second tap at the trigger's
coordinates hits Cancel.

That is only a guarantee if the two stacks line up, so two things go with it:

- **Both stacks move into the sheet's footer slot**, `sheetFooter` with `hasFooter` set. The
  footer is `flex: 0 0 auto` outside the scroll (`0040` section 2), so its children are pinned
  to the bottom of the panel and their positions stop depending on how much copy is above them.
  Today they depend on it: the revoke pane's body is a paragraph shorter and a checkbox taller
  than the link pane's, and the two happening to align is a coincidence rather than a rule.
- **The cancel takes the same button treatment as the trigger**, `secondary-button` rather than
  `.quiet`, so the two rows are the same height and index 0 of one stack is exactly index 0 of
  the other.

The confirm therefore lands where `Close` was. That is safe and does not move the bug: `Close`
dismisses the sheet, so its second tap arrives after the sheet is gone. **`Revoke the link` is
the only control on the link pane that switches panes**, which is what makes this a complete
fix rather than a rotation of the problem.

No timer, and no disabled window. A control that ignores a real tap for a few hundred
milliseconds is indistinguishable from a control that is broken, and this screen is used by
somebody walking.

## 5. The cascade checkbox is 44px because it was told to be

```scss
.cascade input {
  @include shared.tap-target;   // min-block-size AND min-inline-size: --app-touch-target
}
```

`tap-target` sets both axes to `--app-touch-target`, which is 44px, and a native checkbox
stretches to its box. The mixin is right about the target and wrong about the element: **the
target of a checkbox is its label**, and `.cascade` is already a `<label>` wrapping a bordered
card the full width of the sheet.

**The mixin moves to `.cascade`**, where `min-block-size` alone is what is wanted, and the input
is sized explicitly at `--app-icon-md` on both axes with `flex: none` and `accent-color:
var(--app-action-bg)` so it is drawn in the app's own colour rather than the browser's blue.

`align-items: flex-start` stays: the label is two lines and the box belongs beside the first.

## 6. A status control on every row

### 6.1 What it is

A control at the **leading edge** of each line, before the content, drawing the line's state and
toggling the whole line between got and outstanding in one tap.

Leading rather than trailing, and that is decided by what is already there: the quantity, the
outstanding count and the progress caption are all at the trailing edge, and putting a fourth
thing in that column would make the one column a person scans in an aisle four things wide. The
leading edge is empty, it is where a state marker is expected in every list on a phone, and it
is on the side a right handed thumb reaches when the device is held to read.

### 6.2 The row stops being one button

`basket-line-row.html` is currently a single `<button class="row">` carrying the whole line,
with an `aria-label` composed of every caption because the visual rows are separate lines. A
button cannot contain a button, so the row becomes:

- a `<div class="row">` holding
- `<button class="status">`, whose accessible name is the act it performs, and
- `<button class="body">`, which is the existing control with its existing composed label,
  opening the settle sheet.

`0044`'s comment "one button and not a checkbox" is **amended, not deleted**, and the amendment
is the point: settling a line still asks how many, and that is still the sheet. What this adds
is the answer to the one question the sheet does not need to be opened for, "all of it", which
is the common case in a shop and currently costs a tap, a sheet, a tap and a dismissal.

### 6.3 The four states it draws

| Line state | Glyph | Tap does |
| ---------- | ----- | -------- |
| `wanted` | empty circle | settle the whole outstanding amount as `BOUGHT` |
| `partly` | part filled circle | settle the remaining outstanding amount as `BOUGHT` |
| `done`, `lastOutcome` `BOUGHT` | check | reopen the line (luna `0054` section 3) |
| `done`, `lastOutcome` `NOT_AVAILABLE` | a distinct mark, not a check | reopen the line |

The last two rows are the halves of the report's "bought or pending". The fourth state exists
for the reason `touchedCaption` has a separate sentence for it: `NOT_AVAILABLE` closes the
outstanding amount exactly as a purchase does, so a check on it would claim a purchase that
never happened.

**The glyphs are components in `libs/shared/ui`**, one per state, following the existing icon
pattern there. Check `libs/shared/ui/src/lib` before adding any of them: `save-icon`,
`close-icon` and `edit-icon` exist unexported as internals of `in-place-crud`, and reuse means
exporting one rather than adding a second copy of the same glyph.

**Never colour alone** (`0044` section 7). Each state is a different shape, and the accessible
name says which it is.

### 6.4 What a tap sends

The settle direction reuses what the sheet's primary button sends: `BasketStore.settle(lineId,
{ outcome: 'BOUGHT' })`, no quantity, which is "the whole outstanding amount" (luna `0051`
section 6). It does **not** open the allocation pane, and it does not ask about zones: it is the
one tap gesture, and the system allocates oldest origin first exactly as it does when the sheet
sends the same body.

The reopen direction is `BasketStore.reopen(lineId)`, new, over luna `0054` section 3.2.

Both go through `_write`, so the row is busy while the request is out and `aria-busy` is already
handled. Both can produce a skipped origin report, which the row **cannot** draw: the report is
a paragraph, and it belongs on the sheet. A row write that comes back with `skippedCount > 0`
opens the settle sheet on that line, which is where `0051` section 6.4's sentence already lives.

### 6.5 Where it is not drawn

Nowhere. Every participant may settle and every participant may reopen (luna `0054` section
3.5), so there is no reader for whom this control is drawn and refused, and no `@if` guarding
it. That is the same absence rule the "from" caption follows: the data decides, and here the
data says everybody.

## 7. A finished line is not offered two buttons that fail

### 7.1 The two reports are one bug

The settle pane draws, unconditionally:

```
{{ 'basket.settle.all' | rokuT: { count: outstanding() } }}    <!-- "Got all 0" -->
{{ 'basket.settle.none' | rokuT }}                             <!-- "They had none" -->
```

A finished line is still tappable, deliberately: `0043` section 3.2 keeps it in place so
somebody can look at what they bought. So the sheet opens with `outstanding() === 0`, the
plural rule picks `all_other`, and the button reads **"Got all 0"**. Pressing either button
sends a settle that core refuses, because `generated-list-settle.service.ts` throws when
`outstanding === 0`.

**A control you may not use is not drawn** (`0030`). On a line with nothing outstanding the
settle pane draws neither settle target, neither `Got all` nor `They had none`, and neither the
partial nor the allocate control, which are already conditional on `outstanding() > 1` and would
have gone anyway.

What it draws instead:

- **What happened**, in one line: the same sentence `touchedCaption` already composes for the
  row, so the sheet and the row cannot disagree.
- **The product**, and its change control, unchanged. Swapping the pick on a finished line is a
  correction of the record and is still allowed.
- **The history control**, unchanged, for a reader entitled to it.
- **The reopen control**, once luna `0054` section 3 lands, which is the sheet's copy of section
  6's status control and the only way a person who opened the sheet by mistake gets back to a
  line they can settle.

### 7.2 The failure gets a sentence

`settle-sheet.html` ends with one `@if (failed())` drawing `basket.settle.failed`, "That did not
save. Try again.", for every failure the screen can suffer. That is the second half of the
report: the backend said something specific and the screen said nothing.

**A `basket-error-copy.ts`, in the shape of `list-error-copy.ts`**, keyed on the code **and the
operation**, because `forbidden` and `conflict` each mean several things on this screen:

```ts
export type BasketOperation =
  | 'basket.read'      // loading, refreshing
  | 'basket.settle'    // settle all, settle some, allocate, not available
  | 'basket.reopen'    // section 6
  | 'basket.pick'      // swapping the product
  | 'basket.share'     // minting, revoking
  | 'basket.people';   // removing somebody
```

The rows that matter:

| Code | Operation | Says |
| ---- | --------- | ---- |
| `conflict` | `basket.settle` | this line is already finished (luna `0054` section 4) |
| `validation_failed` | `basket.settle` | the same sentence, for a backend before `0054` |
| `forbidden` | `basket.settle`, `basket.reopen` | your access to one of these lists changed |
| `forbidden` | `basket.share`, `basket.people` | only the owner can do that |
| `not_found` | any | this list is no longer here |
| `rate_limited` | any | that was too quick, try again in a moment |
| anything else | any | the generic sentence, with the correlation id beside it |

**`unauthorized` is not in the table.** `BasketStore._fail` already turns a 401 into the
`revoked` or `needsJoin` state, which is a screen rather than a sentence, and that stays where
it is.

The sheet reads the code from `BasketStore.error`, which already holds the last failure and is
already exposed. `correlationIdOf` is reused from `list-error-copy.ts` rather than copied.

### 7.3 The server's own message is not the copy

`GatewayError.serverMessage` carries a localized string, and it is not used, for the reason
`zone-error-copy.ts` sets out at length: the gateway's catalog gives every code one message, so
it reads identically for every conflict in the product. The table above is this screen's copy,
and the server's message stays what it is, a fallback for a code nothing has a row for.

## 8. The history control

Two changes, both to the same control:

- **`text-decoration: underline` comes off `.link`** in `settle-sheet.scss`. It is a button, it
  is already `--app-action-quiet-fg` against `--app-text-secondary` copy, it is already a full
  width row with a 44px target, and nothing else in this app underlines a control. The
  underline was borrowed from the shape of a hyperlink for something that is not one.
- **`basket.history.open` becomes "Show line history"** in `en.json`, and its Spanish takes the
  matching imperative in `es.json`. "What happened to this line" is a question, and a control
  labelled with a question reads as the thing being asked rather than the thing that answers it.
  `basket.history.title`, the pane's own heading, keeps "What happened here": a heading may
  describe, and it is the sentence that makes the pane make sense once it is open.

While the pane is being edited, luna `0054` section 3.3 adds `revertedAt` to a settlement.
**A reverted row stays in the history, marked**, and does not disappear: the whole reason to
open this pane is to reconcile two people's trips, and a purchase that was taken back is part of
that. It draws the same sentence with a quiet qualifier, in `--app-text-muted`, and never a
strikethrough, which reads as deleted rather than as reversed.

## 9. The back button has a hover nothing else has

`basket-page.scss` gives `.back`, `.share` and `.people` one rule, and that rule has a `:hover`.
Every other back control in the app has none: the `page.back` mixin in `_list-page.scss`,
`_zone-page.scss`, `_account-page.scss` and `_install-page.scss` sets a focus ring and stops,
and the hand written ones on the line page, the assistant page and this library's own shopping
lists page do the same.

**`.back` splits out of the shared rule and loses the `:hover`.** `.share` and `.people` keep
theirs: they are actions in the bar rather than the way out of it, and a hover on an action is
not the thing that was reported.

There is no wider rule to write down here. A back control in this app is drawn quiet and reacts
only to focus, and the basket's was the one that did not.

## 10. Delivery, and what each half looks like alone

**Nothing in this plan waits on luna `0054`, and `0054` ships nothing this screen needs before
it.** The three that touch it degrade rather than break:

- **Section 2.2**: with no `username` on the wire, `participantName` falls through to the role
  word exactly as it does today. The reordering is written first and turns on by itself when the
  field appears.
- **Section 6**: with no reopen route, a `done` row's status control is drawn as a **state
  indicator and not a button**, which is the absence rule again: it says what the line is, and
  it does not offer an act that would 404. The settle direction works in full from the first
  commit and is most of the value.
- **Section 7.1**: independent of the backend entirely. It is what stops the failing request
  being sent at all, so it is worth landing before either.

A reasonable order: sections 3, 5, 8 and 9 first, since they are four declarations and clear
four of the ten reports in one commit; then 4, which is a reordering and a mixin move; then 7,
which is the sharpest defect; then 2 and 6, which are the two that read best once `0054` is in.

## 11. What the specs assert

Following `0050`'s inventory for this screen, and adding to it rather than replacing it:

- `basket-labels.spec.ts`: `participantName` prefers `username` over the role word, and prefers
  `displayName` over `username`; `touchedCaption` names the reader by `ownName` and never by
  "you"; a guest with a number is still `Guest N`.
- `people-sheet.spec.ts`: the reader's own row draws their name, and a marker beside it.
- A settle sheet spec: a line with zero outstanding draws no settle target, and does draw what
  happened; a `conflict` on a settle draws the already finished sentence rather than the
  generic one.
- A share sheet spec: the revoke pane's first footer control is the cancel.
- A basket line row spec: the status control's accessible name matches the act for each of the
  four states, and the row's own button still carries the composed label.
- `basket-error-copy.spec.ts`, in the shape of the existing error copy specs: every
  `BasketOperation` has an answer for every `ErrorCode`, and no answer is the empty string.

`no-unguarded-history-back.spec.ts` and the sheet URL assertions in `routes.spec.ts` are
untouched by all of this: no route moves and no `.back()` is added.
