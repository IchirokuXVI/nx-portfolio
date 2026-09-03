# 0073 The admin API is its own namespace

Everything the back office calls lives under `/v1/admin/**`, and nothing else does.

The rule is not organisational tidiness. After `0071` the admin guard is a different guard,
verifying a different key and producing a different principal, and a route cannot carry two guards
that disagree about who the caller is. A URL is the unit that gets a guard, so a differently
guarded thing needs a different URL.

Depends on `0071` (the guard exists) and `0072` (the downstream gate accepts what the gateway
forwards). Nothing behind the gateway changes: the same controllers may call the same services over
the same NATS subjects, and this plan is about the HTTP surface only.

## 1. The rule

**Different guard, different URL. Same handler is fine.**

An admin route may share a controller file, a service, and a NATS subject with a user facing route.
What it may not share is the path, because the path is what carries `@UseGuards`.

`/v1/admin/harvest/*` already works this way and is the model. `harvest.controller.ts` states it:

> `/v1/admin/harvest/`, proxying to the harvester over NATS. **Every route here is platform admin
> gated** inside the harvester service.

Those routes need only their guard swapped from `JwtAuthGuard` to `AdminJwtGuard`. They are already
where they belong.

## 2. Catalog is the awkward one, and it is not a move

Catalog's controllers are **mixed**. Reads under `/v1/catalog/*` are open to any authenticated user
and velista depends on them heavily; writes on the same paths are admin gated. So the refactor is
not "move the catalog controllers", it is "split them".

Reads stay exactly where they are. Velista calls them, they are in the committed OpenAPI document,
and moving them is a breaking change to a shipped app for no benefit.

**The trap is that "write" is not the same as "not a GET".** `POST /v1/catalog/items/lookup` is a
read: it takes a body of ids and forwards `ITEM_PATTERNS.getMany`, and its own doc explains it is a
POST only because the house rule follows Nest's default statuses. It is how a list line renders its
product, it is account authenticated, and velista breaks without it. A mechanical "move every non
GET" refactor moves it and takes the list screen down.

So the split is by **who may call it**, established from the `requireAdmin` call sites in catalog's
services, not by HTTP verb.

## 3. The route map

Everything in this table gains an `admin/` prefix and swaps to `AdminJwtGuard`. Everything not in
it stays where it is with the guard it has.

| Today                                         | Becomes                                             |
| --------------------------------------------- | --------------------------------------------------- |
| `POST /v1/catalog/supermarkets`               | `POST /v1/admin/catalog/supermarkets`               |
| `PATCH /v1/catalog/supermarkets/:id`          | `PATCH /v1/admin/catalog/supermarkets/:id`          |
| `DELETE /v1/catalog/supermarkets/:id`         | `DELETE /v1/admin/catalog/supermarkets/:id`         |
| `POST /v1/catalog/supermarkets/:id/locations` | `POST /v1/admin/catalog/supermarkets/:id/locations` |
| `PATCH /v1/catalog/locations/:id`             | `PATCH /v1/admin/catalog/locations/:id`             |
| `DELETE /v1/catalog/locations/:id`            | `DELETE /v1/admin/catalog/locations/:id`            |
| `POST /v1/catalog/items`                      | `POST /v1/admin/catalog/items`                      |
| `PATCH /v1/catalog/items/:id`                 | `PATCH /v1/admin/catalog/items/:id`                 |
| `DELETE /v1/catalog/items/:id`                | `DELETE /v1/admin/catalog/items/:id`                |
| `POST /v1/catalog/product-groups`             | `POST /v1/admin/catalog/product-groups`             |
| `PATCH /v1/catalog/product-groups/:id`        | `PATCH /v1/admin/catalog/product-groups/:id`        |
| `DELETE /v1/catalog/product-groups/:id`       | `DELETE /v1/admin/catalog/product-groups/:id`       |
| `PUT /v2/catalog/supermarket-items`           | `PUT /v2/admin/catalog/supermarket-items`           |
| `DELETE /v2/catalog/supermarket-items/:id`    | `DELETE /v2/admin/catalog/supermarket-items/:id`    |
| `POST /v1/catalog/price-scopes`               | `POST /v1/admin/catalog/price-scopes`               |
| `PATCH /v1/catalog/price-scopes/:id`          | `PATCH /v1/admin/catalog/price-scopes/:id`          |
| `DELETE /v1/catalog/price-scopes/:id`         | `DELETE /v1/admin/catalog/price-scopes/:id`         |
| `PUT /v1/catalog/location-items`              | `PUT /v1/admin/catalog/location-items`              |

