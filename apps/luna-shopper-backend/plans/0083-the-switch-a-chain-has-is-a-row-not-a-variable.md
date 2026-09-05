# 0083 The switch a chain has is a row, not a variable

`MERCADONA_ENABLED` gates one storefront by name. Plan `0038` section 8.1 introduced it when there
was one storefront and the question was whether to fetch from a third party at all.

A second storefront makes the shape wrong. Plan `0085` adds one. Under the current arrangement it
arrives with `DEZA_ENABLED`, a third chain adds a third variable, and every one of them has to be
threaded through `app-config.ts`, the config map, `_env.tpl` and both `luna-slot` scripts before a
run can start. The owner ruled that out.

**The per chain switch already exists, and it is a column.** `supermarket_sources.enabled`, off by
default, one row per chain, editable in the back office through
`SUPERMARKET_SOURCE_PATTERNS.setEnabled`. `harvest-run.service.ts` line 109 already refuses a spawn
for a chain whose row says false. This plan deletes the variable and leaves the column doing the
job it was built for.

Depends on nothing. Plan `0085` assumes it. `0084` does not care.

## 1. Three switches become two

Plan `0038` section 8.1 and the table in `CLAUDE.md` describe three:

| Switch | Decides | After this plan |
| --- | --- | --- |
| `lunaShopperBackend.harvester.enabled` (Helm) | whether the service exists in a cluster at all | Unchanged. |
| `HARVEST_ENABLED` | whether a pod that exists may start any run | Unchanged. |
| `MERCADONA_ENABLED` | whether that one storefront may be fetched | **Deleted.** `supermarket_sources.enabled` answers it, per chain. |

`HARVEST_ENABLED` stays and is not per chain. It is the deployment level answer to "this pod starts
no runs", it is what keeps both clusters from fetching under k8s plan `0008`, and plan `0081`
section 1 leans on it for an import that touches no third party. One variable that means "this pod
starts runs" is the right number.

**What is lost, stated plainly.** The variable stopped a chain from being fetched without a
database write, from outside the application, by an operator who has the cluster but not the back
office. After this plan that operator turns off `HARVEST_ENABLED` and stops every chain, or opens
the back office. The owner accepted that: a per chain emergency stop that needs a redeploy is
slower than the row, not faster.

## 2. What reads it today

Six code sites, all in the harvester:

| File | Lines | What it does |
| --- | --- | --- |
| `config/app-config.ts` | 14, 90, 120, 173 | The doc comment, the Joi key, the interface field, the parse. |
| `harvest/catalog-discovery.runner.ts` | 69 to 72 | Throws before a discovery run fetches. |
| `harvest/refresh.runner.ts` | 60 to 63 | Throws before a refresh run fetches. |
| `harvest/source-entry.service.ts` | 183 | Returns null from `fetchEnglishName` instead of fetching. |
| `harvest/harvest-run.service.spec.ts` | 47 | Test fixture, `true`. |
| `harvest/postal-code-discovery.spec.ts` | 47 | Test fixture, `false`. |

Two more mention it in prose only: `entities/supermarket-source.entity.ts` line 34 and
`harvest/postal-code-discovery.worker.ts` line 41.

## 3. What replaces each check

**The two runners lose their check and gain nothing.** `run-executor.service.ts` calls
`requireSource(source)` for both modes, and `harvest-run.service.ts` line 109 has already refused
the spawn if that source is disabled. The runner check was a second gate on a run that never
started. Deleting it removes a duplicate, not a protection.

**`fetchEnglishName` keeps its guard, on the row.** `source-entry.service.ts` already loads the
source two lines later, to read `config.warehouse`, and returns null when that is missing. Move the
load up and return null when `source` is null or `source.enabled` is false. The method survives plan
`0079`, which changes what it does with the answer and not whether it asks.

**The two spec fixtures lose the field.** `postal-code-discovery.spec.ts` sets it false and passes,
which is plan `0063`'s point that a store discovery run never reads it. That stays true with the
field gone.

## 4. This closes a gap in a screen that shipped

Admin plan `0006` section 3 drew a panel showing all three switches, and PR #193 amended it: no
gateway route reports `HARVEST_ENABLED` or `MERCADONA_ENABLED`, so the panel renders a third state,
**"not known"**, rather than guessing. The plan calls reading the two literally "a backend change
and therefore a plan of its own".

Deleting `MERCADONA_ENABLED` halves that. The per chain switch becomes a row the admin already
reads and already writes, so the panel shows one true value instead of one unknown. The unread
route that plan wanted is then needed for `HARVEST_ENABLED` alone, which is one variable for the
whole service rather than one per chain, and is a much smaller thing to want.

Admin plan `0006` is amended in this plan's pull request: the three row table becomes two, and the
paragraph about two unreadable switches becomes one.

## 5. Configuration and deployment

- `k8s/helm/templates/luna-shopper-backend/configmap.yaml.tpl` lines 114 and 118: the comment and
  the key.
- `k8s/helm/templates/luna-shopper-backend/_env.tpl` line 216: remove `"MERCADONA_ENABLED"` from the
  key list.
- `values.yaml`, `values.production.yaml` and `values.staging.yaml`: remove
  `lunaShopperBackend.harvester.mercadonaEnabled` wherever it is set.
- `k8s/e2e/luna-shopper-backend/luna-slot.sh` lines 704 and 715, and `luna-slot.ps1` lines 633 and
  644: the generated `.env` line and the comment above it.

**The two scripts must still agree.** They write the same file by hand in two languages, and the
`.ps1` reached parity only recently. A removal from one and not the other is a slot whose services
see different configuration depending on which script the developer ran.

A removed key needs no migration. `_env.tpl` reads a list of names and skips what the config map
does not define, so an old config map with the key and a new deployment without it is not an error.

## 6. Documentation

- `CLAUDE.md` line 257: the three row table becomes two, and the sentence introducing it drops
  "and they are three because they are three different decisions" to the matching count.
- `apps/luna-shopper-admin/plans/0006-the-harvester-screens.md`: section 3 as described above.

Three shipped plans mention the variable as a record of a decision taken at the time:
`0038` lines 353 and 836, `k8s/0008` lines 39, 45 and 146, and `0063` line 97. **They are not
amended.** A plan is what was decided then, `CLAUDE.md` is what is true now, and rewriting the
first to match the second destroys the only record of why the variable existed.

## 7. Testing

- `catalog-discovery.runner.spec.ts` and `refresh.runner.spec.ts`: a run whose source is disabled
  never reaches the client, which is asserted at the spawn and not in the runner.
- `harvest-run.service.spec.ts`: spawning for a disabled source is refused, with the flag gone from
  the fixture. This test exists already, and only the fixture changes.
- `source-entry.service.spec.ts`: creating an item for a chain with a disabled source does not fetch
  an English name.
- A rendered chart check that no template emits `MERCADONA_ENABLED`, which `provision-release.sh
  --check` already renders for.

## 8. Exit criteria

- No file in the workspace outside `plans/` contains `MERCADONA_ENABLED` or `mercadonaEnabled`.
- A chain is enabled and disabled entirely through `supermarketSource.setEnabled`.
- The back office harvester panel shows two switches, one of which is a real value.
- `luna-slot.sh` and `luna-slot.ps1` write byte identical `.env` files.
