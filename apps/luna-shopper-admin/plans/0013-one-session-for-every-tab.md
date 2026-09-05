# 0013 One session for every tab

A back office is used by opening things in new tabs. Plan `0002` put the token in
`sessionStorage`, which is scoped to a tab, so every tab opened from a bookmark or
from a typed address was a login screen. This plan makes the session belong to the
origin instead of to the tab, and makes the tabs that share it renew it once
between them rather than once each.

Two complaints, and they are the two halves of this plan:

1. **A new tab asks for a password.** The operator is signed in on the tab beside
   it. Nothing about the session changed; only its address did.
2. **Five tabs are five renewals.** Every tab runs its own keepalive timer, every
   timer is computed from the same token, so they all decide to renew at the same
   instant and each asks the gateway for its own.

## 1. What an operator sees afterwards

- Signing in on one tab signs in every tab of this app, including tabs opened
  afterwards, until the session ends.
- Signing out on one tab signs out all of them.
- When the token expires while nobody is there, every open tab raises its
  re-authentication overlay, and **one** password takes all of them down.
- Whatever the tab count, the gateway sees one renewal per renewal point.

Nothing else about `0003` changes. The token still renews indefinitely while
somebody is working, an idle session still warns and then expires, and an expired
one is still recovered in place with nothing unmounted and no form state lost.

## 2. `localStorage`, and what it costs

The store is `localStorage` under the key `0002` already used,
`luna-shopper-admin.session`. It is per origin rather than per tab, which is the
whole change: a tab that opens later reads what the tab beside it wrote.

`0002` chose `sessionStorage` for one property, and this plan gives it up
knowingly: **closing the browser no longer ends the sitting.** Three things make
that acceptable rather than a decision to care less.

- The token is short lived and there is no refresh token behind it. What is
  stored is an access token, not a credential that can mint one.
- An expired token is discarded on sight, on the read that finds it, and removed
  from storage in the same act. A browser reopened after a lunch break finds
  nothing.
- A renewal presents the token itself, so a token that is already over cannot be
  renewed into a live one. The exposure has a hard ceiling of one token lifetime.

Weighed against that: a password on every new tab, which is the thing an operator
does dozens of times a day, and which they will make cheaper themselves by
leaving one tab signed in forever.

**A session an earlier build wrote is picked up once.** The first read moves it
out of `sessionStorage` into `localStorage`, so the deploy that lands this plan
does not sign everybody out on the way in.

Sharing needs no handshake, no leader election and no broadcast channel. Two
browser primitives do all of it: `localStorage` for the value, and the `storage`
event for the notification.

## 3. Hearing what the other tabs did

`SessionStorage.watch` reports what another tab wrote, and `SessionLifecycle`
listens from its `start`, beside the activity listeners and for the same reason:
nothing injects a session store until a token is wanted, and a tab that nobody has
asked yet is exactly the tab that has to hear about a renewal it did not make.

The `storage` event has one property this design rests on: **it never fires in the
tab that wrote.** So a renewal tells every other tab and does not tell itself.
There is no echo to suppress and no loop to break, and a tab that adopts a session
deliberately does **not** write it back, because a second write would be a second
event for every other tab to react to.

`supersedes` decides whether an offered session replaces the held one. Its
commonest answer is `false`, because a tab is offered the token it already holds
every time it reads storage during its own renewal. The case it exists for is the
other one: the browser says nothing about the order two writes landed in, and
adopting an older token would replace a live session with one closer to expiry and
start the whole app renewing against it. A different operator is the exception and
is checked first, because a tab that kept the previous token would go on making
requests as somebody who signed out.

An unusable value, and a cleared key, both read as `null`, and `null` means the
same thing everywhere: there is no shared session any more.

## 4. One renewal between them

Serializing is not enough on its own. Four tabs entering a lock one at a time still
make four requests. What removes the other three is the tab that holds the lock
**reading storage again inside it** and finding the token the first one wrote.
That read is the mechanism; the lock is what makes it meaningful.

The lock is `navigator.locks`, wrapped in `withRenewalLock`. It is a browser
primitive that serializes across the tabs of an origin and releases when the tab
holding it closes, which is the part a lock hand built out of `localStorage` gets
wrong: such a lock needs a timeout to survive a tab closed mid renewal, and that
timeout is either too short to be a lock or too long to be usable.

A browser without the API runs the work unserialized. That is the honest
degradation. Tabs that decide in the same instant can each renew, which is the
behaviour before this plan, and it costs a duplicate request rather than a session.

The per tab single flight from `0003` stays exactly as it was. It answers a
different question: several callers in **one** tab wanting a renewal at once.

## 5. One sign out

Clearing the key ends the session in every tab. A tab left open elsewhere that
kept its own copy would go on making requests as an operator who believes they
left, and the shared token makes that a real tab rather than a hypothetical one.

The reverse direction matters as much and is easier to miss: a tab whose overlay is
up is asking for a password that, once another tab has been given it, already
exists. So a superseding session takes this tab's overlay down and releases every
request waiting behind it against the token that arrived. Being able to unlock a
tab from another one is the point of sharing a session, not a side effect of it.
The alternative is an operator typing the same password into every tab they had
open.

## 6. What is not in this plan

- **No cross tab identity read.** Each tab still asks `me` for itself. It is one
  request per tab at sign in, it decorates the chrome rather than gating it, and
  routing it between tabs would be machinery for nothing.
- **No shared reachability probe.** `0008` already coalesces per tab, and an
  outage is not something a tab needs to be told about by another tab; its own
  next request tells it.
- **No `BroadcastChannel`.** The `storage` event carries the value, which is the
  only thing a tab needs. A second channel would be a second thing to keep in
  agreement with the store.
- **No idle timeout across tabs.** Activity stays per tab, as `0003` defined it.
  A tab the operator is working in renews the token, and the tabs that are not
  being touched adopt what it produced, which is the correct outcome without a
  new rule.
