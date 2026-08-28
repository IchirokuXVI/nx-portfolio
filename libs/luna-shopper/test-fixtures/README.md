# luna-shopper/test-fixtures

The single source of truth for Luna Shopper test data (plan 0013). It is
independent of where the data lands: unit tests import the factories directly,
and the per service database seeders (`apps/luna-shopper-backend/<svc>/src/app/db/seed`)
insert the same canonical scenario through the real TypeORM repositories.

- **Factories** (`makeUser`, `makeZone`, `makeList`, `makeLine`, `makeComment`,
  `makeItem`, …) build well formed, entity shaped objects with sensible defaults
  that any field can override. Each defaults its id to a fresh random uuid, so
  one off unit objects never collide.
- **The demo world** (`demoWorld`) is one hand authored, internally consistent
  graph built from the factories with **fixed uuid constants** (`ALICE_ID`,
  `ZONE_WEEKLY_ID`, `LIST_GROCERIES_ID`, `ITEM_MILK_ID`, …). Because the ids are
  compile time constants, a Playwright test knows exactly which zone and list to
  open and a unit test asserts against the same ids, while the seeder and the
  unit fixtures produce the same world.
- **Partitions.** The scenario is authored once but exposed pre split into the
  `auth`, `core`, and `catalog` halves, so each service's seeder consumes only
  its own slice while sharing the identical ids. Luna Shopper joins the three
  databases by application level id, never by a cross database foreign key, so
  the shared id constants are what keep the graph referentially consistent.

There is deliberately **no `package.json`** (it matches the `contracts` and
`platform` libraries): it is a workspace only, test only source library consumed
through the `@portfolio/luna-shopper/test-fixtures` path alias.

## The Jest entry point

`@portfolio/luna-shopper/test-fixtures/jest` is a **second** entry point holding
the infrastructure gate (plan 0015, section 3.1): `describeIntegration`, which
decides whether a missing stack is a green skip or a red failure, and
`requiredEnv`. It lives here because this is already the test only library every
service may depend on, and one definition of that gate is the point — it replaced
two identical per service copies.

It is kept out of the package barrel on purpose: the gate reaches for Jest's
globals, and the Playwright e2e suite imports the barrel for the fixed ids and has
no `describe`. Import the gate from the `/jest` subpath, never from the barrel.

```ts
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';

describeIntegration('core schema (real Postgres)', () => {
  // runs with LUNA_INTEGRATION=1; skips without it; FAILS without it when
  // LUNA_REQUIRE_STACK says CI brought a stack up on purpose.
});
```
