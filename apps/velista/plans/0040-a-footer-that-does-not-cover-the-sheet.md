# 0040: a footer that does not cover the sheet

> **A sheet's buttons belong under its content, not on top of it.** The settings sheet's
> Save and Cancel are stuck to the bottom of a panel that scrolls behind them, so at every
> scroll position except the last one they are painted over rows the reader is trying to
> read. `SheetShell` gains a footer of its own, outside the scroll, and the two sheets that
> want one use it.
>
> Second, smaller: the row menu's entry for a line's conversation says "What people said",
> which describes the contents rather than naming the thing it opens. It becomes
> "Comments", and the two sibling strings that borrowed the phrase follow it.
>
> Prerequisite reading: `0036` section 4 (which introduced the sticky footer and is the
> plan being corrected), `0027` (the comments sheet, which has the other half of the same
> defect) and `0012` section 5.5.

## 1. What is wrong

**The footer is `position: sticky`, and sticky does not reserve space where it lands.**
`list-settings-sheet.scss` pins `.footer` to `inset-block-end: 0` inside `.panel`, which is
the element with `overflow-y: auto`. A sticky element stays in the flow at the position it
was written, which is the very end of the panel, and is then pulled to the bottom edge of
the scrollport for as long as its own flow position is below that edge. The space it
reserves is at the end of the document. The pixels it paints are at the bottom of the
window. So on a settings sheet with more than a screen of members, the share rows that
happen to be under the bottom edge are behind an opaque bar with a background of
`--app-surface-raised` and a hairline over them, and there is no scroll position that shows
them: scrolling moves the content and the bar stays.

`0036` section 4 asked for exactly one thing, that Save be on screen at every scroll
position and at every member count, and sticky delivers it. What it also bought was the
overlap, and the overlap is worse on the sheets where the fix was most needed, because
the member list that made Save unreachable is the same content the bar now sits over.

**The comments sheet has the other half of it.** `.comments` is capped at `40vh` with its
own `overflow-y: auto`, which is precisely the nested scroll `0036` section 4 removed from
the settings sheet and for the reason it gave: a scroll inside a sheet that also scrolls has
no good gesture on a phone, because the thumb lands in one of them and the other is
unreachable without knowing which. It is still there because pinning the composer was the
only way to keep it in view, and a cap on the conversation was the only way to pin the
composer without a footer to put it in.

Both are the same missing piece. A sheet has a body that scrolls and a bottom that does
not, and `SheetShell` does not currently offer the second one.

## 2. The panel becomes a column

`SheetShell` today is one element that is both the panel and the scrollport, with the
grabber and `<ng-content />` inside it. It becomes three:

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| the grabber | fixed at the top of the panel, as tall as it already is                   |
| the body    | `flex: 1`, `overflow-y: auto`, everything projected into the default slot |
| the footer  | fixed at the bottom, whatever is projected into a named slot              |

The panel keeps `max-block-size: var(--app-sheet-max-height)` and becomes
`display: flex; flex-direction: column`. The scroll moves off the panel and onto the body,
and `overscroll-behavior: contain` moves with it, because the thing that must not chain a
leftover scroll into the page behind is whichever element actually scrolls.

**A sheet with no footer must render exactly as it does today.** That is the constraint the
whole change is measured against: eleven templates in this app project content into
`SheetShell` and only two of them are getting a footer, so the other nine have to come out
pixel identical. Two details carry that:

- **The padding is on the body, not on the panel.** The panel's inline padding and its
  block-start padding stay where they are; the block-end padding, which today is
  `calc(var(--app-space-7) + var(--app-safe-bottom))`, belongs to whichever element is last.
  With no footer projected that is the body, and it keeps the value. With a footer it is
  the footer's, which is the same arithmetic `list-settings-sheet.scss` does by hand today
  with a negative margin, done once and in the right place instead.
- **The footer is not rendered at all when nothing is projected**, so it contributes no
  border, no background and no height. Angular gives no direct signal for an empty named
  slot, so the shell takes a boolean input, `hasFooter`, defaulted false, and the two
  sheets that project one set it. A one line input is honest and testable; querying
  projected nodes to guess at it is neither.

The grabber leaving the scroll is a change in behaviour and a small improvement: the drag
handle stays reachable when the sheet is scrolled down, which is where somebody who has
just read to the bottom of a long list of members is. Its `touch-action: none` and its
negative margins are unchanged.

### 2.1 The named slot

`<ng-content select="[sheetFooter]" />` in the footer element, `<ng-content />` in the body.
The selector is an attribute rather than an element, so a sheet marks the `div` it already
has instead of learning a new tag, and the ordering rule Angular applies is the useful one:
the selective slot takes the matching node wherever it appears in the caller's template, and
everything else falls to the catch all. The settings sheet's footer can therefore stay
written at the end of its template, where it reads in the order it is drawn.

## 3. What the two sheets do with it

