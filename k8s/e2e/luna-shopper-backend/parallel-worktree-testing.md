# Running the Luna Shopper backend from several worktrees at once

This is the procedure for developing or testing more than one Luna Shopper
change in parallel, each in its own git worktree, without the copies colliding.
It exists because the backend has fixed, shared infrastructure ports (three
Postgres, NATS, Redis, Mailpit) and five services on fixed ports; two checkouts
that each `docker compose up` and `nx serve` will otherwise fight over the same
ports, container names, and database volumes.

The Angular apps have the same problem and the same answer, on their own separate
slot numbering: see `tools/dev/README.md`.

## What actually collides (and what does not)

| Kind of work                                      | Needs infra?                        | Parallel safe out of the box?                                                                 |
| ------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `nx lint`, `nx build`, **unit tests** (`nx test`) | no                                  | **Yes.** Pure compute, no ports, no DB. Run in every worktree at once; the only limit is CPU. |
| Integration tests (real Postgres + NATS)          | yes                                 | Only with an isolated stack — see slots below.                                                |
| e2e (Playwright driving gateway + realtime)       | yes, plus the four services running | Only with an isolated stack **and** an isolated service port band.                            |
| Live manual smoke (`nx serve` + curl / ws)        | yes, same as e2e                    | Same as e2e.                                                                                  |

So the cheap 90%, lint/build/unit, needs nothing special: give each worktree its
own `node_modules` (see setup) and run. Only work that talks to real Postgres,
NATS, or a running service needs a **slot**.

## Slots: the isolation primitive

A **slot** is an integer N that shifts an entire stack out of the way of the
others:

- the compose project (its containers, network, and named volumes) becomes
  `luna-slot<N>`, so nothing is shared with another slot,
- **slot 0 keeps exactly the historic ports** (gateway 3000, auth-db 5432, nats
  4222, and the rest); it is your own and nothing moves it,
- **every other slot gets a 100 port block up in the 43000s**: slot 1 is
  `43000..43054`, slot 2 is `43100..43154`, and each service's `.env` is pointed at
  that block's Postgres / NATS / Redis / SMTP ports.

The front end slots (`tools/dev/ng-slot.sh`) are a **separate** numbering that
this one does not imply; see the section below.

**Slot 0 is reserved for your own local development** — it is the original
single stack (default ports, project name `luna-shopper-backend`) that your primary
checkout may already have running. Parallel workers (agents, extra worktrees)
must **never** take slot 0, so they can never collide with the ports you are
already using. Worker slots therefore start at **1** (1, 2, 3, …). A lone
worktree that is your own dev environment still just uses the plain default
workflow (no slot flag needed = slot 0).

Within a block the offsets group by kind, so a slot stays readable: services at
`+0`, databases at `+10`, messaging at `+20`, cache at `+30`, mail at `+40`,
observability at `+50`.

|                     | slot 0 (yours)         | slot 1        | slot 2        | slot 3        | …   |
| ------------------- | ---------------------- | ------------- | ------------- | ------------- | --- |
| compose project     | `luna-shopper-backend` | `luna-slot1`  | `luna-slot2`  | `luna-slot3`  | …   |
| gateway             | 3000                   | 43000         | 43100         | 43200         | …   |
| realtime            | 3001                   | 43001         | 43101         | 43201         | …   |
| auth                | 3002                   | 43002         | 43102         | 43202         | …   |
| core                | 3003                   | 43003         | 43103         | 43203         | …   |
| catalog             | 3004                   | 43004         | 43104         | 43204         | …   |
| auth-db             | 5432                   | 43010         | 43110         | 43210         | …   |
| core-db             | 5433                   | 43011         | 43111         | 43211         | …   |
| catalog-db          | 5434                   | 43012         | 43112         | 43212         | …   |
| nats (client / mon) | 4222 / 8222            | 43020 / 43021 | 43120 / 43121 | 43220 / 43221 | …   |
| redis               | 6379                   | 43030         | 43130         | 43230         | …   |
| smtp / mailpit ui   | 1025 / 8025            | 43040 / 43041 | 43140 / 43141 | 43240 / 43241 | …   |
| otlp (grpc / http)  | 4317 / 4318            | 43050 / 43051 | 43150 / 43151 | 43250 / 43251 | …   |
| jaeger ui           | 16686                  | 43052         | 43152         | 43252         | …   |
| prometheus          | 9090                   | 43053         | 43153         | 43253         | …   |
| grafana             | 3010                   | 43054         | 43154         | 43254         | …   |

