# 0021 Confirming an email: the wait in the body, resending, and upgrade's missing send

Three related gaps in email confirmation, plus the platform change all three need.

1. There is **no way to resend** a confirmation. If the first mail is lost, filtered or typo'd
   into someone else's inbox, the account can never be confirmed.
2. **`upgrade()` never sends one.** A temporary user who adds an email and a password gets an
   account with an unconfirmed address and no mail to confirm it with, ever.
3. A client **cannot read a rate limit's wait**, because the only place it is published is a
   header the browser is not allowed to see.

`apps/velista/plans/0009-credential-flows.md` is written against this plan. Its section 5.8 names
the resend endpoint and the upgrade send as the two backend changes it assumes, and its rule C3
says the countdown must be the number the server returned rather than a hardcoded sixty. Section
2 below is what makes that number readable at all.

Depends on 0004 (the error envelope and the throttling conventions) and 0005 (the verification
token). Extracts the token helper that 0022 and 0023 both build on.

## 1. Why the wait cannot be a header

`gateway/src/main.ts:33` is:

```ts
app.enableCors({ origin: config.corsOrigins, credentials: true });
```

No `exposedHeaders`. A cross origin browser client can read only the CORS safelisted response
headers, and `Retry-After` is not one of them, so `@nestjs/throttler`'s header is physically
unreadable by the app that needs it. Adding `exposedHeaders` would work and is not the choice
here, for the same reason plan 0004 gave when it put `correlationId` in the body rather than in
a header: the envelope is the contract, one place to look, and it survives a proxy that strips
headers it does not recognise.

So the wait goes in the body.

## 2. `retryAfterSeconds` on the envelope

A platform change, in `libs/luna-shopper/platform/src/lib/errors/`. It is written once here and
every throttled route in the API gains it, which is why it is not scoped to auth.

### 2.1 The field

`ProblemDetails` gains an optional `retryAfterSeconds?: number`: whole seconds the client should
wait before retrying, present only when `code` is `rate_limited`.

`PROBLEM_DETAILS_SCHEMA` in `problem-details.schema.ts` is `additionalProperties: false`, so the
field must be declared there too or the published OpenAPI document contradicts the responses the
API actually sends. `buildProblemDetails` in `problem-factory.ts` passes it through with the same
conditional spread `errors` already uses, so a non rate limited problem does not carry a null.

### 2.2 A `RateLimitedException`

`ERROR_CODES.RATE_LIMITED` and its 429 mapping already exist in `error-codes.ts`, and
`ERROR_CATALOG` already has a localized message for it. The only thing missing is a class, so
`domain-exception.ts` gains:

```ts
/** Too many attempts. Carries the wait so the client can count it down. */
export class RateLimitedException extends DomainException {
  readonly code = ERROR_CODES.RATE_LIMITED;
}
```

with the wait travelling in the existing `details` bag and the filter lifting it onto the
envelope. It exists so the guard in section 2.3 has something to throw that the filter already
knows how to render, rather than the guard assembling an envelope of its own.

### 2.3 A throttler guard that fills it in

`ThrottlerGuard.throwThrottlingException(context, throttlerLimitDetail)` receives a
`ThrottlerLimitDetail`, and in `@nestjs/throttler` 6.5.0 that extends `ThrottlerStorageRecord`,
which carries `timeToExpire` and `timeToBlockExpire` in seconds. A small
`ProblemThrottlerGuard` overrides that one method and throws the new exception with
`Math.ceil` of the larger of the two, instead of the library's bare `ThrottlerException`.

Registered in place of `ThrottlerGuard` at `gateway/src/app/app.module.ts:90`. It lives in the
platform library beside `throttler-config.ts`, because any service that grows an HTTP surface
wants the same answer.

### 2.4 The honest limitation, and why it is accepted

The throttler's default storage is in memory, per process, and its default tracker is the
client IP. `k8s/helm/values.yaml` sets `replicaCount: 2`. So a gateway 429's number is per pod
and per IP: two people behind one NAT share a bucket, and the same person can get roughly two
buckets' worth by being load balanced onto the other pod.

