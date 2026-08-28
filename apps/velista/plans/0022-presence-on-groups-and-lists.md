# 0022: presence on groups and lists

> Prerequisite reading: `0017` (presence over the socket, which built all of this) and
> `0004` section 6.7 (presence is advisory).
>
> Verified against the source on 2026-08-28.

## 1. Goal

`0017` built presence end to end: the server tracks who is in a zone and who is looking at
a list, `PresenceStore` holds the snapshots, `RealtimeClientI` exposes the four intents,
and every piece of it has tests. One screen renders it: the resume card on the dashboard,
for one list.

Two things are wrong with that, and the second is worse than the first.

- **Groups and lists show no presence anywhere.** A group card does not say who is in the
  group right now, a group page does not, a list row does not, and the list page itself
  does not, not even for the line somebody else is editing, which is the case with the
  highest cost of not knowing.
- **The one screen that does render it can never have anything to render.**
  `viewList` and `editLine` have **no production callers anywhere in this repository.**
  The only calls are in `realtime-socket.spec.ts` and the backend's own presence spec. The
  list page subscribes to `list:{id}` and never announces that anybody is looking at it,
  so `presence.listUpdated` reports an empty viewer set forever, so the resume card's
  "Ana and Marc are shopping now" row has never appeared for a real user.

The second point is the one to fix first, and it reframes the whole plan: this is not
"add presence indicators", it is "connect the feature that was built".

## 2. Announce first, render second

### 2.1 The list page announces viewing

`ListPage` takes both rooms in its constructor:

```ts
const leaveList = this._realtime.subscribeList(this.listId());
const leaveZone = this._realtime.subscribeZone(this.zoneId());
```

`subscribeList` becomes `viewList`. That is the whole change, and `RealtimeClientI` already
documents why it is a substitution rather than an addition:

> **Acquires the list room as well**, because the server refuses a presence intent from a
> socket that is not in `list:{id}`.

So `viewList` returns the same release function and holds the same room; it also says
somebody is there. The zone subscription beside it is untouched.

The home page's `subscribeList` for the resume list stays `subscribeList`, and its comment
already says why in terms this plan endorses:

> `subscribeList` and deliberately **not** `viewList`: this page holds the room to hear
> about the list, not to claim somebody is shopping from it.

Reading the dashboard is not shopping. If both pages announced, every user with the app
open would appear to be in whichever list they last opened, which is worse than no presence
at all: it is presence that is confidently wrong.

### 2.2 Editing a line announces editing

`editLine` has the same problem and a smaller footprint. It is announced when the edit-line
sheet opens and released when it closes, from `EditLineSheet`'s own lifecycle, so the
intent's life is exactly the sheet's. Not from the row, and not on focus of an inline
control: an intent that outlives what caused it is how a line stays locked-looking after
somebody backgrounded the app.

The release must run on **every** exit from the sheet: saved, cancelled, dismissed by a
back gesture, or destroyed by a navigation. `DestroyRef.onDestroy` is the only one of those
that fires in all four cases, so that is where it goes, with the explicit calls on save and
cancel removed rather than added beside it.

`0017` already covers what happens when the socket drops mid-edit: presence is per
connection on both ends, and the server expires a member that stops heartbeating.

## 3. What each surface shows

Four surfaces, one rule: **presence is advisory** (`0004` section 6.7). It may under
report, it may be a few seconds late, and **nothing destructive is ever guarded by it.** No
"are you sure, Marc is editing this" dialog, no disabled control, no lock. Every indicator
below is something a person reads, not something the app enforces.

### 3.1 A zone card on the dashboard: who is in the group

`PresenceStore.onlineIn(zoneId)` needs no intent: the server computes zone presence from
who holds the zone room, and `ZoneStore._syncRooms` already holds one per zone. So this
data is arriving today, for every group on the dashboard, and nothing reads it.

The card gains a row beneath the counts, drawn **only when somebody other than the caller
is online**, using the existing avatar-stack and dot treatment from `ResumeListCard` so the
two read as one idea. New key `home.presence.inGroup`: `{{names}} are here now` /
`{{names}} están aquí ahora`, with a count variant for four or more.

The caller is filtered out **here**, in the component, not in the store. `PresenceStore`'s
header states the rule and the reason:

> Filtering yourself out is a rendering decision, made where the sentence is written. A
> store that dropped a user id quietly would make `viewersOf` disagree with the count the
> server broadcast.

`aria-live="polite"`, as the resume card already does: presence changes with nobody
touching the screen, so it is announced rather than silently swapped.

### 3.2 The group page header: the same fact, on the screen about that group

`GroupHeaderVm` gains an `online: readonly string[]`, filled by `selectGroupState` from
`PresenceStore.onlineIn`. It sits under the member count, which is the natural pairing:
"six members" and "two here now" answer the same question at two timescales.

