# 0210: a reset link can also sign you in

> Asked for by the owner on 2026-10-14:
>
> - "On the password restoration screen, you can skip the restore screen (the password is
>   kept the same) and just login to the account, without using your password."
> - "On the password restoration email, you will have 2 links, one to restore the password
>   and another that logins to the app without restoring the password."
> - "Both the restore password and login share the same token, if either of those actions is
>   completed, the token won't work anymore."
> - "From the admin app you can send the restore password email."
> - "From the admin app, you can generate the restore token without sending the email, so
>   that it can be shared manually. When generating it, the links are given to the admin user
>   and the same limit of 1 use applies."
> - "If you use the login link with a logged account that is linked to that token, you won't
>   get the error even if the token isn't valid anymore. If the token was valid, even if it
>   wasn't used to login because the user was already logged, it must be revoked."
>
> This plan is the backend half **and** the admin half (the owner asked for the admin part
> here). The velista half is velista `0148`, which owns the reset page, the sign in link page
> and the forgot password entry. **Build this plan first.** Velista `0148` is built on its
> contract.
>
> Prerequisite reading: backend `0022` (password reset), `0021` (the grant service), `0020`
> (optional auth), `0071` (the admin is not a user), `0077` section 8 (an operator grant in
> the audit trail), `0194` (support sessions and the refused list),
> `auth/src/app/identity/identity.service.ts` (`forgotPassword`, `resetPassword`,
> `resendVerificationAsOperator`), `auth/src/app/tokens/token-grant.service.ts`,
> `auth/src/app/tokens/token.service.ts`, `auth/src/app/mail/mail.service.ts`,
> `auth/src/app/admin/admin-directory.service.ts`,
> `gateway/src/app/auth/auth.controller.ts`, `gateway/src/app/admin/admin-directory.controller.ts`,
> `libs/luna-shopper-admin/feature-people/src/lib/users.ts` and
> `libs/luna-shopper-admin/data-access/src/lib/directory/`.

## Brief for the agent

### Objective

One reset grant carries two links: a reset link and a sign in link. Spending either one ends
the grant. An operator can mail the grant to a person, or create it and receive the two links
to share by hand. A person who opens the sign in link while already signed in as the owner of
the grant gets no error, and a live grant is ended by that visit.

### Context

Each statement below was read on `dev` at `c6962472`. Read each file again before you rely on
a line of it.

- **The grant exists.** `password_resets` (`userId`, `tokenHash`, `expiresAt`, `consumedAt`)
  is issued by `forgotPassword` and spent by `resetPassword` through `TokenGrantService`. Its
  life is one hour (`RESET_TTL_MS`). Only the SHA-256 hash is stored.
- **`resetPassword` revokes every refresh token of the user**, marks the address verified,
  and returns a fresh pair issued after the revoke.
- **`TokenGrantService.consume` reads the row and then saves it.** Two requests at the same
  instant can both pass. Plan `0194` names the same defect. With two links on one grant, a
  reset and a sign in pressed together both succeed today.
- **Spending a grant leaves the other live grants of the user alive.** A person who asked
  twice and used the second mail still has a working first link for up to an hour. With a
  sign in link that is a working key to the account after the reset that was meant to end
  all keys.
- **The mail has one link**, built by `MailService.link` as `${resetBaseUrl}?token=…`.
  `MAIL_RESET_BASE_URL` is `https://velista.app/reset-password` in production, and the
  staging values file calls it "a placeholder for a page the app does not have". Velista
  has no such route today. Velista `0148` adds it at `auth/reset-password`, beside
  `auth/verify`.
- **The admin app cannot send a reset mail.** The only mail an operator can send is
  `POST /v1/admin/users/:id/resend-verification`, implemented by
  `resendVerificationAsOperator`, which writes through `AuthAuditService.write` and records
  the grant with `recordCreate` (the trail drops `tokenHash`).
- **Support sessions** (plan `0194`) mark each access token with an `act` claim naming the
  operator, and the gateway refuses a fixed list of routes inside one.
- **No user can be disabled.** `users` has no such column, so no refusal for one exists.

### Target state

1. **The grant records how it was made and how it ended.** A migration adds three columns to
   `password_resets`. It only adds, so it is a migration and not a release task.

   | Column | Type | Notes |
   |---|---|---|
   | `channel` | varchar, not null, default `SELF_SERVICE` | `SELF_SERVICE`, `OPERATOR_EMAIL`, `OPERATOR_LINK` |
   | `issuedByAdminId` | uuid, null | the operator for the two operator channels |
   | `spentAs` | varchar, null | `RESET`, `SIGN_IN`, `ALREADY_SIGNED_IN`, `SUPERSEDED` |

   `spentAs` is written in the same statement that sets `consumedAt`.

