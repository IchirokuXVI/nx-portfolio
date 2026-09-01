# 0048: a socket a guest can hold

> The basket is the one screen in this app where several people act on the same rows at the
> same time, in a shop, on phones, and it is the one screen with no live connection. Velista
> `0044` shipped it refetching: after its own writes, and on resume. So two people shopping
> from one basket see each other's work when one of them happens to reload, which on a screen
> whose entire premise is "we are splitting this trip" is the wrong answer often enough to
> matter.
>
> The reason is not an oversight and not a missing backend. **The backend half is built.**
> Backend `0051` section 9 called the participant socket "the largest piece of unbuilt
> infrastructure here", specified it, and it was built: `auth`'s `token.service.ts` mints a
> token carrying `participantId`, and `realtime`'s `token-verifier.service.ts` accepts
> `kind: 'participant'`, requires an `aud` naming the one generated list, and carries the
> amendment to `0035`'s rule that a token naming nobody is invalid.
>
> What is missing is entirely on this side: every socket this app opens authenticates with an
> account JWT, and a guest does not have one.

## 1. What is actually broken

Three things, and only the first is the connection itself.

1. **No live basket.** `generatedList.lineUpdated` and `generatedList.lineSettled` are
   published to the basket's own room and this app cannot join it. `realtime-events.ts` says
   so in a comment, which is the honest thing to do with a known gap and is not a substitute
   for closing it.
2. **Presence is the wrong question answered.** The row of faces on the basket is built from
   the **participant list**, so it shows who has ever joined this basket, not who is holding a
   connection now. The mock says "4 here now". The screen says something closer to "4 have a
   link". Those diverge exactly when it matters: after a trip, when everybody has gone home and
   the basket still claims a crowd.
3. **A guest cannot be told anything.** With no socket at all, a revoked participant learns
   they are revoked on their next write. That is the documented behaviour from `0051` and it is
   fine as a floor, but it means a guest whose access was cut keeps tapping a screen that looks
   live.

## 2. The connection

**A second connection, not a modified first one.** `RealtimeSocket` reaches `ApiUrl`,
`TokenStore` and `SessionStore`, and it is bound app wide as `REALTIME_CLIENT`. Teaching it a
second credential would put "which of two identities am I" inside every existing zone and list
subscription, to serve one screen. The participant connection is its own client, with its own
token source, and it is alive only while a basket screen is.

### 2.1 Who holds which

| Who                                              | Account socket | Participant socket       |
| ------------------------------------------------ | -------------- | ------------------------ |
| Guest, no account                                | none to hold   | while on a basket screen |
| Registered participant on somebody else's basket | as usual       | while on a basket screen |
| Owner, on their own basket                       | as usual       | while on a basket screen |