**This is accepted rather than engineered around.** The alternative considered and rejected was
enforcing the resend's own limit in auth against the `email_verifications` table, which would be
exact and per user. It was rejected because it puts a second, hand maintained rate limiter in
the domain service for one route, and because the thing it buys is precision in a countdown
whose whole purpose is to stop somebody tapping a link twice. A bucket that is occasionally
twice as generous as advertised still does that.

What the client must not do is assume the number. Velista's rule C3 already says the countdown
is whatever the server returned, never a hardcoded sixty, and this is a second reason it is the
right rule: the number can legitimately differ between two requests from the same person.

Moving the throttler to a shared store would make the limits cluster wide and is a real option
later. It is not needed for anything here and is recorded in section 8 rather than built.

## 3. Extracting the token grant

`IdentityService` currently owns the whole hashed single use token dance inline:
`hashToken` (line 66), `createVerification` (line 144) and the consume side inside
`verifyEmail` (line 205). Plan 0022 needs the identical shape for password resets and 0023 needs
it for OAuth states, so it moves to a `TokenGrantService` in `auth/src/app/tokens/`:

- `issue(manager, repository, payload, ttlMs)` generates 32 random bytes, stores only the
  SHA-256 hash with an `expiresAt`, and returns the raw value.
- `consume(manager, repository, raw)` finds by hash, rejects when missing, already consumed or
  expired, stamps `consumedAt`, and returns the row.

It is generic over the entity rather than tied to `EmailVerification`, because all three tables
share the shape (`tokenHash`, `expiresAt`, `consumedAt`) and none of them should share a table.
`IdentityService` keeps its public methods; only the two private helpers move out.

This is a refactor with no behaviour change, and it is the reason 0022 and 0023 are short.

## 4. The resend endpoint

### 4.1 The route

`POST /v1/auth/resend-verification`, bearer authenticated, no body.

| | |
| --- | --- |
| Auth | `JwtAuthGuard`. Resending needs to know whose address to send to, and only a token says that. |
| Body | none |
| Returns | `{ retryAfterSeconds: number }`, 201, the house default for a POST in this gateway |
| Throttle | `THROTTLE_LIMITS.verifyResend`, retargeted to one per minute and moved here from the consume route (sections 4.2 and 4.3) |

The success body carries the wait too, not only the 429. That is deliberate and it is what lets
velista's "Sent again. You can ask for another in 0:52" state exist without the client inventing
the number: one field, three states, one code path.

New `AUTH_PATTERNS.resendVerification` subject with its request and response interfaces in
`libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts` and their JSON Schemas in
`src/schemas/messages/auth.schemas.ts`. The completeness spec from plan 0010 fails if the schemas
are missing, and the handler carries `@ApiContractResponse` per plan 0019.

### 4.2 The limit is the gateway bucket, one per minute

No second rate limiter. `THROTTLE_LIMITS.verifyResend` is **retargeted to one per minute** and
hung on this route, and that is the whole of the enforcement.

```ts
/** Email verification resend. One at a time, so the client's countdown means something. */
verifyResend: { [DEFAULT_BUCKET]: { ttl: minutes(1), limit: 1 } },
```

Retargeting is safe because the bucket's only current user is the consume route, which section
4.3 moves off it.

The three states velista draws all fall out of this one bucket:

- **Ready.** Nothing to enforce.
- **Just sent.** The handler returns `retryAfterSeconds: 60`, read from the bucket's own `ttl`
  rather than written as a literal, so the constant and the response cannot drift apart. It is
  true in the ordinary case: the next resend really is refused for a minute.
- **Refused.** The `ProblemThrottlerGuard` from section 2.3 answers 429 with the real remaining
  seconds off `timeToExpire`, so the countdown starts from what is left rather than from sixty.

Section 2.4 is the caveat on all three, and it is the reason the client renders the number it
was given instead of assuming it.