Slot 0 (first column) is **yours**, reserved for your own development, and nothing
moves it; workers use slots 1 and up.

### Why the high band

It used to be `default + N*100`, which scattered a slot across 5532, 4322, 6479,
1125, 8125 and 16786, most of them in the range everything else on a developer
machine also wants. Slots then collided with **other software** instead of with
each other, which is the same failure the slots exist to prevent, only harder to
diagnose.

43000 is chosen against what the machine actually reserves rather than by feel:

```
netsh int ipv4 show dynamicport tcp        -> ephemeral range starts at 49152
netsh int ipv4 show excludedportrange tcp  -> every Hyper-V/WSL reservation >= 50000
```

So **40000..48000 is clear of both**, and 43000 sits above the front end's 42000
band (`tools/dev/README.md`) with room for nine slots on each side. Worth
re-running those two commands if this ever starts colliding again; the
reservations differ per machine.

## One time per worktree: give it a `node_modules`

A fresh `git worktree` has no `node_modules`, and Nx cannot build without it (it
fails trying to bundle optional transports it should externalise). Point the
worktree's `node_modules` at the main checkout's with a junction — reads only,
so it is safe to share, and each worktree still has its own `.nx` cache, `dist`,
and daemon:

```sh
# from inside the new worktree, on Windows
cmd //c "mklink /J node_modules D:\\Projects\\nx-portfolio\\node_modules"
```

(On a POSIX host: `ln -s ../..//node_modules node_modules`, adjusting the path.)

## Which slots are already taken

Before claiming one, ask. `--list` reads every checkout from `git worktree list`,
reads the slot each one claims out of its own `.env.slot`, and then probes the
ports to say whether anything is actually answering:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list   # or: ...luna-slot.ps1 -List
```

```
  SLOT COMPOSE PROJECT      INFRA     SERVICES  OBSERV  CLAIMED BY
  0    luna-shopper-backend 8/8       5/5       0/5     D:/Projects/nx-portfolio
  1    luna-slot1           8/8       5/5       0/5     D:/Projects/.../worktrees/my-branch  (this one)
```

A claim and a listener are both checked because either alone would lie: a
worktree configured but not started would collide the moment it does, and an open
port nobody claims is something outside this repository that would collide right
now. `OBSERV 0/5` is normal, the profile is opt in.

## Configure and run a slot

From the **root of the worktree** you want to place on slot N, one command does
all of it: write the `.env` files, bring the compose stack up and wait on its
healthchecks, run every migration, then serve all five services.

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 1   # or: ...luna-slot.ps1 -Up 1
```

Leave the number off and it takes the lowest free slot, so an agent that has just
made a worktree needs one command and no bookkeeping:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
```

`--up` waits for all five to listen before it returns, so a zero exit means the
slot is genuinely serving rather than merely spawned. Logs and pids go to
`k8s/e2e/luna-shopper-backend/.run/`, git ignored. `--down` is its inverse: it
frees the five service ports, then takes the compose stack down **with its
volumes**, which is what `stack.sh down` has always meant here. Pass `--keep-data`
to stop the containers instead and keep the databases.

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down
```

### Editing code: you do not restart anything

`nx serve` here is `@nx/js:node`, whose `watch` defaults to true, so **a change to
a service or to a library it consumes rebuilds and restarts that one process by
itself**. Nothing needs stopping to see your work, and the other four services and
the databases are untouched.

