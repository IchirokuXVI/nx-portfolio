# Session token review: auth service, gateway, velista client

Independent review of how this repository issues, stores, rotates and spends session tokens, from the auth service through the gateway to the velista browser client. Dated 2026-10-27. Written for the owner and for the agents who will build the fixes. Nothing in this review changed product code. The only new file beside this one is the Playwright spec named in section 7.

How to read this file as a builder: each finding in section 5 names the files and lines that hold the defect, the test that proves it where one exists, and a suggested fix. Build one finding per pull request. Rerun the test battery in section 7 before and after. A test that passes after the fix is the proof.

## 1. Scope and method

- Reviewed on the `fix/velista-basket-search-duplicates` checkout, 240 commits behind `origin/dev`. Both reviewers compared the two: every auth, token, gateway auth, interceptor and realtime server file is identical on both. Files that differ were read from `origin/dev`. All line numbers below are for those files.
- Two reviewers read the whole system in parallel, one for correctness, concurrency and failure handling, one for security and abuse. Neither saw the other's work. The lead merged the reports, checked each finding against the code, and did the cross-boundary trace in section 4.
- One test writer chose and ran eleven checks against a live local stack: a worktree reset to `origin/dev` at 83f982bd1, an ephemeral Luna slot 4 (gateway on 43300) and velista on slot 1 (42005). A second round settled one question with a script and no stack. Both slots were taken down afterwards.
- No production or staging access was used. No pull request was opened.
- Anything marked [unverified] was inferred and not observed.

## 2. The lifecycle as the code implements it

1. Issue. Register, login, upgrade, the Google callback, password reset and recovery sign-in all end in `TokenService.issueTokens` (`apps/luna-shopper-backend/auth/src/app/tokens/token.service.ts:229-243`). That signs an RS256 access JWT with `sub`, `kind`, `perms`, a `kid` header and a 15 minute expiry (`:54-69`). It also inserts one refresh row: 32 random bytes encoded base64url, stored only as a SHA-256 hash, expiring 30 days after the insert (`:132-149`). Each rotation inserts a new row with a fresh 30 days, so a session has no absolute lifetime. A support session uses `issueTokensForSession` (`:167-203`), which adds the `act` claim and cuts both tokens to the session deadline. The Google callback returns the pair in the URL fragment of a 302 (`apps/luna-shopper-backend/gateway/src/app/auth/google.controller.ts:233-239`).
2. Store. `TokenStore.set` writes the pair to a signal and to `localStorage['session:velista']` (`libs/velista/data-access/src/lib/auth/token-store.ts:138-141`). Other documents on the origin adopt it through the `storage` event (`:121-135`), and the handler trusts `event.newValue` instead of re-reading storage (`libs/velista/platform/src/lib/browser-facade.ts:283`). A support session keeps its pair in `sessionStorage`. A guest basket participant keeps a secret under `basket-session:velista:<basketId>`.
3. Spend. Every gateway request carries `Authorization: Bearer` from the interceptor (`libs/velista/data-access/src/lib/gateway-interceptor.ts:326-344`) and only to the gateway origin. The client decides a token is expired by decoding its `exp` without verifying the signature, 60 seconds early (`libs/velista/platform/src/lib/access-token-expiry.ts:41-48`). The gateway `JwtStrategy` verifies the RS256 signature with the auth public key and `exp`, and nothing else (`apps/luna-shopper-backend/gateway/src/app/auth/jwt.strategy.ts:220-249`). Only a token with `act` makes the gateway call auth. The socket sends the token in the handshake and the realtime service verifies it once, on connect (`apps/luna-shopper-backend/realtime/src/app/socket/realtime.gateway.ts:167-243`).
4. Refresh. The client refreshes on demand only, with no timer: the interceptor calls `accessTokenIfFresh()` and awaits `ensureFreshToken()` when that answers null (`gateway-interceptor.ts:104-113`). A 401 earns one refresh and one retry (`:135-176`, `:268-324`). The refresh is single flight per document (`token-store.ts:204-210`) and `_performRefresh` adopts a newer pair from storage before it rotates (`:278-300`). `POST /v1/auth/refresh` has `@SkipThrottle()` (`apps/luna-shopper-backend/gateway/src/app/auth/auth.controller.ts:134-140`) and forwards over NATS with no timeout. In auth, `IdentityService.refresh` (`apps/luna-shopper-backend/auth/src/app/identity/identity.service.ts:948-963`) calls `TokenService.rotate` (`token.service.ts:282-301`): `findOne` by hash, a check of `revokedAt` and `expiresAt`, then `revokedAt = now` and an unconditional `save`. The user load and the new pair follow outside any transaction. There is no family id, no reuse detection and no grace window.
5. End. Sign out is client only: `TokenStore.clear()` plus `ProfileStore.clear()` (`libs/velista/feature-account/src/lib/account-page/account-page.ts:334-338` on origin/dev). No logout route exists in the gateway, in auth, or in `AUTH_PATTERNS`. `revokeAllForUser` has exactly one caller, the password reset (`identity.service.ts:639`). Account deletion removes rows by FK cascade. Impersonation end revokes the rows of that session only.

