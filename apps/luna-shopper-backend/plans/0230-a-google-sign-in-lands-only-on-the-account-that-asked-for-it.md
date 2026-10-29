> **PR:** [#848](https://github.com/IchirokuXVI/nx-portfolio/pull/848)

# 0230: a Google sign in lands only on the account that asked for it

> The session token review of 2026-10-27
> (`apps/velista-luna-e2e/reviews/2026-10-27-session-tokens/report.md`, PR #844) rated one
> defect critical for its impact: finding F2. The OAuth `state` of plan `0023` is single
> use, and it carries the user to link onto. Nothing ties it to the browser that minted it.
> An attacker mints a guest with `POST /v1/zones`, mints a state under that guest's token,
> and sends a victim the link `GET /v1/auth/google?state=S`. The victim consents on a
> screen that shows the real app name. The callback spends S, finds no identity for the
> victim's Google id, and calls `upgrade` with the attacker's guest as the link target. The
> guest is now REGISTERED with the victim's Google id and verified email. The attacker's
> refresh token stays valid, because `upgrade` revokes nothing. Every later "Continue with
> Google" by the victim opens the attacker's account, and a Google only account has no
> password to reset.
>
> Google is configured in production (`values.production.yaml`, and PR #841 moves it to
> the velista Google Cloud project). The velista button does not navigate yet (velista
> `0009` section 5.6 and `sign-in-page.ts`), so no person uses the flow today. The routes
> are live and the attack needs only the API. It is fixed before the button is wired.
>
> The fix is the one plan `0023` section 3.2 recorded as the next hardening, with one
> change of ordering that is the whole point: **nothing permanent happens at the callback.**
> The callback stages what Google said and sends the browser back with a single use code.
> The app trades the code, plus a verifier only it holds, for the pair. The link and the
> account creation happen in that trade. A browser that did not mint the state has no
> verifier, so a link sent to a victim stages a profile that nobody can redeem, and it
> expires. As a consequence the pair leaves the URL, which is what plan `0023` wanted and
> half of finding F8.
>
> Prerequisite reading: the report sections 2 and 5 (F2, F8), `0023` sections 3.2, 4 and
> 10, `0210` target state 2 (`TokenGrantService`, which the two tables of this plan use),
> `0020` (the hardened optional guard), and in the code `gateway/src/app/auth/google.controller.ts`,
> `google-auth.guard.ts`, `auth.dto.ts`, `auth/src/app/identity/identity.service.ts`
> (`mintOAuthState`, `consumeOAuthState`, `googleLogin`, `upgrade`),
> `entities/oauth-state.entity.ts`, `libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts`.
>
> **Build order.** Before velista `0171`, which builds the client half against the routes
> this plan defines. Independent of `0229`. Until `0171` lands, the callback page of
> velista reads a fragment that carries no pair and sends the visitor to the front door,
> which is its existing behaviour for a fragment it cannot map.

## Brief for the agent

### Objective

Across `libs/luna-shopper/contracts`, `apps/luna-shopper-backend/auth` and
`apps/luna-shopper-backend/gateway`: make `POST /v1/auth/google/state` take a
`codeChallenge` and store it on the state; make the Google callback stage the profile and
the link target in a new `oauth_handoffs` row and redirect with `#code=`; add
`POST /v1/auth/google/exchange` that spends the code, checks the verifier against the
challenge, requires the bearer of the link target when there is one, and only then runs
`googleLogin`; and make `upgrade` revoke every other refresh row of the account. Regenerate
the OpenAPI document and the admin wire types.

### Context

- `oauth_states` is a grant table of `0210`'s `TokenGrantService` (`issue`, `consume`
  with a conditional spend). It holds `userId` (the link target or null), `locale`,
  `tokenHash`, `expiresAt` (10 minutes), `consumedAt`.
- `GoogleController.mintState` takes no body and reads `userId` from the optional bearer.
  `start` redirects to Google with the state from the query (`GoogleAuthGuard`). `callback`
  consumes the state, calls `AUTH_PATTERNS.googleLogin` with `{ ...profile, linkUserId }`,
  and redirects to `APP_BASE_URL/{locale}/auth/callback` with the pair in the fragment
  (`resolveCallback`, `redirect`, `appUrl`). Every failure redirects with `#error=<code>`.
- `GoogleProfile` is `{ providerUserId, email?, displayName? }`. `IdentityService.googleLogin`
  finds the identity, or upgrades `linkUserId` in place, or creates a registered user.
  `upgrade` runs in a transaction and ends with `issueTokens`. It revokes no refresh row.
  `revokeAllForUser(userId, manager)` exists and a password reset calls it in its
  transaction before issuing the resetter's own pair.
- The grant tables share one shape (`BaseEntity` plus `tokenHash`, `expiresAt`,
  `consumedAt`, a nullable `userId` with cascade). `identity-oauth-state.spec.ts` is the
  spec of the state. `google.controller.spec.ts` and `google-callback.http.spec.ts` are the
  specs of the gateway half.
- `GatewayThrottlerGuard` is global. A new route is throttled unless it opts out. The
  exchange does not opt out.
- A gateway route change changes `gateway/docs/openapi.json`, and that changes
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`. Both are generated and
  committed (CLAUDE.md, "The committed OpenAPI document must always be current").

### Target state

- `npx nx test` passes for `luna-shopper-contracts`, `luna-shopper-backend-auth`,
  `luna-shopper-backend-gateway` and `luna-shopper-admin-models`, with `lint` and `build`
  for the two services.
- On a slot with Google unconfigured, `POST /v1/auth/google/state` without a body answers
  400, and with a valid challenge answers 501 as before (the configured guard runs first).
  `POST /v1/auth/google/exchange` with an unknown code answers 401.
- The spec of section 5.1 proves the attack of the preamble no longer links: a state
  minted for guest A, a callback that stages the victim's profile against A, and an
  exchange with a wrong verifier, or with the right verifier and no bearer of A, link
  nothing. A is still TEMPORARY and holds no Google identity. The handoff expires unused.
- The spec of section 5.1 proves the honest flow still works end to end at the service
  level: mint with a challenge, consume, stage, exchange with the matching verifier and
  the bearer of the guest, and the guest is REGISTERED with the identity linked, with one
  live refresh row.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

### Scope

- Work only in: `libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts` and its
  spec, `libs/luna-shopper/contracts/src/schemas/messages/auth.schemas.ts`,
  `apps/luna-shopper-backend-e2e/src/google-sign-in.spec.ts`,
  `apps/luna-shopper-backend/auth/src/app/identity/**`,
  `apps/luna-shopper-backend/auth/src/app/entities/**`,
  `apps/luna-shopper-backend/auth/src/app/db/migrations/**`,
  `apps/luna-shopper-backend/gateway/src/app/auth/google*.ts`,
  `apps/luna-shopper-backend/gateway/src/app/auth/auth.dto.ts`,
  `apps/luna-shopper-backend/gateway/docs/openapi.json`,
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` (generated only), and this
  plan file.
- Do NOT touch: velista, `token.service.ts`, the chart, any `.env`, the review folder,
  `package.json`.

### Constraints

- The callback links nothing and creates nothing. `AUTH_PATTERNS.googleLogin` has exactly
  one caller after this plan, the exchange handler in auth.
- The verifier never reaches the server before the exchange, and the challenge never
  reaches the browser after the mint. The state row stores the challenge, the handoff row
  copies it, and the exchange compares `base64url(sha256(verifier))` to it with a constant
  time compare.
- A handoff whose state carried a `userId` is redeemed only by a request whose bearer
  names that user. One with no `userId` is redeemed with or without a bearer, and a
  bearer on it is ignored: a sign in from scratch cannot be turned into a link by the
  caller.
- Missing, spent, expired and wrong verifier are one outcome on the wire, 401
  `unauthorized`, as the state is today (`0023` section 4.4).
- No new dependency and no new configuration key. The TTL of a handoff is a constant with
  its reason (section 3.2).
- Prettier on each changed file, never on a directory. Never edit the two generated files
  by hand.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] `MintOAuthStateRequest` carries `codeChallenge`, `oauth_states` has a nullable
      `codeChallenge` column, `mintOAuthState` requires it, and `consumeOAuthState` refuses
      a row without one (section 2).
- [ ] `oauth_handoffs` exists with the columns of section 3.1, added by one migration with
      `oauth_states.codeChallenge`, listed last in `index.ts`, and `migrations.spec.ts`
      passes.
- [ ] `AUTH_PATTERNS.stageGoogleSignIn` and `AUTH_PATTERNS.exchangeGoogleSignIn` exist with
      the shapes of section 4, with their request and result schemas in
      `auth.schemas.ts`, handled in `identity.controller.ts` and implemented in
      `identity.service.ts`. The `googleLogin` pattern, its schema and its handler are
      gone.
- [ ] `apps/luna-shopper-backend-e2e/src/google-sign-in.spec.ts` mints with a challenge,
      asserts 400 without one, and asserts 401 for an exchange with an unknown code.
- [ ] `GoogleController.resolveCallback` consumes the state, stages, and redirects with
      `#code=`; it never calls `googleLogin`. Every failure still redirects with `#error=`.
- [ ] `POST /v1/auth/google/exchange` exists as section 4.3 states, throttled, with
      `OptionalJwtAuthGuard` and `@RefuseImpersonation`, documented with
      `ApiContractResponse` and `ApiProblemResponses`.
- [ ] `upgrade` calls `revokeAllForUser` on its manager after the user save and before
      `issueTokens`, in both branches.
- [ ] The specs of section 5 exist and pass. `openapi.json` and `wire-types.ts` are
      regenerated.

### Action boundaries

- Proceed with in-scope edits, specs, the migration, the two regenerations, lint and
  build.
- Stop and ask before touching a velista file, `token.service.ts`, a configuration key,
  or the route of the callback (`APP_CALLBACK_PATH` and the shape `#error=` stay).

### Progress evidence

Report when each project's suite passes and when the two generated files are regenerated.
Ground each claim in a command's output.

## 1. Why the state cannot be bound where it is

Two cheap fixes were considered and both fail on the shape of the flow.

- **A cookie set at `GET /v1/auth/google`.** The victim's browser is the one that opens
  that URL, so it receives the cookie too. The binding must be to the browser that
  *minted* the state under the guest's token.
- **A cookie set at `POST /v1/auth/google/state`.** The mint is an XHR from `velista.app`
  to `api.velista.app`. A cookie set there is a third party cookie, refused by Safari and
  by Chrome under tracking protection, and it needs `SameSite=None` and credentials on the
  request. It would work on some browsers and sign nobody in on others.

What the minting browser can hold without a cookie is a secret in its own storage, and the
one moment it can present that secret is an XHR after the redirect lands in the app. So
the link waits for that XHR.

## 2. The state carries a challenge

`POST /v1/auth/google/state` takes a body:

```ts
export class MintOAuthStateDto {
  /** base64url of SHA-256 of a verifier the client made and keeps. 43 characters. */
  @ApiProperty()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  codeChallenge!: string;
}
```

`MintOAuthStateRequest` becomes `OAuthStatePayload & { codeChallenge: string }`, and
`mintOAuthState` refuses a request without it with a `ValidationException`. The DTO
already refuses it at the gateway. The mint still reads `userId` from the verified bearer
and never from the body.

`oauth_states` gains `codeChallenge varchar NULL`. Nullable only because rows exist at the
moment of the deploy. `consumeOAuthState` refuses a row whose column is null with the same
`INVALID_OAUTH_STATE`: those rows are at most ten minutes old and belong to nobody who can
finish the flow. `OAuthStatePayload` gains `codeChallenge` so the gateway can hand it to
the staging call.

## 3. The callback stages, it does not sign in

### 3.1 `oauth_handoffs`

A grant table in the shape of the others, managed by `TokenGrantService`:

| Column | Type | Meaning |
| --- | --- | --- |
| `userId` | `uuid NULL`, FK users, cascade | The link target copied from the state, or null for a sign in from scratch |
| `providerUserId` | `varchar NOT NULL` | What Google said |
| `email` | `varchar NULL` | What Google said |
| `displayName` | `varchar NULL` | What Google said |
| `codeChallenge` | `varchar NOT NULL` | Copied from the state |
| `locale` | `varchar NULL` | Copied from the state |
| `tokenHash` | `varchar NOT NULL`, unique index `uq_oauth_handoff_token` | The hash of the code |
| `expiresAt`, `consumedAt` | `timestamptz` | As every grant |

One migration adds the table and the column of section 2. It only adds. No release task.

### 3.2 The handoff lives two minutes

`OAUTH_HANDOFF_TTL_MS = 120_000`. The code is spent by the callback page of the app
within one page load of the redirect. Two minutes is that load on a slow phone plus a
retry. A longer life only widens the time in which a staged victim profile sits in the
table waiting for a verifier that will never come.

### 3.3 The callback

`resolveCallback` keeps every branch it has, with one call replaced. After
`consumeOAuthState` answers `{ userId?, locale?, codeChallenge }`, it sends
`AUTH_PATTERNS.stageGoogleSignIn` with `{ ...req.user, linkUserId: payload.userId,
codeChallenge: payload.codeChallenge, locale: payload.locale }` and gets `{ code }`. It
redirects to `APP_CALLBACK_PATH` with the fragment `code=<raw>` and nothing else. The
`#error=` branches do not change.

