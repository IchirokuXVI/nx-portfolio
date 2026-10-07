> **PR:** [#606](https://github.com/IchirokuXVI/nx-portfolio/pull/606)

# 0180: the reference seed is removed

> Decided by the owner on 2026-10-03. The first production catalog is the curated harvest of
> October 2026 (`apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`), and the 239
> authored entries of the reference seed are not part of it. A new seed can come later. It is
> not this plan.
>
> Prerequisite reading: `catalog/src/app/db/reference/` (every file),
> `catalog/src/seed-reference.ts`, `catalog/webpack.config.js`,
> `k8s/helm/templates/luna-shopper-backend/reference-seed-job.yaml.tpl`,
> `k8s/e2e/luna-shopper-backend/stack.sh` (lines 379 and 411 to 436), plans `0166` and `0173`
> (the category tree), and `apps/luna-shopper-backend/tools/ci/assert-runtime-manifest.mjs`.

The reference seed wrote 238 products, two chains, one Mercadona warehouse and a set of
product groups into every database it ran on. It is switched off in both clusters, and it
is still on for every local slot. On 2026-10-03 a plain `luna-slot.sh --up` added those 238
products to a copy of staging, and the copy had to be restored.

## Brief for the agent

### Objective

Delete the reference seed: its data, its entry points, its build output, its Helm job and
its call in the local stack. Keep the three pieces of that directory that the service, two
migrations and the demo seed use, and give them a home that does not say "reference".

### Context

The directory `catalog/src/app/db/reference/` holds two different things.

**The seed, which goes:**

| File | What it is |
| --- | --- |
| `authored.ts`, `mercadona.ts` | the 238 authored products |
| `groups.ts` | `REFERENCE_GROUPS` |
| `stores.ts` | `REFERENCE_STORES` (El Jamón, SuperCash) |
| `seed-reference-catalog.ts` | `seedReferenceCatalog`, `seedMercadona`, `moveSeededMercadona`, `writeItems` |
| `cli.js` | the development entry |
| `types.ts` | `AuthoredItem`, `ReferenceGroup`, `ReferenceStore` |
| `index.ts` | the barrel |
| `catalog/src/seed-reference.ts` | the entry inside the image |

**The taxonomy, which stays:**

| File | Who uses it |
| --- | --- |
| `ids.ts` (`categoryId`, `REFERENCE_NAMESPACE`) | `category.service.ts` line 36 and 194, migrations `1758100000000-CategoryTree.ts` and `1758500000000-DiaCategoryTree.ts`, 13 specs |
| `categories.ts` (`REFERENCE_CATEGORIES`, `UNCATEGORISED_SLUG`, `referenceCategoryRows`) | `taxonomy-seed.ts`, `reference-catalog.spec.ts` |
| `taxonomy-seed.ts` (`seedTaxonomy`, `writeItemCategories`) | the demo seed `db/seed/seed.ts`, two integration specs |
| the category types in `types.ts` | `categories.ts` |

Outside the directory:

- `catalog/webpack.config.js` lines 42 to 57 build `seed-reference.js` as a third entry.
- `catalog/project.json` lines 146 to 152 hold the target `seed:reference`.
- `reference-seed-job.yaml.tpl` is a Helm hook Job. `values.yaml` lines 899 to 920,
  `values.staging.yaml` lines 139 to 146 and `values.production.yaml` lines 196 to 208 hold
  `referenceSeed`, all with `enabled: false`.
- `stack.sh` lines 411 to 436 run the seed on every local `up` unless `CI` is set or
  `LUNA_REFERENCE_SEED=0`. `luna-slot.sh` line 412 has a comment about it.
- `k8s/catalog-seed/README.md` lines 88 to 104, `k8s/catalog-reset/README.md` and
  `docs/initial-catalog-2026-10.md` lines 68 to 69 describe it.
- No service code reads a seeded row at run time. No integration spec and no e2e suite
  relies on one. The demo world (`luna-shopper-backend:seed`, `E2E_SEED`) is a different
  seed and it stays.

### Target state

1. `catalog/src/app/db/taxonomy/` holds `ids.ts`, `categories.ts`, `taxonomy-seed.ts`, the
   category types and a spec. `db/reference/` does not exist.
2. `ids.ts` keeps only what something still calls. `categoryId` and its namespace value
   stay byte for byte the same, because two migrations and every category row in both
   clusters derive their id from it.
3. The taxonomy part of `reference-catalog.spec.ts` survives as `taxonomy.spec.ts`: the
   living tree agrees with the frozen tree of `DiaCategoryTree`, and every slug is unique.
   The product, group and store assertions are deleted with their data.
4. No `seed-reference.ts`, no `seed-reference.js` in the build, no `seed:reference` target,
   no `LUNA_REFERENCE_SEED` anywhere.
5. The Helm chart has no reference seed Job and no `referenceSeed` values key. The
   migration Job is unchanged.
6. `stack.sh up` migrates and does not seed. The comment in `ensure_dev_admin` (line 379)
   and the one in `luna-slot.sh` say what is true now.
7. Documents that tell a person to set `LUNA_REFERENCE_SEED=0`, or to restore before the
   seed, say that the seed is gone.

### Scope

- Work only in: `apps/luna-shopper-backend/catalog/`, `k8s/helm/`,
  `k8s/e2e/luna-shopper-backend/stack.sh` and `luna-slot.sh`, `k8s/catalog-seed/README.md`,
  `k8s/catalog-reset/README.md`, `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`,
  `apps/luna-shopper-backend/tools/ci/` (comments and fixture names only), and the comment
  lines the search below finds in `libs/luna-shopper/{dia,lidl,mercadona}/src/lib/category-leaves.ts`
  and in the six `project.json` files that name `seed-reference.ts`.
- Do NOT touch: the demo seed's data, the auth and core seeds, any migration's behaviour,
  `libs/luna-shopper/test-fixtures`, old plan files, the release tasks.

### Constraints

- **A migration changes one line only: its import path.** `1758100000000-CategoryTree.ts`
  and `1758500000000-DiaCategoryTree.ts` import `categoryId` from `'../reference/ids'`.
  Point them at the new path. Nothing else in a migration changes, and a spec proves that
  `categoryId('<slug>')` answers the same uuid before and after.
- **`uuid` stays a dependency of the catalog image.** `main.js` and `migrate.js` both reach
  it through `categoryId`. Rewrite the `comment` in `catalog/package.json` so it gives that
  reason and no longer names `seed-reference.js`. Run `manifest-check`.
- **Nothing is deleted from a database.** Rows that the seed wrote in a local slot stay
  where they are. This plan removes code.
- Old plan files that mention the reference seed are history. Leave them.
- Only make the changes this plan names. Do not write a replacement seed.

### Acceptance criteria

- [ ] `git grep -n -i "seed-reference\|seed:reference\|LUNA_REFERENCE_SEED\|referenceSeed\|seedReferenceCatalog\|db/reference"`
      finds hits only under `plans/` directories.
- [ ] `npx nx build luna-shopper-backend-catalog` passes, and the output holds `main.js` and
      `migrate.js` and no `seed-reference.js`.
- [ ] `npx nx test luna-shopper-backend-catalog` passes, with `taxonomy.spec.ts` in it.
- [ ] `npx nx run luna-shopper-backend-catalog:test-integration` passes for the 13 specs
      that import `categoryId`.
- [ ] `npx nx run luna-shopper-backend-catalog:manifest-check` passes.
- [ ] `helm template` with `values.staging.yaml` and with `values.production.yaml` renders
      no Job whose name ends in `-reference-seed`.
- [ ] `k8s/bootstrap/provision-release.sh --check --env staging` still passes its render
      step. State plainly if no cluster is reachable and only the render was run.
- [ ] An ephemeral slot comes up with `luna-slot.sh --ephemeral --up <n>`, and
      `select count(*) from items` in its catalog database answers 0.
- [ ] The demo seed still works: `npx nx run luna-shopper-backend:seed` on that slot ends
      with the demo world's item count.

### Action boundaries

Proceed with the deletions, the move, the specs and a local ephemeral slot. Stop and ask
before changing anything in a migration other than the import path, and before touching a
values file key other than `referenceSeed`.

### Progress evidence

Report each acceptance criterion with the command and its output.

## What a slot holds after this

A new slot is empty: no chain, no scope, no shop, no product. A person or a harvest creates
them, as in a cluster. The catalog of October 2026 reaches a slot by restore
(`docs/initial-catalog-2026-10.md`). The demo world is still one command away for anybody
who needs data to click through.

## What this does not do

- It does not clean the rows the seed already wrote. Both clusters were reset to empty
  (`k8s/catalog-reset/README.md`), and slot 1 was restored from staging with the seed off.
- It does not write a new seed. The owner decides later whether one is needed.
