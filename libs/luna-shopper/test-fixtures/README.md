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
