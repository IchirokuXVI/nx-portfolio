# 0022: presence on groups and lists

> Prerequisite reading: `0017` (presence over the socket, which built all of this) and
> `0004` section 6.7 (presence is advisory).
>
> Companion plan: `luna-shopper-backend/plans/0032`, which delivers list presence to a
> group's members so section 3.3 has something to draw. Everything else here ships
> without it; section 6 says so per section.
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

The group page does **not** subscribe per row, and it does not have to, because of what
backend `0032` changes on the server: a socket that subscribes to a zone is joined to
`list:{id}:presence` for every list in it that the caller may read, and
`presence.listUpdated` is emitted there as well as into the list's own room.

**So this section needs no client change beyond rendering.** The client sends no new
message, holds no new subscription, and learns no new event: `presence.listUpdated` is
already in `REALTIME_EVENT_NAMES`, already mapped, and already applied by
`PresenceStore._lists`. `viewersOf(listId)` simply starts having answers for lists this
client has not opened, because the server started sending them.

That is the whole of it, and it is worth noticing how much of this plan's earlier draft
went away. Getting the room right on the server removed a store field, a new event, a new
mapper branch and a rule for reconciling two disagreeing sources.

The rows therefore read from `viewersOf(listId)` exactly as the list page's header does,
and section 5's rule covers the case where the answer is empty: the indicator is absent,
which is correct both when nobody is there and before the first broadcast arrives.

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
- `REALTIME_EVENT_NAMES`, the mapper and the event union are unchanged. Nothing in this
  plan adds an event.
- `ListPage` and the group page inject `PresenceStore`. Both are containers in rule D1's
  sense already, so this adds a store to a page that owns stores, not to a component.
- `HomePage` already injects it.
- `selectHomeState` and `selectGroupState` take presence as an **argument**, as they take
  everything else. They stay pure and stay testable without a fixture, which is the whole
  reason they exist.
- `store-doubles.ts` already ships `fakePresenceStore` with `online`, `viewers` and
  `editors` options, so every spec in this plan is driven by data rather than by a mock.
  Section 3.3 is tested by putting viewers on a list the fake was never told the page had
  open, which is exactly what `0032` makes real.

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

## 6. Sequencing, and what is deliberately not built

Sections 2, 3.1, 3.2 and 3.4 need no server change: announcing intent is a client call the
server already accepts, and zone presence is already arriving for every group on the
dashboard with nothing reading it. They ship first and independently.

Section 3.3 needs backend `0032`, which needs backend `0031` (eviction), because `0032`
joins rooms the client never asked for and therefore cannot release. Until `0032` lands,
`viewersOf` simply answers empty for a list this client has not opened, the indicator does
not draw, and that is section 5's rule working as intended rather than a broken state to
guard against. No client code is conditional on it.

Not built:

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
7. After backend `0032`: a group page lights the row of a list somebody else has open
   while holding no subscription to that list, and a member with no access to that list
   sees nothing and receives nothing naming it. One client change ships with it, and
   section 8 says which and why this criterion was written expecting none.

## 8. What landing backend `0032` actually needed

Sections 3.3 and 6 both say this plan's rendering needs no client change when `0032`
lands, and both are right about the rendering. They were wrong about the **names**, and
the difference is a request.

`presenceNames` drops a viewer whose name will not resolve, deliberately: to the person
reading, "not loaded yet", "left the group" and "not allowed to see them" are one fact
and none of the three is a hex string. Names resolve out of `MemberNames`, which is
demand driven and populated per zone by `ensure`, and both surfaces gated that call on
zone presence alone:

```ts
const peopled = this._presence.onlineIn(zoneId).some((user) => user.userId !== me);
```

Which was complete while list presence could only exist for a list this client had open,
and stopped being complete the moment `0032` started sending list presence for lists it
had not. The failure is quiet in the worst way: `viewersOf` answers correctly, the view
model carries the ids, and every name is then dropped for want of a request nobody made,
so the indicator does not draw and nothing anywhere reports a problem.

The case that makes it more than a race is a shopper who **deep linked to a list**. They
hold no zone subscription, so they are in that list's presence and in no zone's presence
at all, and the group they are shopping in is a group the reader's client would never
have asked the names for. That reader waits forever.

So the trigger on both surfaces now counts a viewer on any of the zone's lists as
somebody being here, through one `hasOthers` helper beside `presenceNames`, for the
reason that function is shared: the rule is quiet enough that two copies is two chances
to get one subtly wrong.

**Why the specs did not catch it, which is the more useful half.** `fakeMemberNames`
answers `nameOf` from a record it was handed rather than from what was asked for, so a
screen that never calls `ensure` still renders names in a test. Section 3.3's own spec,
"lights the row of a list somebody has open, holding no subscription to it", passed
throughout and would have kept passing against a build where the row could never draw.
A double that is more helpful than the thing it stands in for hides exactly the defect
its subject exists to have. The new specs assert the **call** rather than the rendering,
which is the only part of this the double cannot be generous about.
