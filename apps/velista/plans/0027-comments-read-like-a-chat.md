# 0027: comments read like a chat, and the composer stays put

> Written after the fact, from commit `f56bf36`. The work is on `dev`; this plan records
> the design it was built to rather than the one it was built from.
>
> Prerequisite reading: `0012` (the list page) for the column and the composer, and
> `0018` section 4 for how a comment reaches the sheet over the socket.
>
> Two defects on two surfaces, reported together because they are the same complaint from
> a reader's side: the newest thing is not where the eye is.

## 1. The report

Open the comments on a line and the conversation is upside down. The most recent thing
anybody said is the first row, the beginning of the exchange is at the bottom, and the
view opens on the oldest line of it. Every chat the reader has ever used does the
opposite, so the sheet has to be read backwards to be understood at all.

And on the list page itself, the field for adding a line does not stay at the bottom of
the screen. On a short list it sits mid screen with nothing under it. On a long one it
scrolls away with the document. Both only happen in the standalone build; mounted in the
portfolio shell the same page is fine, which is the detail that says what the cause is.

## 2. The sheet: the wire order is not the reading order

`GET /v1/lines/:id/comments` answers newest first and `LineStore` keeps that order,
correctly: it is the order the next page continues from, so a store that reversed on
arrival would have to un-reverse to paginate.

The reading order is the other one. So `comments` reverses on the way out of the store,
in the computed the template already reads, and nothing about paging changes.

### 2.1 Opening at the end

Reversing alone leaves the sheet open on the oldest line, because a scroll box starts at
the top and nothing in the markup asks it to start anywhere else. The scroller is put at
its end by hand, in an `afterRenderEffect`: the rows have to exist before the element can
be measured, and that hook runs in the browser and never on the server (plan `0001`, D2).

The effect reads `comments().length`, so it runs again when somebody says something,
whether it was typed here or arrived on the socket.

### 2.2 Following, unless somebody is reading

A conversation that always jumps to the bottom takes the scrollbar off a reader who has
gone up to read something older, on the frame the next comment lands. So the effect only
moves the scroller when the reader was already at the newest comment.

Two decisions in that:

- **Within `AT_NEWEST_SLACK_PX` (32px) still counts as the bottom.** Sub pixel scroll
  positions and a partly scrolled row both leave a gap of a few pixels at what any reader
  would call the end.
- **`_atNewest` is a plain field, not a signal.** The render effect reads it, and a
  signal would make every scroll event re-run that effect, which is precisely the
  behaviour the flag exists to prevent.

## 3. The list page: the composer was pinned by accident

The composer was never pinned. It was the last row of a column that happened to be the
scroll container, and whether it is depends on where the app is running.

- **Mounted in the portfolio shell** the height chain above the page is definite: the
  shell's host is a flex container, the app's host is a stretched flex item with a real
  height, `.app-main` resolves its `100%` against it and so does the page's host. The
  column is the scroller and the composer below it does not move.
- **Standalone** nothing above the page sets a height. `block-size: 100%` degrades to
  `auto`, the page is as tall as its contents, and the **document** scrolls. On a short
  list that leaves the field mid screen; on a long one it scrolls away with everything
  else.

Both answers are legitimate, and the app runs in both modes from one route factory
(`app-root-route.ts`), so the page cannot pick one and be right.

### 3.1 Sticky, and a page at least a screen tall

`position: sticky` on the composer is correct under either answer: it floats at the
bottom edge while there is still list below it, and settles into its own place at the end
of the scroll.

**Sticky rather than fixed.** Fixed takes the box out of the flow and leaves the last
line of a full list underneath it forever, with no honest way to reserve the space: the
composer's height is one row of text plus whatever the safe area inset is on this device.
Sticky keeps it in the flow, so at the end of the scroll the newest line sits directly
above the field rather than behind it.

Two supporting rules:

- `min-block-size: calc(100dvh - var(--app-safe-bottom))` on the host, so a two item list
  still puts the composer at the bottom of the screen. The inset subtracted is the one
  between the viewport and this page, `.app-main`'s bottom safe area, which keeps a
  notched phone from gaining a document scroll the height of its home indicator. Mounted
  in the shell the percentage resolves and is already at least this, so the minimum never
  binds.
- `display: block` on the component host, set by the page and not by the component. A
  component host is an inline box until something says otherwise, and `sticky` on an
  inline box is ignored. Setting it here means nothing else that renders a composer
  changes shape because this page needed one pinned.

### 3.2 Scrolling to the line just entered

Adding a line scrolls to the end of the list, so the row just typed is the one above the
field. Three decisions:

- **Ask which element scrolls, do not assume.** `_scrollToNewest` uses the column when it
  overflows and the document's scrolling element otherwise, for the reason in section 3.
- **Scroll to the very end, not the new row into view.** At the end of the scroll the
  sticky composer has settled into the flow; anywhere short of it the composer floats
  over the last few pixels of the column and the row that was revealed is the row behind
  it.
- **Only for this reader's own adds.** Somebody else's line arriving over the socket
  leaves the scroll alone. Moving the page under a thumb reaching for a row is how the
  wrong thing gets ticked off in an aisle.

`_added` is a **counter**, not a flag: entering six things in a row is the ordinary case
here, and a boolean that is already `true` does not change, so the effect would fire for
the first item and never again. It is bumped **before** the call, because `addLine` puts
the optimistic row on screen synchronously, so the row and the scroll land in one change
detection pass rather than a round trip apart.

## 4. Acceptance

1. The comments sheet reads oldest to newest and opens on the newest line.
2. A comment arriving over the socket scrolls into view for a reader who was at the
   bottom, and does not move the scrollbar of a reader who is further up.
3. Paging older comments is unaffected: the store's order and the cursor are unchanged.
4. Standalone, the composer is at the bottom of the screen on a two item list and on a
   fifty item list, and does not scroll away.
5. Mounted in the shell, the page is unchanged in both cases.
6. Adding a line puts it directly above the composer, in both run modes, with no
   animation between typing one item and the next.
7. A line added by somebody else does not move the reader's scroll position.
