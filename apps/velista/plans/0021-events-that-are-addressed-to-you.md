# 0021: events that are addressed to you

> Prerequisite reading: `0004` section 6.5 (events into stores), `0015` section on rule
> A2 (the profile owns the name), `0016` (the transport) and `0018` (the audit rule).
>
> Companion plan: `luna-shopper-backend/plans/0030`, which opens the channel this plan
> listens on. **Nothing here works before that lands**, and section 7 says what to do
> about that.
>
> Verified against the source on 2026-08-28.

## 1. Goal

`0018` closed the gap between what the server sends and what a screen shows. This plan
closes the one it explicitly left open: things the server never sent to this client at
all, because there was no room to send them to.

Three symptoms, one cause:

- **Being accepted into a group changes nothing** until a reload.
- **Creating a group** does not appear in the user's other tab.
- **Changing the global username** does not reach the user's other tab, and, the part
  worth reading twice, **never corrects itself**, at any point, for as long as that tab
  is open.

The cause is the whole of backend `0030` section 1: every room in this system is scoped to
a resource, so nothing can be told to a _person_. This plan is what the client does once
a person can be addressed.

## 2. What the client does not have to build

Worth stating first, because it is most of the work not happening.

The `user:{userId}` room is joined by the server at connection, from the token it just
verified. There is no `user.subscribe` message, so:

- `RealtimeClientI` gains **no** new method. No `subscribeUser`, no refcount, no entry in
  `RoomRegistry`, no re-subscribe on reconnect. The room is re-joined by the reconnect
  itself, because joining is part of connecting.
- `RealtimeMemory` needs no new capability either; a test drives these events exactly as
  it drives every other one, by pushing them onto the stream.
- Nothing can be refused, so `refusedZones` and the "not live" badge are untouched.

The whole client change is: two more names in a union, two more mapper branches, and three
stores learning to apply what arrives.

## 3. The union and the mapper

`REALTIME_EVENT_NAMES` (`data-access/src/lib/realtime/realtime-events.ts:102`) gains
`'zone.created'` and `'user.usernameChanged'`. It has agreed exactly with the backend's
`RealtimeEvent` enum since `0016`, and `0018` relied on that agreement; keep it exact.

Two mapper branches in `toRealtimeEvent`:

- `zone.created` → `toZone(payload)`, the same mapper `zone.updated` already uses, since
  the payload is the same `ZoneView`. Returns `null` on anything unmappable, as every
  branch does.
- `user.usernameChanged` → `{ userId, username }`, both required strings, `null`
  otherwise. Deliberately **not** a `UserProfile`: the event carries the name and the id
  and nothing else, and mapping it into the profile shape would invent an email
  verification state and a created date that the payload does not have.

Both get a spec beside the existing mapper specs, including the null cases. Rule D4:
nothing half formed reaches a store.

## 4. Approval, and creation, in `ZoneStore`

### 4.1 The shape both of these share

Both events say _a zone is now yours_ and neither carries a zone the dashboard can draw.
`MyZone` needs `myRole`, `myStatus`, `counts` and a list preview; a `ZoneView` has none of
them, and a `MembershipView` has two of them.

So both branches do the same thing: **`void this.loadZone(zoneId)`**. The event is the
signal; the load is the answer. That is not a workaround, and the alternative is worth
naming so it is not proposed again: composing a `MyZone` from an event would mean
inventing `counts` and `lists`, and `0004`'s rule against exactly that is the reason
`_patch` drops an event for a zone it does not hold.

`loadZone` already does the rest. It `upsert`s, which prepends to `_order` so the group
appears at the top of the dashboard, and `upsert` calls `_syncRooms`, which joins the zone
room the caller may now be in.

### 4.2 `zone.created`

```
case 'zone.created':
  // Only ever addressed to the creator, but checked anyway: a client that trusts
  // routing to be its authorization is one server bug away from rendering somebody
  // else's group.
  if (event.zone.ownerUserId === this._session.userId()) {
    void this.loadZone(event.zone.id);
  }
  break;
```

