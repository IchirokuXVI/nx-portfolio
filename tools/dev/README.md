# Running the Angular apps from several worktrees at once

`ng-slot.sh` / `ng-slot.ps1` place a checkout on an isolated **slot** so several
worktrees, and therefore several agents, can serve the front end at the same time
without fighting over ports.

It uses the same arithmetic as `k8s/e2e/luna-shopper-backend/luna-slot.{sh,ps1}`,
but **the two numberings are independent**. See "which backend" below before
assuming otherwise.

## The slot table

A slot is an integer N. Every port is its default plus N&times;100.

|                           | slot 0 (yours) | slot 1 | slot 2 | slot 3 |
| ------------------------- | -------------- | ------ | ------ | ------ |
| shell                     | 4200           | 4300   | 4400   | 4500   |
| static remotes (reserved) | 4201           | 4301   | 4401   | 4501   |
| odontogram                | 4202           | 4302   | 4402   | 4502   |
| damoclesSword             | 4203           | 4303   | 4403   | 4503   |
| landingV2                 | 4204           | 4304   | 4404   | 4504   |
| velista                   | 4205           | 4305   | 4405   | 4505   |

**Slot 0 is yours**, the ports `project.json` already names, so a lone checkout
needs no slot at all and `npx nx serve shell` is unchanged. `--auto` never takes
it; workers start at 1. Asking for it explicitly (`ng-slot.sh 0`) still works.

There is deliberately **no backend row** in that table. A front end slot number
says nothing about which backend the front end talks to.

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

## Which backend velista talks to

**The front end slot number and the backend slot number are independent.** Front
end slot 5 may talk to backend slot 1, or 2, or 8, and **several front end slots
may talk to one backend at the same time**. That last case is the common one: most
front end work needs a backend running, not a backend of its own, so when nobody
is changing the backend every worktree can point at the single instance that is up
(usually slot 0).

`--backend-slot <n>` says which. Left out, it is worked out rather than assumed,
in this order:

1. the choice already recorded for this worktree, so a re-run never silently
   moves it;
2. the luna slot **this same worktree** runs, if it runs one. This is the real
   pairing when there is one: same worktree, not same number;
3. the only backend gateway that is listening;
4. backend slot 0 if it is listening (several are up, and it is the shared one);
5. backend slot 0 anyway, with a note that nothing is running.

The choice is printed whenever it is made, so an unexpected pairing is visible at
the point it happens rather than as a failed request later.

```sh
tools/dev/ng-slot.sh --up                      # ...and point at whatever is up
tools/dev/ng-slot.sh --up 5 --backend-slot 1   # front end 5, backend 1
```

Nothing on the backend side has to agree in advance: `luna-slot` allows **every**
front end slot's origin, so any of them can call any backend without being
configured into it.

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
named `localhost:3000` / `localhost:3001` as literals, so no worktree could point
anywhere else even when it needed to.

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