Note what this deliberately does not do. It does not stop the same person resending from a
second device, or from the same device after a load balancer moves them to the other pod. It
stops the impatient double tap, which is what the sentence in the nudge is for.

### 4.3 The bucket moves off the consume route

`@Throttle(THROTTLE_LIMITS.verifyResend)` currently sits on `POST /v1/auth/verify-email`
(`gateway/src/app/auth/auth.controller.ts:55`), which consumes a link. It never resent anything,
and three per ten minutes there is actively harmful: a mail client that prefetches links, a
double tap, and one genuine retry can exhaust it, leaving a user who did nothing wrong staring
at a rate limit on a link that would have worked.

Consume gets its own bucket instead. Brute forcing a 256 bit single use token is not a threat
worth designing around, so the limit exists only to make hammering pointless: ten per minute is
ample for every honest pattern including prefetch.

`THROTTLE_LIMITS` gains `verifyConsume` and keeps `verifyResend` at its new value, which finally
means what its name says. Note the constraint recorded at the top of `throttler-config.ts`:
these are per route **overrides** of one registered bucket, not additional named throttlers,
because the global guard applies every registered throttler to every route. That is also why
resend cannot have both a short and a long bucket: it gets one, and section 4.2 picks the short
one, because a countdown the user watches is worth more here than a ten minute ceiling.

### 4.4 The two refusals

Neither is reachable from velista's UI, which renders the sentence only inside the nudge shown
to an unconfirmed account. They exist because the endpoint is public API and must answer them.

| Case | Code | Why not something quieter |
| --- | --- | --- |
| The account has no email (a temporary user holding a valid token) | `conflict` | Returning a wait would be a lie: no mail is coming. |
| The email is already confirmed | `conflict` | Same. Confirming twice is not a thing, and silently succeeding would leave the client counting down to nothing. |

One code, two details. velista 0009 section 5.5 already keys its copy on code plus operation,
so `conflict` on `auth.resendVerification` needs one string, not two.

### 4.5 Old links stay valid

A resend does **not** invalidate the previous token.

The alternative, one live link at a time, is the tidier looking rule and the worse experience.
The reason someone resends is that the first mail has not arrived. Mail arrives late and out of
order, so superseding means the mail they finally receive is the one that no longer works, and
they meet an expired link screen having done nothing wrong. The security argument for a single
live token does not survive contact with the numbers here: each grant is 32 random bytes, single
use, scoped to one address, expires in 24 hours, and at most three can exist per ten minutes.

One consequence has to be fixed rather than accepted. `verifyEmail` (line 205) currently
re-stamps `emailVerifiedAt` and re-publishes `userEmailVerified` for every token it consumes, so
confirming with a second live link emits a duplicate event. Before this plan that was
unreachable, because `register()` created exactly one grant. Now it is reachable, so:

> Consuming a valid token for an already verified user succeeds, marks that token consumed, and
> emits nothing.

Idempotent, which is what plan 0004 section 9 asks of every consumer anyway.

## 5. `upgrade()` sends a verification

`identity.service.ts:242`. Three defects in one method, all in the same twenty lines.

### 5.1 The email branch never confirms

Line 269 sets `user.email` and flips `kind` to `REGISTERED`. It never calls `createVerification`
or `sendVerification`. So a guest who secures their account ends up registered with an
unconfirmed address, and before section 4 there was no way to ever confirm it: the only grant
the system could produce was created inside `register()`, which this user never called.

The fix mirrors `register()` exactly, including its structure: create the grant inside the
transaction, send outside it, swallow a send failure with the same reasoning (delivery must not
roll back a successful upgrade, verification is optional, the global logger records the failure).
`locale` already arrives from the gateway, which threads it onto the upgrade payload
(`auth.controller.ts`, the `upgrade` handler), so nothing new is plumbed.

### 5.2 The Google branch leaves a verified address unverified

