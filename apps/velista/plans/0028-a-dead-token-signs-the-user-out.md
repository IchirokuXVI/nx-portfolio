# 0028: a token whose account is gone signs the user out

> Written after the fact, from commit `ebc5454`. The work is on `dev`; this plan records
> the design it was built to rather than the one it was built from.
>
> Prerequisite reading: `0014` (the gateway interceptor and the refresh path), and rule
> D3 on the optional auth gate in `ZoneApi`.
>
> Companion plan: `luna-shopper-backend/plans/0035`, which makes the gateway answer 401
> for a token naming an account that does not exist. That half must be deployed first:
> everything here is a reaction to a status the server did not previously send.

## 1. The report

Reset the API's database under a phone still holding its token pair, and the app is stuck
for good. The pair looks perfectly healthy to every check the client makes, so it is
presented on the next create or join, refused, and **kept**. The next attempt does the
same thing, and so does the one after that. There is no gesture in the product that
clears it.

The server side of why is `0035`. This plan is the client's three parts of it.

## 2. The gate cannot catch this, and was never meant to

`ZoneApi.createZone` and `joinZone` already run the rule D3 gate before the request:
`authorizeOptionalAuthCall` refreshes proactively, so an expired guest identity is caught
before a round trip and reported as `guest-account-lost`, which is the screen that
already exists for it.

A token signed by the current key with an hour left on it **passes that gate**, and the
account it names may still be gone. Only the server knows. So the gate keeps its job and
gains a second half behind the request: `_lostTheAccountWeSent`, answered from the error
rather than before it.

The two are complementary, not redundant. The gate saves a round trip on the case it can
see; this catches the case nobody can see from here.

## 3. Deleting the pair, on either way out

The interceptor's refresh path already cleared the pair when the **refresh** failed, in
`TokenStore`. It did not clear it when the refresh **succeeded** and the retried request
was refused again.

That second case is the one this defect produces: a token minted a moment ago, rejected
on the same tick. A credential that new being refused does not say the credential was
stale, it says the identity behind it is gone. So a 401 that survives the retry clears
the pair too.

The invariant the whole path exists for, stated once: **a session the server will not
accept must not survive in the browser.** Either way out of the retry that is still a 401
deletes it.

## 4. Which screen the user gets

The interceptor's error path cannot tell a lost guest identity from a signed out user,
and that distinction is exactly what the caller needs, so `ZoneApi` makes it in
`_lostTheAccountWeSent`. Three conditions, each load bearing:

- **A 401**, and not any failure. A 404 on a join is "no zone has that code", which is
  the person's own typo and not a lost account.
- **No session left** by the time it runs. A 401 the app recovered from by refreshing is
  not a lost account, and section 3 guarantees that a 401 which was not recovered from
  has already emptied the store.
- **A pair that was actually presented, and a `TEMPORARY` one.** With nothing sent there
  was no account to lose. A registered user has credentials to sign back in with, which
  is a different sentence and a different screen: they get copy saying they were signed
  out, added to both locales.

The pair is captured **before** the request rather than read out of the store when the
error arrives, because by then the session is already gone and there would be nothing
left to ask what kind it was.

Both routes send `username` **omitted** rather than empty when the caller has no per zone
name in mind: the backend fills it from the global username, and the validation pipe runs
with `forbidNonWhitelisted`, so a stray `undefined` is not something to be casual about.

## 5. Acceptance

1. With the API's database reset under a live client, the first create or join fails, the
   pair is deleted, and the **next** attempt goes out anonymously and succeeds.
2. A 401 that survives the retry clears the pair, not only a failed refresh.
3. A guest whose account is gone lands on the existing `guest-account-lost` screen; a
   registered user is told they were signed out, in both locales.
4. A 401 the app recovers from by refreshing reports nothing to the user.
5. A mistyped join code still reports "no zone has that code" and signs nobody out.
6. The pre request gate still short circuits an expired guest identity with no round
   trip.
