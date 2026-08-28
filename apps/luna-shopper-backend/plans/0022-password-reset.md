# 0022 Password reset

There is no password reset in this system. No endpoint, no token type, no mail template, nothing
in any plan. Somebody who forgets their password today has **no route back to their account**,
and everything they own is behind it.

`apps/velista/plans/0009-credential-flows.md` section 9 puts it plainly when listing what it
could not build: "There is no endpoint and no token type for it. Somebody who forgets their
password today has no route back, which is worth saying plainly and is the most valuable thing
the next backend plan could add."

Depends on 0021, which extracts the `TokenGrantService` this plan is mostly an application of.

## 1. Its own table, not a column on the confirmation one

The obvious economy is a `purpose` column on `email_verifications`: same three fields, same
hash, same expiry, one migration. It is rejected.

- **The lifetimes differ by a factor of twenty four.** A confirmation link is optional and lives
  a day; a reset link is a credential and should live an hour. One column would either force the
  same TTL on both or make every query filter on purpose before it can reason about age, which
  is exactly the sort of thing that gets forgotten in the query that matters.
- **Consuming them does different things.** Confirming stamps a date. Resetting rewrites a
  credential and destroys every live session. Those do not belong behind one code path.
- **A table named `email_verifications` holding password resets is a lie** that the next person
  to read the schema has to discover.

So: a `password_resets` entity in `auth/src/app/entities/`, shaped exactly like
`EmailVerification` (`userId`, `tokenHash` unique, `expiresAt`, `consumedAt`, cascading delete
from `users`), and a migration in `auth/src/app/db/migrations/` following the existing numbering.
Because 0021 made `TokenGrantService` generic over the repository, the service side of this is
two calls, not a reimplementation.

TTL: **one hour**. Long enough to survive a mail queue and a walk to a laptop, short enough that
a link sitting in an unattended inbox stops being a key by lunchtime.

## 2. Asking for a reset

`POST /v1/auth/forgot-password`, no auth, `{ email }`, returns `{ retryAfterSeconds }`.

### 2.1 The response never reveals whether the address exists

Unknown address, known address, Google only account: identical status, identical body, identical
timing budget. This is not a new decision, it is an existing one this endpoint must not undo.
`login()` at `identity.service.ts:191` already throws the same `UnauthorizedException` for an
unknown email and a wrong password, with a comment saying it is so the response does not reveal
which emails are registered. A forgot password endpoint that 404s on an unknown address would
hand back the enumeration oracle that comment exists to close.

`retryAfterSeconds` comes from section 2.2 and is the same for everyone, so it leaks nothing
either.

### 2.2 Throttled by the gateway bucket, like everything else

Same decision as 0021 section 4.2, and for the same reason: one rate limiter, in the gateway,
not a second one hand written into the domain service. `THROTTLE_LIMITS` gains a
`passwordReset` entry at one per minute, the route carries it as a per route override of the
single registered bucket, and `retryAfterSeconds` is read from that bucket's `ttl` so the
constant and the response cannot drift.

The property this gives up is worth naming, because it is the one place the reset flow is weaker
than a per address limit would be. The bucket keys on IP, so it does nothing about somebody
filling one person's inbox with reset mails from a rotating set of clients. What protects the
account in that scenario is not the rate limit anyway: the mails are noise, each link is single
use and expires in an hour, and none of them is a way in. If inbox flooding ever becomes a real
complaint, a per address limit is the fix and section 9 records it as such.

For an address with no account nothing is sent, and the response is the same sixty. It has to
be, or the response time and shape would answer the question section 2.1 refuses to answer.

### 2.3 The account that signs in with Google

An address can exist with no `Credential` row: `googleLogin`'s create branch
(`identity.service.ts:432`) makes a registered user with an email and no password, and so does
an upgrade through Google.

Sending nothing to that person is technically correct and practically useless, because it is
indistinguishable from a lost mail, and they will ask again, and again. So they get a mail too,
a different one: this account signs in with Google, here is the button, no link and no token.

It costs one template and it turns a dead end into an answer. The API response is byte identical
to the ordinary case, so non disclosure holds: the difference exists only in the inbox of
somebody who already controls the address.

## 3. Completing a reset

`POST /v1/auth/reset-password`, no auth, `{ token, password }`, returns **`AuthTokens`**.

### 3.1 Why it signs you in

The alternative is returning `{ userId }` and sending the user to the sign in screen to type the
password they chose eight seconds ago. That is friction with nothing behind it: whoever holds a
consumed reset token has already proven control of the mailbox and has already set the
credential, so refusing them a session withholds nothing from an attacker and costs a real user
a form.

### 3.2 What else it does

Two things beyond writing the hash, both of which follow from what a reset means.

- **Every refresh token for the user is revoked.** The common reason to reset is that somebody
  else has the password. Leaving their sessions alive means the reset changed nothing for up to
  a refresh lifetime. `RefreshToken` already has `revokedAt` and `TokenService` already revokes
  one on rotation (`token.service.ts:110`), so this is a `revokeAllForUser(userId)` beside it:
  one update, `WHERE userId = :id AND revokedAt IS NULL`. The pair issued by this very call is
  created after the revoke, so the person resetting stays signed in and everyone else does not.
