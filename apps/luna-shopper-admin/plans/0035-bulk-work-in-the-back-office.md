# 0035 Bulk work in the back office

> Backend half: `apps/luna-shopper-backend/plans/0160` for the brand batch route. The other two
> routes this plan uses exist today. Section 1 waits for `0160`, and sections 2 and 3 do not.
>
> In backend plan `0150`, the brand registry was empty, so every brand became a review. The
> operator registered 65 brands with a script. Product groups held one product each, and the
> back office can assign a group only one item at a time. The bulk decisions route that the
> curation CLI uses is not reachable from the app.

## Brief for the agent

### Objective

Let a person register many suggested brands in one pass, assign many items to a product group
in one pass, and apply a curation decisions file from the entries queue, each with a review
step before anything is written. Use the `nx-portfolio-angular-developer` skill for the
Angular work and `design-taste-frontend` for the review steps.

### Context

- Brands: `/harvest/brands` (`libs/luna-shopper-admin/feature-brands/src/lib/brands.ts`) and
  `/harvest/suggested-brands` (`brand-suggestions-page.ts`). The page comment says "There is no
  bulk register" on purpose, so each registration stays a decision. This plan keeps that: the
  person ticks each name, and can edit each label before sending.
- Backend `0160` adds `POST /v1/admin/catalog/brands/register-many`, with one outcome per name
  (`CREATED`, `EXISTS`, `REFUSED`).
- Groups: `product-groups.ts` has create, read, update and delete. A single item's
  `productGroupId` is edited in `items.ts`.
  `POST /v1/admin/catalog/product-groups/assignments` exists and the app does not use it.
- Entries: `/harvest/entries` (`entries-queue-page.ts`) and `queue-bulk.ts`, which loops over
  the single routes. `POST /v1/admin/harvest/entries/decisions` exists and the app does not use
  it. The curation CLI writes `decisions.jsonl` and applies it with `--apply`. Backend `0158`
  makes that route name the failed operation and its reason.
- Sections, routes, gateways and wire types work as admin plan `0033` Context describes.

### Target state

1. **Brands.** The suggested brands page gets a selection mode: tick rows, edit each label if
   needed, review the list, then register. The result lists each name with its outcome, and
   refused names stay selected.
2. **Groups.** The group detail screen gets "Add items": search items, tick them, review, then
   assign through `product-groups/assignments`. The result lists each item's outcome. The
   items list gets a "Set group" bulk action for ticked rows, with the same review step.
3. **Decisions.** The entries queue gets "Apply a decisions file": pick a `decisions.jsonl`,
   see a table of the operations it holds (kind, entry, target, name), then apply. The answer
   shows `applied` and, on a refusal, the failed step and the operation it names, with its
   reason.

### Scope

Work only in:

- `libs/luna-shopper-admin/feature-brands/src/lib/brand-suggestions-page.ts`
- `libs/luna-shopper-admin/feature-catalog/src/lib/` (product groups, items)
- `libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts` and a new decisions
  file panel
- `libs/luna-shopper-admin/data-access` and its in memory twins
- `libs/luna-shopper-admin/ui/assets/i18n/*.json`
- the generated wire types, only by running the generator

Do not touch: the backend, the curation CLI, or `queue-bulk.ts`'s existing behaviour.

### Constraints

- **A review step comes before every write.** Nothing is sent from a tick alone.
- The decisions file is read in the browser and sent as the route expects. The app does not
  change a decision.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a dependency for file parsing, or adding a section.

### Progress evidence

- Component specs with the in memory gateway for each of the three flows, including a partial
  result and a refusal.
- `npx nx test` and `npx nx lint` pass for every touched admin library, and
  `npx nx build luna-shopper-admin` passes.