The owner holds both, and that is deliberate rather than redundant. The owner's account room
already receives `generatedList.lineSettled` (velista `0044` added the owner audience so the
home card's counts could move), but the **basket room** carries the per line detail the basket
screen needs and the account room does not. Two rooms, two granularities, one screen that wants
the finer one while it is open.

### 2.2 The token, and why it is not stored like a session

The participant token is short lived and list scoped. It is obtained by presenting the
participant secret, which `BasketSessionStore` already holds, and refreshed the same way. That
refresh is the revocation check: `0051` makes revocation a database fact, and a token that can
only be renewed by a secret the server will refuse is a token that expires into a refusal
rather than one that has to be hunted down.

It therefore **never joins `TokenStore`**. `TokenStore` is the account identity, `gatewayInterceptor`
attaches it to every request, and a participant token attached to an account request would be a
credential confusion bug of exactly the kind that is hard to see and easy to write. The
participant token lives beside the secret, in the basket session, and reaches exactly one
socket.

### 2.3 The constraint that shapes the implementation

**Nothing created per app may use `@angular/core/rxjs-interop`.** It is a secondary entry point
module federation does not dedupe, and a service provided by several remotes that calls
`toSignal` or `takeUntilDestroyed` throws `NG0203` against a perfectly correct DI graph.
`RokuLocaleStore` writes its signal by hand for this reason and so does the existing realtime
layer. The participant client is a service in exactly that category. It writes its signals by
hand and unsubscribes by hand.

## 3. What arrives, and what a guest may see

The basket room carries `generatedList.updated`, `generatedList.lineUpdated`,
`generatedList.lineSettled`, `generatedList.participantJoined`, `generatedList.participantLeft`
and `presence.generatedListUpdated`.

`BasketStore.apply(line)` was written by `0044` so that this plan is a call rather than a
redesign: it merges one line by id and keeps the `origins` the store already holds. That shape
matters more than it looks, because of what a guest's payload does not contain.

**The broadcast is redacted, and the client must not assume otherwise.** `0044` fixed a leak
where the settle route and its `generatedList.lineSettled` broadcast carried
`origins[].zoneId`, `origins[].listId`, `settlements[].listId` and `skipped[].listId` into a
room full of guests. A redacted line therefore arrives with less on it than the line the store
holds, and merging it naively would blank fields a privileged reader had legitimately fetched.
Merging by id while keeping held `origins` is what keeps a redacted event from downgrading an
unredacted view.

The client draws no conclusion from an absent field. "Absent because you may not see it" and
"absent because it is empty" look identical on the wire and mean different things, so the
store's existing rule holds: a field the event does not carry is left as it was, never set to
empty.

## 4. Presence, properly

`presence.generatedListUpdated` is the event, and velista `0023` already established the rule
this screen needs: **presence follows the screen.** Being in the basket's room is the intent to
be present on it; leaving the screen ends it. That is why the connection's lifetime is the
screen's lifetime rather than the session's, and why a backgrounded app (velista `0035`)
resolves presence by reconnecting rather than by a timer.

Two rules from `0044` section 5.1 survive unchanged and are worth restating because presence is
where they are easiest to break:

- **A guest is visibly a guest, and the word "anonymous" is never used.** The distinction is
  drawn, the judgement is not.
- **No guest learns another guest's device.** Presence says somebody is here. It does not say
  what they are holding.

The face row becomes who is connected. The participant list stays reachable in the people
sheet, where "everybody who can open this basket" is the right question and is a different one.

## 5. Falling back, and not lying about it

A socket that will not open must not turn the basket into a broken screen. It degrades to
`0044`'s behaviour, which is a working screen: refetch after our own writes and on resume.

The difference is that it **says so**. A basket that is live and a basket that is refetching
look identical while nobody else is shopping, and completely different the moment somebody is.
The screen carries a quiet indicator of which one it is, in the same place and the same
register as the app's existing offline treatment, so that "nothing is moving" is
distinguishable from "nothing is happening".

Presence is hidden entirely when the connection is down, rather than frozen at its last known
value. A stale face row is a claim about the present tense that nothing is checking.

## 6. Localization

New keys in both locales: the degraded indicator from section 5, and the refusal from section
7 when a participant has been revoked. Everything else on this screen already has copy from
`0044`. No key added here says "anonymous" or names a guest's device.

## 7. Revocation reaches the screen

A revoked participant's token refresh is refused. Today the screen learns this on the next
write; with a connection it learns it at the refresh, which is sooner and is the point.

The screen does not silently close. It says the link is no longer valid, keeps whatever is on
screen readable, and offers the way back. A basket that vanished mid shop with no sentence
would be indistinguishable from a crash, and the person holding the phone is standing in a shop
with a trolley.

## 8. What is tested

- The participant client: connects with a participant token, refreshes by presenting the
  secret, and does not put either in `TokenStore`.
- A spec asserting the participant token never reaches `gatewayInterceptor`.
- `BasketStore` merging a redacted `lineUpdated` over an unredacted held line and keeping
  `origins`; and leaving an absent field alone rather than emptying it.
- Presence: the face row is connection derived, empties when the socket drops rather than
  freezing, and marks guests without the word "anonymous".
- The connection opens on entering a basket screen and closes on leaving it, including on the
  back gesture (velista `0031`'s rule that back never reopens a sheet applies to the sheets
  over this screen unchanged).
- Degraded mode: with the socket refused, the screen still settles, still refetches, and shows
  the indicator.
- Revocation: a refused refresh draws the refusal rather than closing the screen.
- No file added by this plan imports `@angular/core/rxjs-interop`.

## 9. Acceptance criteria

- A guest with no account holds a live socket to one basket, and to nothing else.
- Two people on one basket see each other's settles without either reloading.
- The owner watching their own basket sees line level updates, and their home card's counts
  still move from the account room as they did before.
- The face row shows who is connected now, and empties when the last person leaves.
- A guest is marked as a guest, no guest learns another's device, and nothing says "anonymous".
- A participant token never travels on an account request and never enters `TokenStore`.
- A redacted event never blanks a field a privileged reader had already loaded.
- With the socket refused the basket still works, says it is not live, and hides presence.
- A revoked participant is told, on the screen, without it closing under them.

## 10. Out of scope

- **Per line visibility for guests.** Still all or nothing, per backend `0051` section 11,
  which names it the eventual target and deliberately not first.
- **A guest keeping their participant row after registering.** Backend `0051` open decision,
  unresolved, and not a socket question.
- **Prices, and the basket's empty price region.** Backlog `0004`.
- **The zone room's claim indicator.** `line.claimChanged` has no publisher; backend `0052`.
