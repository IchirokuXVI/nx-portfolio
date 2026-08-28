# 0001: an e2e suite that runs against a slot

> Written after the fact, from commit `c66a347`. The work is on `dev`; this plan records
> the design it was built to rather than the one it was built from.
>
> Prerequisite reading: `tools/dev/README.md` (what a slot is and why the ports cannot
> come from the project graph) and
> `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` for the backend half.
>
> This directory is the home for plans about the workspace's developer and test tooling:
> the slot scripts and the Playwright configuration they drive, which span every app and
> therefore belong to none of them.

## 1. Why this was needed

Slot 0 is the developer's own. A worktree that claims a slot moves its whole stack into
the 42000 band, and everything the app itself needs follows automatically, because Nx
loads `{projectRoot}/.env` when it starts a task.

The e2e suites are the one thing that mechanism cannot reach. It is per **project**:
`apps/shell/.env` reaches `nx serve shell` and never a `*-e2e` task. So running a suite
from a worktree drove **slot 0**, which is somebody else's server, and the result was
either a false pass against the wrong build or a puzzling failure.

Three separate defects fall out of that, and all three are here.

## 2. The slot descriptor names the URL, rather than leaving it to be read off

`ng-slot.{sh,ps1}` computed ports and left the caller to assemble a URL from the port
table by eye. The descriptor now carries `NG_SHELL_URL`, `NG_VELISTA_URL` and
`E2E_BASE_URL` directly.

`E2E_BASE_URL` is the shell's origin for **all four** front end suites, because every one
of them drives its app through the shell. That is the same rule as the blank page rule in
CLAUDE.md, expressed as a variable: a remote on its own port is not the thing under test.

A new verb, `--e2e-env` (`-E2eEnv`), prints it as an export:

```sh
eval "$(tools/dev/ng-slot.sh --e2e-env)"
npx nx e2e velista-e2e
```

It has to cross into the caller's environment, which is exactly the thing the per project
`.env` cannot do. This mirrors the verb `run-services.sh` already has on the backend side,
so the two halves of a slot are driven the same way.

## 3. Suppressing the dev server on `BASE_URL` too

The three Playwright configs suppressed their `webServer` on `E2E_BASE_URL` only. A run
with `BASE_URL` set therefore drove the given URL **and also** started `nx serve shell` on
4200, colliding with whoever owns that port.

Both variables now suppress it. Verified in both directions: the resolved config reports
`webServer` null under either variable, and unchanged when neither is set.

## 4. The documented example pointed at nothing

`apps/luna-shopper-backend/docs/testing-strategy.md` gave a slot example with ports from
the abandoned `default + N*100` scheme (3100/3101, nats 4322) rather than the 43000 band.
Following it aimed the suite at a port nothing was listening on, and the suite **skipped
itself**, which is precisely the false green the surrounding comment warns about.

It now sources `.env.slot` for every port, so it cannot drift again. A document that
restates a generated value is a document that will be wrong later; one that reads the
generated value is not.

## 5. Acceptance

1. `--e2e-env` prints an export that points a suite at this worktree's shell, and the
   four front end suites all take the same origin from it.
2. A run with `BASE_URL` set drives that URL and starts no dev server; the same for
   `E2E_BASE_URL`; with neither set the dev server still starts.
3. The example in `testing-strategy.md` reads its ports from `.env.slot` and names no
   port literally.
4. A suite pointed at a slot that is not running fails rather than skipping itself.