**The settings sheet** moves its `.footer` div into the slot and deletes the whole of the
sticky block: the `position`, the `inset-block-end`, the negative margins that pulled the
panel's padding back, the background and the border, all of which the shell's footer now
owns. What is left is the two buttons and the gap between them.

The delete confirmation keeps borrowing the same footer for its Cancel, and its own
destructive action stays in the body. Nothing about that arrangement changes; it was right
and it is orthogonal.

**The comments sheet** gets the footer it was working around:

- the composer, or the read only line that stands in for it, and the Cancel below it go into
  the slot;
- `.comments` loses `max-block-size: 40vh` and its `overflow-y`, so the conversation is as
  tall as it is and the body scrolls past it;
- the sheet is then one scroll, which is what `0036` section 4 asked for and what this
  sheet could not have until now.

The composer is still always in view, which is the property `0027` wanted and the reason
the 40vh cap existed. It is now in view because it is not in the scroll, rather than because
the thing above it was prevented from growing.

**Sticking to the newest comment moves with the scroll, and this is the part most likely to
be got wrong.** The conversation reads as a chat, oldest at the top and newest at the
bottom, and the sheet keeps the newest in view: `trackPosition` measures how far the list is
from its own bottom and sets `_atNewest`, and an arriving comment sets `scrollTop` to
`scrollHeight` only when it was true. All three of those read the element that scrolls, and
after this change that element is the shell's body rather than `.comments`.

So the `(scroll)` binding and the template reference both move off the `ul` and onto the
body, which means the sheet needs a handle on an element inside `SheetShell`. Two ways to
get one, and the second is the one to take:

- reading it out of the shell with a `viewChild` on the sheet, which reaches through a
  component's template into an element it does not own;
- **`SheetShell` exposing the body**, as a readonly `ElementRef` on its public surface, next
  to the `requestDismiss()` the sheets already call on the same template reference. The
  scroll belongs to the shell now, so the shell is what answers questions about it.

The behaviour is unchanged and only the element it is measured on differs. It is called out
because it fails silently: bound to an element that no longer scrolls, `trackPosition` never
fires, `_atNewest` stays true forever, and the sheet yanks a reader who was scrolled up back
to the bottom every time somebody says something.

## 4. The label

`list.line.comments` is the row menu's entry, and it currently reads "What people said". It
is the only entry in that menu written as a sentence about the contents rather than as a
name for the destination, which is why it reads oddly beside "Change this" and "Take off
the list": those say what pressing them does, and this one describes what you might find.

It becomes **"Comments"**, and "Comentarios" in Spanish. Not "Notes": the sheet it opens is a
thread with authors, timestamps, a composer and, since `0039`, voice messages, which is a
conversation and not an annotation, and `0027` built it to read like a chat on purpose.

Two sibling strings borrowed the same phrase and follow it, because leaving them would make
the product say the thing three ways:

| key                      | today                                             | after                                           |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| `list.line.comments`     | What people said                                  | Comments                                        |
| `list.comments.loading`  | Loading what people said                          | Loading comments                                |
| `list.comments.readOnly` | You can read what people said here, not add to it | You can read the comments here, not add to them |

The sheet's own title, "About {{name}}", is unchanged. It is not a label on a control; it
names the line the conversation is about, which is the one thing somebody who has just
opened it needs to be sure of.

## 5. What is tested

- **A sheet with no footer projects into the body and renders no footer element.** The
  cheapest evidence that the five sheets not touched here were not touched, and the
  assertion most worth having, since a regression in them shows up as a layout change
  nothing else would catch.
- **A projected footer is outside the scrollport**: the body is the element with
  `overflow-y`, and the footer is not inside it.
- **The settings sheet keeps Save reachable** at any member count, which is `0036`'s own
  assertion and has to survive the change to the mechanism.
- **The comments sheet has one scroll**: the conversation element carries no
  `max-block-size` and no `overflow-y` of its own.
- **It still sticks to the newest comment**, and still does not when the reader has scrolled
  up. Both existing assertions, driven through the body rather than through the list, which
  is the whole of what section 3 warns about.
- **The label**: the row menu names the entry `list.line.comments`, and both locale files
  carry the three changed strings. The existing `line-row` specs assert the key rather than
  the words, so they pass unchanged, which is the point of having written them that way.
- The overlap itself is not directly assertable in jsdom, which has no layout. The
  structural assertion, that the footer is not a descendant of the scrolling element, is the
  one that actually holds the property, and it is worth stating in the spec why it stands in
  for the visual one.

## 6. Exit criteria

- No content in the settings sheet is unreachable at any scroll position or any member
  count.
- Save and Cancel are at the bottom of the sheet, always, and nothing passes behind them.
- The comments sheet scrolls in one place, and the composer is still always in view.
- The nine templates with no footer are unchanged, including their bottom padding and their
  safe area inset. The group settings sheet is the obvious next caller, since it has the
  same shape as the list one; it is deliberately not converted here, because it has no
  sticky footer today and therefore none of the defect this plan is about.
- The row menu says "Comments", and no string in the product says "what people said".
