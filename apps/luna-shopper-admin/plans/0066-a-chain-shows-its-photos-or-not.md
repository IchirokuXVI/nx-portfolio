# 0066 A chain shows its photos, or not

> Backend half: plan `0198` of `apps/luna-shopper-backend/plans/`, built in PR #691. It says
> in section 6: "No back office screen. The three routes exist. The button is a plan in
> `apps/luna-shopper-admin/plans/`." This is that plan. It shares no file with `0065` and can
> be built beside it. Build `0065` first if both are scheduled, because this plan makes the
> trap that `0065` closes easy to reach.
>
> Mock: none. The page gains one row and three named actions, drawn as every named action is.

The photos of a chain are shown to shoppers only after a person turns that chain on. Today
the only way is a request by hand to the gateway. On 2026-10-17 Mercadona was turned on that
way in production. A person must be able to see whether a chain is on, turn it on or off, and
stop every chain at once, from the back office.

## Brief for the agent

### Objective

Add the photo switch of a chain to the chain's record page as a read only row and named
actions, with the stop for every chain beside it. Use the `nx-portfolio-angular-developer`,
`antislop`, `antislop-ui`, `antislop-human` and `antislop-copywriting` skills.

### Context

- **The chain descriptor** is `SUPERMARKETS` in
  `libs/luna-shopper-admin/feature-catalog/src/lib/supermarkets.ts` (admin plan `0056`).
  Sections "name" and "prices". `actions: { create, edit, delete }`, no named actions.
- **`linkedImagesEnabled: boolean`** is on `CatalogSupermarketView` (`wire-types.ts`). It is
  not on `UpdateSupermarketDto`, so it can never be a field that a save sends.
- **The routes** (`apps/luna-shopper-backend/gateway/docs/openapi.json`):
  - `PUT /v1/admin/catalog/supermarkets/{id}/linked-images` with `{ enabled: boolean }`
    answers 200 with the chain. Only a JSON boolean passes. Off takes the chain's photos out
    of every product in the same transaction and keeps the saved links.
  - `POST /v1/admin/catalog/linked-images/disable-all`, no body, answers 201
    `{ supermarkets, items }`.