2. **Spending is one statement.** `TokenGrantService.consume` becomes a conditional
   `UPDATE ... SET "consumedAt" = now() WHERE "tokenHash" = $1 AND "consumedAt" IS NULL AND
   "expiresAt" > now() RETURNING *`. No row back is the one refusal it gives today. This also
   fixes the email confirmation and the OAuth state, which share the method. `RETURNING`
   through `createQueryBuilder().update()` answers `raw` rows with column names, not
   entities, so map the row by hand and assert the mapping in an integration spec.

3. **Spending a grant ends every other live grant of the user.** In the same transaction, each
   other row of that user with `consumedAt IS NULL` gets `consumedAt = now()` and
   `spentAs = SUPERSEDED`. This applies to a reset, a sign in and an ended visit (item 5).
   Issuing a grant does **not** end the older ones: a mail that arrives late must still work
   until one of them is used.

4. **The mail has two links.** `sendPasswordResetEmail` renders two buttons from the one raw
   token: the reset link `${resetBaseUrl}?token=…` and the sign in link
   `${resetBaseUrl}?token=…&mode=sign-in`. One base URL, so no new variable. The copy (English
   and Spanish) says that either link works one time, that using one ends both, and that both
   expire in one hour. The ignore line stays.
   - `MAIL_RESET_BASE_URL` moves to the velista route: `/auth/reset-password` in
     `values.production.yaml`, `values.staging.yaml`, `values.homelab.yaml`, `luna-slot.sh`,
     `compose.apps.yml` and `auth/.env.example`. Remove the "placeholder" comment in staging.

5. **A new route signs in with the grant.** `POST /v1/auth/recovery-sign-in`, body
   `{ token, switchAccount? }`, optional bearer (the plan `0020` guard, so a stale token is a
   401 and velista refreshes and retries). It answers 201 with
   `RecoverySignInResult = { outcome: 'SIGNED_IN', tokens: AuthTokens } | { outcome:
   'ALREADY_SIGNED_IN' }`. Auth decides in this order:

   | Caller | Grant | Answer | Writes |
   |---|---|---|---|
   | a support session (`act` set) | any | refused with the code of `0194` | nothing |
   | the owner of the grant | live | `ALREADY_SIGNED_IN` | spends it as `ALREADY_SIGNED_IN`, item 3 |
   | the owner of the grant | spent or expired | `ALREADY_SIGNED_IN` | nothing |
   | another user, `switchAccount` not true | live | `recovery_other_account` (409) | nothing |
   | anyone | no row, or spent or expired and caller is not the owner | `validation_failed` | nothing |
   | no caller, or another user with `switchAccount: true` | live | `SIGNED_IN` | spends it as `SIGNED_IN`, item 3, marks the address verified |

   - The owner check needs the row whatever its state, so look it up by hash first. Spend it
     with the statement of item 2, never with the read. A lost race answers as the row reads
     after it.
   - **A sign in revokes no session.** Only a reset does. A person who suspects that someone
     else has the password uses the reset link, and the mail says so in one line.
   - The route joins the refused list of `0194`, which already rejects it at the gateway for a
     support session. Auth refuses it too, so the rule holds if the list drifts.
   - Throttled with the bucket that `reset-password` uses.

6. **`resetPassword` keeps its behaviour** and gains `spentAs = RESET` and item 3. It takes no
   bearer. Velista `0148` asks before a reset replaces a session that belongs to someone else.

7. **An operator can mail the grant.** `POST /v1/admin/users/:id/send-password-reset`, body
   `{ locale? }`, answers 201 `{ expiresAt }`. It writes through `AuthAuditService.write`, issues
   with `channel = OPERATOR_EMAIL` and the actor as `issuedByAdminId`, records the row with
   `recordCreate`, and sends the mail of item 4 outside the transaction with `dispatchMail`.
   Refusals, each a 409 with its own code: the user has no email (a guest), and the user has
   no password credential (Google only, decision D3). No throttle, as `resend-verification`
   has none for an operator.

8. **An operator can create the links without a mail.**
   `POST /v1/admin/users/:id/recovery-links` answers 201
   `{ resetUrl, signInUrl, expiresAt }`. Same audit, `channel = OPERATOR_LINK`, the same
   refusals as item 7, and a life of 24 hours (decision D1). The response carries
   `Cache-Control: no-store`. The raw token is in this response and nowhere else: not in a
   log line, not in the audit row, not in an event.
   - The user receives a short notice mail (decision D2): "A support operator created a sign
     in link for your account on {date}. If you did not ask for help, change your password."
     No link in it.

