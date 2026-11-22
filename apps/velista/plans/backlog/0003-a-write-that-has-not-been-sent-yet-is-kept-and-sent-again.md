# 0003 (backlog) a write that has not been sent yet is kept and sent again

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Raised on 2026-11-22. In the owner's words: in a supermarket the connection drops in
> places, above all beside the big refrigerators, and a person who leaves a page or the app
> while a request is pending can lose the change. The over-bought question of velista `0207`
> made it visible, because it opens only after a save answers. The owner analyses this
> further before any development. This file only records the problem and a direction.

## The problem

Today a write lives in the page that made it, and in the tab's memory. The list page gathers
presses into runs and sends each run once, after the quiet beat, at destroy or when the page
is hidden (`libs/velista/platform/src/lib/quantity-runs.ts`). `LineStore.addQuantity`
(`libs/velista/data-access/src/lib/lines/line-store.ts:933`) patches the row at once and
snaps it back when the request fails. A write that the network dropped is written to
`sessionStorage` for the list page's next document (`libs/velista/data-access/src/lib/mutations.ts:108`,
velista `0159`), so it dies with the tab and only that page offers to send it again. A
request that is still pending when the app is closed, or that fails after the person left
the page, can thus be lost with no trace.

## Why not block leaving

- The browser's leave prompt (`beforeunload`) works on desktop browsers only.
- On a phone, an installed app and the Android app can be closed with no prompt.
- To block navigation inside the app punishes the shopper when a request hangs: the person
  stands at the shelf and cannot move on.

## The direction proposed (not decided)

An outbox:

- Every write goes into a queue that lives above the pages, not in the page that made it.
- The queue is kept on the device, so it survives a closed app and is sent at the next
  start.
- It sends again when the connection returns.
- A small permanent sign says how many changes are not sent yet.
- On desktop browsers the leave prompt stays as a last net while the queue is not empty.
- A write that arrives late and no longer fits is refused by the guards the backend already
  has, and the person gets the existing overwritten notice.

## Open questions for the analysis

- Which writes go in the queue, and which must stay online only (a settle, a buy).
- How long a queued write may wait before it is dropped.
- What the person sees when a write sent again is refused after a long gap.
- The order of queued writes on one line, and whether two of them merge into one.
- The service worker and the lifecycle of the Android app: can a write be sent in the
  background?
- What the questions that follow a save (velista `0207`) do when the answer comes at the next
  start, on another page or none.

## Not in this plan

No decision, no mock and no code.