## 3. Invariants the design claims, and whether the code holds them

| Invariant | Holds | Evidence |
|---|---|---|
| A refresh token is single use | No | `token.service.ts:285-296` reads then saves with no condition. Test 2: two parallel presentations both answered 201 in 9 of 10 rounds |
| No answer means nothing was spent | No | Test 1: the server rotated, the client kept the dead token and was signed out on the next request |
| Two documents never sign each other out | No | Test 3: the loser removed storage for about 500 ms in 4 of 5 rounds |
| Sign out ends the session | No | Test 6a: the pre-sign-out refresh token still answered 201. Test 4: an in-flight refresh re-signed the user in |
| A held but unproven session never reaches an optional-auth route anonymously | No for baskets | Test 5: the join went out with no bearer and minted a guest participant |
| A token that names nobody is refused | Partly | Realtime and `ParticipantGuard` refuse it. `jwt.strategy.ts:234-249` has no `sub` check. Test 8: `GET /v1/zones` answered 200 |
| A leaked database row yields no usable token | Yes | Hash only, `uq_refresh_token` unique index |
| Key rotation keeps tokens in flight valid | No | Every verifier holds one key and ignores `kid` |
| A password reset ends every other session | Partly | Refresh rows yes. Access tokens live 15 more minutes. Sockets live on |
| A ban or logout is enforced at the next refresh | No | No logout route and no ban state exist |
| The OAuth state is single use and stops a replayed link | Partly | Single use yes. Not bound to the browser that started the flow |
| Secrets never reach the log | Yes, by accident | pino-http's `req` serializer drops `body`. The redaction paths alone do not reach `req.body.password` |
| Admin and user principals cannot be swapped | Yes | Separate keypairs, `aud` on the admin side |
| A support session cannot delete, upgrade, link Google or recover | Yes | `@RefuseImpersonation` on each route |

## 4. One refresh across the boundary, under each failure

The normal path: the client posts R1, the gateway forwards it over NATS, auth revokes R1, loads the user, signs a new access token and inserts R2, the gateway answers 201, the client stores R2. Client holds R2. Server holds R2 live and R1 revoked. They agree.

| Failure | What the client then believes | What the server then believes | Agree? |
|---|---|---|---|
| The request never reaches the gateway (status 0) | Signed in, holding R1 | R1 live | Yes |
| The gateway is up and auth is down (500, no subscribers) | Signed in, holding R1 | R1 live | Yes |
| Auth revokes R1 and fails before issuing R2 (crash, pool timeout) | Signed in, holding R1 | R1 revoked, nothing live | No, permanently. The next refresh is refused and the client clears |
| Auth completes and the answer is lost (gateway pod killed, Envoy timeout, reload, radio) | Signed in, holding R1 | R2 live and orphaned, R1 revoked | No, permanently. Test 1 |
| Two documents present R1 at the same moment | Both signed in on two different pairs, or the loser wipes storage for about 500 ms | Two live chains in 9 of 10 rounds, or one chain | Partly. Tests 2 and 3 |
| Sign out while a refresh is in flight | Signed out, then signed in again when the answer lands | R2 live | No. Test 4 |
| Refresh answers 503 while a session is held | Signed in but unprovable. The next request goes out with no bearer | R1 live | The server sees an anonymous caller and mints a guest participant. Test 5 |
| Key rotation during a rolling restart | Access tokens refused, refresh succeeds, retry refused, session cleared | New key signs | No for every active user |
| Client clock 16 minutes ahead | Every token looks expired, one rotation per burst | A new row per burst | Agree, with multiplied exposure to the two rows above |
| A thief refreshes first | The victim's next refresh is refused and the client clears silently | The thief's chain is live and keeps rotating | The victim is out, the thief is in. Test 6b |

