# 0023 Google sign in, end to end

Google login is built on both sides and works on neither. The passport dance runs, the profile
resolves, `googleLogin` finds or creates a user, and velista has drawn the button and the
callback page. Two gaps in `google.controller.ts` make the whole flow unusable, and the second
one destroys data.

`apps/velista/plans/0009-credential-flows.md` section 5.6 names both and says the button will
keep recording taps rather than navigating until they land. This plan lands them.

Depends on 0020 (the hardened optional guard, for the reason in section 4.2) and 0021 (the
`TokenGrantService`, which is what stores the OAuth state).

## 1. Gap one: the callback answers with JSON

`google.controller.ts` ends with:

```ts
@Get('callback')
@UseGuards(AuthGuard('google'))
callback(@Req() req: { user?: GoogleProfile }): Promise<AuthTokens> {
  const profile = req.user as GoogleProfile;
  return this.nats.send(AUTH_PATTERNS.googleLogin, { ...profile });
}
```

The browser arrived here by following Google's redirect. It is a top level navigation, not an
XHR, so what the user sees is a page of JSON containing their own access and refresh tokens, on
the API's origin, with no way back into the app. Nothing consumes the pair, and the app that
started the flow never learns it finished.

## 2. Gap two: the callback never links a guest

It sends `{ ...profile }` and nothing else. `GoogleLoginRequest.linkUserId` exists and is the
parameter that makes `googleLogin` call `upgrade()` and convert the caller in place
(`identity.service.ts:421`). Without it, `googleLogin` finds no linked identity, falls through
to the create branch at line 432, and mints a **fresh registered user**.

So a guest who taps Continue with Google gets a brand new account and loses every zone, which is
the same failure velista's rule C2 describes for register and the same shape as 0020's stale
token. It is worse than either, because it happens to a guest whose token is perfectly valid,
doing exactly what the button invites.

**Nothing can carry a userId across the round trip today.** `google.strategy.ts` sets no `state`
and no `passReqToCallback`. The app's token lives in localStorage, and neither hop of the
redirect is an XHR that could carry an `Authorization` header. This is why the item is not a one
line fix, and section 4 is the bulk of this plan.

## 3. Fixing the callback: 302 with the pair in the fragment

The callback stops returning a body and issues a redirect to the app:

```
302 Location: {APP_BASE_URL}/{locale}/auth/callback#accessToken=…&refreshToken=…&userId=…&kind=…&username=…
```

velista already has the route and the page: `auth/callback` renders `AuthCallbackPage`, built in
0009 precisely because it is inert without a fragment and is where this was always going to
land.

### 3.1 The fragment, not the query string

A fragment is never sent to a server. A query string is, which means the refresh token would be
written into the gateway's access logs, any proxy's logs in front of it, and the `Referer` of
whatever the app requests next. That is the difference between a secret in one browser and a
secret in three log aggregators.

### 3.2 The honest limitation

A fragment still lands in browser history, and history is readable by anything that can already
run script on that origin. The stronger design is a single use code in the query string that
the app exchanges for the pair over XHR, so the tokens never touch a URL at all.

The fragment is what this plan builds, because it is what the flow was specified against and it
is a large improvement on a page of JSON. Two things make it defensible rather than merely
acceptable, and both are requirements, not suggestions:

- The app must `history.replaceState` the fragment away the moment it has read it, so the pair
  does not survive in the session's history entry. That is a velista obligation and belongs in
  its acceptance criteria.
- The access token is fifteen minutes and the refresh token rotates on first use
  (`token.service.ts`), so a stale history entry is a narrow window rather than a standing key.

The code exchange is recorded here as the next hardening if this flow ever carries anything
beyond a consumer shopping list.

### 3.3 Failures redirect too

Every way this can fail, a refused consent, a bad state, `googleLogin` throwing, ends in a
redirect to the same page with `#error=<code>`, using the stable `ERROR_CODES` values. The one
thing the callback must never do is render an error page on the API's origin, because the user
has no way back from there and the app never learns the flow ended.

### 3.4 Configuration

`GatewayConfig` gains `APP_BASE_URL`, the origin and path prefix of the frontend, validated as a
URI in the Joi schema beside the existing `GOOGLE_*` variables and required only when Google is
enabled (`gateway/src/app/config/app-config.ts:39`). The redirect is built from that constant
plus the locale from section 4, and **never from anything the client supplied**, which is what
keeps this from being an open redirect.

## 4. Fixing the link: the userId rides in the OAuth state

The OAuth `state` parameter is the one value that survives the round trip by design. The
question is what to put in it.

### 4.1 Auth owns the state, and it is opaque

**The state is an opaque random token. Auth stores its hash and the payload behind it.**

- `AUTH_PATTERNS.mintOAuthState` takes `{ userId?, locale }`, issues a grant through 0021's
  `TokenGrantService` against a new `oauth_states` table (same shape as the others, plus the
  payload columns), and returns the raw value. TTL **ten minutes**, which is a consent screen and
  a password, not a lunch break.
- `AUTH_PATTERNS.consumeOAuthState` takes the raw value, consumes it **single use**, and returns
  `{ userId?, locale }`.

The alternative, a stateless value signed by the gateway, was rejected for two reasons. The
gateway holds only auth's **public** key (`authJwtPublicKey`), so it cannot sign anything and
would need a new secret introduced, distributed and rotated for this one purpose. And a stateless
token cannot be single use without a store, and single use is the property that matters here:
a replayed state is how an attacker links **their** Google identity onto **your** account, which
is a permanent way in. There is no Redis in this stack, and auth's database is the shared state
that already exists.

Storing it costs two NATS round trips on the rarest flow in the product.

