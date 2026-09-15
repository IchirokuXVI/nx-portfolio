> **PR:** [#291](https://github.com/IchirokuXVI/nx-portfolio/pull/291)

# 0001 A session that refreshes itself

Part of the curation toolchain: this module, the two deciders
(`libs/luna-shopper/curation-suggestions`, `libs/luna-shopper/curation-groups`),
the orchestrator (`libs/luna-shopper/curation-cli`), and backend plan 0100
(`apps/luna-shopper-backend/plans/0100`).

## What this is

A plain module, not a process: the deciders import it. It owns everything about
talking to a Luna gateway as an admin, so nothing model shaped ever sees a
token. The model does not handle auth, does not see refreshes, and does not
know the credentials exist; the user stated that as a requirement and this
module is where it is enforced.

## The contract

`createAdminSession({ baseUrl, username, password, fetchImpl })` answers a
session object:

- `session.fetch(path, init)`: the one way through. It prefixes `baseUrl`,
  injects the bearer token, and parses JSON. On a 401 it logs in again once
  and retries the request once; a second 401 is a real error.
- `session.verify()`: proves the login works before anything else runs. The
  orchestrator calls it on both gateways before the first model call, and a
  failure names the gateway and the username so the error is actionable.
- Login is `POST /v1/admin/auth/login` with `{ username, password }`, reading
  `accessToken` from the answer, the same route the back office uses.

Defaults are the development convention the user fixed: username `dev-admin`,
empty password. The main gateway's credentials are inputs (the orchestrator
passes them through); the rehearsal slot always uses the seeded `dev-admin`,
which `luna-slot` creates.

## Decisions

- **One retry, then fail.** A refresh loop that retries forever turns a revoked
  admin into an infinite hammer on the login route.
- **`fetchImpl` is injectable** and every test runs against a fake; no test
  logs into anything.
- **Zero npm dependencies**, plain ESM `.mjs`, Node built ins only. The
  workspace cannot take a new package from Windows without corrupting the lock
  file, and nothing here needs one.
- **Not browser reachable.** This library names `process` and is never added to
  `tsconfig.base.json` paths; no app may import it.

## Shape

An Nx project so CI covers it: `project.json` with `lint` (`@nx/eslint:lint`)
and `test` (`nx:run-commands` running `node --test`). Files:
`src/session.mjs`, `src/session.test.mjs`, this `plans/` directory. Remember
`nx reset` after scaffolding, or the graph will not see the project.

## Verification

`node --test` with injected fetch: a login that succeeds, a 401 that refreshes
and retries once, a second 401 that fails, `verify()` on a wrong password
naming the gateway, and the empty password default reaching the login body
unchanged.