The tab that created the zone receives this too, having already upserted optimistically in
`createZone`. The extra load is idempotent and it is the reconciling reload that
`createZone`'s own comment says it wants ("the reconciling reload right behind it is what
keeps that from being a story the client tells itself"). No suppression, no "did I do
this" flag: a store that tracked which of its own actions caused which event would need to
be right about that forever.

### 4.3 `member.approved`

The existing branch already patches `myRole` and `myStatus` for `isMe` and calls
`_syncRooms`. It is correct as far as it goes and it stops one step short: a zone the
caller was PENDING in was loaded as a pending summary, so its `counts` are the pending
view's and its `lists` are empty by definition (`toZoneCard` renders `lists: []` for a
pending membership). Flipping the status makes the card tappable and opens onto a group
page with nothing in it.

So: when `isMe` and the new status is `APPROVED` and the previous status was not, load the
zone. The previous status is read before the patch, from `this._byId().get(zoneId)`,
because after the patch there is nothing to compare against.

Not on every `member.approved` for the caller. A redelivery, or an approval for a zone
already approved, would otherwise fire a request per event.

The zone may also be **absent** from the cache entirely: a request made on another device,
approved before this one ever listed its zones. `loadZone` handles that on its own: it is
a fetch and an upsert, not a patch, so it works for a zone the store has never seen. This
is the one place in the store where an event legitimately creates a record, and it is
legitimate because the record comes from the server rather than from the event.

### 4.4 What is not added

`member.rejected` and `member.kicked` / `member.banned` addressed to the user change
nothing here. The kick and ban branches already remove the zone and record a departure,
and now they simply also arrive when the socket had already lost the room, which is the
point of addressing them to the person and needs no client code. `member.rejected` still
carries no zone id and is still not applied; `MembershipStore` removes its row by id
(`0018` section 3.3).

## 5. The username, and the tab that is wrong forever

### 5.1 Why this one is worse than it looks

`SessionStore.username` is:

```ts
this._profile.username() ?? (identity.username || null);
```

