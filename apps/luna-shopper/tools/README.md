# Luna Shopper db tooling

Cross-service test-data tooling (plan 0013), wired as targets on the umbrella
`luna-shopper` Nx project. Two independent mechanisms that share nothing but the
fixture ids:

- **Seed (a population concern).** Inserts the canonical demo world from
  `@portfolio/luna-shopper/test-fixtures` through each service's real TypeORM
  repositories. Idempotent by fixed id.

  ```sh
  nx run luna-shopper:seed                 # auth, then catalog, then core
  LUNA_ENV=test nx run luna-shopper:seed   # target the opt-in test databases
  ```

- **Snapshot / restore (a backup concern).** `pg_dump` / `pg_restore` of the
  actual databases, so an arbitrary prior state can be put back exactly — which a
  seeder cannot do.

  ```sh
  nx run luna-shopper:db:snapshot -- --label initial
  nx run luna-shopper:db:restore  -- initial     # restoring 'initial' IS the reset
  ```

## Safety

`db/guard.js` is **default-deny**: seed, snapshot and restore only run against
known-local hosts (loopback and the compose service names). A non-local host —
staging — requires an explicit opt-in (`LUNA_DB_ALLOW_HOSTS=<host>` or
`LUNA_DB_ALLOW_DESTRUCTIVE=1`). Production is never seeded, snapshot or restored;
its smoke path goes only through the public gateway API (plan 0013, section 3.5).

`db/env.js` resolves each service's database URL from the same layered `.env`
files the service reads, plus an opt-in `.env.test` (selected by `LUNA_ENV=test`)
that wins, so switching between real and test data is a connection-string swap.

Snapshots are written to `apps/luna-shopper/.snapshots/` (git-ignored).
`pg_dump` / `pg_restore` must be on `PATH` and match the server major version.
