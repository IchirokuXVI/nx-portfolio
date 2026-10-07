# 0194: an operator opens the app as a user

> Asked for by the owner on 2026-10-07. A person reports a bug that happens only with the
> data of that person. The operator has no way to see the app as that person sees it.
>
> This plan is the backend half. Velista `0133` (the handoff page and the strip) and admin
> `0062` (the action on the page of a person) are built on its contract. **Build this plan
> first.** The other two can then be built at the same time.
>
> The word in code is `impersonation`. The words on a screen are "support session" and
> "Viewing as". The owner chose the design on 2026-10-07: a session row with a hard
> deadline, short access tokens that carry the operator, a code that is used one time to
> hand the session to the app.
>
> Prerequisite reading: backend `0071` (the admin is not a user),
> `apps/luna-shopper-backend/auth/src/app/tokens/token.service.ts`,
> `token-grant.service.ts`, `identity/identity.service.ts` (`issueTokens`, `refresh`),
> `admin/platform-admin.service.ts`, `audit/auth-audit.service.ts`,
> `apps/luna-shopper-backend/gateway/src/app/auth/jwt.strategy.ts`,
> `auth/google.controller.ts` (the one existing handoff between two origins),
> `apps/luna-shopper-backend/realtime/src/app/auth/token-verifier.service.ts` and
> `socket/realtime.gateway.ts`.

## Brief for the agent

### Objective

Let a signed in operator start a support session for one user. The session gives the app a
normal token pair for that user. Each access token names the operator. The session stops
at most two hours after it started, and nothing can extend it.

### Context

Every statement below was read on `dev` at `b9eece51`. Read each file again before you
rely on a line of it.

- **An operator and a user are two principals.** They have two tables (`admin_users`,
  `users`), two RS256 key pairs and two passport strategies. Neither token passes the guard
  of the other. `admin-token-separation.spec.ts` asserts it. This plan keeps that rule: an
  operator never presents an admin token to a user route.
- **The access token** of a user carries `sub`, `kind` and `perms`
  (`AccessTokenClaims` in `libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts`).
  Its life is `ACCESS_TOKEN_TTL`, 15 minutes. The gateway and realtime verify it offline.
- **The refresh token** is an opaque value. `refresh_tokens` keeps its SHA-256 hash, an
  `expiresAt` and a `revokedAt`. `rotate()` revokes the row, and `issueTokens` then writes
  a new row with a new 30 day life. No row knows the row before it, and no life has an
  absolute end.
- **No session exists on the server.** No route signs a user out. A signed access token
  cannot be revoked before its `exp`.
- **A socket is checked one time.** `handleConnection` in realtime verifies the token as
  the socket connects. No timer exists for the `exp` of the token, so a socket lives after
  its token expires. The SSE routes verify one time too.
- **`TokenGrantService`** issues a random value, stores its hash and consumes it one time.
  `oauth_states` uses it for the Google handoff. Its `consume` reads the row and then
  saves it. That is two statements, so two requests at the same instant can both pass.
- **The audit trail** is `auth_audit`, written through `AuthAuditService.write` in the
  transaction of the change. Its actor is an `admin_users.id`.
- **The gateway forwards the `Authorization` header of the caller to the assistant.** The
  assistant thus acts as the user of the token with no change here.
- **`APP_BASE_URL`** of the gateway is the address of the app with a `{locale}` hole. The
  Google callback already builds a redirect from it.

### Target state

1. **A session row.** A new table `impersonation_sessions` in the auth database:

   | Column | Type | Notes |
   |---|---|---|
   | `id` | uuid | The session id. It is the `sid` of the claim |
   | `adminId` | uuid | An `admin_users.id`. No foreign key, as in `auth_audit` |
   | `userId` | uuid | Foreign key to `users`, cascade on delete |
   | `reason` | varchar | One of the reason codes below |
   | `reasonNote` | text, null | Required for `OTHER`, refused for the others |
   | `expiresAt` | timestamptz | Creation time plus two hours. Never written again |
   | `endedAt` | timestamptz, null | Set one time, by the end route or by a refusal |
   | `codeHash` | varchar, unique | SHA-256 of the handoff code |
   | `codeExpiresAt` | timestamptz | Creation time plus 60 seconds |
   | `codeConsumedAt` | timestamptz, null | Set by the exchange |

   Two hours is a constant in code, `IMPERSONATION_MAX_MS`. It is not configuration,
   because the owner fixed the number.

2. **The reason codes.** A contract enum `ImpersonationReason`: `BUG_REPORT`,
   `SUPPORT_REQUEST`, `TESTING`, `OTHER`. `TESTING` needs no note. `OTHER` needs a note of
   1 to 500 characters.

