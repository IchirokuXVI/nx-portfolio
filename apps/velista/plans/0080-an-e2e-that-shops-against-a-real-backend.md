# 0080: an e2e that shops against a real backend

> `0050` section 6 asked for one browser test that follows an owner and a guest through a
> shared basket. `0064` section 8 found that no CI gate was able to run it, because the gate with
> a browser has no backend and the gate with a backend has no browser. Three later plans
> added cases to that same missing test (`0068` test 8, `0069` test 9, `0073` test 13).
> This plan builds it, in a new project, run by a third CI gate that holds both halves.
>
> The CI split, decided on 2026-09-13, is: `e2e-frontend` runs browser specs with the
> network stubbed, `e2e-luna` runs the backend API specs, and the new `e2e-velista-luna`
> gate runs browser specs against a real, seeded backend.
>
> Prerequisite reading: `0050` sections 6 and 7, `0064` section 8, `0073`, `0069`, `0074`
> to `0078`, `.github/workflows/docker-ci.yml` (jobs `setup`, `e2e-frontend`, `e2e-luna`,
> `deploy`), `k8s/e2e/portfolio-frontend/compose.yml` and its `nginx.conf`,
> `k8s/e2e/luna-shopper-backend/compose.yml`, `compose.apps.yml`, `stack.sh`, and
> `libs/luna-shopper/test-fixtures/src/lib/demo-world.ts`.

## Brief for the agent

### Objective

Create the Playwright project `velista-luna-e2e`, its three specs (section 5), one seeded
user, and the `e2e-velista-luna` CI job that runs them against the staging images, as
sections 2 to 6 describe.

### Context

- `apps/velista-e2e` has `landing`, `mount` and `startup-gate` only, and stubs
  `**/health/ready`. `apps/luna-shopper-backend-e2e` calls the API and opens no page.
- The staging velista image has `https://api.staging.velista.app` and
  `https://rt.staging.velista.app` compiled in (`apps/velista/webpack.prod.config.ts`).
  There is no runtime configuration.
- `e2e-frontend` serves the frontend images behind nginx on `staging.ichirokuxvi.com`,
  `mfe.staging.ichirokuxvi.com` and `staging.velista.app`, with self signed certificates and
  `/etc/hosts` entries. It has no `api.` or `rt.` host.
- `e2e-luna` runs `luna-slot.sh 0`, pulls both Luna compose files at `staging`, and runs
  `stack.sh e2e-images` with `E2E_SEED=1`.
- `compose.apps.yml` hard codes `CORS_ORIGINS: http://localhost:4200,http://localhost:4205`
  on every service.
- The demo world has Alice (password), Bob (Google only), Carol (pending in Weekly shop).
  No second password user shares a zone with Alice.
- A basket generated straight from the seed holds only Eggs and Nails, both free text. Milk
  has quantity 0, Bread is pending, Apples is rejected. No shopping profile is seeded, so a
  basket has no price scope unless the profile gets postal code `46004` first.
- `e2e-frontend` currently lists `luna-shopper-backend-e2e` among its projects, where that
  suite skips itself for lack of a stack and reports green.

### Target state

`npx nx e2e velista-luna-e2e` passes against a local ephemeral Luna slot and a velista
slot. The new CI job runs it on `main` pushes where it is affected, the deploy waits for it,
and `e2e-frontend` no longer runs either backend suite.

### Scope

- Work only in: a new `apps/velista-luna-e2e/`, `.github/workflows/docker-ci.yml`,
  `k8s/e2e/portfolio-frontend/` (an overlay compose file and an nginx fragment),
  `k8s/e2e/luna-shopper-backend/compose.apps.yml` (the CORS line) and `stack.sh`,
  `libs/luna-shopper/test-fixtures/src/lib/` (one user), and any spec that counts demo
  world rows and breaks because of that user.
- Do NOT touch: any application source under `apps/velista`, `libs/velista`,
  `apps/luna-shopper-backend/*/src`, `pr.yml`, `release.yml`, or the Helm chart.

### Constraints

- Use Playwright, pinned by the workspace version, `chromium` only in CI.
- Drive the app through the UI for everything under test. Set up preconditions through the
  gateway API with a request context, not through the UI.
- Every spec creates its own basket and sets every seeded value it depends on to an
  absolute value, so the suite passes on a fresh database and on a second run.
- Target velista on its own origin, not through the shell (velista is the one standalone
  remote, CLAUDE.md).
- Known traps (`e2e-in-this-repo` memory): `aria-disabled` buttons need `click({ force: true })`
  with an eslint disable line, assert on an inner element rather than a component host, and
  use the reel's keyboard (`spinbutton`, arrow keys) rather than a drag.
- Run the suite locally against a slot before opening the PR. A new suite first runs in CI
  only after the merge.

### Action boundaries

- Proceed with in-scope files, local slots claimed through the slot scripts, and local runs.
- Stop and ask before changing application code to make a test pass, before editing
  `pr.yml` or `release.yml`, and before any change that affects the deploy job other than
  adding this job to its `needs`.
