# 0034 Places and chains in the back office

> Backend half: `apps/luna-shopper-backend/plans/0152` (a place joins the shop and scope it
> names), `0153` (a chain starts with a national scope) and `0154` (DEZA shops find their
> places). Build each section of this plan only after its backend plan is merged. Section 1
> needs `0152`, section 2 needs `0153`, and section 3 needs `0154`. Section 4 needs none.
>
> In backend plan `0150`, the places queue imported shops with only a `STORE` scope, created
> duplicates of seeded shops, and did not create a chain for an OpenStreetMap place. A chain
> made in the back office got no default scope, and nothing set one. The DEZA shop queue
> offered no candidate for any of 11 shops. The sources page offered an `osm-places` adapter
> whose row does nothing.

## Brief for the agent

### Objective

Make the places queue import under the declared or a chosen scope, show and link an existing
shop instead of creating a duplicate, create a chain from an OpenStreetMap place, let the
chain form pick its default scope, show DEZA shop candidates, and tidy the sources page and
the runs list. Use the `nx-portfolio-angular-developer` skill for the Angular work and
`design-taste-frontend` for the candidate panels.

### Context

- Places queue: `libs/luna-shopper-admin/feature-harvest/src/lib/places-queue-page.ts`, with
  import (single and bulk), reject, and a chain picker. Import sends only `supermarketId`,
  although `ImportDiscoveredPlaceDto` accepts `priceScopeId`. The duplicates panel
  (`place-view.ts`, `nearby`) compares a place only with other queued places. `places/groups`
  exists in `harvest-api.ts` and no page uses it.
- Chains: `/catalog/supermarkets` (`feature-catalog/src/lib/supermarkets.ts`), a descriptor
  only. `defaultPriceScopeId` is read only on purpose today, because the gateway did not
  write it. Backend `0153` adds the field.
- Shop queue: `/harvest/shops` (`shops-queue-page.ts`), which maps, unmaps, ignores and
  unignores. Backend `0154` adds candidates to each shop.
- Sources: `/harvest/sources` (`sources-page.ts`). The adapter picker lists `osm-places` at
  `:49`. Backend `0153` stops offering it. OpenStreetMap is always asked by the postal code
  queue and has no row.
- Runs: `runs-page.ts` filters by chain, preset and reverted, not by mode.
- Backend `0152` adds: the declared scope on import, 409 `place_matches_location` with
  candidates, `POST places/{id}/link`, `import` with `force`, 409 on reject of an imported
  place, and `newChain: { name, locale }` on import (from `0153`).
- Sections, routes, gateways and wire types work as admin plan `0033` Context describes.

### Target state

1. **Import.** The import panel shows the declared scope, read from the place, and lets the
   person pick another scope of the chain. When the backend answers
   `place_matches_location`, the panel lists the candidates with the rung that found each,
   and offers "Link to this shop" per candidate and "Create a new shop anyway". The
   duplicates panel lists catalog locations too. For an OpenStreetMap place with no chain,
   the panel offers "Create chain" with a name and locale. Reject of an imported place shows
   the backend's reason.
2. **Chains.** The chain form has a reference picker for `defaultPriceScopeId`, limited to
   that chain's scopes. The chain list shows a "no default scope" chip.
3. **DEZA shops.** Each unmapped shop shows its candidates, best first, with a "strong" mark,
   and a one tap "Map to this location".
4. **Sources and runs.** The sources page shows a read only line, "OpenStreetMap: always
   asked for every postal code", and the picker no longer lists `osm-places`. The runs list
   filters by mode. The places queue has a "Groups" view reading `places/groups`.

### Scope

Work only in:

- `libs/luna-shopper-admin/feature-harvest/src/lib/` (places queue, place view, shops queue,
  sources page, runs page, and a new groups view)
- `libs/luna-shopper-admin/feature-catalog/src/lib/supermarkets.ts`
- `libs/luna-shopper-admin/data-access` and its in memory twins
- `libs/luna-shopper-admin/ui/assets/i18n/*.json`
- the generated wire types, only by running the generator

Do not touch: the backend, other sections, or the generic resource list and form beyond using
them.

### Constraints

- **Nothing links or maps without a person pressing a button.** Candidates are shown, never
  applied.
- Bulk import keeps working. A place in the bulk selection that answers
  `place_matches_location` is left in the queue and reported, not linked.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a section, adding a dependency, or changing bulk import to link.

### Progress evidence

- Component specs with the in memory gateway for each target state item, including the 409
  path and the bulk path.
- `npx nx test` and `npx nx lint` pass for every touched admin library, and
  `npx nx build luna-shopper-admin` passes.
- A browser check on a slot with the backend plans merged: import the Libertador Mercadona
  place, see the seeded shop offered, and link it.