Rule A2 (`ProfileStore`'s header): the profile owns the name, the token is the fallback,
and the store's comment closes with "the token catches up on its own schedule and agrees
when it does".

That is true in the tab that did the rename. In a **second** tab it is exactly backwards:

- The profile was loaded before the rename and holds the old name.
- The token pair does refresh, and the new pair does carry the new name.
- The profile is preferred over the token, so the corrected value is shadowed by the stale
  one.

The fallback that exists to prevent staleness is unreachable precisely when it would help.
That is why the reported symptom is "it doesn't even refresh at any point" rather than
"it takes fifteen minutes", and it is why the fix belongs in `ProfileStore` rather than in
a smarter fallback: with realtime applied, the two agree again and A2 stands unchanged.

### 5.2 `ProfileStore` learns one event

`ProfileStore` does not currently touch realtime. It gains a subscription, written **by
hand** with `DestroyRef` teardown and not with `takeUntilDestroyed`:

```ts
const subscription = this._realtime.events.subscribe((event) => {
  if (event.type === 'user.usernameChanged' && event.userId === this._session.userId()) {
    this._profile.update((p) => (p === null ? p : { ...p, username: event.username }));
  }
});
this._destroyRef.onDestroy(() => subscription.unsubscribe());
```

`@angular/core/rxjs-interop` is a secondary entry point module federation does not dedupe,
so `takeUntilDestroyed` in a service several remotes provide throws `NG0203` with a
perfectly correct DI graph. `PresenceStore`, `MembershipStore` and `RealtimeSocket` are all
written this way and all say so; this is the fifth.

`ZoneStore` was **not**, despite being named here as though it were: it still piped
through `takeUntilDestroyed`, which is the one import this rule forbids, in a store four
remotes provide. It was corrected in the same change, since this plan edits that file
anyway and leaving it would have left the only counterexample to the rule sitting beside
a comment restating it.

Three details that are not incidental:

- **A `null` profile stays null.** The event carries a name, not a profile, and inventing
  one would give `SessionStore` a name to prefer over a token that is already correct.
  Null is what makes the fallback a fallback (the `username` computed's own comment).
- **The id is checked.** The room makes it the caller's, and the store does not take that
  on faith, for `4.2`'s reason.
- **It fires in the renaming tab too**, after `setUsername` already wrote the response.
  Writing the same string twice is a no-op, and suppressing it would need the flag section
  4.2 refuses.

`ProfileStore` now injects `REALTIME_CLIENT` and `SessionStore`, which is worth checking
against provider order rather than assuming: both are provided by the app layer beside it
(rule D5), and neither injects `ProfileStore`, so there is no cycle. `SessionStore` reads
`ProfileStore`, one way, as it already does.

> **Corrected while building.** That last paragraph was wrong twice, and the DI graph
> says so at boot rather than subtly:
>
> - `SessionStore` **does** inject `ProfileStore`. That is how rule A2 is applied, and
>   it is stated three paragraphs above this one. So `ProfileStore` cannot inject
>   `SessionStore` back. It reads the id off `TokenStore` instead, which is where
>   `SessionStore.userId` gets it from anyway: `userId` is `tokens.userId` for every
>   non-anonymous identity, so this is the same value one link earlier in the same chain.
> - Injecting `REALTIME_CLIENT` closes a second cycle,
>   `SessionStore -> ProfileStore -> REALTIME_CLIENT -> SessionStore`, because
>   `RealtimeSocket` injected `SessionStore` for R1's `isAuthenticated` check. It now
>   asks `TokenStore.hasSession()`, which is the same predicate: `SessionStore`'s is
>   `tokens() !== null` and so is this one.
>
> The rule that falls out, and the reason both are recorded here rather than fixed
> quietly: **the realtime client sits below the session, so everything on that path asks
> the token store directly.** Anything `SessionStore` depends on cannot depend on the
> socket. Angular catches this as NG0200 on the first injection, so it fails loudly, but
> it fails at boot for the whole app rather than in the store that caused it.

### 5.3 The per zone name is already live

`member.usernameChanged` reaches `MembershipStore`, which applies it with its five siblings
(`0018` section 7.1). Nothing changes there. The reported behaviour, "the zone's username
is reflected if changing username in zones is activated", is that path working correctly,
and it is the contrast that makes the global one look broken. Both are live after this
plan, by two different mechanisms, for the reason backend `0018` gives: the two names are
deliberately two.

## 6. The audit table, brought forward

`0018` section 2 is the standing answer to "does every event reach a screen". These rows
are added to it when this plan lands:

| Event                  | Rendered by                   | Applied by                 | State |
| ---------------------- | ----------------------------- | -------------------------- | ----- |
| `zone.created`         | the dashboard's zone list     | `ZoneStore` (load)         | Live  |
| `user.usernameChanged` | the app bar, the account page | `ProfileStore`             | Live  |
| `member.approved` (me) | the zone card, the group page | `ZoneStore` (patch + load) | Live  |

And `0018` section 6, which says the account screen is stale for want of a backend
decision, is rewritten to say the decision was taken and where.

## 7. Landing this against a server that cannot yet send it

Every part of this plan is inert on today's server: the two new names never arrive, and
the `member.approved` load only ever runs for a zone the caller already holds. So it can
land first, and it should, for the reason `0020` gives: staging deploys only the affected
projects, so a client that needs a simultaneous server deploy to be correct is a client
that is wrong for the length of a deploy window.

What it cannot do is be **verified** first. The acceptance criteria below all need backend
`0030`. Until then the specs are the verification, driven through `RealtimeMemory`, which
is exactly what that double is for.

## 8. Acceptance

1. Two tabs, same account. Creating a group in one puts it at the top of the other's
   dashboard, with its real name and counts, without a reload.
2. Two tabs, same account. Renaming the global username in one changes the app bar initial
   and the account screen in the other, immediately, in every propagation mode.
3. A pending member's card becomes a full, tappable group card the moment an owner
   approves them, with the group's counts and lists filled, and opening it shows the group
   page rather than an empty one.
4. Approving a member who has never listed their zones on this device still produces a
   correct card.
5. A rejected, kicked or banned member's card still disappears, unchanged from `0018`.
6. Nothing in this plan sends a `subscribe` message, and no new entry appears in
   `RoomRegistry`.