- Stop and report if a flow in section 5 cannot be reached with the seed plus API setup.

### Progress evidence

Report after the seed change (with the specs it broke and fixed), after each spec passes
locally (with the Playwright summary line), and after the workflow change (with
`actionlint` output if available, otherwise a careful read). `--down` every slot you
claimed.

### Session strategy

A new session. This plan touches no application code, so it can be built beside `0079`
and `0081` without conflicts.

## 1. What is being built

| Piece                                       | Where                                                            |
| ------------------------------------------- | ---------------------------------------------------------------- |
| The project                                 | `apps/velista-luna-e2e/`                                         |
| One seeded user, Dana                       | `test-fixtures` `ids.ts`, `demo-world.ts`                        |
| The API hosts in the frontend stack         | `k8s/e2e/portfolio-frontend/compose.luna.yml`, `nginx.luna.conf` |
| CORS from the environment                   | `compose.apps.yml`                                               |
| A stack command that starts without a suite | `stack.sh`                                                       |
| The CI job, and the deploy waiting for it   | `docker-ci.yml`                                                  |
| `e2e-frontend` runs no backend suite        | `docker-ci.yml`, `setup`                                         |

## 2. The project

- `apps/velista-luna-e2e`, generated the way `velista-e2e` was, with
  `implicitDependencies`: `velista`, `luna-shopper-backend-gateway`,
  `luna-shopper-backend-core`, `luna-shopper-backend-auth`, `luna-shopper-backend-catalog`,
  `luna-shopper-backend-realtime`. A backend change marks it affected.