The pattern across the table: the client treats "no answer" and "5xx" as "nothing was spent", and the server has already spent it in two of those cases. No grace window, no idempotency and no atomic rotation exist to reconcile them.

## 5. Findings, ranked

Each finding names its reviewer: A (correctness), B (security), both, or lead (the cross-boundary pass).

### Critical

#### F1. A lost refresh answer signs the user out, and a guest loses the account for good
- Scenario: the access token has expired. The client posts the refresh. Auth revokes the old row and issues a new pair. The answer is lost: a dropped radio, a page reload by the recovery probe (`libs/velista/data-access/src/lib/connection-recovery.ts:134-137` reloads on the first successful probe), a reload on a new version, a gateway pod killed in a deploy, an Envoy timeout over a slow auth (the gateway's NATS client has no timeout). The client keeps the old token by design (`token-store.ts:337-352`). The next request goes out with no bearer, gets 401, retries with the old token, gets 401, and the store clears (`:357-367`, `token.service.ts:288-294`).
- Effect: signed out with no notice. A temporary user has no credential and loses every group.
- Evidence: test 1 failed exactly this way. Storage was null after the next request, the old token answered 401, the new pair was never delivered.
- Likelihood: high. Every deploy and every resume on a weak signal opens the window, and the resume is when the refresh is guaranteed to run.
- Fix: make rotation atomic and idempotent with a short grace window. A just-revoked token whose successor was never used returns that successor, or a fresh pair in the same chain. Record `replacedById` or a family id on the row.
- Found by A. Confirmed by test 1.

#### F2. A Google OAuth state is not bound to the browser, so an attacker links a victim's Google identity onto the attacker's guest account
- Scenario: the attacker mints a guest with `POST /v1/zones` and then a state with `POST /v1/auth/google/state` under that guest's token. Auth stores the state with the guest's `userId`, valid 10 minutes. The attacker sends the victim `/v1/auth/google?state=S`. The victim consents on Google. The callback spends the state, finds no identity for the victim's Google id and calls `upgrade` with the attacker's guest as the link target. The guest becomes REGISTERED with the victim's Google id and verified email. The attacker's refresh token stays valid because `upgrade` revokes nothing. Every later "Continue with Google" by the victim opens that account.
- Effect: silent, persistent account takeover. The victim has no way to revoke: no logout route, and a Google-only account has no password to reset.
- Evidence: `apps/luna-shopper-backend/gateway/src/app/auth/google-auth.guard.ts:86-92` passes the state from the query with no cookie or nonce. `google.controller.ts:220-231` forwards `linkUserId: payload.userId`. `identity.service.ts:1468-1477` calls `upgrade` on that id. `identity.service.ts:974-1053` revokes no refresh row.
- Likelihood: medium. One click plus a consent screen that shows the app name.
- Fix: bind the state to the browser that started the flow with an httpOnly SameSite nonce cookie or PKCE, and revoke the guest's other refresh rows when its identity changes.
- Found by B. Not tested, Google is external.

### High

#### F3. Rotation is not atomic, so one token forks into two live sessions
- Scenario: two presentations of the same refresh token within milliseconds. Both `findOne` calls see `revokedAt = null`, both save, both get a fresh pair. Separately, the revoke commits before the user load and the new pair, so a database error between them revokes with nothing issued.
- Effect: a thief and the victim both keep working. Any future reuse detection never fires because neither presentation is refused.
- Evidence: `token.service.ts:285-296`. The grant service was fixed for exactly this race (`token-grant.service.ts:416-427`, a conditional `UPDATE ... WHERE "consumedAt" IS NULL`); the refresh path was not. Test 2 forked in 9 of 10 rounds.
- Likelihood: high, as measured.
- Fix: `UPDATE refresh_tokens SET "revokedAt" = now() WHERE "tokenHash" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now() RETURNING *`, with the insert of the successor in the same transaction. Refuse on zero rows.
- Found by both. Confirmed by test 2.

#### F4. Sign out revokes nothing, and a stolen refresh token gives unbounded access
- Scenario: the pair is taken through XSS on the shared origin (F12), a shared machine, a profile backup or a log. The thief refreshes before the victim. The victim's next refresh gets a 401 and the client clears silently. The thief keeps rotating. Each rotation issues 30 more days. Sign out on the victim's device does nothing on the server.
- Effect: permanent access. A guest or a Google-only account has no revocation path at all. No admin action ends a user's sessions. Role changes and upgrade revoke nothing.
- Evidence: no logout in `AUTH_PATTERNS` (`libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts`), `revokeAllForUser` called only at `identity.service.ts:639`, sliding expiry at `token.service.ts:137-139`. Test 6a: the pre-sign-out token answered 201. Test 6b: the thief rotated 5 of 5 times while the victim was cleared and left on a "could not read your account details" screen.
- Likelihood: medium, theft first. The impact is permanent.
- Fix: a `POST /v1/auth/logout` that revokes the presented row, a "sign out everywhere" that calls `revokeAllForUser`, an absolute session lifetime carried from the first row of the family, reuse detection on the family, and an admin action to end sessions.
- Found by both. Confirmed by tests 6a and 6b.

#### F5. A held but unprovable session is sent with no bearer, and the basket join mints a guest participant
- Scenario: a signed-in user with an expired access token. The refresh answers 503 (an auth restart). `ensureFreshToken()` returns null. The interceptor sends the request with no `Authorization` header (`gateway-interceptor.ts:104-113`, `:339-341`). The basket join route is `OptionalJwtAuthGuard` and mints a guest participant for an anonymous caller. The client stores the secret and keeps using it.
- Effect: a member joins a friend's list as "Guest N" until tomorrow, on an account that is perfectly healthy. The owner's own basket routes answer `not_a_participant`, which the page draws as "removed from this basket" and the basket socket latches as revoked.
- Evidence: test 5. The refresh got 503, then `POST /v1/share-links/:secret/join` went out with no bearer, answered 201 and created a GUEST participant with `userId: null`. The account pair was still held throughout. The D3 gate (`authorizeOptionalAuthCall`) guards only `zones.create`, `zones.join` and `recoverySignIn`.
- Likelihood: medium to high. An expired token plus any auth restart.
- Fix: never strip the bearer of a held session. Fail the request as a network-class error and let `ConnectionState` show the blocking screen.
- Found by A. Confirmed by test 5.

#### F6. Two documents refreshing one pair sign each other out for about half a second, and a race can leave the winner anonymous in memory
- Scenario: a tab and the installed app, or two restored tabs, both resume with an expired access token and refresh the same pair. Auth serializes them. The loser gets a real 401 before the winner has written storage, reads storage, finds nothing newer, and removes the key. The winner receives the removal through the `storage` event and drops its own signal. The winner's 201 then writes the new pair and both adopt it. [unverified] If the winner's write lands before it processes the queued removal event, it reads a null from the event and sits anonymous in memory while storage holds the good pair, until a reload.
- Effect: both documents go anonymous for about 500 ms. Sockets stop, callers waiting on the refresh get a 401, a guest in a create or join flow is told the account is lost.
- Evidence: test 3 failed in 4 of 5 rounds with the loser's `removeItem` recorded before the winner's `setItem`. `token-store.ts:121-135`, `:357-367`, `browser-facade.ts:283`.
- Likelihood: medium. Every browser restart that restores several velista tabs, and every PWA plus tab pair.
- Fix: serialize refresh across documents with the Web Locks API and re-read storage inside the lock. On a 401, re-read storage once more before clearing. In the storage handler, re-read the current value rather than trusting `event.newValue`. The grace window of F1 also covers this.
- Found by A. Confirmed by test 3.

#### F7. An in-flight refresh resurrects a signed-out session, or overwrites a newer sign-in
- Scenario: a refresh is in flight in one document. The user signs out in another, or signs in as a different account. The refresh answer lands and `_exchange` stores it unconditionally (`token-store.ts:335`).
- Effect: the user is signed back in after signing out on a shared device, or a guest's pair overwrites a registered sign-in.
- Evidence: test 4. The sign out removed the key, the held answer landed 120 ms later and wrote the pair, and both tabs were signed in again.
- Likelihood: low per action, real on shared devices.
- Fix: compare and set. Write the result only if storage still holds the token that was presented.
- Found by A. Confirmed by test 4.

#### F8. The callback page stores any pair from a URL fragment
- Scenario: a link to `/en/auth/callback#accessToken=...&refreshToken=...&userId=...&kind=...&username=...` with the attacker's pair. The page writes it over whatever is held (`libs/velista/feature-auth/src/lib/auth-callback-page/auth-callback-page.ts:66`) and every other document adopts it.
- Effect: a guest's only credential is discarded and the groups are gone. A registered victim is signed into the attacker's account and may type a postal code or lists into it.
- Evidence: test 7. The stored `userId` became the other account's. The history part held: no history entry kept the fragment, `history.length` was 3 and `page.goBack()` reached `/en/home` and then `about:blank`.
- Likelihood: medium. It needs only a link.
- Fix: accept the fragment only when this browser started a Google flow (a nonce in `sessionStorage` echoed in the fragment), and never overwrite a held temporary session without asking.
- Found by B. Confirmed by test 7.

#### F9. The gateway accepts a token with no subject
- Scenario: a guest obtains a basket participant token (`POST /v1/baskets/:id/participant-token`). It is signed by the auth key, has no `sub` and an `aud` of the basket. `JwtStrategy.validate` builds `{ userId: undefined }` from it and lets the request through.
- Effect: `GET /v1/zones` answered 200 with an empty list. `GET /v1/account/me`, `GET /v1/baskets/live` and `DELETE /v1/account` answered 500 because TypeORM refuses an undefined value in a where clause (`TypeORMError: Undefined value encountered in property 'User.id'`). That guard is the only thing standing. Routes that build SQL by hand are unaudited [unverified].
- Evidence: `jwt.strategy.ts:234-249`. Contrast `participant.guard.ts:97-116` and `token-verifier.service.ts:144-162`, which refuse such a token. Test 8.
- Likelihood: low today, because of the TypeORM guard.
- Fix: refuse a payload without a string `sub`, refuse one with `participantId` or `aud` present, and give access tokens an `aud` or `typ` that each verifier requires.
- Found by B. Confirmed by test 8.

### Medium

#### F10. Sockets outlive their tokens
- A user socket is verified once at `handleConnection` and never again. It survives token expiry, a password reset, account deletion and sign out, and can still subscribe to zones and lists because those checks read the user id stored on the socket. Only a support session gets a deadline timer (`realtime.gateway.ts:218-235`).
- Fix: disconnect a socket at its token's `exp` and on a `user.sessionsRevoked` event from reset and deletion. The client reconnects with a fresh token.
- Found by B. A noted it. Not tested, needs a 15 minute TTL or a shorter one on the slot.

#### F11. A key rotation signs out every active user
- Every verifier holds exactly one public key and ignores `kid`: `jwt.strategy.ts:226-231`, the realtime `JwtModule`, and `ParticipantGuard`. `provision-release.sh --rotate` replaces the keypair. During a rolling restart the single retry is refused and `reportRejected` clears the session.
- Fix: a key set by `kid` with the current and the previous key. Roll out the verifiers before the signer.
- Found by both.

#### F12. velista on the portfolio origin shares `localStorage` with four other apps, and no CSP or frame-ancestors header exists
- Confirmed on `origin/dev`: `k8s/helm/portfolio/values.yaml:112-115` mounts velista at `/velista` with `keepPrefix: true`. No nginx file and no Helm template sets `Content-Security-Policy`, `X-Frame-Options`, `frame-ancestors` or `Referrer-Policy`. An XSS in the shell or any remote reads the pair.
- Fix: redirect `/velista` to `velista.app`, and add a CSP with `frame-ancestors 'none'` in both nginx configurations.
- Found by B. Verified by the lead.

#### F13. NATS has no authentication and no NetworkPolicy, and handlers trust identity fields in the payload
- `k8s/helm/velista/templates/luna-shopper-backend/nats.yaml.tpl` carries only `max_payload`. No NetworkPolicy exists under `k8s/`. `admin-auth.refresh { adminId }` signs an admin token after checking only `disabledAt`. `auth.deleteAccount`, `auth.setUsername` and `auth.upgrade` take `userId` from the payload.
- Fix: NATS accounts or nkeys per service with subject permissions, NetworkPolicies, and a verified token instead of a bare id on `admin-auth.refresh`.
- Found by B. Verified by the lead.

#### F14. "Could not refresh" becomes a synthesized 401 that pages read as a refusal
- `gateway-interceptor.ts:279-284` throws a 401 whether the store cleared the session or merely could not prove it. `BasketSocket` latches revoked, `BasketStore._fail` picks "needs sign in" or "not yours", and the error copy selects unauthorized text.
- Fix: throw a network-class error or a 503-class gateway error with an `unavailable` code while the session is still held. Throw a 401 only when the store cleared.
- Found by A.

#### F15. The retry branch calls `reportRejected` on any 401
- The first attempt exempts `not_a_participant`, `participant_expired` and `impersonation_ended` (`gateway-interceptor.ts:147-165`). The retry branch does not (`:312-315`). A real 401 on the first attempt (clock behind, key mismatch) followed by a basket refusal on the retry signs the user out of the whole app.
- Fix: apply the same code exemptions in the retry branch.
- Found by A. Not tested (dropped, needed the client clock behind and a removed member).

#### F16. BasketSocket stops after two failed connects and never re-arms
- `libs/velista/data-access/src/lib/baskets/basket-socket.ts:18` and `:379-385`. No online or resume hook, and `open()` is a no-op for the same id. Plan 0168 removed this latch from `RealtimeSocket` and not from here.
- Fix: mirror the dev `RealtimeSocket` policy: unbounded capped backoff, re-arm on visible, resume and online.
- Found by A.

#### F17. Destructive actions need only a bearer, and admin tokens renew forever with no row to revoke
- `DELETE /v1/account` takes a 15 minute access token and nothing else. An admin token renews itself while live (`admin-identity.service.ts:115-118`) with no absolute cap and no server row, and it can mint operator recovery links, which are full user sessions.
- Fix: re-authentication for deletion, an absolute cap on an admin session carried in a claim, and a server-side admin session row.
- Found by B.

### Low

#### F18. `ParticipantGuard` skips the support-session liveness check
- `participant.guard.ts:97-116` verifies with `JwtService` directly and never calls `ImpersonationGate`. An ended support session still acts on participant routes until its `exp`. The `jwt.strategy.ts` header claims no route can skip the check.
- Fix: call `impersonationFromClaim` plus `assertLive` in `userOf`.
- Found by B. Verified by the lead.

#### F19. Sign in leaks account existence by timing and has no per-account lockout
- `identity.service.ts:349-368` runs argon2id only when the user exists. Login is 5 per minute per IP with no account counter. `LoginDto.password` has no `MaxLength`.
- Fix: verify against a dummy hash, add an account-keyed failure counter as admin login has, add `MaxLength`.
- Found by B.

#### F20. Other bearer secrets reach logs
- `x-participant-secret` is not in `REDACTION_PATHS`. Share-link secrets are path parameters and appear in `req.url` and in Envoy access logs. Realtime accepts `?token=` in the handshake query (`realtime.gateway.ts:446`).
- Fix: redact the header, drop the query fallback.
- Found by B.

#### F21. `POST /v1/auth/refresh` has no throttle
- `auth.controller.ts:135`. Unauthenticated, unlimited database lookups.
- Found by both.

#### F22. A failed storage write makes the store adopt the stale stored pair
- `writeStorage` swallows errors. At the next refresh `_newestHeldPair` prefers storage (`token-store.ts:382-393`), presents the revoked token and clears.
- Fix: a monotonic issue time on the pair, adopt from storage only when newer.
- Found by A.

#### F23. Clock skew
- A client more than 14 minutes ahead rotates on every burst. A client behind relies on the 401 path and meets F15. No `clockTolerance` on the server.
- Fix: compute expiry from the server `Date` header or `iat` as an offset.
- Found by A.

#### F24. Any 401 or 403 on refresh clears the session with no body check
- `libs/velista/data-access/src/lib/errors.ts:132`. A 403 from a proxy or captive portal on that route deletes the pair. [unverified that any proxy in front of the gateway answers one]
- Fix: require the house envelope with an auth code before clearing.
- Found by A.

#### F25. Credential redaction works only by accident
- The redaction paths (`libs/luna-shopper/platform/src/lib/logging/redaction.ts`) reach one level. The exception filter logs `req.body` three levels deep (`libs/luna-shopper/platform/src/lib/errors/global-exception.filter.ts:222-235`). A plain pino with those options writes the password in clear. The deployed logger goes through pino-http, whose `req` serializer rebuilds the object from a fixed field list with no `body`, so nothing leaks today. A custom serializer that adds `body`, or a 5xx logged outside the request's async storage, would leak.
- Fix: deep paths such as `req.body.password`, `req.body.refreshToken`, `req.body.token`, `req.body.newPassword`.
- Found by B. Settled in round two with two scripts and the manual test 9.

## 6. Improvements that are not defects, ranked

1. Move the refresh token to an httpOnly, Secure, SameSite cookie scoped to the auth path, and keep the access token in memory. It removes the multi-document copy problem and most of F6 to F8. `token-store.ts:45-50` already names it.
2. Return `expiresIn` or the server time with the pair, so the client stops trusting its own clock.
3. One verification helper for the gateway strategy, the participant guard and realtime that checks `sub`, `aud`, `typ` and support liveness in one place. Today three verifiers each check a different subset.
4. Session metadata on the refresh row (created at, last used, user agent), a device list on the account page, and a purge of expired rows. Nothing deletes them today, about one row per rotation per user.
5. Deep redaction paths, so F25 cannot regress silently.
6. `Referrer-Policy: no-referrer` on pages that carry tokens in the URL, and move those tokens to the fragment as the impersonation handoff does.

## 7. Test battery

Branch `worktree-review-session-tokens`, based on `origin/dev` at 83f982bd1, pushed. The spec is `apps/velista-luna-e2e/reviews/2026-10-27-session-tokens/session-tokens.spec.ts`, beside this report and a `playwright.config.ts` that runs the folder on its own, outside the staging gate. No pull request was opened. Refreshes were forced by rewriting the `exp` of the stored access token to the past. Pages were signed in through `storageState` on `session:velista`.

| Test | Invariant | Result | What the failure shows |
|---|---|---|---|
| 1 Lost refresh answer | The session survives a rotation whose answer never arrived | fail | The next request went out with no bearer, the retry with the old token got 401, storage cleared, the new pair was never delivered |
| 2 Concurrent rotation | At most one 201 for one token | fail | 9 of 10 rounds forked into two live chains |
| 3 Two tabs, A's answer 500 ms late | No tab removes the session | fail, 4 of 5 | The loser removed storage for about 500 ms, the winner restored it |
| 3b Two tabs, A reaches the server 500 ms late | Same | pass, 5 of 5 | The loser adopted the winner's pair, at the cost of one extra rotation |
| 4 Sign out during an in-flight refresh | Storage stays empty | fail | The held answer re-signed both tabs in 120 ms later |
| 5 Unprovable session on a basket join | No guest join | fail | The join was sent anonymous, answered 201, a GUEST participant was created |
| 6a Sign out revokes the server row | The old token answers 401 | fail | It answered 201 |
| 6b Theft | Reuse ends the thief's chain | fail | The thief rotated 5 of 5, the victim was cleared silently |
| 7 Callback fragment | A held guest pair survives | fail on the overwrite, pass on history | The stored userId was replaced. No history entry kept the fragment |
| 8 Participant token as bearer | 401 on account routes | fail | 200 on zones, 500 on me, live baskets and delete |
| 9 Credentials in the log on a 5xx (manual) | No marker in clear | pass | pino-http drops `body` before redaction |

Rerun, with an ephemeral Luna slot and a velista slot up as CLAUDE.md describes (adjust the two ports to the slots you took):

```sh
git checkout worktree-review-session-tokens
VELISTA_BASE_URL=http://localhost:42005 E2E_GATEWAY_URL=http://localhost:43300 \
  npx nx e2e velista-luna-e2e --skip-nx-cache -- --config reviews/2026-10-27-session-tokens/playwright.config.ts
```

The worktree sandbox refuses inline environment chains. Put the command in a script file under the job tmp directory and run it with bash.

## 8. Disagreements and open questions

Settled in the code or by a test:

- Reviewer A said the "names nobody" rule holds. Reviewer B said the gateway strategy does not check `sub`. Test 8 settled it for B.
- Reviewer B read a credential leak in the gateway log on a 5xx. The manual test and the second round settled it: no leak today, by the accident described in F25.
- Reviewer B read that the callback leaves the pair in history. Test 7 observed no such entry.
- Reviewer A rated non-atomic rotation high and B medium. Test 2 showed it forks 9 times in 10. It is high.

Nobody could settle:

- Whether auth drains in-flight NATS messages on SIGTERM, which decides how much a deploy adds to F1.
- The Envoy route timeout on `/v1/auth/*` against auth latency under load.
- Whether the Capacitor shell aborts in-flight requests when the app goes to the background.
- How long a user socket survives Envoy's idle timeout with no token refresh.
- What routes that build SQL by hand do with an undefined `userId` from F9, beyond the four routes tested.
- Whether any proxy in front of the gateway can answer 401 or 403 on the refresh route.

## 9. Pointers for the builder

| Finding | Files to change | Proof |
|---|---|---|
| F1, F3 | `auth/src/app/tokens/token.service.ts` (`rotate`), `identity.service.ts` (`refresh`), a migration for a family or `replacedById` column | Tests 1 and 2 |
| F4 | A logout pattern in `contracts/.../auth.messages.ts`, a route in `gateway/.../auth.controller.ts`, a handler in `identity.controller.ts`, the client sign out in `account-page.ts` | Tests 6a and 6b |
| F5, F14 | `libs/velista/data-access/src/lib/gateway-interceptor.ts` | Test 5 |
| F6, F7, F22 | `libs/velista/data-access/src/lib/auth/token-store.ts`, `libs/velista/platform/src/lib/browser-facade.ts` | Tests 3 and 4 |
| F8 | `libs/velista/feature-auth/src/lib/auth-callback-page/auth-callback-page.ts`, the state mint in `google.controller.ts` | Test 7 |
| F9 | `gateway/src/app/auth/jwt.strategy.ts`, claims in `token.service.ts` | Test 8 |
| F2 | `gateway/src/app/auth/google-auth.guard.ts`, `google.controller.ts`, `identity.service.ts` (`upgrade`) | A new test with Google stubbed |
| F10 | `realtime/src/app/socket/realtime.gateway.ts` | A new test with a short TTL |
| F11 | `jwt.strategy.ts`, `realtime.module.ts`, `participant.guard.ts` | A slot with two keys |
| F12 | `k8s/helm/portfolio/values.yaml`, both nginx files | curl the headers |
| F25 | `libs/luna-shopper/platform/src/lib/logging/redaction.ts` | The redaction script from round two |