Auth's `stageGoogleSignIn` issues the handoff row through `grants.issue` in a transaction
and returns the raw code. It reads nothing else and writes nothing else. An identity that
already exists for `providerUserId` is not looked up here: the exchange does that, so the
callback has no branch that depends on the database state of an account.

## 4. The exchange is where the account changes

### 4.1 Pattern

`AUTH_PATTERNS.exchangeGoogleSignIn` takes `{ code: string; codeVerifier: string;
callerUserId?: string }` and answers `AuthTokens`. `callerUserId` is set by the gateway
from the verified bearer, as `linkUserId` is on the mint, and never from a body.

### 4.2 The service

In one transaction:

1. `grants.consume(manager, OAuthHandoff, code, 'Invalid or expired code')`. Missing,
   spent and expired are one refusal.
2. `base64url(sha256(codeVerifier))` is compared to `handoff.codeChallenge` with
   `timingSafeEqual` over equal length buffers. A mismatch is the same refusal.
3. If `handoff.userId` is set and `callerUserId !== handoff.userId`, the same refusal. The
   verifier proves the browser, the bearer proves the account, and a link needs both.
4. Then exactly what `googleLogin` does today, on the manager:
   `{ providerUserId, email, displayName, linkUserId: handoff.userId }`. Find the identity
   and issue, or upgrade the link target in place, or create a registered user.