- `playwright.config.ts` reads `VELISTA_BASE_URL` (velista's origin) and
  `E2E_GATEWAY_URL` (for API setup). It starts no web server of its own, and it fails fast
  with a clear message when either is missing. `ignoreHTTPSErrors: true`.
- `global-setup.ts` runs the seed when `E2E_SEED=1`, by calling
  `apps/luna-shopper-backend/tools/db/seed.js` the way `luna-shopper-backend-e2e`'s global
  setup does. Read that setup first and copy its approach, not its file.
- `support/api.ts`: log in as a demo user, set a profile's postal code, set a line's
  quantity, approve a line, add a product to a line, read a zone line and its settlements.
  Each helper names the gateway route it calls.

## 3. The seed

Add **Dana**, `dana@example.com`, password `DEMO_PASSWORD`, an approved `MEMBER` of "Weekly
shop" with `READ`, `WRITE` and `DECIDE` on Groceries and Hardware. She is the registered
participant who passes the all or nothing rule, which no seeded user does today. Search
every consumer of the demo world for counts of users, members or access rows
(`seeded-flow.spec.ts`, `/v1/stats`, integration specs, admin e2e) and update each one
that breaks.

## 4. The CI job

`e2e-velista-luna` in `docker-ci.yml`:

- `needs: [setup, build]`. `setup` outputs a new `velista_luna` flag, true when
  `velista-luna-e2e` is affected. `timeout-minutes: 45`.
- Steps, reusing the existing jobs' steps where they exist:
  1. The Playwright cache and `npx playwright install --with-deps chromium`.
  2. `luna-slot.sh 0`, then pull the Luna compose pair at `staging`.
  3. `stack.sh e2e-up`, a new subcommand: the first three steps of `e2e-images` (infra with
     migrations, the service ports, the apps up and healthy) and no suite. Refactor
     `e2e-images` to call it, so the two cannot drift.
  4. `CORS_ORIGINS=https://staging.velista.app` for the apps. `compose.apps.yml` reads
     `${CORS_ORIGINS:-http://localhost:4200,http://localhost:4205}` instead of the literal.
  5. The frontend stack with the overlay:
     `docker compose -f compose.yml -f compose.luna.yml up -d`. The overlay adds
     `api.staging.velista.app` and `rt.staging.velista.app` to the certificate command, adds
     `extra_hosts: host.docker.internal:host-gateway` to the proxy, and mounts
     `nginx.luna.conf`, which proxies the first host to `host.docker.internal:3000` and the
     second to `:3001` with the websocket upgrade headers.
  6. `/etc/hosts` gets the five hosts.
  7. Wait for `https://staging.velista.app` and `https://api.staging.velista.app/health/ready`.
  8. `E2E_SEED=1 VELISTA_BASE_URL=https://staging.velista.app E2E_GATEWAY_URL=https://api.staging.velista.app npx nx e2e velista-luna-e2e --skip-nx-cache`.
  9. On failure, upload the Playwright report and the compose logs. Always tear both stacks
     down.
- `deploy.needs` gains the job, with the same `!= 'failure'` condition as the other two.
- `setup` removes `luna-shopper-backend-e2e` and `velista-luna-e2e` from the `e2e` list
  that `e2e-frontend` runs, so that gate runs browser specs only.

## 5. The specs

Each spec starts with API setup as Alice: postal code `46004` on her default profile, Milk
quantity 2, Bread approved, Bread added as a second product on the Milk line. Then:

### 5.1 `shop.spec.ts`: one trip, by the owner

1. Open the dashboard, open the get list sheet, choose Groceries and Hardware, generate. The
   basket opens (`0045`).
2. Search for "egg": one line, the count is announced (`0074`).
3. Filter: A to Z, group by category, filter to Hardware only, then Reset (`0075`, `0077`).
4. Prices from one shop: choose Mercadona Colón in the picker. The row shows its price
   (`0078`).
5. Settle Eggs from its row status control (`0052`).
6. Open Milk's settle sheet, record some (`0044`).
7. Settle a line to zero with the reel, raise it to two, then read the zone line through
   the API: it asks for the rest again (`0073` test 13).
8. Split Milk into two products, settle each, then read the zone line's settlements
   through the API: two settlements naming two products (`0069` test 9).
9. Add a line in the aisle with the composer (`0053`).
10. Finish the trip. The history page shows the basket as finished (`0057`).
11. Generate a second basket: the order and grouping from step 3 are remembered, the list
    filter and search are not (`0076`).

### 5.2 `guest.spec.ts`: the owner and a guest (`0050` section 6, updated)

1. Alice generates a basket and opens the share sheet. The test reads the link.
2. A second browser context, signed in to nothing, opens the link, skips the name, and
   lands in the basket as "Guest 1".
3. The guest records some of Milk. Alice's page shows the remainder without a reload.
4. The guest splits a line by product (this replaces `0050`'s swap, which `0069` retired).
   Alice sees the new rows and who did it.
5. The guest sees no list names, no lists summary and no line history.
6. Alice opens the people sheet and sees Guest 1.
7. Alice revokes the link with the cascade. The guest's next action is refused on screen,
   and the basket screen stays open.

### 5.3 `member.spec.ts`: a registered participant (`0068` test 8)

1. Alice generates a basket from Groceries and Hardware and shares it.
2. Dana, signed in, opens the link and sees zone details (list names on the settle sheet).
3. Alice adds a line in the aisle, buys it, and raises it for both lists from the lists
   summary. Both zone lists, read through the API, carry it.

## 6. What the plans left unbuilt

The flows above cover every e2e ask in the basket plans. These parts of those plans are
**not** built, and this plan does not build them either. Each is named so that the next
plan can pick it up deliberately.

| Plan and section                       | What is missing                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `0064` section 3                       | `join-page.spec.ts` does not exist                                                                     |
| `0064` section 4                       | No `BasketPage` spec with a guest cast and a `WRITE` holder who loses it on the next request           |
| `0064` section 5                       | No `ShareSheet` spec for "revoking stops new joins, people shopping keep working", or for the cascade  |
| `0064` section 6.2                     | No `basket-api.spec.ts` for the credential decision                                                    |
| `0064` section 6.3                     | No `basket-session-store.spec.ts`                                                                      |
| `0064` section 7                       | No core spec for the basket read (`getBasket`) or for `sourceNames`                                    |
| `0049` section 4                       | Presence on the dashboard card, deferred until backend `0053` touches the summary                      |
| `0057` section 12                      | Open decisions: naming the owner, "shop this again"                                                    |
| `0070` in full                         | A weighed product's till line. Also stale: it names reel buttons `0073` hid and a sheet `0073` deleted |
| backend `0095`, `0096`, `0101`, `0102` | Price basis, measurement units, the unit a line counts in, unit equivalences                           |
| backend `0087`                         | Shop availability waiting for approval                                                                 |

Retired, and therefore not missing: `0044` section 4.2 (allocate, by `0073`) and 4.4 (the
swap, by `0069`), `0054`'s "up raises" and section 5 (by `0073`), the sheets of `0055` and
`0056` (by `0068` and `0073`), `0062` section 5.2 (by `0069`), `0062` section 5.4 (reversed
by backend `0080`).

## 7. Tests

The deliverable is the three spec files. In addition:

1. `seeded-flow.spec.ts` and every other demo world consumer pass with Dana added.
2. `luna-shopper-backend-e2e` still passes through `stack.sh e2e-images` after the refactor.
3. `e2e-frontend`'s project list, printed by `setup`, contains neither backend suite.

## 8. Acceptance criteria

- [ ] The three specs pass locally against an ephemeral Luna slot and a velista slot.
- [ ] Each spec passes twice in a row on the same database.
- [ ] The CI job exists, runs only when `velista-luna-e2e` is affected, and the deploy
      waits for it.
- [ ] `e2e-frontend` runs no backend suite.
- [ ] No file under application source changed.

## 9. Verification

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
tools/dev/ng-slot.sh --up --apps velista --backend-slot <n>
E2E_SEED=1 VELISTA_BASE_URL=http://localhost:<velista port> E2E_GATEWAY_URL=http://localhost:<gateway port> npx nx e2e velista-luna-e2e --skip-nx-cache
npx nx run luna-shopper-backend-e2e:e2e   # after the seed change, against the same slot
tools/dev/ng-slot.sh --down
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down <n>
```

If the seed script reads the checkout's `.env` files instead of the ephemeral slot's
environment, stop and report it rather than writing `.env` files by hand.
