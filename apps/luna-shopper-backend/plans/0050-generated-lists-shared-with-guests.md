# 0050 Generated lists, shared with guests

> **This plan revises `0049`**, which designed generated lists before sharing existed.
> Section 1 says exactly what survives and what is replaced. `0049` carries a note pointing here
> and should not be read as current on its own.

A generated list is the thing you carry around the shop. This plan makes it **shareable with
people who have no account**, by a link, without ever handing them the household's data.

The design turns on one idea that `0049` did not have: **a link is an invitation, and a
participant is an identity.** One link shared with three people mints three participants, so an
edit made in the shop can be attributed to a person rather than to a URL.

Depends on `0047` (settlements, which this drives) and `0048` (the sources a run
draws from). Pricing the result is backlog `0004`, untouched here. Companion plan:
`apps/velista/plans/0044`.

## 1. What this changes in 0049

**Survives unchanged.** The entity split and its argument (a generated list has no `zoneId`, so it
cannot be a `ShoppingList` with a `kind` column), `GeneratedListLine` with `DERIVED` and `ADDED`
origins, `targetListId` for promoting an added line into a real list, the provenance rows, the
deduplication rule, the snapshot posture, regeneration producing a new list, and the history and
retention rules.

**Replaced.**

| `0049` said | Now |
| --- | --- |
| Any approved member may generate, readers included (section 2) | `WRITE` on the source lists (section 2) |
| Only `ownerUserId` may ever read it (section 8) | Participants may, on the terms in section 5 |
| Generated lists never emit zone events (section 8) | They emit one, so a zone line can say somebody is buying it (section 5.3) |
| `applyStatuses`, `lineVersion` conflicts, partial apply reporting (section 6) | Mostly gone. Section 6 here replaces it |

The last row is the largest simplification. `0049` section 6 existed only because a zone line
carried a trip status that a basket had to write back, with all the version reconciliation that
implied. `0047` removes that status, so applying a result is now writing a settlement,
which is an append rather than a contested update, and most of the conflict machinery evaporates
with it.

## 2. Who may generate, and from what

**`WRITE` on every list a run draws from.** This overrides `0049` section 2, which allowed a
reader to generate and argued that restricting it would break the household where the shopper is
not the admin.

That argument still holds against `DECIDE`, and `DECIDE` is not what is being asked for here.
`DECIDE` approves lines and does nothing else. But generation is no longer the pure read `0049`
took it for: section 5.3 makes a generated list put a visible claim on other people's lines, and
section 6 lets it settle them. Taking a claim on a line is a write, so it takes `WRITE`.

Source selection is unchanged otherwise: zones and lists, several of each, and **a zone chosen
with none of its lists means every list in it the caller holds `WRITE` on**.

This has a property worth naming, because section 5 leans on it: **the owner of a generated list
holds `WRITE` on all of its sources by construction.** Nothing else has to be checked to know it.

## 3. Share links and participants

Two tables, and the split between them is the whole design.

**GeneratedListShareLink** (the thing you copy and send)

- `id` (uuid), `generatedListId`
- `secretHash` (the link secret, **hashed**; section 3.1)
- `label` (nullable free text, "the flatmates", so several links are tellable apart)
- `createdByParticipantId`, `createdAt`
- `expiresAt` (nullable), `revokedAt` (nullable)

**GeneratedListParticipant** (a person acting on the list)

- `id` (uuid), `generatedListId`
- `shareLinkId` (nullable; null for the owner, who arrived by owning it)
- `kind`: `ParticipantKind` enum (`OWNER`, `REGISTERED`, `GUEST`)
- `userId` (nullable; set for `OWNER` and `REGISTERED`, null for `GUEST`)
- `displayName` (nullable; what a guest typed, and null when they skipped)
- `guestNumber` (nullable int; monotonic per generated list, so the fallback label is stable)
- `sessionSecretHash` (nullable; set for guests, who have no other credential)
- `userAgent` (nullable, captured at join)
- `joinedAt`, `lastSeenAt`, `revokedAt` (nullable)
- unique (`generatedListId`, `userId`) where `userId` is not null

### 3.1 The secrets are opaque and stored hashed, and neither is a JWT