9. **The admin app has the two actions** on the page of a person in
   `libs/luna-shopper-admin/feature-people`, beside "Resend confirmation", and in the same
   pattern:
   - "Send password reset email": a confirm, then the expiry in the result line.
   - "Create recovery links": a confirm that says the links are a key to the account, then a
     panel with the two URLs, a copy button for each, and the expiry. The links live in the
     component only. They are not written to a store, to `localStorage` or to the URL, and
     they are gone when the panel closes.
   - Both are hidden for a guest and for a Google only account, from the view the page already
     reads, so the refusals of item 7 are a backstop and not the usual path.
   - The data access follows rule D4: map each answer from `unknown` into an admin model.

10. **Contracts and documents.** New patterns, request and result types and JSON Schemas in
    `libs/luna-shopper/contracts` for item 5, item 7 and item 8. New error codes in
    `libs/luna-shopper/platform/src/lib/errors/error-codes.ts` (`recovery_other_account`, and
    the two operator refusals). Regenerate `openapi.json` and `wire-types.ts`.

### Scope

- `libs/luna-shopper/contracts`, `libs/luna-shopper/platform` (error codes).
- `apps/luna-shopper-backend/auth` (entity, migration, grant service, identity service, admin
  directory service, mail service and templates).
- `apps/luna-shopper-backend/gateway` (the three routes, the refused list).
- `k8s/helm` values files, `k8s/e2e/luna-shopper-backend/luna-slot.sh`, `compose.apps.yml`,
  `auth/.env.example` (the URL of item 4 only).
- `libs/luna-shopper-admin/data-access`, `libs/luna-shopper-admin/feature-people`,
  `libs/luna-shopper-admin/models` (generated, and the admin models).
- The two generated documents.

### Constraints

- **One grant, two links.** Never issue two tokens for one request, and never store the mode
  on the row. The mode is the choice of the person who holds the token.
- **A grant ends at most one time.** A spec runs a reset and a sign in at the same instant
  against a real Postgres, and exactly one wins.
- **Nothing is spent on a read.** The sign in route spends on a POST only. Velista `0148`
  never calls it on page load, because mail scanners open links.
- **The raw token is never logged**, and neither is an operator link.
- **Non disclosure of `0022` section 2.1 stays.** `forgot-password` answers exactly as before.
- **The migration only adds.** Existing rows read as `SELF_SERVICE` with `spentAs` null.

### Action boundaries

- Stop and ask before you change the one hour life of a self service grant, the shape of
  `AuthTokens`, or the revoke that a reset does.
- Stop and ask before you let an operator create links for a guest or a Google only account.
- Do not touch velista. Velista `0148` builds the pages.
- Do not build a list of grants or a revoke action in the admin app (section 1).

### Progress evidence

- `npx nx affected -t lint test` is green, and `npx nx run-many -t build` for auth, gateway
  and `luna-shopper-admin` is green (only the build type checks here).
- The integration specs of auth pass against a real Postgres on an ephemeral slot. Name the
  slot and the command in the report.
- One walk over HTTP on a slot, pasted in the report: forgot password, read both links from
  Mailpit, a sign in with no bearer (`SIGNED_IN`), the reset link then refused, a second
  grant opened by its owner while signed in (`ALREADY_SIGNED_IN`), and an operator
  `recovery-links` call whose sign in link works one time.

## 1. Not in this plan

- **The velista pages.** Velista `0148`.
- **A list of outstanding grants in the admin app, and a revoke button.** Item 3 ends them on
  use and they expire by themselves. Add it if an operator ever needs to take a link back.
- **A sign in link for a Google only account.** It would be a passwordless way in for those
  accounts, which they lack today. It is a reasonable next step, and decision D3 keeps it out.
- **A link for a guest.** A guest has no email and no credential. A link would be a way to
  move a guest to a new device, which is a product feature of its own.
- **A per address limit** on `forgot-password`. Section 2.2 of `0022` still holds.

## 2. Decisions

The agent builds the default of each. The owner can change any of them before the merge.

- **D1. An operator link lives 24 hours, a mailed grant one hour.** An operator who shares a
  link by hand often waits on the person to read a chat. One hour would expire first. 24
  hours is a key that sits in a chat log for a day, which is why D2 exists. **Owner.**