The refusal is `UnauthorizedException`, which the gateway renders as 401 `unauthorized`.
Each refusal writes one warn line with its reason (`unknown_code`, `verifier_mismatch`,
`caller_mismatch`) and the handoff id, never the code, the verifier or the challenge.

`googleLogin` stays as the one place that knows the three branches. The exchange calls it.
Nothing else does after this plan: the handler for `AUTH_PATTERNS.googleLogin` in
`identity.controller.ts` is removed with its pattern, since a pattern with no gateway
caller is a door with no lock.

### 4.3 The route

```ts
@Post('exchange')
@RefuseImpersonation()
@UseGuards(GoogleConfiguredGuard, OptionalJwtAuthGuard)
@ApiBearerAuth('access-token')
@ApiContractResponse(AUTH_PATTERNS.exchangeGoogleSignIn, { status: HttpStatus.CREATED })
@ApiProblemResponses({ body: true, auth: true, notConfigured: true, impersonation: 'refused' })
exchange(@Body() dto: ExchangeGoogleSignInDto, @AuthUser() user?: CurrentUser): Promise<AuthTokens>
```

`ExchangeGoogleSignInDto` is `code` (string) and `codeVerifier` (`^[A-Za-z0-9_-]{43}$`,
the base64url of 32 bytes). The optional guard is `0020`'s hardened one: a guest with an
expired access token is refused and refreshes first, and so the bearer at step 3 of
section 4.2 is always a current one or none.

