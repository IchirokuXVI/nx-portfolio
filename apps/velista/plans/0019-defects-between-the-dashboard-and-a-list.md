# 0019: the defects between the dashboard and a list

> Prerequisite reading: `0003` (the home page), `0011` (the first defect pass, whose
> shape this plan copies) and `0012` (the list page).
>
> Every claim below was checked against the source on 2026-08-28. Where a cause is
> named, the file and the line that carries it are named with it.

## 1. Goal

Four defects on the shortest path through this product: open the app, look at a group,
open a list, add something to it. Three of them are wrong output and one of them is a
control that does not work at all. They are grouped because they are one journey, not
because they share a cause; the causes are given per defect and they are all different.

They are first in the build order for the ordinary reason: one of them is a primary
action that fails, and the other three are cheap.

## 2. The add button submits the page instead of the line

**This is the one to fix first.** Adding a line is the reason the list page exists, and
right now the button at the bottom of it reloads the browser.

`libs/velista/ui/src/lib/list/line-composer.html:5` binds `(ngSubmit)="submit()"`, and
`LineComposer` imports `RokuTranslatorPipe`, `PlusIcon` and `QuantityStepper` and
nothing else. `ngSubmit` is `NgForm`'s output; `NgForm` comes from `FormsModule`. With
no `FormsModule` in `imports`, no directive is applied to the `<form>`, so Angular binds
a listener for a DOM event literally named `ngSubmit`, which no browser ever fires.
Nothing calls `preventDefault`, so the native submit runs: the browser navigates to the
current URL with the field as a query parameter and the app reloads.

The repository already knows this trap and already wrote it down. `SignInPage.onSubmit`
(`libs/velista/feature-auth/src/lib/sign-in-page/sign-in-page.ts:112`) carries the
comment that describes exactly this failure and the fix used on all three auth pages:

> `(submit)` and not `(ngSubmit)`: the latter is `NgForm`'s output and needs
> `FormsModule`, which these pages do not import and do not want, because nothing here
> uses a form control.

So the fix is the fix the auth pages already use, not a new one:

- `line-composer.html` binds `(submit)="onSubmit($event)"`, and `LineComposer` gains an
  `onSubmit(event: Event)` that calls `event.preventDefault()` and then `submit()`.
  `FormsModule` is **not** imported: nothing in this composer is a form control, and
  importing a module to get an event name is how a component acquires a dependency it
  does not use.
- The existing `submit()` keeps its whole body, comment included. It is correct; it was
  simply never being called.

### 2.1 The same bug is in the comments sheet

`libs/velista/ui/src/lib/list/comment-composer.ts:29` has the identical binding with the
identical `imports: [RokuTranslatorPipe]`, so posting a comment reloads the page too.
It is fixed in the same commit and the same way. Nobody reported it, which is worth
noting rather than glossing: the two composers are the only `(ngSubmit)` left in the app,
and finding the second one only because the first was reported is the argument for the
guard in section 2.2.

### 2.2 A test that stops it coming back

The failure is invisible to a unit test that calls `submit()` directly, which is why it
survived two plans. Both composers get a spec that dispatches a real `submit` event on
the `<form>` element and asserts the output fired **and** that the event's default was
prevented. That is the assertion that would have failed on the code as it stands.

A lint rule banning `ngSubmit` outright was considered and rejected: `FormsModule` is a
legitimate thing for a future screen to want, and a rule that forbids the correct usage
to catch the incorrect one will be suppressed the first time somebody needs it.

## 3. An empty list says "0 of 0 ready"

`home.progress.ready` renders `{{ready}} of {{total}} ready`, and a list with no lines
renders it as "0 of 0 ready". That is a sentence about progress through a shop that has
not been described, and it reads as a bug even when it is arithmetically true.

It appears in four places, and all four are in scope, because a rule applied in three of
them is a new inconsistency rather than a fix:

