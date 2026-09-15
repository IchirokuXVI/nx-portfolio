> **PR:** [#372](https://github.com/IchirokuXVI/nx-portfolio/pull/372)

# 0086: two defects the shopping e2e found

> `0080` built `apps/velista-luna-e2e`, a browser suite that shops against a real backend
> (PR #370). Running it found two defects in the app, and the plan forbade touching the app,
> so `member.spec.ts` works around both and says so in its comments. This plan fixes both
> defects and takes the two workarounds back out.
>
> The two defects, as PR #370 recorded them:
>
> 1. **A signed in person who opens a share link joins as a guest.** `BasketApi.join` sends
>    the join with the `anonymous` request context, so the gateway interceptor leaves the
>    bearer token off, the gateway's optional JWT guard sees nobody, and core writes a
>    `GUEST` row with no user id. The join page, the service contract and plan `0044`
>    section 3 all say the opposite: somebody signed in is attached as themselves.
> 2. **A basket re-read in flight erases a line added under it.** `BasketStore` answers a
>    burst of socket events with one coalesced `refresh()` 1.5 seconds later, and
>    `refresh()` replaces the whole basket with its answer. A read still in flight when the
>    composer adds a line answers after the add does, from before it, and redraws the
>    basket without the new row. Reproduced 3 of 3 in the full suite order, never alone.
>
> Prerequisite reading: `0044` section 3 (who joins and how), backend `0051` sections 3
> and 5 (participant kinds, redaction per reader), `0053` (the composer), `0080` section
> 5.3 and the header comment of `apps/velista-luna-e2e/src/member.spec.ts`,
> `libs/velista/data-access/src/lib/gateway-interceptor.ts` (what `SKIP_AUTH` does), and
> `libs/velista/data-access/src/lib/generated-lists/basket-store.ts` in full.

## Brief for the agent

### Objective

Make a signed in person who opens a share link a registered participant, make a basket
re-read unable to erase a change that landed while it was in flight, prove both with unit
specs, and remove the two workarounds from `member.spec.ts` so the e2e exercises the real
paths.

### Context

- `libs/velista/data-access/src/lib/auth/http-context.ts` exports two request contexts.
  `anonymous(op)` sets `SKIP_AUTH`, so the interceptor sends no bearer and does not refresh
  on a 401. `operation(op)` only names the operation for error reports, and the
  interceptor attaches a bearer when the token store holds a session and sends nothing
  when it holds none.
- `BasketApi.join` (`basket-api.ts`, around line 103) posts to `/v1/share-links/:secret/join`
  with `{ context: anonymous('basket.join') }`.
- The gateway route `POST /v1/share-links/:secret/join` runs under `OptionalJwtAuthGuard`
  (`generated-list-sharing.controller.ts`, around line 399). No token mints a guest, a valid
  token attaches the account as a `REGISTERED` participant, and a token that is present but
  bad answers 401.
- `BasketSession.secret` is nullable, documented as "Null when an account token stands in
  for it", and `BasketSessionStore` reads and writes a null secret already.
- `JoinPage` (`libs/velista/feature-shopping-lists/src/lib/join-page/join-page.ts`) calls
  `join()` without a prompt when `SessionStore.isAuthenticated()` is true. That part is
  correct and stays.
- `BasketStore` (`basket-store.ts`): `REFRESH_DEBOUNCE_MS = 1500`, `_scheduleRefresh()`
  coalesces socket events into one `refresh()`, and `refresh()` does
  `this._basket.set(await this._service.getBasket(id))`. Local writes fold their answers in
  through `append` and `apply`, and several writes `await this.refresh()` before they
  answer their caller. Socket events also go through `append` and `apply`.
- `basket-store.spec.ts` drives the store with a fake service, a fake socket (`Subject`)
  and, where timing matters, `jest.useFakeTimers()` with `advanceTimersByTime`.
- `participant-token-never-travels.spec.ts` shows how to run `BasketApi` under the real
  `gatewayInterceptor` with `HttpTestingController`, a `TokenStore` and a fake browser
  facade. There is no `basket-api.spec.ts` yet.
- `apps/velista-luna-e2e/src/member.spec.ts` step 1 adds Dana through
  `addParticipant(alice, basketId, DANA_ID)` and step 2 has her `goto` the basket URL
  directly. Step 3 starts with `await page.reload()` and a comment naming defect 2.
  `guest.spec.ts` step 2 shows how a visitor opens the link: `new URL(link).pathname`.

### Target state

- A signed in person who opens `/s/<secret>` lands in the basket as a registered
  participant: the people sheet shows them under their account name with no guest tag, and
  the settle sheet shows them the lists summary when they hold zone data.
- A visitor with no account session still joins as a guest, with no bearer on the request.
- A `refresh()` answer that was requested before a local change landed is never applied.
  The store reads again, and the promise `refresh()` returns resolves only after an answer
  that is not stale was applied, or after a failure.
- `member.spec.ts` step 2 has Dana open the share link while signed in, and step 3 no longer
  reloads the owner's page. The suite passes against a real backend.

### Scope

- Work only in: `libs/velista/data-access/src/lib/generated-lists/basket-api.ts`,
  `basket-store.ts`, `basket-store.spec.ts`, a new `basket-api.spec.ts` beside them, and
  `apps/velista-luna-e2e/src/member.spec.ts` (plus `support/api.ts` only if a helper has
  to go).
- Do NOT touch: the backend, `gateway-interceptor.ts`, `http-context.ts`, `join-page.ts`,
  `basket-session-store.ts`, the models, `guest.spec.ts`, `shop.spec.ts`, any other plan.

### Constraints

- Use the `nx-portfolio-angular-developer` skill.
- Only make the changes this plan names. No refactor of the store, no new abstraction
  for the generation counter beyond what section 2 describes.
- Comments state why, in the voice of the surrounding file. No dashes as punctuation in
  prose.
- Nothing created in `libs/velista` imports `@angular/core/rxjs-interop` (CLAUDE.md).

### Action boundaries

- Proceed with the in scope edits and specs.
- Stop and ask before adding a dependency, changing a model, or touching a file outside
  the scope list.
- Stop and ask if `apps/velista-luna-e2e` is not in the checkout, or if the join route no
  longer runs under `OptionalJwtAuthGuard`.

### Progress evidence

Report after each of the three parts, each with its spec run: the join fix with
`basket-api.spec.ts`, the read guard with `basket-store.spec.ts`, and the e2e revert with
the suite's result against a slot. Cite the commands and their output.

## 1. The join carries the account, when there is one

`BasketApi.join` sends the request with `operation('basket.join')` instead of
`anonymous('basket.join')`. That is the whole change to the call. What follows from it:

- A signed in person's bearer travels, `OptionalJwtAuthGuard` resolves them, and core
  attaches the account as a `REGISTERED` participant (backend `0051` section 3). The
  answer's session has a null secret, which the session store already accepts.
- A visitor with no account session sends no bearer, because the interceptor attaches
  one only when the token store holds a session. They join as a guest exactly as today.
- A signed in person whose access token is stale gets the interceptor's ordinary refresh
  first, and a 401 on the join gets the ordinary one refresh retry. That is right: the
  gateway refuses a present but bad token on purpose, so that an expired session cannot
  turn into a second identity on somebody's basket.

The comment above the call says why `operation` and not `anonymous`, naming the guard
and the plan `0044` rule, so the next reader does not "fix" it back for the login and
register calls' reason.

## 2. A re-read cannot erase what landed while it was out

`BasketStore` keeps a private generation counter, a number that goes up by one every time
the store changes `_basket` by any path **other than** `refresh()` applying its answer.
That is every fold of a write's answer and every socket event applied locally, so the
bump lives in the shared paths (`append`, `apply`, the removal, and any other direct
`_basket.set` outside `refresh`), not at each call site.

`refresh()` reads the counter before it asks the service, and compares after the answer
arrives:

- Unchanged: apply the answer, set `ready`, clear the error, as today.
- Changed: the answer is from before something this store already holds. Discard it and
  read again. A read that starts after the last local change cannot be stale, so the loop
  ends when the writes stop. No cap that applies a stale answer, because that is the bug.
- A failure keeps today's `_fail` handling and ends the loop.

Two `refresh()` calls at once collapse into one read with, at most, one read queued behind
it. Every caller's promise resolves when a fresh answer was applied or the read failed,
because several writes await `refresh()` before they answer and section 6 of `0057` needs
that answer to reflect the write. `_scheduleRefresh()` and `_cancelRefresh()` keep their
shape. The `state` signal never moves to `loading` for any of this, as today.

The comment on the counter names the failure it prevents: a coalesced refresh, an add in
the aisle, and a row that vanished after the add answered.

## 3. The e2e exercises the real paths

In `member.spec.ts`:

- Step 1 no longer calls `addParticipant`. Remove the import if nothing else uses it.
- Step 2 signs Dana in and opens `new URL(link).pathname`, as `guest.spec.ts` step 2 does
  a visitor, then asserts she lands on the basket URL with no join screen: the heading
  "You've been invited to shop" is never shown to her. Then the existing assertions on the
  lists summary. Add one assertion on the people sheet, in the shape `guest.spec.ts` step 6
  uses: Dana's row shows her name and has no `.guest-tag`.
- Step 3 drops the `page.reload()` and the comment above it. The composer types straight
  after Dana's arrival, which is the timing that reproduced defect 2.
- The header comment's paragraph on how Dana gets on the basket is rewritten to say she
  opens the link, and no longer names a defect.

`addParticipant` in `support/api.ts` stays if anything else imports it, and goes if
nothing does.

## 4. Tests

### `basket-api.spec.ts` (new)

Set up like `participant-token-never-travels.spec.ts`: the real interceptor,
`HttpTestingController`, `TokenStore`, a fake browser facade.

- With a session in the token store, `join(secret)` sends `Authorization: Bearer <token>`
  to `/v1/share-links/<secret>/join`.
- With no session, the same request carries no `Authorization` header.
- Either way the answer's session is written to the session store, with a null secret
  accepted.

### `basket-store.spec.ts`

Under `adding a line`, or a new `describe` for the read guard:

- A refresh is in flight (the fake service's `getBasket` answers a deferred promise).
  `addLine` answers and folds its line in. The refresh's answer, taken without that line,
  then resolves. The line is still in the basket, and the service was asked for the basket
  again. The second answer, holding the line, is applied.
- The same with a `generatedList.lineAdded` socket event landing during the read.
- A refresh with no change in flight applies its answer as before (existing cases cover
  this, keep them green).
- `await store.refresh()` resolves only after the fresh answer was applied.
- The existing coalescing case ("redraws from the broadcast, over the socket already
  held") stays green with fake timers.

### The e2e

`npx nx e2e velista-luna-e2e` against a real backend, three passed, and again on the same
database.

## 5. Acceptance criteria

- [ ] `basket-api.ts` sends the join with `operation('basket.join')`.
- [ ] `basket-api.spec.ts` proves the bearer travels with a session and not without one.
- [ ] `basket-store.ts` never applies a refresh answer older than a local change, and
      `refresh()` resolves only after a fresh answer or a failure.
- [ ] `basket-store.spec.ts` proves the add and the socket event survive an in flight read.
- [ ] `member.spec.ts` opens the link signed in, asserts no join screen and no guest tag,
      and does not reload before typing.
- [ ] `npx nx test velista-data-access` and `npx nx lint velista-data-access` pass.
- [ ] `npx nx lint velista-luna-e2e` passes and the suite passes twice against a slot.

## 6. Verification

Unit and lint:

```sh
npx nx test velista-data-access
npx nx lint velista-data-access
npx nx lint velista-luna-e2e
```

The e2e, against an ephemeral Luna slot and a velista dev slot. The seed resolves its
three database URLs through dotenv, which never overwrites a set variable, so export them
from the slot's rendered files. Start the Luna slot with `LUNA_REFERENCE_SEED=0`: the
reference catalog and the demo world both insert Mercadona under the same unique key and
the second one dies.

```sh
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
LUNA_REFERENCE_SEED=0 bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 3
tools/dev/ng-slot.sh --up 1 --apps velista --backend-slot 3

E=/tmp/luna-slot-ephemeral/slot3/env/apps/luna-shopper-backend
export AUTH_DB_URL=$(sed -n 's/^AUTH_DB_URL=//p' $E/auth/.env)
export CORE_DB_URL=$(sed -n 's/^CORE_DB_URL=//p' $E/core/.env)
export CATALOG_DB_URL=$(sed -n 's/^CATALOG_DB_URL=//p' $E/catalog/.env)
E2E_SEED=1 LUNA_REQUIRE_STACK=1 VELISTA_BASE_URL=http://localhost:42005 \
  E2E_GATEWAY_URL=http://localhost:43200 npx nx e2e velista-luna-e2e --skip-nx-cache

tools/dev/ng-slot.sh --down
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down 3
```

If slot 3 or front end slot 1 is taken, `--list` says so: take the lowest free one and
adjust the ports (`42000 + (N-1)*100 + 5` for velista, `43000 + (N-1)*100` for the
gateway, so slot 3 is 43200). The share link on a dev slot names `http://localhost:4205`, the compiled in
standalone origin, which is why the spec opens the path against its own base URL.