A share link secret is high entropy random, not a signed token. The requirement is that it be
checked against the database on every use, and a JWT you must look up anyway is a JWT with no
benefit and a signing key's worth of risk. Both secrets are stored as hashes, like a password, so
a database leak does not hand over working links.

Ids are uuids and nothing in the URL is enumerable. A request for a link that never existed and
one for a link that was revoked get the same answer.

### 3.2 Every actor is a participant, including the owner

The owner gets a participant row at generation time. It costs one insert and it buys a single
foreign key for every attribution field in this plan: `lastEditedByParticipantId`,
`createdByParticipantId`, `settledByParticipantId`, and presence. The alternative is a nullable
pair of a user id and a participant id on each of them, checked for exactly one being set, in five
places.

### 3.3 The credential on the hot path is the participant's, not the link's

The link secret is presented **once**, at join. From then on the client holds its own participant
secret and the link secret is never transmitted again.

That is a better posture than a flat model gives, and it is worth stating as a benefit rather than
an accident: the string that gets forwarded in a group chat, screenshotted and pasted into a
browser history has a single use job, and the long lived credential is per person and individually
revocable.

It also makes the per request check cheap. Authorizing a participant request is **one indexed
lookup** on `sessionSecretHash`, reading `revokedAt` on that row. The link's state is never
consulted outside of joining, for the reason in 3.4. No cache, because revocation has to bite
immediately and this is a single primary key read.

### 3.4 Revoking a link does not evict the people already using it

Two levels, and both are things somebody actually wants.

- **Revoke the link.** No new participant may be minted from it. **Every existing participant
  keeps working**, including the ability to open the list from that same URL, because their
  session is what authorizes them and the link is only an invitation they already accepted. This
  is the common case: stop it spreading, do not throw out the people in the shop.
