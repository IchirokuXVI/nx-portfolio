> **PR:** [#196](https://github.com/IchirokuXVI/nx-portfolio/pull/196)

# 0067: a session that outlives the backend

> **Leave the app for five hours, come back, and the account is gone.** Not the session:
> the account. A temporary user has no password, no email and no recovery, so the pair in
> `localStorage` is the whole of their identity, and every path that deletes it is a path
> that deletes them.
>
> Plan `0035` fixed the first of these and named the premise behind it: a failed refresh
> is not a rejected token. It corrected the case it could see, a request that reached no
> server, and left the rest of the premise standing as "anything the server answered".
> That turns out to be a far wider net than "the server refused this token", and
> everything caught between the two is an outage rather than a rejection.
>
> There is a second cause underneath, which has nothing to do with the backend at all:
> one origin holds two documents. The installed app and the browser tab share a
> `localStorage`, hold independent copies of the pair, and rotate each other's refresh
> tokens on any resume that wakes them both.
>
> And a third, which is the expensive one: an app that keeps a session it could not prove
> then treats itself as anonymous, and the next thing it does is call a route that mints
> a **new** guest account.
>
> Prerequisite reading: `0035`, `0004` sections 5.5 and 8, `0008` section 3.4, and
> `0028`.

## 1. What happens

Three reproductions. The first is what a user reports, the second and third are what the
first one is made of.

- **Signed out after a few idle hours.** The access token lives fifteen minutes and the
  refresh token thirty days, so five hours idle should cost one refresh and nothing else.
  It costs the account instead, whenever the refresh lands in a window where auth is not
  answering. Every deploy is such a window: `kubectl rollout restart` is asynchronous, and
  during it the gateway's broker call to auth finds nobody and `GlobalExceptionFilter`
  answers **500 `internal`**, or the gateway pod itself is gone and the proxy answers its
  own **503**. The client reads either as "your refresh token was rejected" and deletes
  the pair.
- **Signed out while using two windows.** The app is installed to the home screen and also
  open in the browser. Both resume, both refresh, and the backend revokes the presented
  token on every rotation (`auth/src/app/tokens/token.service.ts:177`). The loser presents
  a token the winner revoked a second earlier and gets a perfectly truthful 401. Clearing
  on it removes the key, and the winner is signed out too.
- **A second account, quietly.** Not a sign out at all. The gate that decides whether a
  zone is created as somebody or as nobody reads a failed refresh as "nobody", so during
  an outage a user with a working account creates a group on a brand new empty one, and
  their groups stay where they were.

## 2. Only a refusal is a refusal

`TokenStore` split its failures with `hasResponse`, which is `status !== 0`:

```ts
if (!hasResponse(error)) {
  return null; // nothing was spent
}
this.clear(); // "the server answered, whatever it answered"
```

The comment is the bug. "The server answered" is the right question for whether the
network is up, which is why `ConnectionRecovery` asks it, and the wrong question for
whether a credential was refused. A refresh token is single use, so **a refusal** means
spent or revoked either way, and that reasoning is sound. It does not reach a 500 from a
gateway that never got as far as auth, a 503 from a proxy with nothing to route to, or a
504 on a broker timeout. None of those touched the token.

**The fix.** A second predicate, `isCredentialRejection`, beside the first, and only it
may end a session.

| The refresh call             | What it means                          | What happens                     |
| ---------------------------- | -------------------------------------- | -------------------------------- |
| 401 or 403                   | the credential was refused             | `clear()`                        |
| no response at all           | nothing was spent (`0035`)             | keep, report the network failure |
| **5xx, 408, 429**            | **the server could not answer for it** | **keep, surface the error**      |
| **a body that cannot parse** | **rule D4 says it is not a session**   | **keep**                         |

The last row moved as well, and it is worth saying why, because `0035` put it on the
other side. A 200 carrying something this app cannot read is not a session, so the
refresh still fails. It is also not a refusal, and the likeliest way to meet one is a
captive portal answering every request with its own login page, which is an ordinary
Tuesday in a supermarket. If the pair really was spent, the next refresh is answered 401
and cleared then, at the cost of one round trip. Being wrong the other way costs an
account.

Nothing downstream changes. The request still fails, `ConnectionState` still raises the
blocking screen, `ConnectionRecovery` still probes until the backend answers. The session
is simply still there when it comes back.

## 3. One origin, two documents

Single flight is per document, and velista is installable, so the origin can hold two at
once: the installed window and a browser tab, over one `localStorage`. Each keeps the
pair in its own signal, each refreshes on its own resume, and the loser's 401 is real.

Three things answer it, and they are three because the race can be met at three moments.

- **Before presenting anything**, `_newestHeldPair` reads storage rather than trusting the
  signal. A tab that has been asleep for an hour is holding a pair the installed app
  replaced, and storage is the shared truth. When what is stored came from elsewhere and
  is still good, there is nothing to ask the server at all.
- **On a 401**, `_newerThan` checks whether the token that was refused is still the one
  this origin holds. When it is not, the pair is adopted and the refresh is retried on it,
  once. One, because a second restart would be racing the other document rather than
  catching up with it.
- **Continuously**, `BrowserFacade.watchStorage` feeds the `storage` event to the store,
  which never fires in the document that did the writing. A pair is adopted, a removal is
  a sign out and is followed, and an unreadable value is ignored: one corrupt write on a
  shared origin must not end a working session.

## 4. An unproven session is not an anonymous one

`authorizeOptionalAuthCall` is rule D3's gate, in front of the two routes that mint a
guest account when they see no identity. It answered three states, and a refresh that
failed without clearing fell through to `anonymous`.

That was safe while a failed refresh always cleared. `0035` made the session survive, and
in doing so made the fall through reachable: a user with a perfectly good account, whose
refresh met a 503, is told that nobody is signed in, and the route they were on their way
to hands them a second, empty one. Their groups stay on the first. A temporary user has no
password with which to go back and find it.

So there is a fourth state, `unavailable`, meaning a session is held and could not be
proven right now. `refuseUnprovenSession` turns it into a refusal at every call site, and
the call never leaves the client. The failure is a `NetworkError` rather than a fourth
case threaded through four result types, which is the honest shape of it: nothing was
attempted and nothing changed, and "we could not do that, try again" is already the
sentence `entryErrorKey` shows for one.

`optional-auth-refuses-unproven.spec.ts` scans the library for a call to the gate with no
call to the refusal beside it, because the mistake here is an omission and an unguarded
new call site reads exactly like a guarded one.

## 5. Where a session may still end

Four places, and there is no fifth.

1. A refresh answered 401 or 403, and the pair that was refused is still the newest one on
   this origin.
2. The interceptor's retry, holding a pair minted seconds earlier, is refused 401, and the
   same check passes. That is `TokenStore.reportRejected`, which the interceptor calls
   instead of reaching for `clear()` itself: whether the pair was still ours is a question
   only the store can answer.
3. The user signs out, or deletes their account.
4. The other document on this origin did 3.

## 6. What this does not fix

The window is narrower, not closed. A refresh that is genuinely spent is still discovered
one round trip later than before in the unreadable body case, and a user whose refresh
token expires after thirty days idle is still signed out, which is correct. The blocking
screen and the reload behind it are still `0003`'s deliberately weak version, unchanged
here.

An httpOnly refresh cookie remains the real answer to the storage question (`0004`,
section 11) and would delete most of section 3 along with it, since the pair would stop
being something two documents each hold a copy of.