3. **A refresh row knows its session.** `refresh_tokens` gains a nullable
   `impersonationSessionId` (foreign key, cascade). `rotate()` returns it beside `userId`.

4. **The claim.** `AccessTokenClaims` gains an optional member:

   ```ts
   act?: {
     sub: string;   // admin_users.id
     sid: string;   // impersonation_sessions.id
     until: number; // the deadline of the session, seconds since the epoch
   };
   ```

   `act` is the actor claim of RFC 8693. `sub` stays the user. A token with no `act` is an
   ordinary token, and every reader treats an absent `act` as "not a support session".

5. **Issuing for a session.** One function issues the pair of a session, for the exchange
   and for a refresh alike:
   - The `exp` of the access token is the earlier of now plus `ACCESS_TOKEN_TTL` and the
     `expiresAt` of the session.
   - The `expiresAt` of the refresh row is the `expiresAt` of the session.
   - It refuses a session with `endedAt` set, a session past `expiresAt`, and a session
     whose operator is disabled or gone. A refusal for a disabled operator sets `endedAt`.

6. **Four NATS subjects in auth**, each with a gateway route in front of it:

   | Route | Guard | Does |
   |---|---|---|
   | `GET /v1/admin/impersonation` | `AdminJwtGuard` | Answers `{ enabled }` |
   | `POST /v1/admin/users/:id/impersonation` | `AdminJwtGuard` | Starts a session |
   | `POST /v1/auth/impersonation/exchange` | none | Trades the code for the pair |
   | `POST /v1/auth/impersonation/end` | `JwtAuthGuard` | Ends the session of the token |

   - **Start.** The body is `{ reason, note?, locale? }`. Auth verifies the operator with
     `requireAdmin`, as every other admin subject does. It writes the row and the audit
     record in one transaction, and it ends each earlier session of the same operator and
     the same user that is still live. The answer is
     `{ sessionId, url, codeExpiresAt, expiresAt }`. The gateway builds `url` from
     `APP_BASE_URL`: the path `/auth/impersonate` and the code in the fragment, as
     `#code=<code>`. The code is in no query string, so no access log holds it.
   - **Exchange.** The body is `{ code }`. One conditional `UPDATE ... RETURNING` consumes
     the code: it matches the hash only while `codeConsumedAt` is null, `codeExpiresAt` is
     in the future and `endedAt` is null. A missing, used, old or ended code gets one
     answer, `impersonation_code_invalid`, so that the answer says nothing about which.
     The answer of a good code is `AuthTokens`, unchanged in shape.
   - **End.** A token with no `act` gets `not_impersonating`. A token with `act` sets
     `endedAt` (a second call changes nothing), revokes the refresh rows of the session,
     writes the audit record and answers 204.

7. **The gateway checks each request of a support session.** `JwtStrategy` puts
   `impersonation: { adminId, sessionId }` on `CurrentUser` when the token carries `act`.
   A guard then asks auth one question over NATS, `auth.impersonation.check`, and refuses
   with 401 `impersonation_ended` unless the session is live. Only tokens with `act` pay
   for that hop. It is what makes "End" and the two hour limit exact, and not late by the
   life of an access token.

8. **The routes a support session cannot use.** A decorator `@RefuseImpersonation()` and
   its guard answer 403 `impersonation_not_allowed`:
   - `DELETE /v1/account`
   - `POST /v1/auth/upgrade`
   - `POST /v1/auth/google/state`
   - `POST /v1/zones/:id/members/:mid/transfer-ownership`
   - `POST /v1/auth/resend-verification` (added by this plan, see section 2)

   Every other route answers as it does for the user. **The assistant routes stay open**
   (the owner, 2026-10-07).

9. **Realtime.** `TokenVerifierService` returns `until` and the session id of a token with
   `act`. `handleConnection` asks auth the same question as the gateway, refuses a session
   that is not live, and sets a timer that disconnects the socket at `until`. The SSE
   routes close their stream at `until`. Auth publishes `impersonation.ended` with the
   session id, and realtime disconnects the sockets of that session on it.

10. **One switch.** `IMPERSONATION_ENABLED` in auth, default `false`. While it is false,
    start answers 403 `impersonation_disabled`, and exchange answers
    `impersonation_code_invalid`. `values.staging.yaml` sets it true.
    `values.production.yaml` does not name it. The `.env` that `luna-slot.sh` writes and
    `compose.apps.yml` set it true, so that a developer and the e2e gate can use it.

11. **The documents.** `openapi.json` and `wire-types.ts` are regenerated and committed.

### Scope

