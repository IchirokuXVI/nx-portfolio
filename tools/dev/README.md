# Running the Angular apps from several worktrees at once

`ng-slot.sh` / `ng-slot.ps1` place a checkout on an isolated **slot** so several
worktrees, and therefore several agents, can serve the front end at the same time
without fighting over ports.

It works the same way as `k8s/e2e/luna-shopper-backend/luna-slot.{sh,ps1}`, in its
own port band and on its **own independent numbering**. See "which backend" below
before assuming a front end slot implies a backend slot.

## The slot table

**Slot 0 is yours**, exactly the ports `project.json` already names, and nothing
here changes them. A lone checkout needs no slot at all and `npx nx serve shell` is
unchanged. `--auto` never takes slot 0; workers start at 1. Asking for it
explicitly (`ng-slot.sh 0`) still works.

**Every other slot gets a 100 port block up in the 42000s**, keeping the shape of
the defaults so the numbers stay readable: 4200 becomes 42000, 4205 becomes 42005.

|                           | slot 0 (yours) | slot 1 | slot 2 | slot 3 | …   | slot 9 |
| ------------------------- | -------------- | ------ | ------ | ------ | --- | ------ |
| shell                     | 4200           | 42000  | 42100  | 42200  | …   | 42800  |
| static remotes (reserved) | 4201           | 42001  | 42101  | 42201  | …   | 42801  |
| odontogram                | 4202           | 42002  | 42102  | 42202  | …   | 42802  |
| damoclesSword             | 4203           | 42003  | 42103  | 42203  | …   | 42803  |
| landingV2                 | 4204           | 42004  | 42104  | 42204  | …   | 42804  |
| velista                   | 4205           | 42005  | 42105  | 42205  | …   | 42805  |

### Why the high band

It used to be `default + N*100`, which put slot 1 on 4300 and slot 4 on 4600,
right in the range everything else on a developer machine also wants. Slots then
collided with **other software** instead of with each other, which is the same
failure the slots exist to prevent, only harder to diagnose.

42000 is chosen against what the machine actually reserves rather than by feel:

```
netsh int ipv4 show dynamicport tcp        -> ephemeral range starts at 49152
netsh int ipv4 show excludedportrange tcp  -> every Hyper-V/WSL reservation >= 50000
```

So **40000..48000 is clear of both**, and far above the crowded region below 10000
where the defaults live. The backend takes 43000 (see
`k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`), leaving room for nine
slots on each side. Worth re-running those two commands if this ever starts
colliding again; the reservations differ per machine.

There is deliberately **no backend row** in that table. A front end slot number
says nothing about which backend the front end talks to.

## Commands

```sh
tools/dev/ng-slot.sh --list          # every worktree's slot, and what is live
tools/dev/ng-slot.sh --auto          # claim the lowest free slot
tools/dev/ng-slot.sh --up            # claim one if needed, then serve everything
tools/dev/ng-slot.sh --up --apps shell,velista
tools/dev/ng-slot.sh --restart       # bounce apps, keeping the rest serving
tools/dev/ng-slot.sh --down          # stop what this worktree started
```

```powershell
./tools/dev/ng-slot.ps1 -List
./tools/dev/ng-slot.ps1 -Up -Apps shell,velista
./tools/dev/ng-slot.ps1 -Restart -Apps velista
./tools/dev/ng-slot.ps1 -Down
```

`--up` waits for every app's first build to answer before it returns, so a zero
exit means the slot is genuinely serving. It refuses to start over a port that is
already busy rather than half starting the slot. Logs and pids land in
`tools/dev/.run/`, all git ignored.

## Editing code: you do not restart anything

**Every app is served with watch and live reload on, and each watches its own
sources _and_ the libraries it consumes.** Editing `libs/velista/...` recompiles
velista and reaches the browser on its own. Nothing needs stopping, and no build
has to be paid for twice.

Because the apps are independent processes here, a change to one remote rebuilds
**only that remote**; the other four are untouched and the shell picks the new
remote up on the next page load. (Measured: editing a `libs/velista` template
recompiled velista while the shell's compile count stayed where it was.)

So `--down` is for finishing with a slot, not for checking your work.

### The one thing live reload cannot pick up

A rewritten **`.env`**. Nx loads `{projectRoot}/.env` into a task when it _starts_
it, and webpack evaluates `MFE_REMOTE_URLS` and the `DefinePlugin` values once,
while building its config. So after `--backend-slot` or a slot move, a running
server keeps serving the old URLs.

That is worth a verb of its own because it is invisible otherwise: rewriting the
file **does** trigger a watch rebuild, and the rebuild silently reuses the values
read at startup. Nothing looks wrong; the app just talks to the wrong backend.

```sh
tools/dev/ng-slot.sh --restart --apps velista   # ~15s, and the shell stays up
```

With no `--apps`, `--restart` bounces whatever of this slot is currently running,
so it never quietly starts an app you left out of `--up`.

| you changed                                                     | what to do               |
| --------------------------------------------------------------- | ------------------------ |
| a component, template, style, or any library                    | nothing, it live reloads |
| a route table, a provider, a DI token                           | nothing, it live reloads |
| `.env` (a slot move, `--backend-slot`)                          | `--restart`              |
| `project.json`, a webpack config, `module-federation.config.ts` | `--restart`              |
| adding a whole new remote                                       | `--down` then `--up`     |

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
tools/dev/ng-slot.sh --up 5 --backend-slot 1   # shell 42400, gateway 43000
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