`/v2/catalog/supermarket-items` keeps its version. The version says what shape the payload has and
is unrelated to who may send it, so bumping it here would claim a change that did not happen.

**Stays put, called by velista:** every `GET` under `catalog/supermarkets`, `catalog/locations`,
`catalog/shops`, `catalog/items`, `catalog/product-groups`, `catalog/suggest`, `catalog/scope`,
`catalog/supermarket-items`, `catalog/price-scopes` and `catalog/location-items`, plus
`POST /v1/catalog/items/lookup`.

**Guard swap only, already in the namespace:** all of `admin/harvest/runs`,
`admin/harvest/places`, `admin/harvest/supermarkets/:supermarketId/entries`,
`admin/harvest/item-refs` and `admin/harvest/sources`.

## 4. The admin app reads through admin routes too

A question this raises and settles: when the back office lists items, does it call the existing
open read or a new admin read?

**A new admin read**, mirroring each list it needs. Three reasons. The open reads are scoped to the
caller's shopping profile and postal codes, which is meaningless for an operator and actively wrong
(an admin editing a product they cannot buy nearby would see no price). They paginate and rank for
a shopper, not for someone looking for the row they just broke. And an app holding only an admin
token cannot call a route guarded by `JwtAuthGuard` at all, which is the point of `0071`.

So the admin catalog reads are unscoped, sorted for administration, and filterable by the things an
operator cares about: `priceSourceKind`, missing `productGroupId`, `postalCodeSource = DERIVED`,
`available = false`. Those filters are what `apps/luna-shopper-admin/plans/0005` renders.

## 5. Verification before the refactor

One check to run first, and to record the result of in the PR: **confirm no velista code calls a
catalog write route.** The expectation is that it does not, because those routes are admin gated
and velista holds a user token, so any call would already be a 403. But the assumption is load
bearing for this whole plan and it is one search.

Search `libs/velista/data-access` and `apps/velista` for each moved path.

## 6. OpenAPI

Every row of section 3 changes the committed document, and this is the largest single diff it has
taken. Regenerate and commit it in the same PR:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

`openapi-document.spec.ts` fails on a stale document, so a forgotten regeneration is a red PR
rather than silent drift. Never hand edit it. On a CRLF checkout that spec can fail for line ending
reasons unrelated to the contract, which is worth knowing before diagnosing a red test as a real
one.

This document is also what `apps/luna-shopper-admin/plans/0004` generates its types from, so it
must be correct before the admin app's data layer is written, not merely before the release.

## 7. Tests

- Each moved route: reachable at its new path with an admin token, **404 at its old path**.
- Each stayed route: unchanged, and still reachable with a velista user token.
- `POST /v1/catalog/items/lookup` still works with a user token, explicitly asserted, because it is
  the one route this refactor is most likely to break.
- The harvest routes accept an admin token and reject a user token after the guard swap.
- `openapi-document.spec.ts` passes.

## 8. Exit criteria

- Every route the admin app calls is under `/v1/admin/**` and guarded by `AdminJwtGuard`.
- No route is reachable by both a velista token and an admin token.
- velista's e2e suite passes unchanged.
- `openapi.json` regenerated and committed.

## 9. Out of scope

- The users, zones and lists surfaces, which do not exist yet: `0074`.
- Anything about what the routes record: `0075`.