- `libs/luna-shopper/contracts` (the claim, the enum, the messages, the event).
- `libs/luna-shopper/platform/src/lib/errors/error-codes.ts` (five codes).
- `apps/luna-shopper-backend/auth` (entity, migration, service, subjects, audit, config).
- `apps/luna-shopper-backend/gateway` (routes, strategy, two guards, config read).
- `apps/luna-shopper-backend/realtime` (verifier, socket timer, SSE, the event).
- `k8s/helm` (ConfigMap, `_env.tpl`, `values.yaml`, `values.staging.yaml`),
  `k8s/e2e/luna-shopper-backend/luna-slot.sh` and `compose.apps.yml`.
- The two generated documents.

### Constraints

- **An ordinary session does not change.** A token with no `act` takes no new hop, and a
  refresh row with no session keeps its 30 day life. A spec asserts both.
- **The deadline is written one time.** No code path writes `expiresAt` of a session after
  the insert. A spec reads the entity for a second writer.
- **The real sessions of the user stay.** Starting or ending a support session revokes no
  refresh row that the user holds.
- **The code is never logged**, and neither is a token. The audit record of the row leaves
  `codeHash` out, as it leaves `tokenHash` out today.
- **The migration only adds.** One table and one nullable column. No row is deleted, so
  this is a migration and not a release task.
- Do not add a second switch in the gateway. One switch in auth cannot disagree with itself.

### Action boundaries

- Stop and ask before you change the shape of `AuthTokens`, the 30 day life, or the life of
  an access token.
- Stop and ask before you add a route to the refused list beyond the five above, or remove
  one from it.
- Do not build an admin route that lists or ends sessions. Section 1 says why.
- Do not touch velista or the admin app. Their plans do.

### Progress evidence

- `npx nx affected -t lint test` is green, and `npx nx run-many -t build` for auth, gateway
  and realtime is green (only the build type checks here).
- The integration specs of auth pass against a real Postgres on an ephemeral slot. Name the
  slot and the command in the report.
- One walk over HTTP on a slot, pasted in the report: start, exchange, a read as the user,
  one refused route, end, and the same read answering 401 after it.

## 1. Not in this plan

- **A list of sessions in the admin app, and ending one from there.** The start answer
  gives the id, and the app ends its own session. A history page waits for a reader of the
  audit trail, which does not exist yet.
- **A record of each request made in a session.** The row says who, whom, when and why.
- **Production.** The switch stays off there until the owner turns it on. The privacy
  policy must name support access before that day.
- **A read only mode.** The owner chose writes with a refused list.

## 2. Decisions

- **A session row, not a longer token.** A two hour access token cannot be stopped, and a
  refresh row with a two hour life is renewed by the next rotation. The row holds the one
  deadline that every token of the session is cut to.
- **The gateway asks auth on each request of a session.** The other choice is to trust the
  token for its 15 minutes. Then "End" is up to 15 minutes late, and a disabled operator
  keeps the session for that long. Support sessions are rare, so one hop per request costs
  nothing that matters.
- **`resend-verification` joins the refused list.** It sends mail to the real address of the
  user, from a press that the user did not make. The owner did not name it. Strike it from
  target state 8 if the owner disagrees.
- **A new start ends the earlier session** of the same operator and user. Two live sessions
  for one pair have no use, and an operator who lost the tab needs a way back in.
- **A guest can be the user.** A `TEMPORARY` account is a `users` row like any other, and
  bugs happen to guests too.
- **The code travels in the fragment**, and the tokens travel in a response body. The
  Google callback puts tokens in a fragment. This plan does not copy that, because a code
  that is dead after one use is worth less to whoever reads a browser history.

## 3. Build order

1. Contracts: the claim, the enum, the messages, the event, the error codes.
2. Auth: the entity and the migration, then issuing, then the four subjects, then the
   switch.
3. Gateway: the routes, the strategy, the two guards.
4. Realtime: the verifier, the timer, the event.
5. Helm, the slot script and the compose file. Then the two generated documents.

## 4. Tests

- **Issuing.** The `exp` of an access token never passes the deadline. A refresh one minute
  before the deadline gives a token with one minute of life. A refresh after the deadline
  is refused. A refresh of an ended session is refused. A refresh while the operator is
  disabled is refused and sets `endedAt`.
- **The code.** Two exchanges of one code at the same instant: exactly one succeeds
  (integration, real Postgres). An old code, a used code and a code of an ended session get
  the same answer.
- **The gateway.** Each refused route answers 403 with `act` and its usual answer without.
  A request after "End" answers 401 `impersonation_ended` while the token is still inside
  its `exp`. A token with no `act` sends no check to auth.
- **Realtime.** A socket of a session is disconnected at `until` under fake timers, and on
  `impersonation.ended`.
- **The switch.** Off: start is refused and exchange is refused.
- **The separation.** `admin-token-separation.spec.ts` still passes with no edit.
