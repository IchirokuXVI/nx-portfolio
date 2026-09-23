# 0004: an ephemeral slot holds its number

> Found by `apps/luna-shopper-backend/plans/0150` ("Things I did that the plan did not script"
> in its report). Prerequisite reading: `0003` in this folder (claims, locks and giving a slot
> back), the `--ephemeral` section of `k8s/e2e/luna-shopper-backend/luna-slot.sh` (from line
> 83), and `slots.mjs` in `libs/luna-shopper/tools/curation/cli/src/`. Curation cli plan
> `0005` fixes the tool's own half: it brings the slot up inside its `try` and handles SIGTERM.
>
> In `0150`, the curation CLI's first run took rehearsal slot 1 as an `--ephemeral` slot.
> Another worktree had claimed slot 1 fifteen minutes earlier. Nothing refused, because an
> ephemeral `--up` writes no claim and checks only whether each service port is open. A second
> tool running `--auto` at the same moment can pick the same number before any port opens.

## Brief for the agent

### Objective

Make `luna-slot.sh --ephemeral --up <n>` refuse a slot that another checkout claims or locks,
record the ephemeral slot while it runs so `--list` and `--auto` see it, and release that
record on `--down`.

### Context

- An ephemeral slot writes nothing under the worktree and makes no claim. Its rendered files,
  logs and pids live in `$TMPDIR/luna-slot-ephemeral/slot<n>` (`EPHEMERAL_ROOT`, line 149),
  and `--down` removes them. Slot 0 is refused.
- `serve_services` (around line 1506) refuses only when a service port is already open
  (`probe_ports`). Compose ports are checked the same way. Nothing reads the claims before an
  ephemeral up.
- `--list` (around line 1990) prints a row for a claim, a lock, or an open port. An ephemeral
  slot is visible only through its open ports, so it is invisible between the moment it is
  chosen and the moment its first port opens, and after a crash that left containers with no
  published port.
- The curation CLI picks the lowest slot of 1 or more that `--list` does not print
  (`slots.mjs:98-112`), and then calls `--ephemeral --up`. That is a check then act race.
- `0003` defines claims (one per worktree) and locks (`--down --keep-data`). An ephemeral
  record is a third kind: it belongs to a process, not to a worktree.

### Target state

- `--ephemeral --up <n>` refuses with a message naming the owner when slot `n` is claimed by
  any worktree, locked, or already held by another ephemeral record.
- Before it starts anything, `--ephemeral --up <n>` creates a record atomically (`mkdir` of a
  directory under a shared root, which fails if it exists) holding the pid of the caller and the
  time. The first of two racing callers wins, and the second is refused.
- A record whose pid is gone and whose ports are all closed is stale. `--list` shows it as
  stale, and the next `--ephemeral --up` of that number takes it over.
- `--list` shows ephemeral records with `ephemeral (pid N)` in the claimed by column.
  `--auto` and the curation CLI's choice skip them.
- `--ephemeral --down <n>` removes the record after it stops everything.

### Scope

Work only in:

- `k8s/e2e/luna-shopper-backend/luna-slot.sh`
- `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` and `tools/dev/README.md` for the
  documentation
- the "One checkout runs one slot" paragraph of `CLAUDE.md`, if its description of ephemeral
  slots stops being true

Do not touch: `tools/dev/ng-slot.sh` (it has no ephemeral mode), the curation CLI, or any
claim or lock file format from `0003`.

### Constraints

- Git Bash on Windows is the supported shell. `mkdir` is the atomic step because it behaves
  the same there and on Linux. Do not use `flock`.
- The shared root is outside every worktree, next to where claims are read, so two checkouts
  see the same records.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing the claim or lock format, touching slot 0 or any slot another
worktree holds while testing, or running `--reset-env`.

### Progress evidence

- A script test, or a documented manual run pasted in the PR, showing: an ephemeral up refused
  on a claimed slot, two racing ephemeral ups where one is refused, `--list` showing the
  record, a killed caller's record shown stale and taken over, and `--down` removing it.
- Use only a free slot number for these checks, and give it back at the end.