- **The precedent for a switch that writes at once** is the chain source (admin plan `0059`,
  `feature-harvest/src/lib/sources.ts`): `enabled` is a boolean field with
  `editable: false`, `help` and `setBy`, and two named actions with `available` and `confirm`
  write it. No switch on a page writes at once (the owner's rule in `0059`).
- **The precedent for a call that is not CRUD, with a memory twin**, is
  `product-group-assignments.ts`: `instanceof ResourceMemoryGateways` for memory, otherwise
  `HttpClient` with `ApiUrl.gateway(PATH)` and `toGatewayError`. After a write,
  `ResourceChanges.wrote('supermarkets')` (see `chains/chain-context.ts`), and also
  `'items'`, because the shown photo of products changed.
- **`NamedAction`** (`models/src/lib/resource/resource-descriptor.ts`): `name`, `label`,
  `confirm`, `available`, `danger`, `after`, `recordOnly`, `run`, and an optional
  `ActionOutcome` of kind `line`.
- **A list has no action of its own.** Only rows have named actions, and ticked rows have
  bulk panels.
- **Guard specs** in `apps/luna-shopper-admin/src/app/`: `danger-actions-pinned.spec.ts` pins
  the `danger` choice of every named action, and `no-unread-translation-key.spec.ts` wants
  every key read.

### Target state

The texts below use Mercadona as the example. Each one names the chain of the page.

1. **A row "Photos shown"** in a new section "Photos" of the chain page: "Yes" or "No", never
   editable, with the help: "Shoppers see this chain's product photos when we have none of
   our own. The photos stay on the chain's site. Turning this off hides them at once."
2. **"Show this chain's photos"** in the More menu when the chain is off. It asks first:
   "Show Mercadona's photos? Products with no photo of our own show the photo Mercadona
   gives. Nothing is copied. You can hide them again at any time." It writes `true`.
3. **"Hide this chain's photos"** in the More menu when the chain is on. It asks: "Hide
   Mercadona's photos? Every product stops showing them at once. The saved links stay, so
   showing them again needs no harvest." It writes `false`.
4. **"Hide every chain's photos"** in the More menu of every chain, under the line with the
   danger actions, only when at least one chain is on if the page can know it, and
   `recordOnly`. It asks: "Hide the photos of every chain? Every product stops showing chain
   photos at once. Each chain must then be shown again one by one." It answers a line:
   "Photos hidden for 2 chains and 3,104 products."
5. **The chain list** gains a column "Photos" with "Shown" or nothing, and the row actions
   of targets 2 and 3.
6. **The memory back end** answers both writes as the catalog does: the flag on the chain,
   and the count of chains and products for the stop.

### Scope

- In: `feature-catalog/src/lib/supermarkets.ts`, a new gateway file beside it for the two
  calls, `chains/` if the page context needs the flag, the memory back end, their specs,
  `danger-actions-pinned.spec.ts` and `en.json`.
- Out: the gateway, `openapi.json`, `wire-types.ts`, the catalog service, velista, the
  product page (plan `0065`).

### Constraints

- The flag is written by the named actions and by nothing else. No save sends it.
- Use the chain's name in every question. A question without it is refused in review.
- "Hide every chain's photos" is `danger: true`: it is the one action of the three that a
  single press cannot take back. The other two are not danger.
- Send `{ "enabled": true }` and `{ "enabled": false }` as JSON booleans.
- The constraints of plans `0053` and `0056` hold.

### Action boundaries

- Do not change a gateway route, a DTO or the catalog.
- Do not turn a chain on or off on staging or production. On your own Luna slot you may.
- Do not start, stop or migrate Luna slot 0, 1 or 3.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/data-access` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- Specs for which action is offered in each state, the body each one sends, the line of the
  stop, and the reload of products after a write.
- The walk of section 3, with screenshots at 1360 px and 390 px.

## 1. Not in this plan

- Showing a chain again after the stop in one press. Backend `0198` makes that one request
  per chain on purpose.
- An audit view of who turned a chain on. The catalog audits both writes. Reading the audit is
  another plan.
- Velista's draw of a chain photo (`referrerpolicy`, a placeholder). That is a velista plan.

## 2. The descriptor

| Field | Kind | Says |
| --- | --- | --- |
| `linkedImagesEnabled` | boolean | `editable: false`, `help` of target 1, `setBy: 'catalog.supermarkets.photosSetBy'` ("Changed from the More menu") |

```ts
record: {
  sections: [
    // name, prices, as today
    { title: 'catalog.supermarkets.section.photos', fields: ['linkedImagesEnabled'] },
  ],
},
actions: {
  create: true, edit: true, delete: true,
  named: () => chainPhotoActions(inject(ChainPhotos)),
},
```

`ChainPhotos` holds `set(chainId, enabled)` and `hideAll()`. Each one calls its route, then
`ResourceChanges.wrote('supermarkets')` and `ResourceChanges.wrote('items')`.

Whether "Hide every chain's photos" can know that a chain is on: if the chain list is already
read for the page, use it. If not, offer the action always. A stop that changes nothing
answers "Photos hidden for 0 chains and 0 products.", which is true.

## 3. The walk

On your own Luna slot:

1. Open Mercadona. "Photos shown" says "No". The More menu offers "Show this chain's photos".
2. Show them. The question names Mercadona. The row says "Yes". A product with a Mercadona
   link and no photo of its own shows the photo over the gateway.
3. Hide them from the list row. The row says "No" again.
4. Show Mercadona and DEZA, then "Hide every chain's photos". The line names the counts. Both
   chains say "No".