The exception is a rewritten **`.env`**: Nx loads `{projectRoot}/.env` into a task
when it _starts_ it, so a new `PORT`, a new database URL, a changed `CORS_ORIGINS`
or `APP_BASE_URL` needs the process replaced. That is `--restart`, which **leaves
the compose stack and its volumes alone** so bouncing a service never costs you
the data you have been working with:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart                    # all five
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart --services gateway # just one
```

| you changed                               | what to do                                        |
| ----------------------------------------- | ------------------------------------------------- |
| a service, a controller, a shared library | nothing, `nx serve` restarts it                   |
| a `.env` (a slot move, `--app-slot`)      | `--restart`                                       |
| an entity or a migration                  | `nx run luna-shopper-backend-<svc>:migration:run` |
| `compose.yml`                             | `--down` then `--up`                              |

`-p observability` on either verb adds or removes the traces and metrics stack;
see the section below.

The steps are still available one at a time, and `--up` is exactly their sum:

```sh
# just write .env.slot (compose) + every service .env, and a dev JWT keypair if absent
bash k8s/e2e/luna-shopper-backend/luna-slot.sh 1        # or: ...luna-slot.ps1 1
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --auto   # ...or the lowest free one

# bring up this slot's isolated infra (own containers + volumes)
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  -f k8s/e2e/luna-shopper-backend/compose.yml up -d

# run migrations for this slot's databases, then serve / test
npx nx run luna-shopper-backend-auth:migration:run
npx nx run luna-shopper-backend-core:migration:run
npx nx serve luna-shopper-backend-gateway     # + realtime / auth / core / catalog
```

`luna-slot.{sh,ps1}` is idempotent: re-run it with the same N to refresh the
files, or a different N to move the worktree to another slot. Everything it
writes is git ignored, so it never shows up in a diff or a commit.

## The front end slots are a separate numbering

`tools/dev/ng-slot.{sh,ps1}` does all of this for the Angular apps with the same
arithmetic, but **the two numbers are independent and must not be assumed equal**.
A front end on slot 5 may point at a backend on slot 1, or 2, or 8, and **several
front end slots may point at one backend at the same time**. That last case is the
common one: most front end work needs a backend running, not a backend of its own,
so when nobody is changing the backend every front end worktree can use the single
instance that happens to be up.

Two consequences, and they pull in opposite directions:

- **`CORS_ORIGINS` is a list**, so `luna-slot` writes **every** front end slot's
  two origins, not this slot's. A backend has no way to know which front ends will
  call it and no reason to care, and an origin it was not told about fails with a
  CORS error that says nothing about slots. Twenty entries in a git ignored file
  removes the whole class of problem. (It used to be hardcoded to `localhost:4200`,
  so any front end past slot 0 got a gateway that refused its own browser.)
- **`APP_BASE_URL` and the two `MAIL_*_BASE_URL` are singular**: they are where
  the Google callback and the verification links send a browser, and a redirect
  can only have one target. So they name one front end, chosen with
  `--app-slot <n>` and defaulting to 0, the shared one. Only the OAuth and mail
  round trips are affected by getting it wrong; ordinary API calls from any slot
  work regardless.

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 1 --app-slot 5
bash tools/dev/ng-slot.sh --up 5 --backend-slot 1
```

On the front end side the backend is worked out rather than assumed when
`--backend-slot` is left off: a choice already recorded, else the luna slot this
same worktree runs, else the only gateway listening, else slot 0. See
`tools/dev/README.md`.

### Traces and metrics, per slot

The observability stack (plan 0016, section 9) is behind the `observability`
profile, so a plain `up` never starts it and nobody pays for four extra
containers they did not ask for. Add it to any slot:

```sh
nx run luna-shopper-backend:observability:up      # prints this slot's URLs
nx run luna-shopper-backend:observability:down    # removes only those four
```

Both wrap `stack.sh -p observability {up,down}`, and `-p` accepts any profile in
`compose.yml`. In both directions it means the same thing: operate on that
profile and nothing else. So `observability:up` starts the four telemetry
containers without touching the base stack and without migrating (run `stack:up`
for that), and `observability:down` removes those four while keeping their
volumes, so taking the telemetry down never takes the databases with it and
never costs you the Prometheus history. `stack:down` is still the whole project
including volumes, profiled containers and all.

The same thing by hand, without the wrapper:

```sh
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  --profile observability \
  -f k8s/e2e/luna-shopper-backend/compose.yml up -d
```

`luna-slot.{sh,ps1}` already wrote `OTEL_ENABLED=true` and this slot's collector
endpoint into **each service's own `.env`**, so the services export as soon as
they restart. The per service file is not a style choice: the OpenTelemetry SDK
starts before Nest and reads `process.env`, Nx loads `{projectRoot}/.env` into a
project's tasks, and nothing loads the shared `.env.luna-shopper-backend` into
the environment at all, so a telemetry variable placed there is read too late and
silently ignored.
Open Jaeger at the slot's port from the table above and a single list load shows
one trace spanning the gateway, the NATS hops, the database work and the realtime
push.