`GroupHeader` still injects nothing (rule D1). The page passes the names down, as it does
for every other field on that view model.

### 3.3 A list row: who is shopping from it

Both the group page's `ListRow` and the zone card's inline list rows gain a viewer
indicator: the dot and up to two initials, no names, because a row has no space for a
sentence and the group page's header already carries one.

This one has a cost that must be stated rather than discovered, because it is the only
place in this plan where a decision is genuinely arguable:

> **List presence requires the list room**, and a screen showing eight lists would need
> eight subscriptions to light eight rows.

So the group page does **not** subscribe per row. It renders the indicator for a list only
when `PresenceStore` already holds a snapshot for it, which happens when the caller has
the list open elsewhere, or opened it recently enough that the room is still held. In
practice that means the indicator is usually absent on this screen, and that is the correct
trade: an absent indicator is honest ("we are not saying"), and eight subscriptions per
group page is a real cost paid on every open for a decoration.

The alternative, a zone-level "who is in which list" summary in the counts broadcast, is
the right long-term answer and is **not** built here. It is a backend change (one more
field on `BroadcastZoneCounts`, computed from the presence keys the realtime service
already holds) and it belongs in a backend plan. Section 6 records it.

### 3.4 The list page: viewers in the header, and the editor on the line

Two indicators, and the second is the one that earns this plan.

**Viewers**, in `ListHeader`, beside the progress line: the same dot, avatars and sentence
as the resume card, from `viewersOf(listId)` minus the caller. This is the screen the
resume card was pointing at, so the two say the same thing in the same words.

**The editor**, on the line row, from `editorOfLine(listId, lineId)`. That method exists
today with this comment:

> The shape a line row wants, and the reason `editors` carries a `lineId` at all.

and no line row calls it. It renders as the editor's initial and a subdued label on the
row, and it changes nothing else about the row: the row stays tappable, the edit sheet
still opens, and a simultaneous edit still resolves the way `0012` says it does. Advisory,
per section 3.

## 4. What the stores and pages need

- `PresenceStore` is unchanged. Every method this plan calls already exists, and the two
  that were never called (`editorOfLine`, and `viewersOf` in anger) are called now.
- `ListPage` and the group page inject `PresenceStore`. Both are containers in rule D1's
  sense already, so this adds a store to a page that owns stores, not to a component.
- `HomePage` already injects it.
- `selectHomeState` and `selectGroupState` take presence as an **argument**, as they take
  everything else. They stay pure and stay testable without a fixture, which is the whole
  reason they exist.
- `store-doubles.ts` already ships `fakePresenceStore` with `online`, `viewers` and
  `editors` options, so every spec in this plan is driven by data rather than by a mock.

## 5. The empty case, everywhere

Every indicator in this plan is **absent** when there is nobody, never "0 online" and never
a greyed-out placeholder. Presence under-reports by design, so a zero is the one number it
must never assert. `ResumeListCard` already does this (`@if (list().shoppers.length > 0)`)
and it is the pattern the four new surfaces copy.

The same applies when the socket is down: `PresenceStore` empties on disconnect, so every
indicator disappears at once. That is correct and it is deliberate, since `0016` names
"looking live while being stale" as the worst available failure, and it is also why the
existing "not updating right now" notices on the group page and the list header are not
duplicated per indicator. One statement per screen that the screen is not live is enough.

## 6. Deliberately not built

- **Zone-level list presence in the counts broadcast** (section 3.3). It would let a group
  page light every list row without a subscription per row. Backend change, backend plan,
  and the client work here is designed so that adding it later changes where the data comes
  from and not what is drawn.
- **Any enforcement.** No locks, no warnings, no disabled controls. Section 3.
- **Presence on the members screen.** A row there is a membership, which is a durable fact;
  overlaying a live dot on it invites reading absence as something meaningful about the
  person, which it is not.

## 7. Acceptance

1. Two accounts in one group, both with the app open on the dashboard. Each sees the other
   listed as here now on that group's card, and the row disappears within the presence
   timeout when one closes the tab.
2. Neither sees **themselves** in that row, and a group where only the caller is online
   shows no row at all.
3. One account opens a list. The other's dashboard resume card and group page list row show
   them shopping. This is the criterion that fails on today's code for a reason that has
   nothing to do with rendering.
4. Opening the edit sheet on a line makes that line show the editor's initial on the other
   account's list page. Saving, cancelling, backing out and navigating away all clear it.
5. Killing the socket clears every indicator on every screen at once, and the existing
   "not updating right now" notices are the only explanation shown.
6. `viewList` and `editLine` each have at least one production caller, and a spec asserts
   the release runs on destroy.
