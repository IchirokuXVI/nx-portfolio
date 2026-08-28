# Running the Angular apps from several worktrees at once

`ng-slot.sh` / `ng-slot.ps1` place a checkout on an isolated **slot** so several
worktrees, and therefore several agents, can serve the front end at the same time
without fighting over ports.

It is the front end half of `k8s/e2e/luna-shopper-backend/luna-slot.{sh,ps1}` and
uses the same arithmetic, so **"slot 2" means one thing across the whole app**.

## The slot table

A slot is an integer N. Every port is its default plus N&times;100.

|                             | slot 0 (yours) | slot 1      | slot 2      | slot 3      |
| --------------------------- | -------------- | ----------- | ----------- | ----------- |
| shell                       | 4200           | 4300        | 4400        | 4500        |
| static remotes (reserved)   | 4201           | 4301        | 4401        | 4501        |
| odontogram                  | 4202           | 4302        | 4402        | 4502        |
| damoclesSword               | 4203           | 4303        | 4403        | 4503        |
| landingV2                   | 4204           | 4304        | 4404        | 4504        |
| velista                     | 4205           | 4305        | 4405        | 4505        |
| its luna gateway / realtime | 3000 / 3001    | 3100 / 3101 | 3200 / 3201 | 3300 / 3301 |

**Slot 0 is yours**, the ports `project.json` already names, so a lone checkout
needs no slot at all and `npx nx serve shell` is unchanged. `--auto` never takes
it; workers start at 1. Asking for it explicitly (`ng-slot.sh 0`) still works.

## Commands

```sh
tools/dev/ng-slot.sh --list          # every worktree's slot, and what is live
tools/dev/ng-slot.sh --auto          # claim the lowest free slot
tools/dev/ng-slot.sh --up            # claim one if needed, then serve everything
tools/dev/ng-slot.sh --up --apps shell,velista
tools/dev/ng-slot.sh --down          # stop what this worktree started
```

```powershell
./tools/dev/ng-slot.ps1 -List
./tools/dev/ng-slot.ps1 -Up -Apps shell,velista
./tools/dev/ng-slot.ps1 -Down
```

`--up` waits for every app's first build to answer before it returns, so a zero
exit means the slot is genuinely serving. It refuses to start over a port that is
already busy rather than half starting the slot. Logs and pids land in
`tools/dev/.run/`, all git ignored.

Pair it with the backend on the same number:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 1   # gateway 3100, realtime 3101
tools/dev/ng-slot.sh --up 1                             # shell 4300, velista 4305
```

`--backend-slot <n>` points velista at a different luna slot, for the uncommon
case where the two numbers have to differ.

## How it works, and why it is not simply a port in project.json

The ports cannot be overridden in `project.json`. `nx serve shell` runs the module
federation dev server, which starts the remotes **itself** and reads each one's
port straight out of the project graph
(`@nx/module-federation/src/utils/parse-static-remotes-config.js` and
`get-remotes-for-host.js` both do `targets['serve'].options.port`). There is no
flag and no environment variable for it, and `project.json` is committed, so a
worktree cannot move those ports without a diff every branch would carry.

So the script does not ask Nx to orchestrate the remotes:

- each app is served as its own task with `--port` on the command line, which
  every app accepts;
- the shell also gets `--skipRemotes`, so its dev server serves only the host and
  leaves the remotes to the tasks started beside it;
- the shell also gets `MFE_REMOTE_URLS`, so the bundle it builds looks for those
  remotes on this slot's ports instead of the defaults baked into the graph;
- the remotes get `--excludeTaskDependencies`, because three of them declare
  `dependsOn: ['shell:serve']`. That rule exists to stop somebody opening a remote
  on its own port and seeing a blank page, and here the shell is already being
  started beside them on this slot's port, so honouring it would put a second one
  on 4200 and recreate the collision the slots exist to prevent.

**The shell needed no change for any of this.** `apps/shell/webpack.config.ts` has
read `MFE_REMOTE_URLS` since velista moved to its own origin, and
`apps/shell/remote-urls.ts` already applies a per-remote map over whatever the
defaults were. The slot script just writes the map.

### What is written, and why nothing has to be exported

All git ignored, all per worktree:

| file                     | what it carries                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `tools/dev/.env.ng-slot` | the slot descriptor, read back by `--up`, `--down`, and every other worktree's `--list` |
| `apps/shell/.env`        | `MFE_REMOTE_URLS` for this slot                                                         |
| `apps/velista/.env`      | `LUNA_GATEWAY_URL` / `LUNA_REALTIME_URL` for the backend slot                           |
| `tools/dev/.run/`        | one log and one pid per served app                                                      |

The two app level files are picked up on their own: **Nx loads
`{projectRoot}/.env` into the environment of that project's tasks**, which is the
same mechanism the Luna services already rely on. Nothing has to be exported by
the caller, and nothing leaks into another project's build.

### velista is the one app that needed a change

It is the only front end that talks to a backend, and its development environment
named `localhost:3000` / `localhost:3001` as literals. Every worktree would
therefore have talked to whichever backend held slot 0.

`apps/velista/webpack.config.ts` now carries the same `DefinePlugin` that
`webpack.prod.config.ts` has always had, with the two default ports as its
defaults, and `environment.ts` reads them from `process.env` exactly as
`environment.prod.ts` does. A build with neither variable set is byte for byte the
single stack behaviour that came before.
`velista-env-substitution.spec.ts` asserts the two files agree, in both
configurations, so a variable added to one and forgotten in the other is a red
test rather than an app that throws in the browser.

## How `--list` knows

There is no shared registry to fall out of step with reality. `--list` asks
`git worktree list` for every checkout, reads each one's own `.env.ng-slot` for the
slot it claims, and then **probes the ports** (`probe-ports.mjs`, one node process
for the whole scan) to say whether anything is actually answering.

So a slot can be:

|           |                                                                      |
| --------- | -------------------------------------------------------------------- |
| `free`    | nothing claims it and nothing is listening: `--up` can take it       |
| `idle`    | a worktree is configured for it but is not serving                   |
| `up`      | every app of the slot is answering                                   |
| `partial` | some answer and some do not, or something outside the repo holds one |

A claim and a listener are both checked because either alone would lie: a
configured but idle worktree would collide the moment it starts, and an open port
with no claim is something outside this repository that would collide right now.

`probe-ports.mjs` tries **both** loopback addresses. That is not belt and braces:
the shell's serve target sets `host: 0.0.0.0` and answers on 127.0.0.1, while a
remote binds `localhost`, which Node resolves to `::1` and which then refuses IPv4
outright. Probing v4 alone reported a running velista as closed.
