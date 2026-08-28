# 0035: a token that names nobody is an invalid token

> Written after the fact, from commits `ebc5454` (the gateway half) and `7c2aeed`. The
> work is on `dev`; this plan records the design it was built to rather than the one it
> was built from.
>
> Prerequisite reading: `0004` section 2 (the house problem envelope and how a rejected
> NATS call carries it), `0018` section 9 (identity resolution on create and join) and
> `0020` (what the gateway already answers 401 for).
>
> Companion plan: `velista/plans/0028`, the client half. This half must be deployed
> first: the client change is a reaction to a 401 that only this plan can produce.

## 1. The report

Reset the API's database under a phone that is still holding the token pair it was issued
before, and the app can never recover.

Nothing on the client doubts the pair. It is signed by the current key and its expiry is
an hour out, so the proactive refresh does not fire and the interceptor sees nothing
wrong. It goes out on the next create or join, the gateway asks auth for the caller's
profile, auth has never heard of that user, and the answer is `404 not_found`.

The client keeps the credentials, presents them again on the next attempt, and gets the
same answer, forever. No group is created, none is joined, and there is no gesture in the
product that clears the pair.

## 2. Why 404 is the wrong code here

A signature that verifies and an `exp` in the future say the token was issued by us and
has not lapsed. They say nothing about whether the account it names still exists, and the
two come apart in exactly two situations: an account deleted inside the access token's
lifetime, and a database reset under a client holding a pair from before it. The second
is routine in staging and in local development.

`404` is a statement about a **resource**. On these two routes the client cannot tell it
from "no zone has that join code", which is the same status on the same endpoint, so it
has no way to distinguish a mistyped code from a dead identity and correctly refuses to
throw the session away on either.

`401` is the one code the client already reads as "these credentials are spent". It
refreshes, the refresh fails too, and the pair is deleted from the browser. The next
attempt goes out anonymously and works.

## 3. Where the mapping applies

Narrowly, and only where the account was named by **nothing but the caller's own token**:

- resolving the caller's identity on `POST /v1/zones` and `POST /v1/zones/join`;
- the account routes, every one of which is keyed on that `userId` alone.

Everywhere else a `404` about a zone, a list or a membership is about that resource and
passes through untouched. A spec pins the boundary: a mistyped join code signs nobody
out.

### 3.1 `asRejectedCredentials`

One helper in `auth/remote-problem.ts`, applied at the call sites above, beside
`errorCodeOf`, which already narrows a rejected NATS call to the stable `ERROR_CODES`
set. It turns `NOT_FOUND` into `UnauthorizedException` and returns everything else
unchanged, so the decision is a one line reading at each site rather than a rule spread
across controllers.

It is applied to the **rejection of the specific call**, not to a route's whole error
path. A route that also fetched a zone could otherwise convert that zone's absence into a
sign out.

## 4. The check has to actually run

`resolveIdentity` used to skip `auth.getProfile` when the request body carried a
`username`, on the reading that the hop was there to fetch a name and there was no name
left to fetch. That reading was incomplete: the hop is **also the only moment either
route checks that the account behind the token exists at all**.

So a token naming a deleted user could write a zone owned by nobody. Unreachable,
undeletable, with no membership anyone can be removed from, created by a request that
answered `201`. That is a worse outcome than the hop it saved, which falls on the two
rarest operations in the product.

The hop is therefore **unconditional for an authenticated caller**, and the name it
returns is used only when the body did not supply one:

```ts
username: suppliedUsername ?? profile.username;
```

A supplied username decides what core records. It never decides whether the caller is
real.

The anonymous branch is unchanged and still makes no second call: a minted user's name
comes back on the `AuthTokens` from the mint that just happened.

### 4.1 The spec that asserted the skip

There was a spec asserting that a supplied username skipped the profile call. It asserted
a **decision** rather than a behaviour, which is why it did not survive the decision
changing. It is now two specs, both about behaviour: the supplied name still wins, and
the identity behind it is still confirmed.

## 5. The document

`POST /v1/zones` and `POST /v1/zones/join` now document `401`. They could already answer
it for an expired token since `0020` and the document never said so, so the regenerated
`openapi.json` carries both cases, not only the new one.

Regenerated with `npx nx run luna-shopper-backend-gateway:openapi`, never by hand.

## 6. Acceptance

1. A token naming a user auth has never heard of is answered `401` on create, on join and
   on every account route.
2. A mistyped join code is still `404`, and signs nobody out.
3. A `404` about a zone, a list or a membership is unchanged.
4. Create and join resolve the caller's profile whether or not the body names a username,
   and the supplied name still wins when one is given.
5. No zone can be created by a token whose account does not exist.
6. `openapi.json` documents `401` on both routes and the document spec passes.
