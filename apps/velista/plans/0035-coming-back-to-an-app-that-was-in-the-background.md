# 0035: coming back to an app that was in the background

> **Leave the app on a phone for a while, come back, and the session is gone.** Sometimes
> it is the whole account: the app is signed out and asking for a password. Sometimes it
> is only the live half: the screen is drawn, the numbers are right, and nothing on it
> will ever change again. Three separate causes produce that, none of them is the network
> going down, and only one of them is visible to the person it happens to.
>
> This plan fixes all three, and then makes the remaining, legitimate case say so: when
> the socket is genuinely not connected, the notice is coloured like a warning rather than
> like a footnote, and the header carries a mark, so the state is visible from any screen
> rather than only from a list.
>
> Prerequisite reading: `0004` section 8, `0016` section 6 (rules R1 to R3), `0028`, and
> `0002` section 4.4, which is the one this plan has to argue with.

## 1. What happens

Three reproductions, and they are three different bugs that look like one.

- **Signed out.** Open the app, switch to another app for twenty minutes, come back. The
  first request goes out with an expired access token, the refresh that follows fails to
  reach the server because the radio has not finished waking up, and the session is
  cleared. The user is on the landing page.
- **Silently stale.** Open a list, lock the phone, come back a minute later. The list is
  there, the header says nothing is wrong, and a line somebody else ticks off never
  appears. The socket died while the page was frozen and nothing is trying to reopen it.
- **Stale and saying so, quietly.** The same, but the reader happens to be on a list page
  and notices the one grey line at the top of the header saying the list is not live.

## 2. Why it signs the user out

`TokenStore._performRefresh` clears the session inside a bare `catch`, and its own comment
records the decision:

```ts
} catch {
  // Includes a network failure, which is indistinguishable here from a revoked
  // token. Clearing is the safe reading: ...
  this.clear();
  return null;
}
```

The premise is wrong, and it is wrong in a way this repository has already written down
elsewhere. **A network failure is perfectly distinguishable from a rejected token**:
Angular reports a request that never reached a server as status `0`, which is exactly the
test `ConnectionRecovery.hasResponse` makes, for exactly this reason, ten files away.

The reasoning behind clearing is still sound for the case it was written for. A refresh
token is single use, so a refresh the server *answered* with a rejection is spent or
revoked either way, and keeping the pair around would let rule D3's optional auth routes
mint a duplicate guest account later. None of that is true of a request that never
arrived. Nothing was spent, nothing was revoked, and the token being thrown away is still
the only way back into the account.

A resume is the moment this is most likely. The access token has almost certainly expired
while the app was away, so the first request on resume is guaranteed to trigger a refresh,
and the radio is at its least reliable in exactly that second.

**The fix.** `_performRefresh` splits its failure in two:

| The refresh call | What it means | What happens |
| --- | --- | --- |
| answered, any status | the token was rejected, or the server refused it | `clear()`, as today |
| a body that does not parse | the same: the server answered | `clear()`, as today |
| **no response at all (status 0)** | **nothing was spent** | keep the session, report the network failure, return null |

Returning null without clearing leaves every caller exactly where it is. The interceptor's
retry fails, the request surfaces its ordinary error, `ConnectionState.reportNetworkFailure`
raises the blocking screen `0003` section 3.1 already draws over this case, and
`ConnectionRecovery` probes until the backend answers. Every one of those paths exists
today. The session is simply still there when the backend comes back.

**One consequence to state rather than discover.** `TokenStore.gateFor` maps a failed
refresh over a `TEMPORARY` identity to `guest-account-lost`, which is `0028`'s account lost
panel. With this change a network failure no longer produces that state, and it should not:
telling a guest their account is gone because their phone was in a lift is the same false
alarm as signing a full user out, and it is the one with no way back.

## 3. Why the socket never comes back

`RealtimeSocket` gives up after two consecutive failures and latches `degraded`, which is
rule R3 and is right: the client cannot tell a rejected token from a dropped network, and
against the former no number of retries ever succeeds. The class provides exactly one way
back out, and the constructor arms exactly one thing to use it:

```ts
effect(() => {
  const online = this._browser.onLine();
  untracked(() => { if (online) this.retry(); });
});
```

**Regaining the network is the only re-arm, and a backgrounded app never lost it.** The
`online` event fires when the interface comes back, and on the resume this plan is about,
the interface never went anywhere. What happened is that the browser froze the page, closed
the socket, and let the retry timers stop. The page comes back holding a latched `degraded`
and a re-arm waiting for an event that already happened, or that will never happen at all.

`retry()` is public and documented as "the same door with a handle on it, for a UI to
call". Nothing calls it. There is no control anywhere in the app that reaches it, so today
a latched `degraded` ends only in a reload.

## 4. Nothing notices the app came back

Which is the cause underneath both of the others. There is no `visibilitychange` handler,
no `pageshow` handler and no page lifecycle awareness anywhere in `apps/velista` or
`libs/velista`. The app cannot react to a resume because it does not know a resume is a
thing that happens to it.

That is the piece to build, and it belongs in `platform` beside `BrowserFacade.onLine`, for
the same reason that signal lives there: it is a fact about the browser that both
`data-access` and `ui` need, and `ui` may not import `data-access` (`0004` section 3.2).

### 4.1 One signal, two events, and why both

`BrowserFacade` gains `visible`, a signal fed from the document's `visibilitychange`, and
`AppResumed`, a small service in `platform` that turns the false to true edge into
something other services can subscribe to.

Two event sources, because one of them does not cover the case that matters most:

- **`visibilitychange`** is the ordinary one. Tab switch, app switch, screen lock.
- **`pageshow` with `persisted === true`** is a page restored from the back/forward cache,
  which is a **different** thing: the whole document was evicted and put back, timers and
  all, and on iOS Safari it is what happens to a backgrounded installed app far more often
  than a plain visibility change does. A page restored this way can come back with a dead
  socket and never fire `visibilitychange` at all.

Both edges produce one resume. Consecutive resumes closer together than a small threshold
collapse into one, because a phone unlocking can fire both.

### 4.2 What a resume does, in order

A resume is not a reload and must not become one. It is three cheap re-assertions, and each
of them is a call that already exists:

1. **`RealtimeClient.retry()`.** Unconditional. It clears `degraded`, resets the failure
   count and reconnects, and against a socket that is already healthy it is close to free.
   The rooms come back by themselves: `RoomRegistry.onConnected` rejoins everything the
   screens still hold (rule R6), so nothing here has to know which page is open.
2. **`ConnectionRecovery.probe()` once**, immediately, rather than waiting up to ten
   seconds for the next tick of its interval. If the app was put down inside a lift and
   picked up outside one, the blocking screen should be gone before the person has read it.
3. **Nothing else.** No store refresh, no refetch, no navigation. The socket coming back
   runs `_reconcile`, and the screens are driven from events. A resume that refetched every
   open store would turn every glance at the phone into a burst of requests, and it would
   fight `0034`'s update check for the same moment.

**A resume never reloads the page.** `ConnectionRecovery` already reloads when the backend
comes back, deliberately deferred until nothing holds unsaved state, and that path is
untouched. A resume that reloaded on its own would throw away a half typed comment every
time somebody checked the time.

### 4.3 Where it is wired

`AppResumed` is a `platform` service holding the signal and the edge. The two reactions live
where their dependencies already are: `RealtimeSocket` in `data-access` reads it in an
effect beside the `onLine` one it already has, and `ConnectionRecovery` reads it in the
effect it already has. Neither gains a new dependency direction, and `platform` gains no
knowledge of either.

## 5. Saying it when the app really is not connected

The three fixes above remove the cases where the app was wrong. What is left is the case
where it is right: the socket is down, the screen will not update itself, and that has to be
legible.

### 5.1 What exists today

One line, on one screen. `ListHeader` draws `list.header.notLive` behind `!header().live`,
in `--app-text-2xs` and `--app-text-muted`, with the offline glyph beside it. On every other
screen in the app, including the dashboard, a group page and the assistant, a dead socket
looks exactly like a live one.

