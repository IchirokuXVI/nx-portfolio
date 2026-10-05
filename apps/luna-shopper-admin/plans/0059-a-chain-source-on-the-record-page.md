> **PR:** [#641](https://github.com/IchirokuXVI/nx-portfolio/pull/641)

# 0059 A chain source on the record page

> Eighth plan of the record page series (`0052` to `0060`). Needs `0054` (the collections
> of a record), merged. It shares no file with `0055` to `0058` and can be built beside
> them.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. No board draws a source. The orange
> note about a switch that writes at once names this record, and section 5 copies it.

A chain source is the row that says how the harvester fetches one chain: which adapter,
how many workers, how fast, and whether it may run at all. It is the one record of the
back office that has no descriptor. `SourcesPage` is 1,134 lines that draw a list, a form
to add a source, a form inside each row, two switches on each row that write at once, and
a delete.

After this plan a source is a resource like the others: a list, and a record page.

## Brief for the agent

### Objective

Give the chain source a descriptor, and draw it with the generic list and with
`RecordPage`. Delete `SourcesPage`. Use the `nx-portfolio-angular-developer`,
`design-taste-frontend`, `antislop`, `antislop-ui`, `antislop-human` and
`antislop-layoutmobile` skills.

### Context

- **`SourcesPage`** (`feature-harvest/src/lib/sources-page.ts`) is the `sources` child of
  `/harvest/setup` (`feature-harvest/src/lib/routes.ts`), beside the tabs of brands and
  postal codes. It has no address for one source.
- **It reads and writes through `HARVEST_SERVICE`** and not through a `ResourceGateway`:
  `listSources({ limit: 50 })`, `readSource(chainId)`, `upsertSource(chainId, { adapterKey,
  workers, maxRequestsPerSecond, config })`, `setSourceEnabled`, `deleteSource(chainId)`. A
  source is keyed on the ID of its chain. `upsertSource` both adds and changes.
- **The view** is `HarvestSupermarketSourceView`: `id`, `supermarketId`, `adapterKey` (one
  of seven), `enabled`, `autoImportPlaces`, `config`, `workers`, `maxRequestsPerSecond`,
  `lastRunAt`, `lastSuccessAt`, `consecutiveFailures`. It has no `createdAt`.
- **The two switches of a row.** `enabled` says whether the chain may be fetched (plan
  `0083` of the backend: a row for each chain, off by default). `autoImportPlaces`
  ("trusted") says whether the places a run finds are added with no review. Each has an
  info button.
- **The texts of plan `0041`** for this screen: a caution on the form ("A chain blocks a
  crawl that asks too fast. Raise workers and requests one step at a time, and watch the
  failures count."), and one line under the list about OpenStreetMap, which is always on.
- The Setup header counts the sources through `DashboardStore`.
- The harvester can be absent from a cluster. `harvest-absent.spec.ts` guards what the
  screens say then.

### Target state

1. **`SOURCES` is a descriptor** in `feature-harvest/src/lib/sources.ts`, with a gateway
   that wraps `HARVEST_SERVICE` (section 2).
2. **The Sources tab of Setup is the generic list** of `SOURCES`: the chain, the adapter,
   a state ("Fetched" or "Off"), the last run, and the failures in a row. A row opens the
   source.
3. **A source is a record page** at `/harvest/setup/sources/:id`, where the ID is the ID
   of the chain. Details has three sections: "Source" (chain, adapter), "How fast"
   (workers, requests in a second) and "What it may do" (may be fetched, places are added
   with no review, the config).
4. **Whether a chain may be fetched is not a switch.** While the page reads, the row says
   "Yes" or "No". "Stop fetching this chain" or "Let this chain be fetched" is in the More
   menu, with its own question, and it writes at once after the question. The list offers
   the same action on a row, where it draws the named actions of a row today.
5. **"Places are added with no review" is a switch under "Edit"**, saved with Save.
6. **Adding a source** is `RecordPage` at `/harvest/setup/sources/new`. The chain is a
   picker with no empty choice. A chain that already has a source is refused under the
   field, and nothing is overwritten.
7. **The caution of plan `0041`** is one line above the first section while the page is a
   form.
8. **"Delete this source" is in the More menu.** It asks first.
9. **The Record block** holds "Last run", "Last success", "Failures in a row" and the ID
   of the row. It has no "Added", because the view carries no such date.
10. **`SourcesPage` is gone.** The count on the Setup header, the line about
    OpenStreetMap and what the screen says when the harvester is absent stay as they are.

### Scope

- In: `feature-harvest/src/lib/` (new `sources.ts` and `sources-gateway.ts`,
  `sources-page.ts` deleted, `routes.ts`, `setup-page.ts`, `harvest-paths.ts`), the section
  of the app that lists the resources of the harvester
  (`apps/luna-shopper-admin/src/app/sections.ts`, if a resource must be named there to be
  in the registry), their specs, and `en.json`.
- Out: `HARVEST_SERVICE` and its two implementations, the run form, the presets, the
  queues, the chain page, the gateway, `openapi.json` and `wire-types.ts`.

### Constraints

- The gateway of `SOURCES` calls `HARVEST_SERVICE` and nothing else. It adds no request
  that the service does not make today.
- A create never overwrites. `upsertSource` writes over a source that exists, so the
  gateway reads first and refuses.
- `enabled` is changed by the named action and by nothing else. The form does not send
  it.
- Do not add an environment variable or a values field. Whether a chain may be fetched is
  a row, as `CLAUDE.md` says.
- The texts of the two info buttons become the `help` of the two fields. Nothing is said
  twice.
- The constraints of plans `0053` and `0054` hold.

### Action boundaries

- Do not change a gateway route, a DTO or the harvester.
- Do not turn fetching on for a chain on a backend that is not yours. On your own Luna
  slot, turning it on starts nothing by itself, and do not start a run.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk saves, so it needs a Luna
  slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-harvest`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/data-access` and
  `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 4, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- A link from a chain to its source. Whether a chain has a source is not on the chain's
  row, so a field of the chain cannot point at it. The source's own page links to its
  chain.
- A form that changes with the adapter. The config stays one box of JSON, as today.
- The switches of the price rules page and the roles of a person. They are not this
  record.

## 2. The descriptor

```ts
export const SOURCES = defineResource<Source>({
  name: 'sources',
  segment: 'sources',
  labels: { one: 'harvest.sources.one', many: 'harvest.sources.many',
            create: 'harvest.sources.add' },
  rowId: (row) => row.supermarketId,
  title: (row) => row.chainName ?? '',
  // ...
});
```

| Field | Kind | Says |
| --- | --- | --- |
| `supermarketId` | reference to `supermarkets` | required, `editable: 'create'`, `nameLookup` |
| `adapterKey` | a choice of the seven adapters | required |
| `workers` | number | an integer, at least 1 |
| `maxRequestsPerSecond` | number | more than 0 |
| `enabled` | boolean | `editable: false`, `setBy: 'harvest.sources.enabledSetBy'` ("Changed from the More menu") |
| `autoImportPlaces` | boolean | editable, with the text of its info button as `help` |
| `config` | json | editable |
| `lastRunAt`, `lastSuccessAt` | date, with the time | never editable |
| `consecutiveFailures` | number | never editable |

- **The title** is the name of the chain. The view carries the chain's ID alone, so the
  gateway adds `chainName` to each row from the lookup that `ChainNames` already holds. A
  source whose chain cannot be named is headed by its adapter, and never by an ID.
- **The gateway** (`sources-gateway.ts`):
  - `list` is `listSources`, with its cursor.
  - `read(id)` is `readSource(id)`.
  - `create(input)` reads the source of `input.supermarketId` first. If one exists, it
    throws a refusal that the form draws under the chain: "This chain already has a
    source." If none exists, it calls `upsertSource`.
  - `update(id, input)` calls `upsertSource` with the row as it is and the changed fields
    over it, because the route takes the whole source.
  - `remove(id)` is `deleteSource(id)`.
- **Two named actions**: `stop-fetching` (`available` when `enabled`) and `allow-fetching`
  (`available` when not). Each has a `confirm` that names the chain and calls
  `setSourceEnabled`. Neither has `danger`: both can be taken back with one press.
- `actions`: `create`, `edit`, `delete`.
- `rowStates`: "Fetched" in the good tone, or "Off" in the neutral one.
- `caution`: the key of the caution that the row form draws today.
- `notices`: the line about OpenStreetMap, as a list says a sentence it always says. If a
  constant sentence fits `info` better, put it there and say so.
- `list.columns`: the chain, the adapter, `lastRunAt`, `consecutiveFailures`. `compact`:
  the chain and the adapter.

```ts
record: {
  sections: [
    { title: 'harvest.sources.section.source',
      fields: ['supermarketId', 'adapterKey'] },
    { title: 'harvest.sources.section.speed',
      fields: ['workers', 'maxRequestsPerSecond'] },
    { title: 'harvest.sources.section.may',
      fields: ['enabled', 'autoImportPlaces', 'config'] },
  ],
  facts: { also: ['lastRunAt', 'lastSuccessAt', 'consecutiveFailures'] },
},
```

The routes: `routes.ts` mounts the list with `resourceTabRoute(SOURCES)` at `sources` and
the record with `resourceFormBranch(SOURCES)` beside it, as it mounts the brands.

## 3. Specs

- `sources-page.spec.ts` (760 lines) is rewritten as `sources.spec.ts` over the descriptor
  and its gateway: each field, a create that is refused for a chain with a source, an
  update that sends the whole source, the two actions and which is offered, the delete,
  the title with and with no chain name.
- `setup-page.spec.ts` and `routes.spec.ts`: the Sources tab is the list, and `new` and
  `:id` open the record page.
- `harvest-absent.spec.ts` stays green: with no harvester the tab says what it says today.
- A case in `sources.spec.ts` that the form never sends `enabled`.
- List in the pull request any case of `sources-page.spec.ts` that has no new home.

## 4. The walk

On slots of your own, at 1360 px and at 390 px:

- Setup, Sources: one row for each source, with its state. The count on the header is
  right.
- Open a source: three sections, "May be fetched" as "Yes" or "No" with no control, and
  the Record block with the last run and the failures.
- The More menu: "Stop fetching this chain". It asks and names the chain. After it the
  row says "No", the state says "Off", and the menu offers the other action.
- "Edit": the caution line, the switch for the places, the config box. Break the JSON and
  save: the refusal is under the box. Fix it and save.
- Add a source for a chain that has one: refused under the chain, and the old source is
  as it was. Add one for a chain with none: it opens, reading, with "Source added.".
- Delete a source: it asks, and the app goes to the list.
- At 390 px: the list is cards, the More menu is a sheet, no sideways scroll.

## 5. Decisions made

From the mock, approved on 2026-10-05. The orange note asked: may a switch write at once
while reading, for example to stop a chain from being fetched? The owner took the
recommendation:

- **No. A switch changes with Save like every other field. A change that must be fast is
  a named action in the More menu, with its own question.**

Decisions this plan made, for the owner to confirm:

- **The two switches leave the rows of the Setup list.** Plan `0044` put them there, and
  one press stopped a chain. It is now the row's action, with a question: two presses.
  This is the largest change of habit in the series. If the owner wants one press to stay
  on the list, say so before this plan is built, and the list keeps its switch while the
  record page keeps the rule.
- **"Trusted" is a switch under "Edit"** and not a second action. It is a setting that is
  thought about, and a run does not wait on it.
- **A source is keyed by its chain in the address**, because that is the key every route
  of the harvester takes.

## 6. What this plan deletes

- `feature-harvest/src/lib/sources-page.ts` and `sources-page.spec.ts`.
- The form to add a source and the form inside a row, with their own Save buttons.
- The two row switches and their info buttons.
- The keys of `en.json` that only `SourcesPage` read.
