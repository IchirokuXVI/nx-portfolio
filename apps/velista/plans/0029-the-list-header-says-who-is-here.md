# 0029: the list header says who is on the list, and opens

> Written after the fact, from commit `d336473`. The work is on `dev`; this plan records
> the design it was built to rather than the one it was built from.
>
> Prerequisite reading: `0022` (presence on groups and lists), whose section 3 rule that
> presence is advisory and gates nothing still holds here, and `0004` section 6.7 on why
> presence under reports by design.

## 1. The report

The list page drew the same advisory presence row as the cards on the dashboard: "Ana are
shopping now", plural whatever the count, with no way to find out who the initials belong
to.

That row is right for a card, which is read in passing. The list page is the one screen
somebody stands in a shop looking at, and there the questions are different: who is here,
what are they allowed to do, and since when.

## 2. A new component, not a fifth mode

`PresenceRow` draws the advisory version on four card surfaces and keeps doing so,
unchanged. `ListViewers` is the list page's own.

Separate because it answers a different question. Adding a mode to `PresenceRow` would
mean one component whose four callers want a glance and whose fifth wants a disclosure,
a role and a timestamp, which is two components sharing a file.

## 3. The sentence, and the stack that agrees with it

One person is named. Two are both named. Three or more name the first and count the rest.

The avatars say the same thing as the words: **two people are two initials, more than two
is one initial and a `+n`, where `n` is exactly the number the sentence says is not
named.** A stack showing three faces over a sentence mentioning one is two different
answers to one question, so `overflow` is one computed feeding both the bubble and the
copy, and they cannot disagree.

There is no "and 1 more": at three people the count is 2, so the collapsed form is never
reached for a single unnamed person.

Two details that are easy to lose:

- The sentence is **centred and hard capped at two lines**. Names are as long as people
  decide they are, and this sits above the lines being read.
- Initials are taken by **code point**, not `charAt`. Slicing cuts a surrogate pair in
  half, and a name starting with an emoji would draw the replacement character.

### 3.1 It draws nothing for nobody

`PresenceRow`'s rule, for `PresenceRow`'s reason. Presence under reports by design, so
zero is the one number it must not assert, and an empty set is also what every surface
shows before the first broadcast and the instant the socket drops. The host carries the
row and is `display: none` when empty, so the header pays neither a gap nor a separator
for an absent one.

## 4. The panel, and the two facts it needed

An arrow at the end opens a panel naming everybody, with their role in the group and when
they arrived. Neither of those existed as a fact the client could state.

### 4.1 `MemberNames` caches the membership, not the name

It held a `userId -> username` map. It now holds the whole `Membership`, so `roleOf`
answers off the same rows `nameOf` does.

Two parallel maps would have been the smaller change and the worse one: they are filled
from the same rows by the same method, so the only thing a second map could ever do is
disagree with the first.

- Still keyed by **user** id rather than membership id. Every caller starts from a user
  id, because that is what a comment, a line and a presence payload carry.
- `roleOf` returns **null** while the members request is in flight, not the enum's
  `MEMBER` fallback. That fallback exists to read an unrecognised value off the wire
  safely; using it here would quietly demote an owner for the length of a request.
- It is the **zone** role, the only one the client can know about somebody else. A per
  list role is not broadcast and no endpoint answers it.
- A nameless row is still not indexed, which was already `nameOf`'s rule and now governs
  the role too. The role is drawn next to the name, so a role with no name to sit beside
  is not something any surface can render.

### 4.2 `PresenceStore` remembers when it first saw somebody

No presence payload carries a timestamp. `broadcastList` publishes the whole room with
nothing dated in it, so "since when" is not a fact the server offers.

The only honest instant available is the first snapshot **this client** saw somebody in,
so the store records it per viewer per list:

- It survives later snapshots. A snapshot replaces the room, and somebody still in the
  new one keeps the instant they were first seen at.
- It is dropped when they leave, and goes with the rooms on a disconnect.
- It lives in the **store** rather than the page, because a page computing it would
  restart the clock every time it was navigated away from and back.
- A viewer with no time yet says "here now" rather than being stamped with the current
  one, which would be inventing a fact.

### 4.3 `presencePeople` keeps the id

`presenceNames` drops the user id, and the two lookups above are made **by** user id.
Matching people back up by name would put the wrong role on the second Ana in a group
with two, and nothing prevents that: a username is unique within a zone only if the
backend says so, and it does not.

So `presencePeople` is the same three joins with the id kept, and `presenceNames` is that
function with the ids dropped rather than a second copy of the rules. Every surface that
only wants a sentence keeps calling it.

## 5. Still advisory

Nothing here gates anything, and opening the panel changes nothing about the list. It is
a disclosure over a sentence, not a control (`0022`, section 3). Escape closes it, an
outside click closes it, and it is closed on arrival every time.

## 6. Acceptance

1. One viewer is named; two are both named; three or more name the first and count the
   rest, and the `+n` beside the initials is the same number the sentence gives.
2. Nobody present draws nothing at all, with no gap left in the header.
3. A long name wraps to at most two lines and does not push the list down the screen.
4. The panel names everybody present with their zone role and when they were first seen.
5. An owner is never drawn as a member while the members request is in flight; no role is
   drawn at all until it resolves.
6. Two members with the same name get their own roles and their own arrival times.
7. A viewer seen in a later snapshot keeps the time they were first seen at; one who
   leaves and returns is timed from the return.
8. The four card surfaces still render `PresenceRow` exactly as before.
