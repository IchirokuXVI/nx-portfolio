# Running the Luna Shopper backend from several worktrees at once

This is the procedure for developing or testing more than one Luna Shopper
change in parallel, each in its own git worktree, without the copies colliding.
It exists because the backend has fixed, shared infrastructure ports (two
Postgres, NATS, Mailpit) and four services on fixed ports; two checkouts that
each `docker compose up` and `nx serve` will otherwise fight over the same
ports, container names, and database volumes.

## What actually collides (and what does not)

| Kind of work | Needs infra? | Parallel safe out of the box? |
| --- | --- | --- |
| `nx lint`, `nx build`, **unit tests** (`nx test`) | no | **Yes.** Pure compute, no ports, no DB. Run in every worktree at once; the only limit is CPU. |
| Integration tests (real Postgres + NATS) | yes | Only with an isolated stack — see slots below. |
| e2e (Playwright driving gateway + realtime) | yes, plus the four services running | Only with an isolated stack **and** an isolated service port band. |
| Live manual smoke (`nx serve` + curl / ws) | yes, same as e2e | Same as e2e. |

So the cheap 90%, lint/build/unit, needs nothing special: give each worktree its
own `node_modules` (see setup) and run. Only work that talks to real Postgres,
NATS, or a running service needs a **slot**.

## Slots: the isolation primitive

A **slot** is an integer N that shifts an entire stack out of the way of the
others:

- every host port becomes its default **+ N&times;100**,
- the compose project (its containers, network, and named volumes) becomes
  `luna-slot<N>`, so nothing is shared with another slot,
- the four services listen on `3000..3003 + N*100`, and their `.env` files are
  pointed at that slot's Postgres / NATS / SMTP ports.

Slot 0 is the original single stack: default ports, project name `luna-shopper`.
A lone worktree can ignore slots entirely and use the plain workflow.

| | slot 0 | slot 1 | slot 2 |
| --- | --- | --- | --- |
| compose project | `luna-shopper` | `luna-slot1` | `luna-slot2` |
| auth-db | 5432 | 5532 | 5632 |
| core-db | 5433 | 5533 | 5633 |
| nats (client / mon) | 4222 / 8222 | 4322 / 8322 | 4422 / 8422 |
| smtp / mailpit ui | 1025 / 8025 | 1125 / 8125 | 1225 / 8225 |
| gateway | 3000 | 3100 | 3200 |
| realtime | 3001 | 3101 | 3201 |
| auth | 3002 | 3102 | 3202 |
| core | 3003 | 3103 | 3203 |

The step of 100 is larger than the spread of the base ports, so no two slots
ever land on the same number. Three slots (0, 1, 2) are laid out here; the
scheme extends to as many as you need.

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

## Configure and run a slot

From the **root of the worktree** you want to place on slot N:

```sh
# writes .env.slot (compose) + every service .env, and a dev JWT keypair if absent
bash k8s/e2e/luna-shopper-backend/luna-slot.sh 1        # or: ...luna-slot.ps1 1

# bring up this slot's isolated infra (own containers + volumes)
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  -f k8s/e2e/luna-shopper-backend/compose.yml up -d

# run migrations for this slot's databases, then serve / test
npx nx run luna-shopper-auth:migration:run
npx nx run luna-shopper-core:migration:run
npx nx serve luna-shopper-gateway     # + realtime / auth / core, all on slot ports
```

`luna-slot.{sh,ps1}` is idempotent: re-run it with the same N to refresh the
files, or a different N to move the worktree to another slot. Everything it
writes is git ignored, so it never shows up in a diff or a commit.

Tear a slot down (removes only that slot's containers and volumes):

```sh
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  -f k8s/e2e/luna-shopper-backend/compose.yml down -v
```

## Two strategies

1. **Parallel (multi-process, isolated).** Assign each worktree a distinct slot
   (0, 1, 2). Each runs its own compose stack and its own four services on its
   own port band, fully concurrently. Use this when you genuinely want all three
   sets of integration/e2e or live smoke tests running at the same time. Cost is
   RAM and CPU: three stacks means six Postgres, three NATS, three Mailpit, plus
   up to twelve Node services.

2. **Sequential (one shared stack).** Keep every worktree on slot 0 and only one
   worktree runs infra-backed tests at a time; the others do lint/build/unit
   (which need no infra) freely in parallel. Lighter on the machine, and enough
   when infra-backed runs are short. Tear the stack down or just leave it up and
   hand it between worktrees.

A good default for three parallel changes: run **all** lint/build/unit in
parallel everywhere (strategy 2's free lane), and only spin up a slot (strategy
1) in whichever worktree currently needs a live stack. Reserve three
simultaneous slots for the final cross-worktree integration pass.

## CI note

CI runs one job at a time against a freshly created stack, so it needs no slot —
it is effectively always slot 0 on its own machine. Slots are a local-parallel
convenience; nothing about them leaks into the images or the Helm chart. If CI
ever runs Luna jobs concurrently on one runner, give each job a slot via the
same `--env-file` mechanism.
