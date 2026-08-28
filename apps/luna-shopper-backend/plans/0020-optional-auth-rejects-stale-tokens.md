# 0020 Optional auth must reject a stale token

`OptionalJwtAuthGuard` treats an expired access token exactly as it treats no token at all. On
the two routes that use it, that means a returning guest is silently given a **new** guest
account, and everything the old one owned becomes unreachable.

This is the smallest plan in the set and the one with the largest downside if it is skipped. It
lands first because 0023 needs the same guard before it can carry a userId across the Google
round trip safely.

## 1. What happens today

Three facts, each reasonable alone.

**The guard swallows every failure.** `gateway/src/app/auth/jwt-auth.guard.ts:27`:

```ts
override async canActivate(context: ExecutionContext): Promise<boolean> {
  try {
    await super.canActivate(context);
  } catch {
    // Ignore: anonymous is allowed on these routes.
  }
  return true;
}
```

The `catch` cannot tell a missing `Authorization` header from a signature that does not verify,
a token for a deleted user, or, the case that matters, a token whose `exp` has passed.
`handleRequest` then returns `undefined` for the user and the request proceeds as anonymous.

**An anonymous caller on these routes gets a fresh identity.** `zone.controller.ts:83`,
`resolveIdentity`, calls `AUTH_PATTERNS.createTemporaryUser` when no caller is attached. That is
correct behaviour for a genuine first time visitor: plan 0006 section 3 deliberately mints the
throwaway identity here rather than on opening the app, so a browsing visitor leaves no account
behind.

**Access tokens are short lived.** Fifteen minutes (plan 0005, section 3).

Put them together:

> A guest leaves the app open for twenty minutes, comes back, and taps "Create a group". Their
> token is expired, so the guard passes them through as anonymous, so the gateway mints a second
> temporary user and creates the zone under it. Their previous zones still exist, owned by a
> user id nothing on the device now holds a valid credential for. A guest has no email and no
> password, so there is no way to sign back in and reach them.

The app has destroyed the user's data, and it did so to the users with the least protection:
the ones who never registered.

## 2. Why this is the backend's problem

The frontend already defends against it. `apps/velista/plans/0004-data-access-auth-and-realtime.md`
section 5.5 makes it **rule D3**: before any call to an optional auth route, if a token exists it
must be valid, refresh first if it is expired, and never mint a second guest over the top of an
old one. Section 11 of that same plan records the suggestion this plan implements, in its own
words, that the backend reject an expired token on these routes rather than treating it as
anonymous, "which would remove the hazard entirely rather than requiring every client to
remember it".

That is the argument. A rule every client must remember is a rule some client will forget: a
second frontend, a mobile wrapper, a test harness, a curl command in a runbook. The condition is
cheap to detect at the only place all of them pass through.

## 3. The change

Split the two cases the `catch` currently merges.

- **No `Authorization` header at all.** A genuine anonymous caller. Allowed through with no user
  attached, exactly as today.
- **A header is present.** The caller is claiming an identity. Verify it, and reject with the
  normal 401 if it does not hold up.

In `OptionalJwtAuthGuard`:

```ts
override async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  if (!request?.headers?.authorization) {
    return true;
  }
  return (await super.canActivate(context)) as boolean;
}
```

`handleRequest` keeps returning `undefined` rather than throwing, so the anonymous branch still
attaches no user; the strict path now propagates the strategy's `UnauthorizedException`, which
the global exception filter turns into the house envelope with `code: "unauthorized"` (plan
0004, section 2). Nothing else in the guard changes.

### 3.1 Why the header, and not the token's contents

The discriminator is deliberately "did the caller present a credential", not "is the credential
any good". A malformed or truncated `Authorization` header is a client defect, and answering it
with a silent new account would be the same failure in a different costume. The only request
that proceeds anonymously is the one that asked to.

A header that is present but empty is treated as present, and therefore rejected. That is a
one character difference in behaviour from an absent header and it falls on the safe side.

## 4. Blast radius

`OptionalJwtAuthGuard` is used in exactly one file today:
`gateway/src/app/zones/zone.controller.ts`, on `POST /v1/zones` (line 109) and
`POST /v1/zones/join` (line 135). Every other route already uses `JwtAuthGuard` and already
rejects a stale token. So the surface of this change is two routes, and both of them are the
routes the hazard is about.

Plan 0023 adds a third user of the guard, `POST /v1/auth/google/state`, for the same reason: a
stale token there would drop the `linkUserId` and hand a guest a fresh Google account.

## 5. What clients see, and why the break is worth taking

This is a deliberate behaviour change, not a bug fix behind a flag. A client that today sends an
expired token to `POST /v1/zones` receives a 201 and a new zone; after this it receives a 401.

That is the right trade. The 401 is recoverable in one hop, because `POST /v1/auth/refresh` is
`@SkipThrottle()` and `TokenStore` in velista already does single flight refresh and retry
(velista 0004, section 5.4). The silent mint is not recoverable at all. A loud, retryable error
beats quiet data loss every time, and the error arrives at the moment the client can still fix
it.

**Rule D3 stays where it is.** This plan removes the hazard's cause; it does not make the
client's own freshness check redundant. Refreshing before the call still saves a round trip and
still gives velista the one case the server cannot help with: a refresh that fails while the
stored identity was `TEMPORARY` is the "your guest account is gone" message, and only the client
knows how to say it. Nothing here invites the removal of that code.

## 6. Tests

In `gateway/src/app/auth/jwt-auth.guard.spec.ts` (extend it if it exists, add it if not):

- No `Authorization` header: `canActivate` resolves true, no user attached.
- An expired token: `canActivate` rejects with a 401, and the assertion is on the rejection
  rather than on a returned false, because the filter needs the exception to build the envelope.
- A token with a bad signature: same.
- A valid token: `canActivate` resolves true with the user attached and `setRequestContext`
  called, which is the behaviour `JwtStrategy.validate` already provides.

At the controller level, one test per route asserting that an expired token no longer reaches
`AUTH_PATTERNS.createTemporaryUser`. That is the regression this plan exists to prevent, so it
is asserted on the NATS call rather than on the status code.

Existing integration and e2e suites that lean on the old fall through (any that send a
deliberately stale token and expect a 201) need updating; the ephemeral stack suite from plan
0015 is where to look.

## 7. Acceptance criteria

- [ ] `POST /v1/zones` and `POST /v1/zones/join` with an expired bearer token return 401 with
      `code: "unauthorized"`, and no temporary user is created.
- [ ] The same routes with no `Authorization` header still mint a temporary user and return
      `tokens` in the handshake envelope, unchanged.
- [ ] The same routes with a valid token still act as that user and return no `tokens`.
- [ ] A malformed or empty `Authorization` header returns 401 rather than acting anonymously.
- [ ] `npx nx run-many --all --target=lint` and `--target=test` pass.

## 8. Out of scope

- **Any change to token lifetimes.** Fifteen minutes is plan 0005's decision and this plan does
  not revisit it.
- **A grace period for recently expired tokens.** It would reintroduce a window where the answer
  depends on the clock, for no gain over refreshing.
- **Rejecting tokens for deleted users on a fast path.** The strategy verifies signature and
  expiry offline and never calls auth per request (plan 0004, section 10). A token for a deleted
  user stays valid until it expires, which is a known and accepted property, unrelated to this
  change.
