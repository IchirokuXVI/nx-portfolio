# 0049 Generated shopping lists

> **Revised by `0051`, and not current on its own.** This plan was written before a
> basket could be shared with people who have no account, and before `0047` took the
> trip status off a zone line. Four things here are superseded: who may generate (readers, now
> `WRITE`), the rule that only the owner may ever read a generated list (now participants, on
> terms), the rule that generated lists emit no zone event (now exactly one), and most of
> section 6's write back and conflict machinery, which existed only to reconcile a status that
> no longer exists. `0051` section 1 is the table of what survives. Everything else
> here, including the entity split and the argument for it, still stands.

The feature that makes the zone lists worth keeping: a user presses a button and gets the list
they will actually carry around the shop, assembled from everything still pending across the
zones and lists they chose. It is theirs alone, it is kept as history, it can be edited, and an
edit only reaches the shared lists when the user says which shared list it belongs in.

This plan is about **composing, owning and reconciling** that list. Pricing it and splitting it
across shops is backlog 0004, which consumes what this one produces. Depends on 0007 (lists,
lines and their two state machines) and on `0049` (which zones and lists feed a run).

## 1. A generated list is not a `ShoppingList`

The tempting shortcut is a `kind` column on `ShoppingList` and a nullable `ownerUserId`. It is
rejected, on one decisive fact: **a generated list draws from several zones at once**, so it has
no `zoneId`, and `ShoppingList.zoneId` is non nullable and load bearing in every query, every
authorization check, every realtime room and every event payload in 0006, 0007 and 0009. Making
it nullable turns "which zone is this list in" from a fact into a question that every one of
those call sites has to answer.

New entities, in core:

**GeneratedList**
- `id` (uuid)
- `ownerUserId` (opaque; the only user who may ever read it)
- `name` (nullable; set only when the owner names it. An unnamed list is displayed as its
  generation date, localized by the reader’s client, and a second unnamed list on the same
  day gets a number appended to the display, so the default is never stored, never needs
  localizing server side, and never collides)
- `status`: `GeneratedListStatus` enum (`DRAFT`, `ACTIVE`, `COMPLETED`, `ARCHIVED`)
- `generatedAt`, `sourceSnapshot` (jsonb: the zones, lists and preference values the run used)
- pricing fields added by backlog 0004, not here

**GeneratedListLine**
- `id`, `generatedListId`
- `content` (the text as shown, copied at generation time)
- `quantity` (integer, the sum across origins)
- `itemId` (nullable, opaque catalog id), `productGroupId` (nullable, per backlog 0001 section
  3.2; at most one of the two set)
- `status`: reuses `LineStatus` (`PENDING`, `READY`, `NOT_AVAILABLE`) so the shopping gesture is
  the same gesture as in a zone list
- `origin`: `GeneratedLineOrigin` enum (`DERIVED`, `ADDED`), where `ADDED` means the user typed
  it into the generated list and it exists nowhere else yet
- `targetListId` (nullable, only for `ADDED` lines; section 5)
- `position`

**GeneratedListLineOrigin** (the provenance rows, one per contributing zone line)
- `id`, `generatedListLineId`, `zoneId`, `listId`, `lineId`, `quantity`, `lineVersion`
- unique (`generatedListLineId`, `lineId`)

`sourceSnapshot` is not decoration. A run's meaning depends on which lists it drew from and what
the thresholds were, and the preferences change; without the snapshot a three week old generated
list cannot be explained to the person looking at it.

## 2. Who may generate, and from what

**Any approved zone member may generate.** Generation is a read of lines the caller can already
see, so it needs no new power, and restricting it to admins would make the feature useless in
exactly the household where the admin is not the one doing the shopping.

The sources are, in order:

1. The `sources` given in the request, if any.
2. Otherwise the stored generation sources of the shopping profile the run names, or of
   the caller's default profile when it names none (`0049` section 1). They default to
   `ALL`.
3. `ALL` means: every zone where the caller's membership is `APPROVED`, and inside each zone
   every list the caller holds a `ListAccess` row for, reader or writer alike.