- **Revoke the link and its guests**, offered as an explicit second choice ("revoke all guests
  from this link?"). Sets `revokedAt` on every participant minted from it.
- **Revoke one participant.** Only that one. For the lost phone and the guest who should not have
  been given it.

Because a cascade writes `revokedAt` onto each participant row, section 3.3's single lookup still
answers every case, and the link table stays off the hot path.

### 3.5 A guest name is readability, and the token is attribution

Two guests can both type "Dani". A typed name is unverified text on an unauthenticated link and
must never be treated as identity.

So the name is what the screen shows and the participant id is what the record keeps. A guest who
skipped the prompt is shown as "Guest 2" from `guestNumber`, which is unique within the list and
stable for the life of the participant. Guest names are rendered visibly as guests, never in a
form that could be mistaken for a registered member.

## 4. Joining

Three steps, and the first one must leak nothing.

1. **Preview.** `GET` the link by its secret returns only what the join screen needs: the
   generated list's name, how many participants are on it, and whether it is still joinable. **No
   lines, no zone names, no list names, no member names.** Somebody who finds a link in a chat log
   learns that a shopping list exists and nothing else.
2. **Join.** `POST` with an optional `displayName`. Mints a participant and returns its session
   secret once. A guest who sends no name gets the next `guestNumber`.
3. **Or attach.** A caller who presents a valid account token is attached as a `REGISTERED`
   participant instead, with no name prompt, and the unique constraint in section 3 makes a second
   link they open resolve to the same participant row.

A revoked or expired link answers the preview honestly ("this link is no longer accepting
people") so the join screen can say so, and refuses the join.

## 5. What a participant may see

### 5.1 The basket itself, always

Every participant sees the lines, their quantities, what has been settled and what is outstanding,
and the price information backlog `0004` will attach. That is the point of sharing.

### 5.2 Zone data, only on the all or nothing rule

**Origins, which list a line came from, the settlement history, and the per list allocation sheet
in section 6.3 are shown only to a participant who holds `WRITE` on every source list of the run,
evaluated at request time.**

- The owner passes by construction (section 2), so the rule only ever bites recipients.
- A `GUEST` never passes, having no account to hold access with.
- A `REGISTERED` participant passes only if they independently have `WRITE` everywhere the run
  drew from.

**At request time, never from the snapshot.** A basket outlives the access it was built with, and
a recipient's standing today is the only one that can be honestly checked. This is the same rule
`0049` section 5 applied to writing back.

The all or nothing shape has a known cliff: one source list where the reader holds only `READ`
collapses the whole view even when they have `WRITE` on the other four. It is accepted for now
because it fails in the safe direction and because the per line alternative needs a per viewer,
per line projection. That refinement is in section 11, and the cross list indicator in
`0047` builds most of the machinery it would need.

### 5.3 The one zone event a generated list emits

`0049` section 8 said generated lists never emit zone events. They emit exactly one, so that a
zone line can show that somebody is out buying it.

The payload says **that** a line is in an active basket and **whose**, and nothing else: not what
else is in it, not where they are shopping, not what it costs. That is precisely the leak `0049`
section 8 already declared acceptable when it noted an admin can see a line was marked bought but
not what basket it came from.

## 6. Settling from the basket

The half of the plan that does real work, and the half `0047` was shaped to receive.

A `GeneratedListLine` gains **`settledQuantity`** (int, default 0) beside its existing `quantity`.
Outstanding is the difference, the screen shows both, and a line is finished when they are equal.
Settling is cumulative, so one line can be worked through two shops in an afternoon.

### 6.1 Three gestures, and the guest can use two of them

| Gesture | Who | What it does |
| --- | --- | --- |
| Settle | anyone | settles the whole outstanding amount, allocated by 6.2 |
| Partial submit | anyone | settles a number they type, allocated by 6.2 |
| Allocate | passes 5.2 | settles per source list, by hand, overriding 6.2 |

**A guest must never have to know which household a tin of tomatoes belongs to.** They are in a
shop with a list. So the first two gestures ask for a number at most, and the allocation is the
system's problem.

`NOT_AVAILABLE` is an outcome rather than a quantity: it closes the outstanding amount, writes
settlements that decrement nothing, and sets the indicator `0047` section 5 derives.

### 6.2 The default allocation is oldest origin first

A basket line can sum several zone lines. Milk from the flat list (2) and from the parents' list
(1) is one line of 3, and buying 2 has to land somewhere.

**Oldest provenance row first, until the settled quantity is exhausted.** Deterministic,
explicable in one sentence, and identical to the obvious answer in the overwhelmingly common case
where a line has exactly one origin. Proportional splitting was rejected for producing fractional
units of things that come in units.

Every origin touched gets its own `LineSettlement` row (`0047` section 3), each carrying
this generated line's id, so the allocation is auditable afterwards rather than being a rule that
ran once and left no trace.

### 6.3 The allocation sheet is the accurate version of the same act

A participant who passes section 5.2 can open a sheet listing each source list with its share, and
set the numbers by hand. It is the same operation with the allocation supplied instead of derived,
so it writes the same settlements, and it is also the only way to say "two for us, one for my
parents" correctly when the default guessed otherwise.

### 6.4 A settle is authorized by the owner's access, never the actor's

The security property that makes guest settling safe, and it needs stating plainly.

**Before writing a settlement to an origin line, the check is whether the generated list's owner
still holds `WRITE` on that origin's list.** Not the guest's access, because a guest has none, and
not a stored grant from generation time, because access moves.

So a guest can never cause a write anywhere the owner could not have written themselves. The owner
delegated shopping, not permission. An origin whose access has since gone is skipped and reported,
which is the one piece of `0049` section 6 that survives intact.

## 7. Presence

The room is `generated:{id}:presence`, following plan `0032`'s rule that the room is the access
control rather than a filter applied to a broadcast.

Presence entries are **not** `PresenceUser`, which is `{ userId, username }` and can describe none
of this. A participant entry carries `participantId`, `kind`, the display name or the guest
number, and `userId` only when there is one.

Two consequences accepted as they are:

- **The device string is not presence data.** A participant's `userAgent` and join time are shown
  on tap, to participants who pass section 5.2 only. Guests do not get to inspect each other.
- **One person on a phone and a laptop is two participants**, and appears twice. It is truthful,
  since it is two sessions, and deduplicating by typed name would be exactly the mistake section
  3.5 warns about.

## 8. Who touched this last

`GeneratedListLine` gains `lastEditedByParticipantId` and `lastEditedAt`, written by every edit
and every settle.

This is what answers "who got the bread" at a glance in a shop where four people are working
through one list, and it is one column rather than a join into an event log because it is read on
every row of the main screen.

## 9. The socket path does not exist

The largest piece of unbuilt infrastructure here, and it is invisible in the feature description.

**Every socket today authenticates with an account JWT.** A participant secret is not one and
names no user, so a guest cannot open a connection at all, and without one there is no presence
and no live basket.

**Recommendation: mint a short lived, list scoped JWT at join and on refresh**, carrying a
`participantId` claim, no `sub`, and an audience naming the one generated list. The socket
handshake is then unchanged, the token is worthless anywhere else, and it is refreshed by
presenting the participant secret, which is the database check that carries revocation.

This collides with a shipped rule and amends it. Plan `0035` established that **a token that names
nobody is an invalid token**, which is correct and was written when the only thing a token could
name was a user. This is the one legitimate token that names no user, and `0035`'s rule becomes
"names neither a user nor a live participant". That amendment is part of this plan, not a surprise
to be discovered at the guard.

## 10. Contracts, events, migrations

- New enums `ParticipantKind` and, from `0047`, `SettlementOutcome`, in
  `libs/luna-shopper/contracts`, per the constant sets rule.
- Events on the generated list's own room: `generatedList.updated`, `generatedList.lineUpdated`,
  `generatedList.lineSettled`, `generatedList.participantJoined`, `generatedList.participantLeft`,
  `presence.generatedListUpdated`. One event on the **zone** room, section 5.3.
- Endpoints under `/v1/generated-lists`, plus an unauthenticated pair for the link preview and the
  join, and a participant authenticated surface for everything a guest does.
- Migrations, in core: the three tables from `0049` section 1, plus `generated_list_share_links`
  and `generated_list_participants`, plus `settledQuantity` and the two attribution columns on the
  generated line. One migration widens `0047`'s `line_settlements`, making
  `settledByUserId` nullable and adding `settledByParticipantId`, with a check constraint that
  exactly one is set.
- Account deletion deletes the caller's generated lists, their links and their participants, and
  that is recorded on plan `0011`'s checklist, section 5. A `LineSettlement` is a zone fact
  and is **not** deleted with the account; its attribution is nulled.
- The OpenAPI document is regenerated.

## 11. Open decisions

- **Per line visibility** instead of section 5.2's all or nothing, once the machinery exists.
  Agreed as the eventual target and deliberately not built first.
- Whether a guest who later registers should keep their participant row, so their edits stay
  attributed across the change. Leaning yes, by attaching the new `userId` and promoting the kind,
  which is cheap and preserves the history. It is not the `TEMPORARY` to `REGISTERED` upgrade in
  plan `0021`: a guest is not an account and opening a link must never create one.
- Default link expiry. Leaning an absolute cap plus expiry when the list is completed or archived,
  since an unauthenticated read of somebody's shopping habits should not outlive the trip.
- Whether several `ACTIVE` generated lists per user should be allowed, inherited from `0049`
  section 10 and still leaning yes.
- Whether an owner can hand a generated list to somebody else outright, which is a different thing
  from sharing it and is out of scope here.

## 12. Exit criteria

- A member with `WRITE` on the sources generates a basket, and a reader cannot.
- One share link, given to three people, produces three participants, and every edit names which
  of them made it.
- A guest joins with no account, optionally types a name, and gets "Guest N" if they do not.
- A registered user opening a link is attached as themselves, once, however many links they open.
- Revoking a link stops new joins and leaves the people already shopping working; revoking with
  the cascade removes them; revoking one participant touches nobody else.
- A revoked participant is refused on the next request, with no cache to wait out.
- The link preview discloses no line, list, zone or member.
- A guest sees the basket and never sees a zone, a list name, a settlement history or the
  allocation sheet.
- A registered participant sees those only while holding `WRITE` on every source, checked on each
  request.
- Settling a whole line, submitting part of one, and allocating per list all write the same
  settlements, and the first two never ask which list anything belongs to.
- Two origins on one line are settled oldest first, and the allocation sheet overrides that.
- A guest's settle is refused on any origin the **owner** may no longer write, and reported.
- A partially settled line shows what was submitted and what is outstanding, and a second settle
  finishes it.
- Presence lists guests and registered participants together, and no guest learns another's device.
- A guest holds a live socket without an account, and a token naming neither a user nor a live
  participant is still refused.
