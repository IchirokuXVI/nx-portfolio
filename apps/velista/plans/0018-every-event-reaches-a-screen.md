# 0018: every event reaches a screen

> Prerequisite reading: `0004` section 6.5 (events into stores) and section 7.1 (why
> stores live in `data-access`), plus `0016` and `0017` for the transport and presence.
>
> Backend facts verified against the source on 2026-08-28.

## 1. Goal

Close the gap between what the server sends and what the app shows. The transport is
built (`0016`), presence is built (`0017`), and every one of the backend's 26 events maps
to a typed event on the client. What was never checked is whether each mapped event
actually **reaches the thing that renders it**, and for two data sources it does not.

The rule this plan applies, stated once so the audit below has an edge:

> An event exists to spare somebody a reload. If a screen holds a record the server can
> change, and the server publishes an event when it changes, that screen updates without
> being asked. Anything less is a screen that is quietly wrong, which is worse than a
> screen that is obviously stale.

## 2. The audit

All 26 events, against the data source that renders them. `REALTIME_EVENT_NAMES` and the
backend's `RealtimeEvent` enum already agree exactly, so nothing arrives unmapped and
nothing is listened for that cannot come; the column that matters is the last one.

The last three rows were added by `0021`, and they are of a different kind from the rest:
this plan's gaps were events that arrived and reached nothing, while those were events the
server had no way to send at all, because every room in the system is scoped to a resource
and nothing could be addressed to a person. They are listed here so this table stays the
one standing answer to "does every event reach a screen".