Line 256 takes the email from the Google profile and never sets `emailVerifiedAt`, even though
`googleLogin`'s create branch does exactly that at line 438. The asymmetry has no defence: it is
the same email, verified by the same provider, and which branch the user took is invisible to
them. A guest who upgrades with Google therefore lands on a nudge asking them to confirm an
address Google already confirmed.

Set `emailVerifiedAt` when the email comes from Google, and send no confirmation mail for that
branch.

### 5.3 The Google branch can 500 on a duplicate email

The email and password branch checks the address is not taken (lines 261 to 268). The Google
branch, twelve lines above, assigns `user.email` with no such check, so a Google account whose
address already belongs to another user hits the partial unique index `uq_users_email` and
surfaces as a raw 500 rather than the `conflict` the other branch returns for the identical
situation.

Same check, same `ConflictException`, same `messageArgs: { field: 'email' }`.

## 6. Tests

- **Platform**: `buildProblemDetails` carries `retryAfterSeconds` when given one and omits the
  key otherwise; the schema accepts the field, which the existing OpenAPI document spec covers
  transitively; `ProblemThrottlerGuard` throws a `RateLimitedException` whose seconds come from
  `timeToExpire`.
- **`TokenGrantService`**: issue then consume succeeds; consume twice fails; consume after
  `expiresAt` fails; the stored value is a hash and never the raw token.
- **Resend**: a first call sends and returns 60, and the 60 comes from the bucket's `ttl` rather
  than a literal; a second call inside the window returns 429 with a remainder strictly under 60
  (this is the spec velista's rule C3 leans on, so it asserts the number, not just the status);
  no email returns `conflict`; already verified returns `conflict`.
- **Consume**: two live grants, consuming the second after the first succeeds without a second
  `userEmailVerified` event. Assert on the publisher, since the event is the observable part.
- **Upgrade**: the email branch writes an `email_verifications` row and calls the mailer; the
  Google branch sets `emailVerifiedAt` and calls no mailer; the Google branch on a taken address
  returns `conflict` and not a 500; and, carried over from plan 0005, the `userId` is unchanged
  across every branch.

Then `npx nx run luna-shopper-backend-gateway:openapi` with the diff committed. CLAUDE.md
requires it and `openapi-document.spec.ts` turns a forgotten regeneration into a red build.

## 7. Acceptance criteria

- [ ] Every 429 this API returns carries `retryAfterSeconds` in the body, and the published
      OpenAPI document says so.
- [ ] `POST /v1/auth/resend-verification` sends a fresh link and returns `{ retryAfterSeconds }`.
- [ ] A second resend inside sixty seconds returns 429 with the real remaining seconds, not a
      flat sixty.
- [ ] `POST /v1/auth/verify-email` no longer carries the resend bucket, and a fourth consume
      inside ten minutes succeeds.
- [ ] A link that was superseded by a resend still works, and confirming a second time emits no
      second `userEmailVerified`.
- [ ] Upgrading with an email and a password sends a confirmation mail and creates a grant.
- [ ] Upgrading with Google sets `emailVerifiedAt`, sends no mail, and returns `conflict` rather
      than a 500 when the Google address already belongs to somebody else.
- [ ] `npx nx run-many --all --target=lint` and `--target=test` pass, and `openapi.json` is
      regenerated and committed.

## 8. Out of scope

- **Blocking anything on verification.** `login()` does not look at `emailVerifiedAt` and this
  plan does not change that. velista 0009 section 5.2 is explicit that a blocking step would be
  a barrier this product does not have, and it would strand users whenever mail delivery failed.
- **Shared throttler storage, and any second rate limiter.** Section 2.4 documents the per pod,
  per IP limitation and accepts it. Making the buckets cluster wide is an operational change
  with no user visible payoff here, and enforcing a parallel limit in the domain service is the
  thing that decision explicitly rejected.
- **Changing what the confirmation mail says or looks like.** The template in `mail.service.ts`
  is unchanged; 0022 adds new ones beside it.
- **A resend for an address that was never deliverable.** Bounce handling needs a provider
  webhook and a delivery state model, and neither exists yet.