- **`emailVerifiedAt` is set if it was not.** They just proved control of the mailbox by
  following a link sent to it, which is the same evidence the confirmation flow accepts and a
  strictly stronger action than clicking a confirmation link. Leaving the address unverified
  after that would be pedantry, and it would leave a nudge on screen asking for proof already
  given.

Both happen in the transaction that consumes the token, so a failure leaves neither half done.

### 3.3 Failures

| Case | Code |
| --- | --- |
| Unknown, expired or already consumed token | `validation_failed` |
| Password shorter than 8 or longer than 200 | `validation_failed`, per field, from the DTO |

One code for all three token failures, exactly as `verifyEmail` already does at
`identity.service.ts:215`, and for the same reason: distinguishing them tells an attacker which
tokens once existed.

A reset for a user with no `Credential` row (the Google case, if they somehow obtain a token)
cannot happen, because section 2.3 never issues one to them.

## 4. Mail

Two additions to `auth/src/app/mail/mail.service.ts`, following the existing pattern exactly:
a `COPY` record keyed by `SupportedLocale`, a compiled Handlebars template, and a method. English
and Spanish, per plan 0004 section 12.

- **The reset mail.** Subject, heading, a line saying somebody asked to reset the password for
  this account, the button, an expiry line naming one hour, and the standard ignore line. The
  ignore line matters more here than in the confirmation mail, because an unrequested reset mail
  is the first sign somebody is trying the address.
- **The Google mail.** No link, no token, no button that does anything security relevant: this
  account signs in with Google, open the app and use Continue with Google.

`AuthConfig` gains `MAIL_RESET_BASE_URL` beside the existing `MAIL_VERIFY_BASE_URL`
(`auth/src/app/config/app-config.ts`), required in the Joi schema the same way, and both k8s
values files gain it. The link is built the same way the verification link is
(`mail.service.ts:63`), pointing at the frontend's reset route with the raw token in the query.

## 5. Contracts

New in `libs/luna-shopper/contracts`:

- `AUTH_PATTERNS.forgotPassword` and `AUTH_PATTERNS.resetPassword`.
- `ForgotPasswordRequest { email, locale? }` and `ResetPasswordRequest { token, password }`,
  with `locale` threaded from the request context by the gateway exactly as `register` does at
  `auth.controller.ts:38`, so the mail is in the language the app is showing.
- A `RetryAfterResult { retryAfterSeconds }` response shape, shared with 0021's resend rather
  than duplicated.
- JSON Schemas for all of them; plan 0010's completeness spec fails without them.

Both gateway handlers carry `@ApiContractResponse` and `@ApiProblemResponses` per plan 0019, and
`openapi.json` is regenerated.

## 6. Tests

- **Non disclosure**: forgot password for an unknown address, a known address and a Google only
  address return the same status and the same body. Asserted together in one test, because the
  property is the equality rather than any single response.
- **Mail routing**: a password account gets the reset template; a Google only account gets the
  Google template; an unknown address gets no mail at all.
- **Throttle**: a second request inside sixty seconds returns 429 carrying the real remaining
  seconds rather than a flat sixty. Note for whoever writes it that the bucket keys on IP, so a
  request for a different address from the same client is refused too; that is the documented
  behaviour of section 2.2 and the test should assert it rather than be surprised by it.
- **Reset**: a valid token sets the hash, returns a usable pair, and the old password no longer
  logs in; a consumed token fails; an expired token fails; a token for a user whose
  `emailVerifiedAt` was null leaves it set.
- **Session revocation**: two live refresh tokens before the reset, both rejected after it, and
  the pair returned by the reset itself still rotates. This is the one people get wrong by
  revoking after issuing.
- Password rules come from the DTO and are covered by its own validation tests.

## 7. Acceptance criteria

- [ ] `POST /v1/auth/forgot-password` answers identically for an unknown address, a registered
      address and a Google only address.
- [ ] A reset link older than one hour, or already used, is refused with `validation_failed`.
- [ ] Completing a reset returns `AuthTokens` and the user is signed in with no further step.
- [ ] Completing a reset revokes every refresh token issued before it, and not the one it issues.
- [ ] Completing a reset marks the address verified when it was not.
- [ ] A Google only account receives the Google mail and never a reset token.
- [ ] `npx nx run-many --all --target=lint` and `--target=test` pass, and `openapi.json` is
      regenerated and committed.

## 8. What the frontend will need

Recorded so it is not rediscovered, and deliberately not designed here: two routes, a request
screen reached from the sign in screen's rejection message, and a `?token=` screen that sets the
new password and lands signed in. Both belong to a velista plan, which will also decide the copy.
The only backend fact that plan needs and cannot guess is section 2.1: the response is the same
whether or not the address exists, so the screen must say "if that address has an account, we
have sent a link" and must never claim delivery.

## 9. Out of scope

- **Changing a known password from inside the app.** That is an account settings concern, needs
  the current password rather than a mailed token, and belongs with the account screen.
- **Rate limiting by anything other than the gateway's IP bucket.** A per address limit is the
  answer if inbox flooding ever becomes a real complaint (section 2.2), and it is not built now.
  No device fingerprinting and no captcha either.
- **Bounce and delivery tracking.** Same answer as 0021: it needs a provider webhook and a
  delivery state model, neither of which exists.
- **Forcing a reset.** No administrative "expire this user's password" path; nothing in the
  product needs one yet.