| Event                                                 | Rendered by                      | Applied by                 | State                                   |
| ----------------------------------------------------- | -------------------------------- | -------------------------- | --------------------------------------- |
| `zone.updated`                                        | zone cards, group page           | `ZoneStore`                | Live                                    |
| `zone.ownershipChanged`                               | zone cards, group page           | `ZoneStore`                | Live                                    |
| `zone.markedForDeletion`                              | zone cards                       | `ZoneStore`                | Live                                    |
| `zone.deleted`                                        | zone cards, group page           | `ZoneStore`                | Live                                    |
| `zone.countsUpdated`                                  | member and list counts, requests | `ZoneStore`                | Live                                    |
| `list.created`                                        | list rows, zone list count       | `ListStore`, `ZoneStore`   | Live                                    |
| `list.updated`                                        | list rows                        | `ListStore`                | Live                                    |
| `list.deleted`                                        | list rows                        | `ListStore`                | Live                                    |
| `list.accessChanged`                                  | list rows                        | `ListStore` (refresh)      | Live                                    |
| `line.added` / `.updated` / `.deleted` / `.reordered` | list page lines                  | `LineStore`                | Live                                    |
| `comment.added`                                       | the **comment count** on a line  | `LineStore`                | Live                                    |
| `comment.added`                                       | the **comments sheet**           | nothing                    | **Gap 2**                               |
| `member.joined`                                       | zone member count                | `ZoneStore`                | Live                                    |
| `member.usernameChanged`                              | members screen rows              | page, via a news channel   | Live, by a mechanism this plan replaces |
| `member.approved`                                     | members screen rows              | nothing                    | **Gap 1**                               |
| `member.kicked` / `.banned`                           | members screen rows              | nothing                    | **Gap 1**                               |
| `member.roleChanged`                                  | members screen rows              | nothing                    | **Gap 1**                               |
| `member.joined` (PENDING)                             | the join request queue           | nothing                    | **Gap 1**                               |
| `member.rejected`                                     | the join request queue           | nothing                    | **Gap 1**                               |
| `zone.created`                                        | the dashboard's zone list        | `ZoneStore` (load)         | Live (`0021`)                           |
| `member.approved` (the caller's own)                  | the zone card, the group page    | `ZoneStore` (patch + load) | Live (`0021`)                           |
| `user.usernameChanged`                                | the app bar, the account screen  | `ProfileStore`             | Live (`0021`)                           |
| `merge.requested` / `.approved` / `.rejected`         | nothing                          | nothing                    | **No screen, section 5**                |
| `presence.zoneUpdated`                                | resume card                      | `PresenceStore`            | Live (`0017`)                           |
| `presence.listUpdated`                                | resume card                      | `PresenceStore`            | Live (`0017`)                           |

Note the shape of both gaps: they are the two places where a **list of records is held as
page state**, and neither is an oversight in the store layer. The stores apply everything
they own. What was missing is a store owning these two things at all.

`member.kicked` and `member.banned` deserve the specific call out, because they are the
worst of the set. A member removed while an owner is looking at the members screen stays
on it, with a working actions menu, until the page is reloaded. Every action on that menu
then fails against a membership that no longer exists.

## 3. Gap 1: the membership rows

### 3.1 Why a store, and not an effect on the page

`MembersPage` holds `_rows` and already learns about one event, the rename, through
`ZoneStore.memberRename`. The comment beside it states the rule, which this plan keeps:

> It reaches this screen through `ZoneStore` rather than through a second subscription to
> `REALTIME_CLIENT.events`, so every screen in the app still learns about the stream
> through a store.

That rule is why the answer is not "let the page subscribe". The other option, five more
one shot news channels on `ZoneStore`, is worse than it looks: a signal holds only its
latest value, so two membership events in one turn would deliver the second and drop the
first, and joins and departures arrive in bursts precisely when a group is busy. A rename
could get away with it. A queue of join requests cannot.

So the rows move into a **`MembershipStore`**, which is where a record the server can
change belongs (`0004` section 7.1). The page keeps what is genuinely page state: which
rows are busy, what the live region announces, and which error is on screen.

### 3.2 The status filter is part of the state

Rule G2 means this screen asks for `APPROVED` alone as an ordinary member and
`APPROVED, PENDING` as staff, so the store remembers the filter each zone was loaded
under. Without it, applying `member.joined` for a PENDING membership would insert a join
request into a list an ordinary member is not allowed to see, which is a permission
decision made by accident in a client.

The filter turns each event into one of three answers:

- **In the filter**: upsert by id, replacing the row or appending a new one.
- **Not in the filter**: remove by id. This is what makes a kick or a ban take the row
  away, since the payload is the membership in its new state rather than a deletion.
- **Zone not loaded**: ignore. The store holds what was loaded, and inventing a partial
  zone from an event is how a screen ends up rendering one member out of nine.

### 3.3 `member.rejected` stops being a no-op

Its payload is `{ id, userId }` with no zone, which is why `ZoneStore` documents it as
unappliable and leaves the count to correct itself on the next load. That reasoning is
right for a **zone summary** and wrong for a **row**: a membership id is enough to remove
a row by, and ids are unique across zones, so the store drops that id wherever it is
loaded. The request queue empties the moment somebody else answers it.

## 4. Gap 2: the comments sheet

`comment.added` reaches `LineStore`, which uses it to keep the comment count on a line
honest. The comments themselves live in the sheet, which appends only the comment the
reader posted. Two people commenting on one line is the ordinary case for this product,
and the second person's comment does not appear.

The rows move to `LineStore`, keyed by line, beside the counts it already keeps and the
event it already receives. Two properties fall out of that and both are worth stating:

- **The append is an upsert by id.** A comment the reader posts arrives twice, once as
  the response to the POST and once as `comment.added` on the socket, so anything less
  than an upsert shows it twice. The sheet's own optimistic append becomes the same call
  the event makes.
- **Only a line whose comments are loaded gets the append**, the same rule the count
  already follows: starting a list from an event would render one comment for a line that
  has nine.

## 5. What stays unbuilt, and why

**The merge events.** `merge.requested`, `merge.approved` and `merge.rejected` are mapped
and reach `ZoneStore`, which ignores them. That is correct and stays: account merge is a
backend capability (`luna-shopper-backend` plan 0008) with no endpoint consumed by this
app, no model, and no screen. There is nothing to be stale, so there is nothing to make
live. The events are kept in the union rather than dropped, because the day the screen is
built the transport, the mapper and the union are already right, which is exactly the
property `0004` was written to buy.

This is the difference the plan's rule turns on: an event with no screen is a **feature**
that has not been built, and an event with a screen that ignores it is a **bug**. Only the
second kind is in scope here.

## 6. The account screen, and the decision it was waiting on

> **Superseded by `0021` and backend `0030`.** The decision this section left open was
> taken; what follows records what was true when this plan was written, and where it
> ended up.

A global username change has an event, `user.usernameChanged`, and the account screen
would be the place to render it. It was not a gap in **this** plan, because that event
never left the broker: the identity events are auth talking to core, they are deliberately
absent from `DOMAIN_EVENT_SUBJECTS`, and the realtime service therefore never fanned one
out to a socket. What did reach a client is `member.usernameChanged`, once per affected
membership, which is the per zone half of the same rename and is applied by
`MembershipStore`.

So the account screen was not stale for want of a client change. Making it live meant
publishing an identity event to the socket, which is a backend decision and a backend
plan, and the plan is backend `0030`: core re-publishes the identity event as a domain
event addressed to the renamed user's own sessions, and `ProfileStore` applies it
(`0021` section 5). The two names stay deliberately two, live by two mechanisms.

It is worth recording why this one was more than a fifteen minute staleness. Rule A2 makes
`ProfileStore` the owner of the name and the token pair the fallback. In a second tab that
is backwards: the profile holds the pre-rename name, the refreshed pair carries the new
one, and the profile wins, so the fallback that exists to prevent staleness is unreachable
exactly where it would have helped. Without the event, that tab is wrong for as long as it
stays open.

## 7. What changed while building it

### 7.1 The rename channel is gone

`ZoneStore.memberRename` and the `MemberRename` type are deleted rather than left beside
the store. Once `MembershipStore` applies `member.usernameChanged` with its five
siblings, that channel had one writer and no readers, and a second path into the same row
is how the two come to disagree in the case nobody tests.

### 7.2 A store that shows its rows before the reload lands

`MembersPage` used to render a skeleton whenever a load was in flight, because its rows
went away with the screen. They survive it now, so the second visit to a group draws the
list it already has while the reload is on its way, and the skeleton is kept for the case
it was always for: a screen with nothing on it yet.

### 7.3 Which is why the store empties on an identity change

That is the first time in this app rows are drawn **before** the request that refreshes
them, and the same property would show one account the previous account's member list for
the frame between a sign in and its first page. An effect on `SessionStore.userId()`
empties everything the moment it changes. Nothing else in the app needed this, because
nothing else had the property.

### 7.4 A comment's own echo is an upsert

`comment.added` for a comment the reader just posted arrives after the POST that created
it, so the sheet's optimistic insert and the event call one method that replaces by id.
Before this it could not show twice only because the sheet and the event wrote to
different places, which is the same bug wearing a disguise.
