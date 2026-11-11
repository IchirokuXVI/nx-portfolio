# 0073: a source entry has an address

> Follow up of admin plan `0071` (PR #972, open on 2026-11-11), and checked against `origin/dev`
> (`b23a13050`) and the branch of PR #972 on 2026-11-11. Plan `0071` section 2 asks for a link
> from each size example of the run page to its entry when the example names an `entryId`. No
> address for one source entry exists, so PR #972 draws the name with no link, and its body says
> so. The owner decided on 2026-11-11 that this plan adds the address and the link.
>
> Prerequisite reading: admin plan `0071` (the report section of the run page), admin plan
> `0072` (wave 2, not built: the size doubt chip in the same queue), admin plan `0044` (the
> three tabs and the address that is the state), backend plan `0249` (the size examples), the
> branch of PR #972 (`run-page.ts` and `run-report.ts` of `feature-harvest`),
> `libs/luna-shopper-admin/models/src/lib/harvest/harvest-addresses.ts`,
> `libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts`,
> `feature-harvest/src/lib/review-chain.ts`, and the route `GET /v1/admin/harvest/entries` in
> `apps/luna-shopper-backend/gateway/docs/openapi.json`.
>
> Mock: none. The link is the name the run page draws already, and the queue gains one notice
> in the filter row that it has.

## Brief for the agent

### Objective

Give one source entry an address in the back office, the products queue narrowed to that one
entry, and make the name of each size example on the run page a link to it when the example
names an `entryId`. Follow the "Angular conventions" section of `CLAUDE.md` (that section is
what a plan here means by the `nx-portfolio-angular-developer` skill), and use the `antislop`,
`antislop-ui` and `antislop-copywriting` skills for the notice and its copy.

### Context

- **No read of one entry exists.** The gateway has these admin routes for entries
  (`openapi.json`): `GET /v1/admin/harvest/entries` (the queue), `POST
  /v1/admin/harvest/entries/{id}/accept`, `/{id}/item`, `/{id}/reject`, `POST
  /v1/admin/harvest/entries/decisions`, and `GET /v1/admin/harvest/items/{itemId}/entries`
  (the rows of one product). None reads one entry by its id. The NATS patterns agree
  (`SOURCE_ENTRY_PATTERNS`, `libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`,
  near lines 178 to 246): no `get`.
- **The queue's filters.** `GET /v1/admin/harvest/entries` takes `supermarketId`, `status`,
  `sourceKind`, `query`, `brandKey` and `delisted` (`SourceEntryListQueryDto`,
  `apps/luna-shopper-backend/gateway/src/app/harvest/harvest.dto.ts`, near lines 840 to 892).
  The controller passes them on one by one (`harvest.controller.ts`, near lines 568 to 580).
  The harvester reads them in `SourceEntryService.list` (`source-entry.service.ts`, near lines
  262 to 334). With no `status`, it lists `CANDIDATE` and `UNRESOLVED` only (near lines 283 to
  287). `query` matches the name, the brand or an equal EAN, which is not an address.
- **A size example can name a decided row.** Plan `0249` records a doubt on any row that a walk
  read, also an `ACTIVE` one. The default queue does not list an `ACTIVE` row, so a link that
  only narrows the default queue can land on nothing.
- **The queue reads its URL.** `EntriesQueuePage` reads `brandKey` from the query string once
  (`entries-queue-page.ts`, near line 1177), and the chain through `ReviewChain`, which keeps it
  in the `chain` parameter (`REVIEW_CHAIN_PARAM`, `harvest-addresses.ts`, near line 40). "The
  address is the state" (`review-chain.ts`, near line 9). `reload` builds one `QueueStore` over
  `listEntries` with the filters (near lines 1438 to 1470). `openRow` focuses a row of the page
  in hand (near line 1617).
- **The addresses live in `models`.** `harvest-addresses.ts` has `harvestReviewPath`,
  `harvestRunPath` and the parameter names, because `feature-catalog` links into this section
  too.
- **The run page on PR #972.** `readRunReport` maps each example with an `entryId`, `''` when
  absent (`run-report.ts` of the branch, near lines 90 and 332). `run-page.ts` draws the name in
  a `th` of the examples table (near line 478 of the branch). The run view carries
  `supermarketId`.
- **The query string reaches `openapi.json` only.** `generate-wire-types.mjs` reads
  `components.schemas`, and a query parameter is not a schema there. A new parameter thus
  changes `openapi.json` and leaves `wire-types.ts` as it is. Run both commands anyway, and
  commit what changes.

### Target state

1. **The queue route takes one more filter, `entryId`.** `GET /v1/admin/harvest/entries?entryId=`
   answers the one row with that id, whatever its status, and every other filter that is given
   still applies. With `entryId` and no `status`, the default `CANDIDATE` and `UNRESOLVED`
   clause is not added.
2. **The back office has the address.** `/harvest/review/products?entry=<id>&chain=<chain>`.
   The products queue reads `entry` from its query string, asks the route with `entryId` and
   nothing else but the chain, and opens that row. A notice in the filter row says that the
   queue shows one entry, with a control that shows the whole queue again.
3. **The run page links.** On a size example with an `entryId`, the name is a link to that
   address, with the run's chain.
4. **The memory back end agrees.** `HarvestMemory.listEntries` reads `entryId` with the same
   rule, and the seed holds one example whose entry is `ACTIVE`.

### Scope

- Contracts: `ListSourceEntriesRequest.entryId` (`harvest.messages.ts`, near line 1783).
- Gateway: `SourceEntryListQueryDto.entryId`, `@IsOptional() @IsUUID()`, and the controller
  passes it on. Its spec.
- Harvester: the clause in `SourceEntryService.list` and its spec.
- Generated: `openapi.json`, by `npx nx run luna-shopper-backend-gateway:openapi`. Then
  `npx nx run luna-shopper-admin/models:wire-types`, which is expected to change nothing.
- Admin `models`: `REVIEW_ENTRY_PARAM` and one address function in `harvest-addresses.ts`.
- Admin `data-access`: `EntryQuery.entryId` (`harvest-service.ts`, near line 452), the API
  passes it through `toParams`, and `harvest-memory.ts` (near line 634) filters on it. One seed
  example in `harvest-seed.ts`.
- Admin `feature-harvest`: `entries-queue-page.ts`, `entries-queue.spec.ts`, `run-page.ts`,
  `run-page.spec.ts`.
- `libs/luna-shopper-admin/ui/assets/i18n/en.json`: the copy of section 2.
- Out of scope: a page of its own for one entry, a resource descriptor for entries, the size
  doubt chip and its filter (admin plan `0072`), and every other link to an entry.

### Constraints

- No new admin route. The address is a query string on a route that exists, so the rail and
  the route specs of the app (`no-route-outside-the-rail.spec.ts`) see nothing new.
- No new gateway route. One optional field on the query of a route that exists.
- Never edit `openapi.json` or `wire-types.ts` by hand.
- The page reads the parameter from `unknown`: a value that is not a uuid shape asks nothing
  and draws the empty state with the notice. The gateway refuses a value that is not a uuid
  with a 400, and the page must not send one.
- No dash as punctuation in any string.
- Run `npx nx build luna-shopper-admin`. The PR checks never build the admin app.

### Action boundaries

- Build after PR #972 merges. The link goes into the examples table that PR #972 adds.
- Stop and ask before you add a route, a page or a resource descriptor.
- Stop and ask if admin plan `0072` is open on a branch that changes `SourceEntryListQueryDto`
  or `SourceEntryService.list` at the same time. Both plans add a filter there.

### Progress evidence

The spec output of the gateway, the harvester and the admin libraries, the diff of
`openapi.json`, the empty diff of `wire-types.ts`, `npx nx build luna-shopper-admin`, and
screenshots at 1360 px and 390 px of the queue opened from a size example of the memory back
end, one on a waiting row and one on an `ACTIVE` row.

## 1. Why a filter and not a read by id

Three designs reach one entry:

- (a) **A filter `entryId` on the queue route.** One optional field in the DTO, the contract
  and the harvester clause. The queue page already reads its filters from the URL and already
  draws and decides any row the route answers, decided rows included (with a `status` it
  "reaches a decision to look up or undo", the DTO says). The answer has the shape the queue
  reads today, with the brands of each row.
- (b) **A new route `GET /v1/admin/harvest/entries/{id}`**, a new NATS pattern, a handler, and
  a page or a mode of the queue that draws one row from it. It is a second read of the same
  row in a second shape, and the queue would still need a mode to show it.
- (c) **No backend change.** A link to the queue with `query=<name>&chain=<chain>` finds
  every row whose name contains the text, and no `ACTIVE` row. That is a search, not an address.

This plan takes (a). It is the smallest design that reaches every row, and it adds no screen.

## 2. The queue with one entry

When the query string holds `entry`:

- `reload` asks `listEntries` with `entryId` and the chosen chain only. The status, kind,
  brand and delisted filters of the page are not sent, because the entry is the question.
- The page opens the row when the page answers it.
- The filter row shows a notice: the text of `harvest.entries.entry.one` and a button with
  `harvest.entries.entry.all`. The button removes `entry` from the URL with
  `replaceUrl`, as `ReviewChain.choose` writes a filter, so the back button still returns to
  the run page. The queue then reads again from the top.
- A changed filter (chain, status, kind, brand) also removes `entry`, because the operator has
  asked another question.
- A page that answers no row draws the existing empty state, with the notice above it.
- After a decision, the row stays in the answer (the route answers it whatever its status), so
  the operator sees what the decision made of it.

Copy:

| Key | English |
| --- | --- |
| `harvest.entries.entry.one` | Showing one entry. |
| `harvest.entries.entry.all` | Show the whole queue |

## 3. The address

In `harvest-addresses.ts`:

- `REVIEW_ENTRY_PARAM = 'entry'`, beside `REVIEW_CHAIN_PARAM`.
- `harvestEntryAddress(entryId, supermarketId)`, which answers the commands of
  `harvestReviewPath('products')` and the query parameters `{ entry, chain }`. The run page
  binds both to `routerLink` and `queryParams`. The builder names the function as the file
  names its others.

## 4. The order with admin plan 0072

Build this plan before admin plan `0072`. Both touch these files:

- `entries-queue-page.ts` and `entries-queue.spec.ts`: this plan adds the parameter and the
  notice, and plan `0072` adds the chip and maybe a filter.
- `harvest-memory.ts`, `harvest-seed.ts` and `en.json`.
- If the count of its D2 asks for the filter, plan `0072` also adds a field to
  `SourceEntryListQueryDto`, a clause beside the one of this plan in `SourceEntryService.list`,
  and the two regenerations.

This plan is small and finishes a follow up of PR #972, so it goes first, and plan `0072` adds
its filter beside a filter that is already there. The two must not be open at the same time.

## Tests

- Harvester `source-entry.service` spec: `entryId` answers that row with no status given, an
  `ACTIVE` row included. With a `status` that the row does not have, it answers nothing.
- Gateway: the DTO refuses an `entryId` that is not a uuid, and the controller passes the field.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after the two commands.
- Admin `harvest-memory` spec: the same rule as the harvester.
- `entries-queue.spec.ts`: with `entry` in the URL, the page asks with `entryId` and the chain
  only, opens the row and shows the notice. The button removes the parameter and reads the
  queue again. A filter change removes it too.
- `run-page.spec.ts`: an example with an `entryId` draws a link to the address with the run's
  chain, and an example with none draws the name only.

## Acceptance criteria

- [ ] A size example with an `entryId` links to the queue opened on that entry.
- [ ] The link reaches an `ACTIVE` entry as well as a waiting one.
- [ ] No new route in the gateway or the admin app.
- [ ] `openapi.json` is regenerated, and no generated file is edited by hand.
- [ ] `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.

## Verification

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-backend-gateway
npx nx test luna-shopper-backend-harvester -t "SourceEntryService"
npx nx test luna-shopper-admin/data-access
npx nx test luna-shopper-admin/feature-harvest
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

## Decisions

**D1 (owner, answered 2026-11-11):** the size example links to its entry, in a plan of its own
after admin plan `0071`.

The choices below are the planner's and wait for the owner. The PR body lists them.

**D2. A filter on the queue route, not a read by id (section 1). Open.** Recommended: the
filter.

**D3. With `entryId`, the default status clause is dropped, and an explicit `status` still
applies. Open.** Recommended, because a size example can name an `ACTIVE` row.

**D4. The address is the products queue with `entry` and `chain` in the query string, and the
queue sends only the entry and the chain while it is set (section 2). Open.** Recommended.

**D5. The copy of section 2. Open.**

**D6. This plan builds after PR #972 merges and before admin plan `0072` (section 4). Open.**
Recommended.