A reader may generate from a list they can only read. Reading a line and copying it into a
private list is a read, and the write back in section 5 re checks write access at write time
anyway.

Lines the caller cannot read never enter a run, and a zone or list that disappears between two
runs simply stops contributing.

## 3. Which lines qualify

A line is picked up when **all** of these hold:

- `approvalStatus = APPROVED`. A `PENDING` line is a request nobody has agreed to yet and a
  `REJECTED` one is a decision; neither belongs in a basket. This is worth stating loudly because
  it is the rule that makes zone approval mean something.
- `status = PENDING`. `READY` means somebody already has it, `NOT_AVAILABLE` means it could not
  be got, and both are the shopper's own bookkeeping from a previous trip.
- The line is not already carried by another **`ACTIVE`** generated list of the same user. Two
  live baskets both claiming the same milk is how a household ends up with two milks. The
  overlap is reported rather than silently dropped, so the user can see why a line is missing.

**Deduplication.** The same thing appears in two zones ("Milk" in the flat list and in the
parents' house list), and the point of the feature is one line to buy once. Lines are merged when
they resolve to the same `itemId`, or to the same `productGroupId`, or, failing both, on
normalized text (trimmed, case folded, accent folded). Quantities sum, and every contributing
line gets its provenance row. Text matching is deliberately conservative: "milk" and "whole milk"
stay separate, because merging two things a user meant separately is a worse failure than showing
two lines they can merge by hand.

## 4. The run

`generatedList.create { sources?, name?, priceIt? }` is one core operation, with an idempotency
key (0004 section 9) so a double tap does not produce two baskets.

It is a **snapshot**, not a live view. Nothing in a generated list updates when a zone line
changes afterwards; the provenance rows carry `lineVersion` precisely so a later reconciliation
can tell that the origin moved. A live view was considered and rejected: a shopping list that
rewrites itself while you are in the shop is hostile, and the zone list stays available for
anyone who wants the live truth.

Regeneration produces a **new** `GeneratedList` rather than mutating an old one, which is what
makes the history in section 7 an actual history.

## 5. Editing, and the write back rule

A generated list is fully editable: rename it, edit line text and quantity, reorder, delete a
line, add a line. All of it is local by default, and this is the rule the whole plan turns on:

> An edit inside a generated list changes the shared zone lists **only** when the user has said
> which shared list should receive it.

- **Editing a `DERIVED` line** (text, quantity) changes the generated copy alone. The zone line
  is untouched. The user asked for a shopping list, not for a way to rewrite other people's
  lists by accident.
- **Adding a line** creates it with `origin = ADDED` and `targetListId = null`. It lives only in
  the generated list. If the user sets a `targetListId`, the line is also created in that zone
  list through the ordinary `line.add` path, subject to the ordinary rules: the caller must hold
  `WRITER` access **at that moment**, and the new line starts `PENDING` approval like any other.
  The created line becomes the generated line's provenance row and its `origin` stays `ADDED` so
  the history records where it came from.
- A **default target list** may be set per run (`defaultTargetListId`), which is the ergonomic
  case: "everything I add today also goes in the flat list". It is a default on new lines, never
  a retroactive sweep over lines already added.
- **Deleting a `DERIVED` line** removes it from the basket and leaves the zone line pending. That
  is the "I decided not to buy this today" gesture, and it must not look like "this is done".

The failure mode this rule exists to prevent: a user tidies up their own shopping list at the
till and, without meaning to, rewrites a list four other people depend on.

## 6. Closing the loop: marking things bought

The other half of the same rule, and the reason the provenance rows exist.

- Marking a generated line `READY` or `NOT_AVAILABLE` is local by default.
- The user may **apply the result to the origins** (`generatedList.applyStatuses`, or a per line
  `applyToOrigins` flag), which sets every provenance line to the same status through the
  ordinary `line.setStatus` path, emitting the ordinary `line.updated` events so the rest of the
  zone sees it live (0009).
- Applying re checks `WRITER` access per origin line and skips the ones the caller may no longer
  write, reporting them. A partial apply is a real outcome and is reported as one rather than
  failing the whole call.
- **Conflicts.** If a provenance row's `lineVersion` no longer matches the zone line, the origin
  changed since the basket was made. The apply reports it and, by default, still applies the
  status, because "I bought the thing" is almost always still true even if somebody edited the
  text. A deleted origin line is skipped and reported. This follows the last write wins posture
  0009 already took, and the report is what stops it from being silent.
- Marking the whole generated list `COMPLETED` is the natural moment to offer the apply, but the
  offer stays an offer.

## 7. History and retention

Generated lists are kept. That is the point of the feature: a user wants to know what they bought
two weeks ago and what it cost.

- `generatedList.listMine { cursor?, order? }`, cursor paginated and orderable per 0004 section
  11, defaulting to newest first.
- `ARCHIVED` hides a list from the default listing without deleting it.
- Deleting one is a real delete of the generated rows only. It never touches a zone list.
- Retention is unbounded for now; a cap or an age based archive is an open decision, and the fact
  that lines are copies rather than references means the history stays readable however much the
  zones change afterwards.
- Account deletion (0011) deletes every generated list of that user, and that fact is recorded in
  0011's checklist, section 5.

## 8. Privacy

- Only `ownerUserId` reads a generated list. Not zone admins, not the zone owner, nobody.
- Generated lists never appear in `list.listInZone` or in any zone scoped view, and never emit
  zone events.
- Realtime updates for them go to the **owner's own room**, not to a zone room (0009), so the
  same basket stays in sync between the user's phone and their laptop and reaches nobody else.
- The audit consequence is deliberate: a zone admin can see that a line was marked bought, since
  that is a zone event, but not that it came from a generated basket, nor what else was in it.

## 9. Contracts, events, versioning, migrations

- New enums `GeneratedListStatus` and `GeneratedLineOrigin` in `libs/luna-shopper/contracts`, per
  the constant sets rule.
- Events on the owner room: `generatedList.created`, `generatedList.updated`,
  `generatedList.lineUpdated`, `generatedList.deleted`. Applying statuses emits ordinary
  `line.updated` events in the zones, which is what makes the loop visible to everyone else.
- Endpoints under `/v1/generated-lists`, guarded by the JWT guard, with contract schemas so 0019
  documents the responses with no hand written DTOs.
- One append only core migration for the three tables. No change to `ShoppingList` or `ListLine`,
  which is the payoff of section 1.

## 10. Open decisions

- Whether a generated list may be **shared** with the zone later ("here is what I am buying").
  Out of scope here; the `ownerUserId` column is what a future `sharedWithZoneId` would sit next
  to.
- Whether `ACTIVE` should be enforced as at most one per user, or whether several live baskets
  are legitimate (one per shop trip, one per week). Leaning several, with the overlap rule in
  section 3 doing the real work.
- Text normalization for deduplication: how far to fold. Accents and case are safe; stemming is
  not.
- Whether `applyStatuses` should default to on at `COMPLETED`. Leaning off, since the plan's
  central rule is that shared data changes only when asked.

## 11. Exit criteria

- Any approved member of a zone can generate a list from the pending, approved lines of the
  zones and lists they chose, with all of them as the default.
- The same product appearing in several lists produces one line with the summed quantity and a
  provenance row per origin.
- A generated list is visible to its creator alone, in no zone view, and its realtime updates
  reach no one else.
- Editing a derived line, deleting one, or marking one bought changes nothing in any zone list
  until the user explicitly applies it or names a target list.
- A line added with a target list appears in that list through the normal add path, with normal
  access checks and normal approval, and is skipped with a report when access is gone.
- Applying statuses to origins is partial tolerant, reports what it skipped, and detects an
  origin that changed or vanished since the run.
- Regenerating produces a new list and leaves the previous one intact and readable.
- Generated lists are listed newest first, cursor paginated, and survive changes to the zones
  they came from.
- Account deletion removes them.