## 5. Proof

### 5.1 Auth: `identity-google-handoff.spec.ts`

Against the test harness `identity-oauth-state.spec.ts` uses, with a fixed verifier and
its known challenge as a test vector:

1. **The honest link.** Mint for guest A with the challenge, consume, stage the profile
   with `linkUserId: A`, exchange with the verifier and `callerUserId: A`. A is
   REGISTERED, one identity row names A, one live refresh row, the pair names A.
2. **The honest sign in from scratch.** Mint with no user, stage with no link target,
   exchange with the verifier and no caller. A new registered user exists.
3. **The attack, wrong verifier.** As case 1 up to the exchange, then exchange with a
   different verifier. Refused. A is TEMPORARY, no identity row, the handoff is spent.
4. **The attack, right verifier, wrong account.** As case 1, exchange with
   `callerUserId: B`, and once with no caller. Refused both times. A is TEMPORARY.
5. **A replayed code.** Case 1, then the same exchange again. Refused.
6. **An expired code.** Stage, set `expiresAt` to the past by SQL, exchange. Refused.
7. **A state with no challenge.** A row inserted without one is refused at consume.
8. **A bearer cannot turn a sign in into a link.** Case 2 with `callerUserId: A`. A new
   registered user is created and A is untouched.
9. **Upgrade ends the other sessions.** A guest with two live refresh rows upgrades by
   email. One live row remains and it is the one in the response. The same for the Google
   branch through case 1.

### 5.2 Gateway

- `google.controller.spec.ts`: `resolveCallback` sends `stageGoogleSignIn` with the
  profile, the link target and the challenge, and redirects with `#code=`; it never sends
  `googleLogin`; each failure still redirects with `#error=`.
- `google-callback.http.spec.ts`: the fragment of a successful callback carries `code`
  and no `accessToken`.
- A new `google-exchange.http.spec.ts`: 400 without a body, 401 with an unknown code, 501
  with Google unconfigured, 201 with the `AuthTokens` body when the NATS double answers.
- `google-state` in the existing specs: 400 without `codeChallenge`.

### 5.3 The review battery

Test 7 of `session-tokens.spec.ts` sends the callback page a fragment with a pair. After
velista `0171` the page stores nothing from a fragment and the overwrite assertion passes.
This plan alone does not change that test's result, and that is expected.

## 6. Out of scope

- The client half: the verifier, the mint with a challenge, the exchange from the callback
  page. Velista `0171`.
- Offering the Google button to anybody. Velista `0009` section 5.6 and the owner's call.
- Google inside the Android app. The flow needs a system browser there (velista `0167`
  lists it as later work). The design holds for it: the verifier lives in the app's own
  storage, and an App Link brings the code back to that storage.
- Unlinking a Google identity, and the other items of `0023` section 10.
- Sign out everywhere, a logout route, and ending sockets on a revoke (F4, F10).