- **D2. Creating operator links mails a notice to the user.** An operator sign in link is a
  full session as the person, with no `act` claim, no two hour deadline and no refused list.
  It does what a support session (plan `0194`, off in production) does with fewer limits.
  The audit row records who created it. The notice tells the person. **Owner:** keep the
  notice, or also put the route behind the switch of `0194` until the privacy policy names
  support access.
- **D3. An operator action refuses a Google only account.** The reset half would give it its
  first password through the branch of `resetPassword` that is unreachable today. That may be
  wanted, but it is a new way in that nobody asked for.
- **D4. A sign in revokes no session**, and marks the address verified, as a reset does.
- **D5. Issuing does not supersede; spending does** (item 3). The other way round lets anyone
  who knows an address kill a link an operator just shared, by asking for a reset.
- **D6. One base URL with a `mode` parameter**, not a second variable. Each new variable costs
  changes in five files.

## 3. Build order

1. The grant service: the statement of item 2 and its race spec.
2. The migration, the entity, item 3 in `resetPassword`.
3. The sign in route through auth and gateway, the refused list.
4. The mail of item 4 and the URL move.
5. The operator routes of items 7 and 8, with their audit.
6. Contracts, error codes, `openapi.json`, `wire-types.ts`.
7. The admin app actions.

## 4. Tests

- **The race.** A reset and a sign in on one grant at the same instant: exactly one succeeds
  (integration, real Postgres). The same for two sign ins.
- **Superseding.** Two grants for one user. Spending the first ends the second as
  `SUPERSEDED`. Issuing a third leaves the second alone until a spend.
- **Each row of the table in item 5**, one spec each, including the support session refusal
  and the 409 that spends nothing.
- **The owner rule.** Signed in as the owner with a live grant: `ALREADY_SIGNED_IN`, and the
  grant is spent and the reset link refused afterwards. With a spent grant:
  `ALREADY_SIGNED_IN` and no write.
- **A sign in keeps sessions.** A live refresh token before a sign in still rotates after it.
- **The mail** renders two links from one token, and the sign in link carries `mode=sign-in`.
- **Operator routes.** Each writes one audit row with the actor and without `tokenHash`. Each
  refuses a guest and a Google only account. `recovery-links` answers `no-store`, lives 24
  hours, and sends the notice. Its sign in link works one time.
- **Admin app.** The panel shows both links and drops them on close; the actions are hidden
  for a guest and a Google only account.

## 5. As built

The build follows the text above, with the default of each decision D1 to D6. It differs in
the points below. Velista `0148` reads this section as the contract where it differs from the
target state.

- **The codes of the two operator refusals** are `recovery_needs_email` (a guest, no address)
  and `recovery_needs_password` (no password credential). Both 409, as is
  `recovery_other_account`. The text above did not name the two.
- **`POST /v1/auth/recovery-sign-in` is in a controller of its own**,
  `recovery-sign-in.controller.ts`, and not in `auth.controller.ts`. The body is a raw token,
  and the error log prints the body of a request that failed with a 500. The controller of
  its own is what `WithholdBodyMiddleware` is applied to, so the constraint "the raw token is
  never logged" holds on that path too. `reset-password` still carries its token in a body
  that the middleware does not cover; that is outside this plan.
- **`switchAccount` passes only as a JSON boolean.** The global pipe converts types, so the
  DTO reads the field as it was spelled, as the harvest schedule reads its acknowledgement.
  A string `"false"` answers 400 and does not leave a session.
- **No `@Throttle` on the sign in route.** `reset-password` carries none of its own, so the
  bucket it uses is the default one, and the sign in route uses the same.
- **The migration adds three CHECK constraints** besides the columns: the allowed values of
  `channel` and `spentAs`, `spentAs` only with `consumedAt`, and an operator on exactly the two
  operator channels. It still only adds.
- **The operator routes take a body of `{ locale? }`.** For `send-password-reset` it is the
  language of the reset mail; for `recovery-links` it is the language of the notice mail.
  `recovery-links` refuses with 501 `not_configured` when no SMTP host is set, because the
  notice of decision D2 could not be sent.
- **The notice mail writes its date in UTC and says so.** Auth does not know where the person
  is.
- **The admin app needed two additions to the descriptor framework.** A named action may now
  answer an outcome: a `line` the record page draws in the tone of a save, or a `panel` the
  record page draws in a dialog and drops on close. And `recordOnly` keeps an action off the
  rows of the list, where a panel has nowhere to go. Both are in
  `libs/luna-shopper-admin/models` and `feature-resource`, which the scope above did not list.
  The admin models of the two answers (`RecoveryLinks`, `PasswordResetSent`) are in
  `data-access/src/lib/directory/recovery-links.ts`, beside their mappers, as the harvest
  answers are.
