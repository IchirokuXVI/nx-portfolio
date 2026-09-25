> **PR:** [#441](https://github.com/IchirokuXVI/nx-portfolio/pull/441)

# 0093: what changed while you were not looking

> Backend halves: `apps/luna-shopper-backend/plans/0138` (the change log, the cursor, the
> marks, the two routes) and `0139` (the event that reaches every covering basket). Both
> must be on `dev` first, and so must velista `0090`, which owns the models and the store
> this plan draws from. Mock: none exists. Section 4 describes every screen in words, and
> the changes sheet is the one layout the product owner has not seen (action boundaries).
>
> A basket follows its lists now (backend `0130`, section 2), so a line can appear, ask for
> a different amount, take another name or leave while somebody is halfway down an aisle.
> This plan is how the screen says so: a mark on the row, a disabled row where a line left,
> a banner that counts what is new, and a sheet that tells each change in words. The
> window in which a change counts as new belongs to **each viewer** and runs on the
> **server's** clock, so a shopper whose phone was in a pocket for an hour still sees what
> happened. The client holds no clock and no window. It draws what the read says and it
> tells the server when a person has actually looked.
>
> Prerequisite reading: backend `0130` in full (sections 3, 4, 6, 7 and 11 points 10 and 12
> carry this plan), backend `0138` and `0139`, velista `0090`, `0079` sections 2 and 3 (the
> sticky tools bar keeps its height), `0086` section 2 (`refresh()` replaces the whole
> basket, which is why a mark cannot live on the client), `0052` section 6.3 (row states by
> shape, "never colour alone"), and `libs/velista/feature-shopping-lists/src/lib/basket-page/`.

## Brief for the agent

### Objective

Draw the server's per viewer marks on basket rows, the disabled `REMOVED` row, the changes
banner and the changes sheet of sections 3 to 6, and send the acknowledgement of section 7
only when a person has really seen the changes.

### Context

- Velista `0090` leaves `BasketRow` with `rowKey`, `state` (`REMOVED`, `SKIPPED`,
  `NOT_AVAILABLE`, `DONE`, `PARTLY`, `WANTED`), `note` and `mark` (`ADDED`, `CHANGED`,
  `REMOVED` or null), the server's `progress`, a `BasketApi` on `/v1/baskets`, a
  `BasketStore` whose `refresh()` replaces the whole basket behind a generation counter,
  and a refetch on socket reconnect and on `AppResumed`. This plan adds nothing to a row.
  It draws two of its fields.
- The basket page (`basket-page.html`) already has three notices above the list: the
  `.stale` line (lines 129 to 139), the `.finished` banner (157 to 178) and the
  `.prompt` row under the tools (311 to 318). `lib-list-tools` (249 to 299) is one sticky
  bar holding the search, the progress sentence and the chip row.
- `BrowserFacade` (`libs/velista/platform/src/lib/browser-facade.ts`) has a `visible`
  signal fed by `visibilitychange` (line 55). It has no intersection observer.
- Backend `0138` serves `GET /v1/baskets/:id/changes` and
  `POST /v1/baskets/:id/changes/seen`, and puts `mark` on each row of the basket read, for
  the participant who asked. Backend `0139` emits `basket.linesChanged { lineIds }` to the
  basket room. The broadcast carries ids and nothing else (backend `0130`, section 6).
- A purchase somebody else made is **not** a change (backend `0130`, section 11 point 12).
  It moves `left` on the row and it never reaches the banner.

### Target state

Sections 3 to 8 hold at a phone viewport in both themes, the client compares no timestamp
to decide what is new, and
`npx nx run-many -t lint test -p velista/platform velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/` (the change models),
  `libs/velista/data-access/src/lib/` (the change mapper, the change calls on `BasketApi`
  and its memory twin, `BasketChangeStore`, the one new socket event),
  `libs/velista/platform/src/lib/browser-facade.ts` (one method, section 7),
  `libs/velista/ui/src/lib/` (the row mark, the banner, the change entry),
  `libs/velista/feature-shopping-lists/src/lib/` (the basket row, the basket page, a new
  `changes-sheet/` folder, `basket-paths.ts`), `libs/velista/feature-shell/src/lib/routes.ts`
  (one sheet), and the two translation files.
- Do NOT touch: any backend project, the zone list page, the settle sheet, the row
  gestures of velista `0092`, the sharing screens of velista `0094`, `apps/velista-luna-e2e`
  (velista `0096` owns it).

### Constraints

- Load the `nx-portfolio-angular-developer` skill before writing Angular, and the
  `design-taste-frontend` skill for the mark, the banner and the sheet.
- **No clock on the client decides anything here.** No `Date.now()`, no timer that ends a
  mark, no stored "last seen". A mark appears and disappears because a read said so.
- Rule D4: a change is mapped from `unknown` into a model this scope owns, with a fallback
  for an unknown kind. Rule D1: only the page and the sheet inject stores, and `ui`
  components take plain values.
- Zoneless components. Nothing a service provides imports `@angular/core/rxjs-interop`.
- Dates through `Intl`, never `DatePipe`. Tokens only. **Amber is not attention**: a mark
  is a shape and a word, in the accent role, never the warning colour.
- The tools bar keeps its height (velista `0079`, sections 2 and 3). The banner is not
  inside it.
- `BasketChangeStore` is provided on the basket route beside `BasketStore`. Route
  providers are never destroyed, so every observer and listener this plan adds is torn
  down by the routed component or the sheet, never by a `DestroyRef` on the store.
- The memory gateway (`basket-memory.ts` or what velista `0090` renamed it to) learns the
  two change calls and the marks in the same commit as the real client.
- Icons are components in `libs/shared/ui`. Check the directory listing before adding one.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs and a front end slot pointed at a backend that has
  `0138` and `0139`.
- Stop and ask if either backend plan is not on `dev`, if the basket read carries no
  count of unseen changes or the changes read carries no per entry "new to you" flag
  (section 2 needs both from the server and must not rebuild them), or before settling
  the layout of the changes sheet: draw it as a mock in `apps/velista/plans/mocks/basket-changes/`
  first and show the product owner.

### Progress evidence

Report after the models and the store with their specs, after the row mark and the
`REMOVED` row, after the banner, after the sheet, and after the acknowledgement with the
spec that proves a hidden tab sends nothing. Each report names the run.

### Session strategy

One session. The acknowledgement (section 7) is small and is the part that is easy to get
subtly wrong, so build it last, against a slot, with the page really hidden and shown.

## 1. What is being built

| Piece                                          | Where                                                          |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `BasketChange`, its kinds, its mapper          | `models`, `data-access/src/lib/mapping/`                       |
| `changes()` and `acknowledgeChanges()`         | `BasketApi`, `BasketServiceI`, the memory twin                 |
| `BasketChangeStore`                            | `data-access`, beside `BasketStore`                            |
| `basket.linesChanged`                          | the basket socket's event map, handled by `BasketStore`        |
| The mark on a row, the `REMOVED` row           | `basket-line-row.*`                                            |
| `lib-changes-banner`                           | `libs/velista/ui/src/lib/basket/`                              |
| `lib-change-entry`                             | the same folder                                                |
| `ChangesSheet` at `…/sheet/changes`            | `feature-shopping-lists/src/lib/changes-sheet/`, `routes.ts`   |
| `BrowserFacade.observeIntersection`            | `platform`                                                     |
| `ChangeAcknowledger`                           | `feature-shopping-lists/src/lib/basket-page/`                  |
| Copy                                           | `en.json`, `es.json`                                           |

## 2. Models and data access

```ts
export const BASKET_CHANGE_KINDS = [
  'ADDED',
  'QUANTITY_CHANGED',
  'RENAMED',
  'MERGED',
  'DELETED',
  'APPROVAL_CHANGED',
  'UNKNOWN',
] as const;
export type BasketChangeKind = (typeof BASKET_CHANGE_KINDS)[number];
export const BASKET_CHANGE_KIND_FALLBACK: BasketChangeKind = 'UNKNOWN';

/**
 * Who made a change, as backend `0138` section 8 serves it: a participant of this basket, or
 * an account the reader can already resolve because they can write the list. Core serves no
 * name. The mapper resolves one from what the client holds: `basket.participants` for a
 * participant id, the zone's members for a user id, and null when neither knows the person.
 */
export interface BasketChangeActor {
  readonly participantId: string | null;
  readonly userId: string | null;
  readonly name: string | null;
}

export interface BasketChange {
  readonly id: string;
  readonly kind: BasketChangeKind;
  /** The row this line is in now, or null when it is gone. The wire serves no line id. */
  readonly rowKey: string | null;
  readonly contentBefore: string | null;
  readonly contentAfter: string | null;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly approvalBefore: LineApprovalStatus | null;
  readonly approvalAfter: LineApprovalStatus | null;
  /**
   * The text of the line a merge folded this one into. Not on the wire: it is the `content`
   * of the row `rowKey` names, read from the store when the change is mapped, and null when
   * that row is not in the basket any more.
   */
  readonly mergedIntoContent: string | null;
  /** Null when the reader is not entitled to know (backend `0130`, section 6). */
  readonly actor: BasketChangeActor | null;
  /** The wire serves `listId` only to a reader who holds `WRITE` there. Resolved against `basket.lists`. */
  readonly list: BasketListRef | null;
  readonly at: Date;
  /** The server's answer to "is this new to this viewer". Never computed here. */
  readonly unseen: boolean;
}

export interface BasketChangePage {
  readonly items: readonly BasketChange[];
  readonly nextCursor: string | null;
}
```

- The kinds are backend `0138`'s. The list above is what this plan has a sentence for. The
  mapper turns any other value into `UNKNOWN`, which draws `basket.changes.entry.unknown`
  and never throws.
- The wire names are the backend's. The mapper in `data-access/src/lib/mapping/` reads
  them from `unknown`, refuses an entry with no id, no line id or no date, and drops a
  refused entry from the page without failing the page.
- `Basket` gains one number from the read, `unseenChangeCount`, mapped as `0` when absent.
  It is the banner's whole input.
- `BasketServiceI.changes(basketId, cursor?)` is `GET /v1/baskets/:id/changes` and
  `BasketServiceI.acknowledgeChanges(basketId, through)` is
  `POST /v1/baskets/:id/changes/seen` with `{ through }`, the id of a change. Both go out
  with the participant credential every basket call uses, so a guest can call both.
- **`BasketChangeStore`**: signals `changes`, `state` (`idle`, `loading`, `ready`,
  `failed`), `nextCursor`, and the methods `load()`, `loadMore()`, `acknowledge(through)`
  and `reset()`. `load()` carries the generation counter velista `0086` gave
  `BasketStore.refresh()`, so an answer a newer request overtook is dropped.
  `acknowledge()` is fire and forget with one retry, and on success it asks
  `BasketStore.refresh()` once, quietly, so the count and the marks are the server's new
  answer and not a local guess.
- **`basket.linesChanged`** is added to the basket socket's event map and handled in
  `BasketStore` by the debounced refetch velista `0090` already owns. Nothing else happens
  on that event: no mark is set locally, no count is bumped, the sheet is not reloaded
  unless it is open, in which case `BasketChangeStore.load()` runs after the same quiet.

## 3. The mark on a row

A row whose `mark` is `ADDED` or `CHANGED` is an ordinary, fully working row with one
addition: a small tag at the trailing end of its name line, `lib-tag` if velista already
has one (check `libs/velista/ui/src/lib/` first), else a span styled from the accent role.

- `ADDED` reads "New". `CHANGED` reads "Changed". The tag is text with a leading dot, so it
  survives a monochrome screen (velista `0052` section 6.3).
- The tag is part of the row button's accessible name, after the line's name:
  "Milk, new on the list".
- Nothing about the row moves. The order is the server's (backend `0130` section 10), and a
  marked row is not lifted to the top, because a list that rearranges under a thumb is the
  thing velista `0053` section 7 refused.
- A rename merge arrives as **one** `CHANGED` row, the survivor. The absorbed line is not
  a `REMOVED` row, because backend `0138` records the merge as `MERGED` and marks the
  survivor. If a build ever shows a removed row after a merge, the defect is on the
  server and this plan does not paper over it.

## 4. The `REMOVED` row

`state === 'REMOVED'` (backend `0130`, section 4): every entry of the row left the
coverage and this viewer still has a mark for it. The server sends the row. The client
does not keep it alive.

- **Drawn in place**, where the server's order puts it, at the ordinary row height, so the
  list does not jump when it arrives or when it leaves.
- **Fully disabled.** No reel, no status control, no price, no chevron. The row is not a
  button and opens no sheet. Its name is struck through **and** followed by the words "No
  longer on the list", because a strike alone is colour and shape with no sentence.
- **Not focusable as a control**, and still readable: the row is a plain `li` with text,
  so a screen reader reads "Milk. No longer on the list." in document order, and the Tab
  key passes it by.
- **Counted nowhere.** The progress sentence and the pending number are the server's
  `progress`, which already excludes `REMOVED` rows (backend `0130` section 4), and this
  plan never recounts (velista `0060` section 4). Two client counts need care because they
  count array elements today: the tools bar's `[total]` and `[shown]`
  (`basket-page.html:254` and `:255`) and the chip row's counts. Both take
  `rows.filter((row) => row.state !== 'REMOVED')`, in one selector, named
  `countableRows`, used by every count on the page.
- **Search and filters** treat it as any row: a search that does not match hides it, and a
  list filter hides it with its list. "All done" (`allSettled`) ignores it.
- It leaves when the server stops sending it. No animation is owed. A row that fades out
  under a thumb is a row somebody tried to tap.

## 5. The banner

`lib-changes-banner`, inputs `count: number`, output `opened`. Drawn by `BasketPage` when
`basket.unseenChangeCount > 0`, **directly under `lib-list-tools` and above the
`.prompt` row**, inside the scroll and outside the sticky bar. The bar's height is
untouched (velista `0079`).

- One row: a dot, the sentence `basket.changes.banner` ("3 changes on your lists"), and a
  trailing chevron. The whole row is one real `button`.
- `role="status"` on a wrapper around the button, so the count is announced politely when
  it appears or changes, once per change of number, and not on every redraw.
- It opens `…/sheet/changes` through `sheetSegments()`.
- It is drawn on a finished basket too, with the same count, because what changed is
  still worth reading. It is never drawn in the `revoked`, `failed` or `loading` states.
- It disappears when the server says the count is zero, which happens on the refresh
  that follows an acknowledgement (section 7). Never by a local decrement.

## 6. The changes sheet

Route: `sheet('changes', …)` under `shopping-lists/:generatedListId` and under whatever
route velista `0091` gives the live basket, in `libs/velista/feature-shell/src/lib/routes.ts`.
Opened with `sheetSegments('changes')`. Cancel, the scrim and Escape call
`SheetNavigation.dismiss(basketUrl)`, the basket being the fallback.

- **Title**: "What changed". Under it, for a guest or a reader with no list refs, nothing
  more. For a reader with refs, each entry can name its list.
- **Body**: `BasketChangeStore.changes`, newest first, one `lib-change-entry` each.
  `load()` runs when the sheet opens. "Show more" appears while `nextCursor` is not null
  and keeps focus where it was, announcing how many arrived through a polite status
  element, the pattern of velista `0088` section 10.
- **An entry** is two lines. The first is the sentence of the table below. The second is
  muted: who, which list, and when, each part present only when served. The date is
  `Intl.DateTimeFormat` with `dateStyle: 'medium'`, `timeStyle: 'short'` in the reader's
  locale, formatted into the view model and never in the template.
- An entry with `unseen: true` carries the same "New" tag a row does. That flag is the
  server's. The sheet computes nothing from `at`.
- **States**: `loading` draws three skeleton entries at the entry's height. `failed`
  draws `basket.changes.failed` and a retry. An empty page draws `basket.changes.empty`.
- An entry is not a button. It opens nothing. A change is a fact, and the row it is about
  is one dismiss away.

| Kind               | Sentence (English)                                                       |
| ------------------ | ------------------------------------------------------------------------ |
| `ADDED`            | "Milk" was added, asking for 2                                           |
| `QUANTITY_CHANGED` | "Milk" asks for 3 instead of 2                                           |
| `RENAMED`          | "Leche" is now called "Milk"                                             |
| `MERGED`           | "Leche" was merged into "Milk"                                           |
| `DELETED`          | "Milk" was removed                                                       |
| `APPROVAL_CHANGED` | to `PENDING`: "Milk" is waiting for approval again. To `REJECTED`: "Milk" was turned down. To `APPROVED`: "Milk" was approved |
| `UNKNOWN`          | "Milk" changed                                                           |

The name printed is `contentAfter`, falling back to `contentBefore`. A `QUANTITY_CHANGED`
to zero reads "is no longer needed", because "asks for 0 instead of 2" is a number nobody
says out loud.

## 7. The acknowledgement

**The rule.** `POST /v1/baskets/:id/changes/seen { through }` is sent when, and only when,
a person has had a change in front of their eyes:

1. The document is visible (`BrowserFacade.visible()` is true), **and**
2. either at least one marked row (`mark !== null`) intersects the viewport by half its
   height, or the changes sheet is open with at least one entry drawn, **and**
3. both have stayed true for `CHANGE_SEEN_DWELL_MS`, 1500 milliseconds, a constant beside
   the acknowledger. A dwell is a display debounce and not a rule about what is new, so a
   timer is allowed here and nowhere else in this plan.

`through` is the id of the **newest change that was rendered** when the dwell ended: the
first entry of the sheet if the sheet is open, else `basket.newestUnseenChangeId` as the read
that drew the marked rows served it. It is never "now" and never a timestamp, so a change
that arrives between the render and the request stays unseen (backend `0130` section 13:
a cursor never carries a timestamp).

**Where it lives.** `ChangeAcknowledger`, a plain class provided by `BasketPage` itself
(`providers` on the component, not on the route), so it dies with the page. It takes
`BrowserFacade`, `BasketStore` and `BasketChangeStore`.

- `BrowserFacade` gains
  `observeIntersection(element, callback, options): () => void`, which returns the
  teardown and is a no operation on the server. The basket row registers itself through a
  small directive, `libSeenTarget`, only while its row is marked.
- The acknowledger sends at most one request per distinct `through`. After a success it
  calls `BasketStore.refresh()` once.
- **It never runs from a refetch.** A refetch caused by the socket, by a reconnect or by
  `AppResumed` changes what is drawn. It is the intersection and the visibility that
  decide, afterwards, whether a person saw it. A service worker never sends it: the call
  exists only in the page.

**The failure modes, and why each is the safe way to be wrong:**

| What happens                                               | Result                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| The request is lost, the phone is offline                  | The marks stay and the banner stays. One retry, then silence until the next dwell. |
| The tab is hidden the whole time                           | Nothing is sent. Everything is still new when the person comes back.   |
| The marked rows are below the fold and never scrolled to   | Nothing is sent for them. The banner still counts them.                |
| The person opens the sheet and closes it at once           | Under the dwell, nothing is sent.                                      |
| Two devices of one account                                 | The viewer is the participant (backend `0130` section 11 point 10). Seeing it on one clears it on the other at its next read. Accepted. |
| A change lands while the request is in flight              | `through` names the older change, so the new one stays unseen.         |

## 8. Every way a viewer comes back

The client has no memory of what was new, so every path is the same path: read the
basket, draw what it says.

| The viewer…                                     | What the client does                                   | What the server answers                                                        |
| ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| cold starts the app on the basket               | `BasketStore.load()`                                   | rows with marks for every change after this participant's cursor, and the count |
| reloads the page                                | the same                                               | the same marks as before the reload, because nothing was acknowledged by it    |
| was offline for an hour, then the socket returns | the reconnect refetch of velista `0090`               | everything that happened in that hour, marked                                  |
| had the phone in a pocket, the app resumes      | the `AppResumed` refetch of velista `0090`             | the same                                                                       |
| opens the basket on a second device             | `BasketStore.load()`                                   | the participant's cursor, so what the first device acknowledged is already seen |
| acknowledged, then looks again inside the window | any read                                              | the marks are still there, until the server's mark window after the acknowledgement ends |
| is a guest whose link visit ended and who joined again | a new participant                                | a new cursor. Nothing is marked from before they joined.                       |
| looks at a finished basket                      | `BasketStore.load()`                                   | marks as for any basket. A finished basket covers no new change.               |

None of the rows reads a clock on the device.

## 9. Copy

Under `basket` in `libs/velista/ui/assets/i18n/en.json` and `es.json`.

| Key                                   | English                                        | Spanish                                              |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `basket.mark.added`                   | New                                            | Nueva                                                |
| `basket.mark.changed`                 | Changed                                        | Cambiada                                             |
| `basket.mark.addedLabel`              | {{name}}, new on the list                      | {{name}}, nueva en la lista                          |
| `basket.mark.changedLabel`            | {{name}}, changed                              | {{name}}, ha cambiado                                |
| `basket.line.removed`                 | No longer on the list                          | Ya no está en la lista                               |
| `basket.changes.banner_one`           | {{count}} change on your lists                 | {{count}} cambio en tus listas                       |
| `basket.changes.banner_other`         | {{count}} changes on your lists                | {{count}} cambios en tus listas                      |
| `basket.changes.title`                | What changed                                   | Qué ha cambiado                                      |
| `basket.changes.loading`              | Loading what changed                           | Cargando los cambios                                 |
| `basket.changes.failed`               | That would not load                            | No se ha podido cargar                               |
| `basket.changes.retry`                | Try again                                      | Reintentar                                           |
| `basket.changes.empty`                | Nothing changed on your lists lately           | No ha cambiado nada en tus listas últimamente        |
| `basket.changes.more`                 | Show more                                      | Ver más                                              |
| `basket.changes.loaded_one`           | {{count}} more change loaded                   | {{count}} cambio más cargado                         |
| `basket.changes.loaded_other`         | {{count}} more changes loaded                  | {{count}} cambios más cargados                       |
| `basket.changes.close`                | Close                                          | Cerrar                                               |
| `basket.changes.entry.added`          | “{{name}}” was added, asking for {{count}}     | Se ha añadido «{{name}}», con {{count}}              |
| `basket.changes.entry.quantity`       | “{{name}}” asks for {{after}} instead of {{before}} | «{{name}}» pide {{after}} en vez de {{before}}  |
| `basket.changes.entry.notNeeded`      | “{{name}}” is no longer needed                 | «{{name}}» ya no hace falta                          |
| `basket.changes.entry.renamed`        | “{{before}}” is now called “{{name}}”          | «{{before}}» ahora se llama «{{name}}»               |
| `basket.changes.entry.merged`         | “{{before}}” was merged into “{{name}}”        | «{{before}}» se ha unido a «{{name}}»                |
| `basket.changes.entry.deleted`        | “{{name}}” was removed                         | Se ha quitado «{{name}}»                             |
| `basket.changes.entry.pendingAgain`   | “{{name}}” is waiting for approval again       | «{{name}}» vuelve a esperar aprobación               |
| `basket.changes.entry.rejected`       | “{{name}}” was turned down                     | «{{name}}» se ha rechazado                           |
| `basket.changes.entry.approved`       | “{{name}}” was approved                        | «{{name}}» se ha aprobado                            |
| `basket.changes.entry.unknown`        | “{{name}}” changed                             | «{{name}}» ha cambiado                               |
| `basket.changes.entry.by`             | {{who}}                                        | {{who}}                                              |
| `basket.changes.entry.inList`         | in {{list}}                                    | en {{list}}                                          |

Reuse `basket.history.you` and `basket.history.someone` for the actor. Plural forms follow
what the translator already does for `basket.share.joinedWith_one`.

## 10. Accessibility

- The banner's wrapper is `role="status"`. Its button's name is the sentence, count
  included. The dot is `aria-hidden`.
- A marked row's tag is inside the row button's name (section 3). It is not a second
  focus stop.
- A `REMOVED` row is text in the list, read in order, with no `aria-disabled` control
  left inside it. It is not `aria-hidden`: the reason it is there is that somebody has to
  be told.
- The sheet takes the panel focus velista `0081` made the default. Its entries are a
  list (`ul`, `li`). "Show more" keeps focus and announces through the status element.
- Motion: none is added. The banner appears and disappears without animation, because an
  announcement and a layout shift at once is two interruptions.

## 11. Realtime

One new event, `basket.linesChanged`, handled as section 2 says. No payload field is
read beyond what `BasketStore` needs to decide that a refetch is owed, which is nothing.
The refetch is the one velista `0090` debounces, so a burst of edits by somebody tidying
a list at home costs one read.

## 12. Not in this plan

- The row gestures, skip and the composer: velista `0092`.
- A purchase by another shopper as a banner entry. Decided against (backend `0130`
  section 11 point 12).
- Marks on the zone list page. The list page shows the list itself.
- A push notification for a change.
- The e2e journeys for marks: velista `0096`.

## 13. Tests

1. The change mapper refuses an entry with no id, line id or date, maps an unknown kind
   to `UNKNOWN`, keeps `list` and `actor` null when absent, and never throws on a page
   with one bad entry.
2. `unseenChangeCount` maps to `0` when absent. The banner is drawn above zero and not at
   zero, under the tools bar, and the bar's measured height is the same with and without
   it.
3. A row with `mark: 'ADDED'` and one with `'CHANGED'` draw their tags and their
   accessible names. Neither moves in the order.
4. A `REMOVED` row has no button, no spinbutton and no link inside it, is reachable by a
   screen reader query for its text, and is skipped by Tab.
5. `countableRows` leaves `REMOVED` rows out of the tools bar's `total` and `shown` and
   out of `allSettled`. The progress sentence is the server's numbers untouched.
6. Each kind draws its sentence in both languages, `QUANTITY_CHANGED` to zero draws "no
   longer needed", and `APPROVAL_CHANGED` picks its sentence from `approvalAfter`.
7. The sheet: loading, failed with retry, empty, a second page that keeps focus, and an
   overtaken `load()` answer that is dropped.
8. **The acknowledgement.** With a fake `BrowserFacade`: visible and a marked row
   intersecting for the dwell sends one request with the newest rendered id. Hidden sends
   nothing. Visible with no marked row on screen sends nothing. A refetch alone sends
   nothing. The same `through` is never sent twice. A failure retries once and leaves the
   marks. A success calls `refresh()` once.
9. `basket.linesChanged` three times in a burst causes one refetch and sets no mark
   locally.
10. `no-rxjs-interop-in-the-live-basket.spec.ts`, `no-unguarded-history-back.spec.ts`,
    `token-hygiene.spec.ts` and `routes.spec.ts` stay green, and `routes.spec.ts` sees the
    new sheet under the `sheet` marker.
11. A spec that greps this plan's new files for `Date.now` and `new Date()` outside the
    mapper and fails on a hit, so the "no clock" rule is held by a test and not by a
    comment.

## 14. Acceptance criteria

- [ ] A line added, changed or renamed on a source list shows on the open basket with a
      mark, without a reload.
- [ ] A line removed from a source list stays on screen as a disabled, readable row and
      counts toward no number on the page.
- [ ] A banner under the tools bar says how many changes are new to this viewer and opens
      a sheet that tells each one in words.
- [ ] The tools bar is exactly as tall as before.
- [ ] Nothing is acknowledged while the tab is hidden, by a background refetch, or before
      a marked row or the sheet was really on screen.
- [ ] A reload, an offline hour, a resume and a second device all show what the server
      says is new, with no client clock involved.
- [ ] A rename merge shows one changed row and no removed row.
- [ ] A guest sees the marks and the sentences and never a list name or a person they are
      not entitled to.

## 15. Verification

```sh
npx nx run-many -t lint test -p velista/platform velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps velista
```

On the slot, with two accounts in one group (memory note on the two account browser
recipe): open the live basket as the first, add, change, rename and delete lines on the
zone list as the second, and check the marks, the banner and the sheet at a phone
viewport in both themes. Then hide the tab, make a change, wait, show the tab, and check
in the network panel that `changes/seen` is sent only after the row was on screen. Give
the slots back.
