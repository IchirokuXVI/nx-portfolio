# 0229: a refresh whose answer was lost keeps the session

> The session token review of 2026-10-27
> (`apps/velista-luna-e2e/reviews/2026-10-27-session-tokens/report.md`, PR #844) rated one
> defect critical for every user and traced it to one method. `TokenService.rotate` reads
> the refresh row, saves `revokedAt`, and returns. The user load and the new pair follow
> outside any transaction. When the answer never reaches the browser, the server has spent
> the only token the browser holds. The next request fails, the retry fails, and the client
> clears the session (finding F1, test 1). A guest has no credential to sign in with again
> and loses every group.
>
> The same read then save is why two presentations of one token both succeed (finding F3,
> test 2: nine forks in ten rounds). Production shows both: on the owner's account one
> token produced two live children three times across the two auth replicas, and a revoked
> row whose successor was created the same millisecond and never used is the signature of
> a lost answer (2026-10-22 and 2026-10-25). The client was signed out within 200 ms each
> time.
>
> This plan makes the rotation one atomic statement inside one transaction, records which
> row replaced which, and lets a token that was spent moments ago and whose successor was
> never used obtain a fresh pair one time. Nothing changes on the wire, in the gateway or
> in velista. The client already keeps its pair when a refresh has no answer and retries
> with it. That retry is what this plan makes succeed.
>
> Prerequisite reading: the report sections 2, 4 and 5 (F1, F3), `0005` section 3 (the
> rotation as designed), `0210` target state 2 (`TokenGrantService.spend`, the conditional
> `UPDATE ... RETURNING` that fixed the same race for grants), `0194` (the rows of a support
> session), and in the code `tokens/token.service.ts`, `identity/identity.service.ts`
> (`refresh`), `impersonation/impersonation.service.ts` (`refresh`, `issue`),
> `entities/refresh-token.entity.ts`, `tokens/token-grant.integration.spec.ts` (how a spec
> runs against a real Postgres).
>
> **Build order.** Independent. It touches the auth service and nothing else. Plan `0230`
> and velista `0171` are the other two plans of the same review and share no file with it.

## Brief for the agent

### Objective

In `apps/luna-shopper-backend/auth/`, make `TokenService.rotate` spend a refresh row with
one conditional `UPDATE ... RETURNING`, run the revoke, the user load and the insert of the
successor inside one transaction, record the successor on the spent row in a new
`replacedById` column, and let a row that was spent inside the reuse grace and whose
successor is still unused obtain one fresh pair. Log the reason of every refusal. Prove it
with an integration spec against Postgres and with tests 1 and 2 of the review battery.

### Context

- `TokenService.rotate` (`tokens/token.service.ts`) does `findOne` by hash, checks
  `revokedAt` and `expiresAt` in process, sets `revokedAt` and calls `save`. Two callers
  that pass the read both save. `IdentityService.refresh` then loads the user and calls
  `issueTokens`, or `ImpersonationService.refresh` for a support row. No transaction joins
  the three steps. A failure after the save leaves a revoked row and nothing live.
- `TokenGrantService.spend` (`tokens/token-grant.service.ts`) is the pattern to copy: the
  condition is in the `WHERE` of the write, Postgres takes the row lock before it
  evaluates the condition, and the second statement finds the row spent. It maps the
  `RETURNING` row back through the entity metadata. Plan `0210` explains it.
- `issueRefreshToken` inserts a row with 30 fresh days, or with the deadline of a support
  session. `revokeAllForUser` (password reset) and `revokeAllForSession` set `revokedAt`
  on live rows with no successor. Those rows must stay dead.
- `RefreshToken` (`entities/refresh-token.entity.ts`) has `userId`, `tokenHash`,
  `expiresAt`, `revokedAt`, `impersonationSessionId`. Rows cascade with the user.
- The migrations are classes under `src/app/db/migrations/`, listed in order in
  `index.ts`, each with a comment that says what it adds and why it is not a release task.
  `migrations.spec.ts` runs them.
- The velista client keeps its pair on a refresh with no answer (`token-store.ts`), sends
  the next request, gets 401, refreshes with the same token and retries one time
  (`gateway-interceptor.ts`). Today the second refresh gets 401 and the store clears. After
  this plan it gets a pair.
- The gateway forwards `POST /v1/auth/refresh` over NATS with no timeout and no throttle.
  Neither changes here.

### Target state

- `npx nx test luna-shopper-backend-auth`, `lint` and `build` pass, and the integration
  spec of section 4 passes against a slot's auth database.
- Tests 1 and 2 of the review battery pass against an ephemeral Luna slot and a velista
  slot, with the command of section 7 of the report. Test 1: storage still holds a pair
  after the lost answer and after the reload, and the page is not at the front door.
  Test 2: ten concurrent presentations of one token answer one 201 and nine 401.
- A row revoked by a password reset answers 401 at once, inside the grace and outside it.
- Every refused refresh writes one warn line with a `reason` from section 3.2 and the row
  id when a row exists, and never the token or its hash.

### Scope

- Work only in: `apps/luna-shopper-backend/auth/src/app/tokens/**`,
  `apps/luna-shopper-backend/auth/src/app/identity/identity.service.ts`,
  `apps/luna-shopper-backend/auth/src/app/impersonation/impersonation.service.ts`,
  `apps/luna-shopper-backend/auth/src/app/entities/refresh-token.entity.ts`,
  `apps/luna-shopper-backend/auth/src/app/db/migrations/**`, the specs beside them, and
  this plan file.
- Do NOT touch: the contracts, the gateway, velista, the chart, any `.env`, the review
  folder under `apps/velista-luna-e2e/reviews/`, `package.json`.

### Constraints

- No new dependency, no new configuration key, no new NATS pattern. The grace is a
  constant with its reason beside it (section 3.3).
- The wire contract of `auth.refresh` and of `POST /v1/auth/refresh` does not change: the
  same request, the same `AuthTokens` body, the same 401 with the same message on refusal.
  A client cannot tell the reasons of section 3.2 apart, on purpose.
- Only a row that a rotation revoked is eligible for the grace: it carries a successor.
  A row revoked by `revokeAllForUser` or `revokeAllForSession` carries none and is refused.
- Every write of one rotation runs on one `EntityManager` inside one transaction. A
  failure anywhere after the spend leaves the presented row live.
- Prettier on each changed file, never on a directory.
- Only make the changes this plan asks for. Reuse detection across a family, a logout
  route, an absolute session lifetime and the client changes of F5 to F7 are other
  findings of the report and other plans.

### Acceptance criteria

- [ ] `refresh_tokens` has `replacedById uuid NULL` with a foreign key to
      `refresh_tokens(id) ON DELETE SET NULL`, added by `RefreshTokenSuccessor1773000000000`
      (plan 0230 took 1772900000000 first), listed last in `index.ts`, and
      `migrations.spec.ts` passes.
- [ ] `TokenService.rotate(raw, manager)` spends the row with one conditional update as
      section 3.1 states, and never with a read followed by a save.
- [ ] A spend that updates nothing takes the grace path of section 3.2 under a row lock,
      and refuses with the reason that applies.
- [ ] `IdentityService.refresh` runs the spend, the user load and the issue of the
      successor in one `dataSource.transaction`, for an ordinary row and for a support row.
      The successor's id is written to `replacedById` of the spent row inside that
      transaction.
- [ ] The integration spec of section 4 exists, runs against Postgres like
      `token-grant.integration.spec.ts`, and covers each listed case.
- [ ] A unit spec asserts the warn line and its `reason` for each refusal, and that the
      line carries no token and no hash.
- [ ] Tests 1 and 2 of the review battery pass, and the PR body holds their observed
      annotations.

### Action boundaries

- Proceed with in-scope edits, specs, the migration, lint, build, and the slot runs.
- Stop and ask before changing a contract, a gateway file, a velista file, the grace
  constant to a value outside section 3.3, or any file outside the scope.

### Progress evidence

Report when the suite passes, when the integration spec passes against a slot, and when
tests 1 and 2 pass. Ground each claim in a command's output.

## 1. What goes wrong today, in order

1. The browser posts R1. Auth finds the row, sets `revokedAt`, saves.
2. Auth loads the user and inserts R2. The gateway answers 201 with R2.
3. The answer is lost: a dropped radio on resume, the reload that
   `connection-recovery.ts` makes on its first good probe, a gateway pod ended by a deploy,
   an Envoy timeout over a slow auth.
4. The browser still holds R1. Its next request goes out, the access token has expired,
   the gateway answers 401. The interceptor refreshes with R1. Auth finds `revokedAt` set
   and refuses. The store clears. The person is at the front door with nothing said.

Step 1 is also where two requests at the same instant both pass. Each one reads a row
with `revokedAt` null, each one saves, each one gets a pair. One token has two live
children, and nothing ever notices.

A third case sits between steps 1 and 2: a crash or a pool timeout after the save and
before the insert. The row is revoked and nothing is live. The next refresh is refused for
good.

## 2. The rows after this plan

`refresh_tokens` gains one column:

| Column | Type | Meaning |
| --- | --- | --- |
| `replacedById` | `uuid NULL`, FK to `refresh_tokens(id)`, `ON DELETE SET NULL` | The row that a rotation of this row issued. Null on a live row, and on a row that a reset or a session end revoked. |

The migration only adds. No existing row changes, every existing revoked row reads as
"revoked with no successor", which is what it was, and so it is a migration and not a
release task. No index: the only read of the column goes from a row that was just locked
by its hash to its successor by primary key.

The entity gains the matching property and a self relation. Delete of a user still
removes every row by the existing cascade.

## 3. One rotation is one transaction

`IdentityService.refresh` opens `this.dataSource.transaction` and does the whole rotation
on its manager. `TokenService.rotate`, `issueTokens`, `issueTokensForSession` and
`ImpersonationService.refresh` take the manager. How the parameter reaches each one is the
builder's choice. What is not a choice: no write of the rotation happens on the default
repository while the transaction is open.

### 3.1 The spend is one statement

```sql
UPDATE "refresh_tokens"
SET "revokedAt" = now()
WHERE "tokenHash" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()
RETURNING *
```

Exactly as `TokenGrantService.spend` does it: the condition lives in the `WHERE`, and the
second of two concurrent statements waits on the row lock, re-evaluates the condition,
finds `revokedAt` set, and updates nothing. Expiry is judged on the clock of the database,
the same clock that wrote `revokedAt`.

One row back: the normal path. The caller loads the user, issues the successor through
`issueRefreshToken` on the same manager, and sets `replacedById` of the spent row to the
successor's id. Commit.

### 3.2 Zero rows: the grace path, or a refusal with a reason

The statement spent nothing. Lock the row by hash with `SELECT ... FOR UPDATE` on the same
manager and decide:

| Finding | Reason logged | Outcome |
| --- | --- | --- |
| No row | `unknown` | 401 |
| `expiresAt <= now()` | `expired` | 401 |
| `revokedAt` set, `replacedById` null | `revoked` | 401. A reset, a session end, or a row rotated before this plan. |
| `revokedAt` older than the grace | `grace_over` | 401 |
| Successor exists, the update of section 3.2.1 spent nothing | `successor_spent` | 401. The answer did arrive and the token was spent again by somebody. |
| Successor exists and was unused | `reissued` (info, not warn) | A fresh pair, section 3.2.1 |

#### 3.2.1 Reissue inside the grace

```sql
UPDATE "refresh_tokens"
SET "revokedAt" = now()
WHERE "id" = $successor AND "revokedAt" IS NULL
RETURNING "id"
```

One row back means the successor was never presented, so the answer that carried it was
lost, and this presentation is the retry. Insert a new successor for the same `userId` and
the same `impersonationSessionId`, with the ordinary fresh expiry (or the session deadline
for a support row), and point `replacedById` of the presented row at the new row. Commit.
The chain stays single: the orphaned successor is now revoked with no successor of its own,
and a presentation of it is refused as `revoked`.

Zero rows back means the successor was spent. The answer arrived somewhere and was used.
This presentation is a replay, whoever made it, and it is refused.

Two retries of one lost answer inside the grace serialize on the row lock of the presented
row. The second one finds `replacedById` pointing at the row the first one issued, finds
it unused, revokes it and issues a third. That is one wasted row and no refusal, which is
the right trade: a doubled retry is a flaky radio, not an attack.

### 3.3 The grace is two minutes

`REFRESH_REUSE_GRACE_MS = 120_000` in `token.service.ts`, with this reason beside it.

The measured retry is 65 ms behind the lost answer. The reload that the recovery probe
makes, and the first request of a new gateway pod after a deploy, are seconds. Two minutes
covers each of them with room, and it covers a phone that lost the radio in a doorway.

It does not cover a phone that was put away for ten minutes after a lost answer. That case
needs a window long enough that a copied token stays replayable for as long after the
victim's rotation, against a victim whose successor sits unused because they are idle. The
report's F4 (a family and reuse detection) is the right answer to that, not a longer
window. Two minutes is decision D1, and the owner can move it with one constant.

### 3.4 The refusal is logged

Every 401 of `rotate` writes one warn through the Nest `Logger` with `reason` from the
table, `rowId` when a row exists, and `userId` when a row exists. Never the token, never
`tokenHash`, never a prefix of either. Today auth logs `code: unauthorized` and nothing
else, which is why the production diagnosis of 2026-10-27 needed a read of the table.

The message the client receives stays `Invalid or expired refresh token` for every reason.
Telling the reasons apart on the wire would tell a caller which guesses were once real
tokens.

## 4. Proof

### 4.1 `token-rotation.integration.spec.ts`

Against a real Postgres, as `token-grant.integration.spec.ts` runs, with
`IdentityService.refresh` under test and a user row seeded:

1. **One of ten.** Ten concurrent `refresh(R1)`. Exactly one resolves with a pair, nine
   reject with `UnauthorizedException`. The table holds one live row for the user.
2. **The retry after a lost answer.** `refresh(R1)` gives R2. `refresh(R1)` again gives
   R3. R2 is revoked, `R1.replacedById` is R3's id, `refresh(R2)` rejects, `refresh(R3)`
   resolves.
3. **A spent successor.** `refresh(R1)` gives R2, `refresh(R2)` gives R3. `refresh(R1)`
   rejects with reason `successor_spent`.
4. **A reset stays final.** `revokeAllForUser` then `refresh(R1)` rejects, with reason
   `revoked`.
5. **Outside the grace.** Set `revokedAt` of a rotated row to three minutes ago by SQL.
   `refresh` rejects with reason `grace_over`.
6. **A failure after the spend leaves the row live.** Make the user load fail (delete the
   user inside the test, or a failing manager). `refresh(R1)` rejects and `R1.revokedAt` is
   still null.
7. **A support row.** A row that names a session rotates under the same deadline, and the
   grace path reissues under the same session.

### 4.2 The review battery

Tests 1 and 2 of `session-tokens.spec.ts` are the end to end proof, run as section 7 of
the report says. Paste their `observed` annotations into the PR body. Test 3 (two tabs)
and test 6b (theft) are expected to keep failing. They are F6 and F4.

## 5. Out of scope

- A family id and reuse detection, a logout route, an absolute session lifetime (F4).
- The client: never sending a held session with no bearer (F5), one refresh across
  documents with the Web Locks API (F6), compare and set on the stored pair (F7).
- A timeout on the NATS forward of the refresh, and a throttle on the route (F21).
- Purging expired rows.