### 4.2 Minting it needs a valid token or none, never a stale one

`POST /v1/auth/google/state`, returning `{ state }`, guarded by **0020's hardened
`OptionalJwtAuthGuard`**.

The guard choice is the whole point. Under the old guard, a guest whose access token had expired
would mint a state with no `userId`, sail through the Google flow, and land on a fresh account
with their zones orphaned: the exact bug this plan is fixing, reintroduced one layer up and
harder to see. After 0020, a presented token must be valid or the request is refused, so the
client refreshes and tries again. A caller with no token at all still gets a state, with no
`userId` in it, which is the genuine sign in from scratch.

`locale` comes from the request context the platform already populates.

### 4.3 The flow, start to finish

1. The app calls `POST /v1/auth/google/state` and receives an opaque `state`.
2. The app navigates the browser to `GET /v1/auth/google?state=…`.
3. A `GoogleAuthGuard`, extending `AuthGuard('google')` and overriding `getAuthenticateOptions`,
   returns `{ state }` read from the query, so passport appends it to the authorization URL.
   `passport-oauth2` leaves it alone while `state: true` is unset (its default store is the null
   store), so it round trips untouched and no session is involved.
4. Google returns to `GET /v1/auth/google/callback?code=…&state=…`. Passport exchanges the code
   and `GoogleStrategy.validate` resolves the profile exactly as it does now; the strategy is
   unchanged and needs neither `state` nor `passReqToCallback`, because the controller can read
   `req.query.state` itself.
5. The controller consumes the state, gets `{ userId?, locale }`, and calls `googleLogin` with
   `{ ...profile, linkUserId: userId }`.
6. It redirects per section 3.

### 4.4 A missing or invalid state fails the flow

It does not fall back to "no `linkUserId`". Proceeding without one is precisely the data loss in
section 2, and a silent fallback would make it depend on a race between a token's expiry and a
user's typing speed. A state that is absent, unknown, expired or already consumed ends at section
3.3 with `#error=`, and the user taps the button again.

The cost of being strict is one wasted trip to Google in a case that should not occur. The cost
of being lenient is an orphaned account.

## 5. What does not change

`IdentityService.googleLogin` and `upgrade` are untouched by this plan: `linkUserId` is already
threaded, already routes to `upgrade`, and 0021 already fixed what `upgrade` does with a Google
profile (`emailVerifiedAt`, and the duplicate address conflict). This plan's job is to make the
parameter arrive. That the service side needed no change is a sign 0005 designed the contract
correctly and only the transport was missing.

`GoogleStrategy` is likewise unchanged.

## 6. Contracts and docs

New subjects, request and response interfaces, and JSON Schemas in
`libs/luna-shopper/contracts` for `mintOAuthState` and `consumeOAuthState`; plan 0010's
completeness spec fails without the schemas.

The two HTTP routes need care in the OpenAPI document, because neither returns a normal body.
`GET /v1/auth/google/callback` becomes a documented 302 the way `GET /v1/auth/google` already is
(`@ApiFoundResponse`, with the comment there explaining why a redirect has no payload to
document), and it loses its `@ApiContractResponse(AUTH_PATTERNS.googleLogin)`, which now
describes something the client never sees. `POST /v1/auth/google/state` is an ordinary
documented response.

## 7. Tests

- **State**: mint then consume returns the payload; consume twice fails; consume after ten
  minutes fails; the raw value is never stored.
- **The guard on `/state`**: no token mints a state with no `userId`; a valid token mints one
  carrying it; an **expired** token is refused. The third is the regression test for section 4.2
  and is the most valuable test in this plan.
- **Callback**: with a state carrying a `userId`, `googleLogin` is called with `linkUserId` set;
  without one, it is called without; with an invalid state, `googleLogin` is **not called at
  all** and the response is a 302 carrying `#error=`.
- **Redirect shape**: the `Location` is built from `APP_BASE_URL` and the state's locale, the
  tokens are in the fragment, and the query string contains neither token. Assert the absence
  explicitly, since that is the property section 3.1 exists to guarantee.
- **End to end, the criterion this plan is for**: a temporary user with a zone signs in with
  Google and afterwards has the **same `userId`** and the same zones. Belongs in the ephemeral
  stack suite from plan 0015.

## 8. Acceptance criteria

- [ ] The callback never returns a JSON body; it always redirects to the app.
- [ ] Tokens travel in the URL fragment and appear nowhere in a query string or a log line.
- [ ] A guest who signs in with Google keeps the same `userId` and every zone.
- [ ] An absent, unknown, expired or reused state fails the flow with `#error=` rather than
      creating an account.
- [ ] A state minted with an expired bearer token is refused at mint time.
- [ ] A state cannot be used twice.
- [ ] With `GOOGLE_*` unset the routes are still simply not registered, and boot is unaffected.
- [ ] `npx nx run-many --all --target=lint` and `--target=test` pass, and `openapi.json` is
      regenerated and committed.

## 9. What velista can do once this lands

Recorded, not designed here. Its 0009 section 5.6 says Google must not be offered to a guest at
all until the link works; that condition can be removed. `AuthCallbackPage` gains its fragment
reader and the `history.replaceState` from section 3.2. Both are one plan's worth of small work
on top of pages that already exist.

## 10. Out of scope

- **Any other OAuth provider.** The state machinery is provider neutral and would take one, but
  nothing asks for one.
- **Unlinking a Google identity**, and linking one to an account that already has a password.
  Both are account screen concerns.
- **The code exchange described in section 3.2.** Recorded as the next hardening.
- **Reusing the OAuth state for anything else**, such as carrying a post login destination. It
  would work and it would make the state a general redirect carrier, which is how open redirects
  are born.