### 5.2 The colour, and the collision it walks into

The requirement asks for yellow. **This design system deliberately has no yellow warning
role**, and `0002` section 4.4 is a page of argument about why: amber is the brand action
colour, an amber action and an amber warning are hard to tell apart, and the place that
ambiguity would do the most damage is a shopping list row. What a warning would have covered
was split into `danger` (coral, destructive and `NOT_AVAILABLE`) and `attention` (violet,
anything awaiting a person).

So the choice is between reopening that decision and using the role it created for cases like
this one. **Use `--app-status-attention-*`.** Being disconnected is not destructive and it is
not an error the user made; it is a state waiting on something, which is the exact sentence
`attention` was defined for, and it is already the colour of every pending thing in the
product. It is not yellow, and the requirement says "yellow or another colour that clearly
indicates it", which this is: violet against the muted grey it replaces is a larger jump in
salience than amber against grey would have been.

The notice keeps its glyph, gains `--app-status-attention-fg` on the text and the icon, and a
tinted `--app-status-attention-bg` strip so it reads as a band rather than as small print.
Its size goes from `2xs` to `xs`: `2xs` is the size this app uses for metadata, and this is
not metadata.

**If yellow is insisted on later**, the honest version is a new `warning` role with its own
token triple and a contrast check across both themes, not an inline colour, and `0002`
section 4.4 gets an amendment rather than a workaround. That is a larger change than this
plan, and it is not this plan.

### 5.3 The mark in the header

`AppBar` gains an offline mark, drawn only when the socket is not connected, sitting before
the two action buttons. It is the same `OfflineIcon` the notice uses, in the same attention
colour, with an `aria-label` and no press behaviour: a button here would have to lead
somewhere, and there is nowhere to go.

Two rules about it:

- **It is not the blocking screen's business.** `ConnectionState.offline` covers the page
  with `ConnectionLost`, and the header is behind it. This mark is for the case where HTTP
  works and the socket does not, which is precisely `degraded` or a plain disconnect, and is
  the case that today has no symptom outside a list page.
- **Rule D1 holds.** `AppBar` takes `connected` as an input and knows nothing about
  `RealtimeClient`. The pages that draw the bar pass it, the same way they already pass
  `signedIn` and `accountInitial`.

The list header's notice stays. It says something the mark cannot: **this list** is not live,
which is also true when the zone room was refused while the socket is perfectly fine. The two
are not duplicates. The mark is about the connection, and the notice is about the screen.

## 6. What is tested

The three causes are three unit tests, and none of them needs a browser.

- **`token-store.spec.ts`**: a refresh that fails with status 0 leaves `hasSession()` true
  and the stored pair intact; a refresh answered with 401 clears it. Then the pair that
  matters: `gateFor` over a `TEMPORARY` identity answers `guest-account-lost` for the second
  and **not** for the first.
- **`realtime-socket.spec.ts`**: drive the fake socket to two failures so `degraded` latches,
  fire a resume with `onLine` never changing, and assert a connect attempt was made. That
  test fails today.
- **`app-resumed.spec.ts`**, new: hidden then visible produces one resume; a `pageshow` with
  `persisted` produces one; the two inside the collapse window produce one, not two.
- **`app-bar.spec.ts`** and the list header spec: the mark is present when `connected` is
  false and absent when true, and it carries an accessible name.

`whenStable` is not used in any of these: these specs are zoneless, so drain microtasks
instead.

## 7. Exit criteria

- A refresh that gets no response leaves the user signed in, and one the server rejects signs
  them out exactly as it does today.
- A guest whose refresh failed on a network error is not told their account is lost.
- Backgrounding the app for long enough to kill the socket and returning restores the live
  connection with no reload and no user action.
- A latched `degraded` is cleared by a resume, not only by an `online` event.
- A resume issues at most one probe and no store refetch.
- With the socket down, the disconnected state is visible from every screen in the app, in a
  colour that is not the same grey as metadata, and it disappears within a second of the
  socket coming back.
- Nothing in this plan introduces an inline colour or a token outside `_semantic.scss`.