| Where                                                       | File                                          |
| ----------------------------------------------------------- | --------------------------------------------- |
| A list inside a zone card on the dashboard                   | `libs/velista/ui/src/lib/home/zone-card.html`  |
| A list row on the group page                                 | `libs/velista/ui/src/lib/zone/list-row.ts`     |
| The list page header                                         | `libs/velista/ui/src/lib/list/list-header.html`|
| The resume card                                              | `libs/velista/ui/src/lib/home/resume-list-card.html` |

The resume card is already correct by accident: its `progress()` computed returns `null`
when `lineCount === 0`, and the label sits inside the `@if (progress(); as percent)`
block, so an empty list draws neither bar nor sentence. It is listed so the next reader
knows it was checked and why it needs no change.

### 3.1 The copy, and where the decision lives

One new key, `list.empty.short`, in both `en.json` and `es.json` under
`libs/velista/ui/assets/i18n/`:

- `en`: `List is empty`
- `es`: `La lista está vacía`

Not reusing `list.empty.title` ("Nothing on this list yet"), which is a full empty-state
heading written for a screen with room for it. A row on a card has room for three words.

Each of the three templates picks the key on `lineCount === 0` rather than on
`readyCount`, and the existing `lineCount !== undefined` guards stay exactly as they are:
`undefined` still means "the count has not arrived" and still renders nothing, while `0`
now means "there is nothing in it" and renders the sentence. The two must not collapse
into one falsy check, which is the mistake this section exists to prevent.

The list page header additionally suppresses its progress bar at zero, for the resume
card's reason: an empty bar under an empty list is decoration that describes nothing.
`ListHeader.percent`'s comment currently justifies rendering it ("nothing is ready
because there is nothing") and is rewritten rather than left contradicting the template.

## 4. "New list" on the dashboard is an action that cannot exist

`BottomActionBar` (`libs/velista/ui/src/lib/home/bottom-action-bar.ts`) offers **New
list** as the primary action, and `HomePage.newList()` calls `_notYetRouted`, which does
nothing. The button has never worked.

It is not going to be made to work, because it cannot be: a list belongs to a zone
(`ShoppingList.zoneId` is non-nullable throughout the backend), and the dashboard is the
one screen in the app with no zone in scope. Creating a list from here would need a zone
picker in front of it, and the group page already offers **New list** with the zone
already chosen. So the dashboard's primary action is not a broken button; it is the
wrong button.

It becomes **Get shopping list**, which is the action that genuinely belongs on a screen
with no zone in scope: a run assembled across every zone and list the user chose. That
feature is designed and scheduled, in backend `plans/0050-generated-shopping-lists.md` (revised by `0051`),
and this plan does not build any part of it.

So the button ships **disabled**, and that is a deliberate exception to the rule this app
otherwise follows. `LineComposer`'s own header states the rule:

> It is absent for a reader, never disabled ... a disabled text field at the bottom of a
> screen is an invitation that does not work and costs a tap to find out.

That rule is about a control somebody is **not permitted** to use, where absence is the
honest answer. This is a control nobody can use yet, where absence would leave the
primary slot of the primary screen empty and would tell a returning user nothing about
where the product is going. The distinction is worth writing into the component, because
the next person to read the two comments together will otherwise think one of them is
wrong.

Concretely:

- Two new keys, `home.action.generateList` (`Get shopping list` / `Obtener lista de la
  compra`) and `home.action.generateList.soon` (`Coming soon` / `Próximamente`), the
  second as the button's `aria-describedby` text so a screen reader gets the reason
  rather than a bare disabled control.
- `BottomActionBar` renames its `newList` output to `generateList` and sets
  `[disabled]="true"` with a hard-coded `true` and not an input: an input would invite a
  caller to pass `false` and enable a button with nothing behind it.
- `HomePage.newList()` and its `_notYetRouted('lists.create')` call are **deleted**
  rather than renamed. The route it names will never exist.
- The Join-by-code secondary action beside it is untouched.

The group page's own **New list** button (`zone.detail.newList`) is unaffected and keeps
its key. Both strings exist and they mean different things now, which is correct.

## 5. A new list does not appear on the dashboard until a reload