Every port shifts by the slot offset like the rest, so two worktrees can each run
their own collector, Jaeger and Prometheus at the same time. The collector
scrapes the services on the **host** (they run under `nx serve`, not in compose),
which is why `.env.slot` also carries the five service ports.

With the profile down, telemetry is harmless: the batch processor drops spans and
logs a warning, and requests are unaffected. Set `OTEL_ENABLED=false` in
`apps/luna-shopper-backend/.env.luna-shopper-backend` to silence it entirely.

## Two strategies

1. **Parallel (multi-process, isolated).** Assign each worker worktree a distinct
   slot starting at **1** (1, 2, 3, …) — never slot 0, which stays yours. Each
   runs its own compose stack and its own four services on its own port band,
   fully concurrently, and none of them touch the default ports your own dev
   stack (slot 0) may be using. Use this when you genuinely want several sets of
   integration/e2e or live smoke tests running at the same time. Cost is RAM and
   CPU: three worker stacks means six Postgres, three NATS, three Mailpit, plus
   up to twelve Node services.

2. **Sequential (one shared worker stack).** Keep every worker worktree on a
   single shared worker slot (say slot 1) and let only one run infra-backed tests
   at a time; the others do lint/build/unit (which need no infra) freely in
   parallel. Lighter on the machine, and enough when infra-backed runs are short.
   Tear the stack down or leave it up and hand it between worktrees. Slot 0 is
   still untouched, so your own dev stack keeps running throughout.

A good default for several parallel changes: run **all** lint/build/unit in
parallel everywhere (strategy 2's free lane), and only spin up a worker slot
(strategy 1, slot ≥ 1) in whichever worktree currently needs a live stack.
Reserve simultaneous worker slots (1, 2, 3) for the final cross-worktree
integration pass — all still clear of your slot 0.

## One command per suite

The sequence above (compose up, wait, migrate, run, tear down) is wrapped by the
stack targets from plan 0015, and those honour `.env.slot` — so once this worktree
is on a slot, they run its isolated copy with no extra flags:

```sh
npx nx run luna-shopper-backend:test-integration:stack
npx nx run luna-shopper-backend:e2e:stack
```

`e2e:stack` also builds and starts the five services, polls `/health/ready` on
each, and points the Playwright suite at **this slot's** gateway and realtime
ports. That last part matters: left to its defaults the suite talks to
`:3000/:3001`, which from a slotted worktree is either nothing (so it skips itself
and reports a green run that tested nothing) or your own slot 0 stack.

The service lifecycle is `k8s/e2e/luna-shopper-backend/run-services.sh`, usable on
its own if you want the services without the suite:

```sh
bash k8s/e2e/luna-shopper-backend/run-services.sh start   # build, launch, health gate
bash k8s/e2e/luna-shopper-backend/run-services.sh logs    # tail every service log
bash k8s/e2e/luna-shopper-backend/run-services.sh stop    # SIGTERM, so shutdown hooks run
bash k8s/e2e/luna-shopper-backend/run-services.sh ports   # the ports it resolved
```

## CI note

CI runs one job at a time against a freshly created stack on its own machine, so
it needs no slot (the reserved-slot-0 rule is only about not colliding with your
local dev ports, which do not exist on a CI runner). It runs `luna-slot.sh 0` to
get the service `.env` files and a throwaway JWT keypair, then deletes the
`.env.slot` it wrote and namespaces the compose project per run id instead.

Slots are a local-parallel convenience; nothing about them leaks into the images
or the Helm chart. If CI ever runs Luna jobs concurrently on one runner, give each
job a worker slot (≥ 1) via the same `--env-file` mechanism.

The scripts CI runs are the ones in this directory, not a copy inlined into a
workflow, so the CI path and the local path cannot drift apart. See
`apps/luna-shopper-backend/docs/testing-strategy.md` for the two tiers and for
`LUNA_REQUIRE_STACK`, which turns an intended skip into a failure wherever a stack
was brought up on purpose.