The counts on a zone card are live: `ZoneStore._apply` handles `list.created` with
`bumpLists(zone, 1)` (`zones/zone-store.ts:698`), so "3 lists" becomes "4 lists" the
moment somebody else creates one. The **preview underneath it** is not touched, so the
card claims four lists and shows three, until the next full load.

The preview is at most three entries, newest activity first
(`ZONE_LIST_PREVIEW_LIMIT = 3` in `core/src/app/zones/zone-summary.sql.ts:31`, and
`MyZone.lists` documents the same in `libs/velista/models/src/lib/domain.ts:55`). So
there is a real case and a real non-case:

- A zone showing fewer than three lists has room, and the new list belongs in it.
- A zone already showing three has none, and the correct answer is to change nothing.
  The preview is "the three most recent", the new list is more recent than all of them,
  and evicting the oldest would be right, but only if the ordering the server used is
  reproducible on the client. It is not: it is ordered by recent **activity**, which the
  client cannot compute for lists it has never loaded.

That asymmetry is the whole design of this fix, and it is the reason the fix is small.

### 5.1 What `ZoneStore` does with each list event

Three branches, in `_apply`, replacing the current single-line `list.created` case and
two of the entries in the "list-scoped traffic reaching the zone room" fall-through:

- **`list.created`**: bump `listCount` as today, and additionally, **if and only if**
  `zone.lists.length < ZONE_LIST_PREVIEW_LIMIT` and no entry with that id is already
  there, append a preview built from the event's list. `lineCount` and `readyCount` are
  `0`, which is a fact and not a guess for a list that was created this instant. A zone
  already at the limit gets the count bump alone.

- **`list.updated`**: rename in place, if the id is in the preview. This is not in the
  reported defect and it is included anyway, because it is the same one-line shape and
  leaving it out means a renamed list keeps its old name on the dashboard while showing
  its new one on the group page, which is the same class of lie in a place nobody would
  think to look.

- **`list.deleted`**: drop by id and decrement `listCount`. Note the consequence and
  accept it: a zone with four lists showing three loses one from the preview and shows
  two, until the next load refills it. The alternative is asking the server for a new
  preview on every deletion, which is a request per event for a cosmetic third row.

`list.accessChanged` stays in the fall-through. Its payload says access changed, not
whether **this** caller gained or lost it, so the store cannot tell whether to add or
remove a row, and guessing either way puts a list on a dashboard the caller may not open.

### 5.2 The limit moves into the models library

`ZONE_LIST_PREVIEW_LIMIT` is currently a backend constant that the client reproduces by
knowing the number. The client needs it now, so it is declared once in
`@portfolio/velista/models` beside `MyZone.lists`, whose doc comment already asserts
"at most three". The two are separate declarations in separate deployables and they can
drift; what stops that is the doc comment on each pointing at the other, and the fact
that a drift is visibly harmless in one direction (a client limit lower than the
server's shows fewer rows) and self-correcting in the other (a higher one is never
reached, because the server never sends more).

## 6. What is not in this plan

- The role chip's colour, and a promotion that does not reach the screen. Those are
  `0020`.
- Anything that needs an event the server does not currently send to this client. That
  is `0021`.
- Presence on group and list rows. That is `0022`.
- Building **Get shopping list**. Section 4 ships the affordance and nothing behind it,
  on purpose.

## 7. Acceptance

1. Typing an item and pressing the add button, or the phone keyboard's Go key, adds the
   line and does not navigate. The field keeps focus and the quantity resets to one.
2. Posting a comment does not navigate.
3. A list with no lines reads "List is empty" on the dashboard, on the group page and in
   the list page header, in both locales, and the list page header draws no progress bar.
4. A list whose counts have not arrived still renders nothing at all, unchanged.
5. The dashboard's primary action reads "Get shopping list", is disabled, and announces
   why.
6. With two sessions in one group of one list: creating a list in the first makes it
   appear on the second's dashboard, inside the card, without a reload. Renaming it
   renames it there. Deleting it removes it.
7. With a group of four lists, creating a fifth changes the count and leaves the three
   previewed rows alone.
