> **PR:** [#636](https://github.com/IchirokuXVI/nx-portfolio/pull/636)

# 0051 A search accepts an ID

> Needs `0041` to `0047`, all merged, and `0050` (the typeahead is a combobox), which this
> plan is stacked on. Plan `0049` (other defects of the walk) is built beside this one. It
> owns the sign in, the chains panel, the harvest review lists and the rail, and this plan
> changes none of them.

The owner walked the remodel on 2026-10-04 and asked for one rule for the whole back
office. Every search takes text. When the text is the ID of a record, the search selects
that record. When no record of that table has the ID, it says so in plain words. The
app also stops showing a bare ID where a name belongs, and stops asking for one.

## Brief for the agent

### Objective

Give `luna-shopper-admin` one rule, written once: a search that is handed a record ID
reads the one record of its own table that has the ID. Apply it to the typeahead and to
every search box of a list. Then audit the app for a bare ID shown as a name or asked for
in a field, replace the ones this plan can reach, and list the rest. Use the
`nx-portfolio-angular-developer`, `antislop`, `antislop-ui` and `antislop-human` skills.

### Context

- The typeahead of the app is `ReferencePicker`
  (`libs/luna-shopper-admin/ui/src/lib/resource/reference-picker.ts`), a combobox since plan
  `0050`. It reads its options through `ReferenceLookup.search(resource, term, scope)`. The
  app's lookup is `ResourceReferences`
  (`libs/luna-shopper-admin/feature-resource/src/lib/resource-registry.ts`).
- A list is a `ResourceListStore`
  (`libs/luna-shopper-admin/data-access/src/lib/resource/resource-list-store.ts`). The
  generic list page and the hand built Products page both hold one. Its search box is a
  filter of kind `search` on the descriptor.
- Every table the gateway reads one row of is keyed by a uuid. `GET /v1/admin/.../{id}`
  exists for people, zones, lists, shopping lists, chains, shops, products, product groups,
  categories, sections, brands, runs and presets.
- One table a typeahead points at has no such route: price scopes
  (`/v1/admin/catalog/price-scopes/{id}` has `PATCH` and `DELETE` only). The app finds one by
  walking the collection, and the walk stops after ten pages.
- A postal code, a brand key, a kind of source and an EAN are not IDs in the sense of this
  plan. Each is already what its own search matches.
- The app has one locale file: `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Target state

1. **One rule.** `recordIdIn(term)` in `libs/luna-shopper-admin/models` says whether typed
   text is a record ID: a uuid, with the space around it dropped and the case lowered.
   Nothing else in the app decides this.
2. **One read.** `readRecordById(descriptor, gateway, id, within)` in
   `libs/luna-shopper-admin/data-access` is the read behind every search that was handed an
   ID. It uses the resource's own read by ID, so the ID of a shop finds nothing in a search
   of products. It answers the row, or `null` for "no record has this ID".
3. **The typeahead.** A typed or pasted ID is read at once, with no wait. A record that is
   found is selected at once, like a clicked row. The field shows its name and the list
   closes. An ID that no record has leaves the value alone, and the list says
   "No product has this ID." with the noun of the picker's resource.
4. **A list.** An ID in the search box of a list shows exactly that record, as the one row
   of the list. The user stays on the list. An ID that no record has shows
   "No product has this ID." in place of the empty state, with the button that clears the
   filter.
5. **Same table only.** The ID is looked up on the resource the search is on. Under a
   parent (the shops of one chain, a typeahead over one chain's shops), a record of another
   parent is not found.
6. **A failure is not "not found".** A read that fails for another reason shows the
   failure the list or the typeahead already shows. It never says that the record is
   missing.
7. **The app avoids bare IDs.** Section 4 lists every place found. The ones this plan
   builds show a name, with the ID small, in the mono face and copyable.
8. **A guard.** A spec fails when a descriptor asks for an ID in a plain field, draws a
   column of bare IDs, or filters by an ID through a search box.

### Scope

- In: `libs/luna-shopper-admin/models/src/lib/resource/record-id.ts` (new) and the
  descriptor and gateway types beside it,
  `libs/luna-shopper-admin/data-access/src/lib/resource/read-record-by-id.ts` (new) and
  `resource-list-store.ts`, `libs/luna-shopper-admin/ui/src/lib/resource/**`,
  `ui/src/lib/catalog/scope-picker.ts`, `feature-resource` (`resource-registry.ts`,
  `resource-list-page.ts`), the Products page, the Categories page, the product group page
  and the product list gateway in `feature-catalog`, the pages of a person, a zone and a
  shopping list in `feature-people`, `en.json`, and one new spec in
  `apps/luna-shopper-admin/src/app`.
- Out: the gateway, `openapi.json`, `wire-types.ts`, the generic record page and form
  (they are being drawn again in a mock), and everything plan `0049` names.

### Constraints

- The rule is one function. No component tests a term against a pattern of its own.
- No gateway route changes. A table with no read by ID is left out and named.
- A value of the typeahead still changes only through a choice. A found ID is a choice. An
  ID that is not found changes nothing.
- An answer for text the field no longer holds is dropped, as plan `0050` drops a stale
  search. While the list is open, Enter never submits the form.
- No text is written in a template. Every new text is a key in `en.json`.
- Under counting is the safe side. Where the app cannot prove that a record is missing, it
  does not say so.

### Action boundaries

- Do not change a gateway route, `openapi.json` or `wire-types.ts`.
- Do not start, stop or migrate Luna slot 0, 1 or 3. For a walk that only reads, a front
  end slot is allowed to point at the backend of slot 0. Save nothing through it.
- Do not redesign the generic record page or form.
- Do not build plan `0049`.

### Progress evidence

- `npx nx test` and `npx nx lint` are green for `luna-shopper-admin/models`,
  `luna-shopper-admin/data-access`, `luna-shopper-admin/ui`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-people`, `luna-shopper-admin/feature-harvest`,
  `luna-shopper-admin/feature-brands` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green. The pull request checks never build this app.
- A browser walk at 1280 px and at 390 px: a real ID and a wrong ID in a typeahead, in the
  Products list, in one screen of the harvester and in one list of people.

## 1. Not in this plan

- A read by ID for price scopes. It needs a gateway route (section 5).
- A search box for a list that has none (section 3).
- The generic record page and form. They are being drawn again.
- An ID in the address bar. A record page already opens from its ID in the address.

## 2. The rule, for the next agent

**A search takes text. Text that is a record ID is that record, on the table the search is
over, or a sentence that says no record of that table has it.**

How to keep it:

- Ask `recordIdIn` (or `recordIdFor(descriptor, term)`, which also knows a table with no
  read by ID). Do not write a second pattern.
- Read with `readRecordById`. It is what makes "not found" mean one thing: a 404, a 400 on
  the ID itself, or a row outside what the screen fixed.
- A new list built on `ResourceListStore` has the rule already. Draw `store.idNotFound()`
  before `store.noMatch()`.
- A new typeahead is a `ReferencePicker`. It has the rule already.
- A search over rows that are already in memory compares `row.id` with the ID. Only when
  every row is in memory does it say "not found".
- A descriptor whose table has no read by ID says `readById: false`. A typed ID is then
  text there.

**The app shows a name, and an ID only beside it.**

- A field that holds the ID of another record is a `reference` or a `references` field.
  Never a `text` field.
- A descriptor's `title` never answers the ID. A row with no name gets the next thing that
  tells two rows apart: a date, a kind, a brand.
- Where the ID itself is worth reading, on the page of the record, draw it with
  `lib-record-id`: small, mono, muted, with a Copy button.
- `apps/luna-shopper-admin/src/app/no-typed-record-id.spec.ts` holds the three checks that
  are cheap to hold.

## 3. Every search input of the app

| Search | What it searches | After this plan |
| --- | --- | --- |
| `ReferencePicker`: every `reference` field of a form, every `reference` filter of a list, the chips of `ReferencesControl`, and the fourteen direct uses in `feature-brands`, `feature-catalog` and `feature-harvest` | chains, shops, products, product groups, categories, brands, people, zones, lists | An ID selects its record at once. A missing ID says "No chain has this ID." and selects nothing. Read on the picker's own resource and inside its scope. |
| The same picker over price scopes (run form, import upload, places queue, a shop's scopes, a chain's default scope, the price scope filter of shops) | price scopes | **Left out.** No read by ID exists (section 5). A typed ID is text, as before. |
| The search box of the generic list (`ResourceFilters`, kind `search`): chains, shops of a chain, sections of a chain, product groups, brands, people (username, and email) | the list's own table | An ID shows that one row. A missing ID shows "No shop has this ID." and the button that clears the filter. Under a chain, a shop of another chain is not found. |
| The search box of Products | products | The same, from the same store. With "Prices at" chosen, the row found by ID carries its price at that scope. |
| The search box of postal codes | postal codes | Unchanged. The table is keyed by the postal code, and that is what the box matches. |
| Categories (the tree) | categories, all in memory | An ID shows that category, under its parent. A missing ID says "No category has this ID." |
| A product group, "Add items" | products | An ID shows that product as the one row to tick. A missing ID says "No product has this ID." |
| The scope picker's "Find a scope" | the price scopes it holds | An ID narrows to the scope with that ID among the scopes held. It never says the ID is missing, because the picker can hold a shortened list. |
| Brand suggestions | suggestions | **Left out.** A suggestion is a spelling waiting to be registered. It has a key and no ID. |
| The brand box of the products queue of the harvester | queue rows, by the brand they carry | **Left out.** It narrows the queue by a brand name. It is no search for a queue row, and the queue is plan `0049`'s. |
| The search of the import preview | the rows of a file not yet uploaded | **Left out.** Those rows are no records. |

Lists with no search box at all: zones, lists, the lines of a list, the members of a zone,
shopping lists, price scopes, prices, the products of a shop, runs, and the three review
queues. There is nowhere to type an ID. Section 6 asks the owner about them.

## 4. Bare IDs: what was found, and what changed

No screen asks for a typed ID today. Every field that holds the ID of another record is
already a typeahead or a select. The guard keeps it so.

### Changed here

| Place | It showed | It shows now |
| --- | --- | --- |
| Shopping lists of a person or a zone, the name of each row | the uuid, for every list without a name, which is most of them | the day the list was made, `2026-09-30` |
| The page of a shopping list, the heading | the uuid | "List of Sep 30, 2026" |
| The page of a product, the heading, for a product with no name in any language | the uuid | "Product with no name". The brand and the size stay under it. |
| A member of a zone, the form, the field "Person" | the uuid of the person | the username |
| The Details of a person, of a zone and of a shopping list, the line "Identifier" | the uuid in the mono face | the uuid small, mono, muted, with a Copy button (`lib-record-id`) |

### Left out, with the reason

| Place | It shows | Why it stays |
| --- | --- | --- |
| The generic form, every read only `reference` field with no name on the row (who created a list, who created a line) | a uuid | The generic record page is being drawn again. The fix is there: resolve the name as the list does. |
| The generic form, the line "Identifier" of every resource | the uuid as plain text | The same page. `lib-record-id` is the control for it. |
| A run, the fact "Reverted by", and the hover text of a reverted run in the list | the uuid of an admin | No descriptor reads one admin by ID. It needs a read. |
| The decisions file panel of the products queue | the uuid of an entry before its name, and a column of target uuids | The harvest review lists are plan `0049`'s. The names are in the file, so the order can be swapped there. |
| The products queue, "The row it points at (…) is not in this queue" | the uuid of an entry | No route reads one entry. |
| A shopping list, "by participant …" | the ID of a participant | The view carries no name for a participant. It needs a gateway read. |
| A zone, the owner, when the owner's account has no name | the uuid of the owner | Backend plan `0074`, section 3, chose it: the listing still succeeds and the ID is what is true. The owner decides (section 6). |
| A name that is still being read, or whose record is gone (chain, product group, product, scope and shop names in the harvester and the product pages) | the uuid, until the name lands | An empty cell says less than the ID. The owner decides (section 6). |
| The rows of a shop's products and of prices, when the product has no name | the uuid of the product | Those rows carry nothing else that names the product. |
| The run form, a scope that no longer exists | the uuid, with a button that removes it | The ID is all that is left of it. |
| The import upload, "the file names …, which this deployment does not have" | a uuid from another deployment | There is no record here to name. |
| A typeahead whose value points at a deleted record, "This points at …" | the uuid | The same reason. |

A provider reference of a place, the chain's own code of a shop or a product, a brand key,
an EAN and a correlation identifier are not record IDs of this app. They stay.

## 5. Price scopes have no read by ID

`GET /v1/admin/catalog/price-scopes/{id}` does not exist. The app finds one scope by
reading the collection page after page, and stops after ten pages. One chain holds about
1,675 shop scopes, so that walk can end before it reaches the scope. "No price scope has
this ID" is then a guess.

So the descriptor of price scopes says `readById: false`, and a typed ID is text in every
typeahead over price scopes. This plan changes no gateway route. The fix is one read route
in the backend, with its own plan. When it exists, delete `readById: false` and the
typeaheads take an ID with no other change.

## 6. Decisions made here, for the owner to confirm

- **A found ID is selected at once.** The owner said "automatically selects". The other
  choice was to show the record as the single option and wait for Enter. A whole pasted
  uuid is no slip of the hand, so the rule of plan `0050` holds: a value changes only
  through a choice, and this is one.
- **A list narrows to the one row. It does not jump to the record's page.** The user stays
  where the search was, sees the row among its columns, and opens it with one click. A
  jump also makes a mistyped paste leave the list.
- **An ID sets the other filters of the list aside.** A category, a group or an order
  chosen before does not hide the record. Without this rule, a record that exists is reported as missing.
  The filters keep their values. When the box holds words again, they count again. The parent of
  the list (the chain of the shops) is not set aside.
- **A 400 on the read counts as "not found".** The route refused the ID itself, so no
  record can have it. Every other failure is shown as a failure.
- **A shopping list with no name is called by its day.** The list row shows the day as the
  calendar writes it, because a descriptor's title cannot translate. The page shows it in
  words.
- **Lists with no search box got none.** Zones, lists, shopping lists, runs and the review
  queues have no text search in the gateway. A box that takes only an ID is possible in the
  app alone, for zones, lists and shopping lists, which have a read by ID. Say so if it is
  wanted.
- **The ID shown while a name is read.** Section 4 leaves it. A quiet "…" until the name
  lands, and the ID only for a record that is gone, is a small change in each name cache.
- **Plan `0050` named `_read` of the picker as the only method this plan changes.** It
  changes `_search` and `onType` too, to select the found record and to read an ID with no
  wait. The read itself moved into the lookup, which knows the descriptor and the scope.

## 7. What the walk found

Walked on 2026-10-05 at 1280 px and at 390 px, on a front end slot of this worktree that
pointed at the backend of slot 0. The walk only read: the script counted the requests that
were not `GET`, and there were none.

- **Products.** A real ID, pasted in upper case with spaces around it, shows one row. A
  wrong ID shows "No product has this ID." and "Clear the filter".
- **A typeahead.** The Product group filter of Products: a wrong ID says "No product group
  has this ID." under the field, and a real ID fills the field with "Adhesive Tape" and
  closes the list.
- **The harvester.** The chain of a new run: a wrong ID says "No chain has this ID.", and
  a real ID fills the field with "Deza". The harvester has no list with a search box over
  records, so this is the typeahead of one of its screens.
- **People.** A real ID shows one person. A wrong ID says "No person has this ID." The ID
  of a product finds no person.
- **Categories.** A wrong ID says "No category has this ID."
- **The page of a person.** The identifier is small, with a Copy button.
- **No horizontal scroll** on any of these at either width.
- **The console** logs one 404 line for each wrong ID. That is the browser reporting the
  read that answered "no such record". No other error.
- **Not walked.** A typeahead over one chain's shops with the ID of another chain's shop,
  the shops of a chain, the "Add items" search of a product group, the scope picker, the
  page of a shopping list and of a zone, and the Copy button being pressed (the clipboard
  needs a permission the walk did not grant). Their specs pass. No screen reader was run.

## 8. What this plan adds

- `recordIdIn`, `recordIdFor`, `searchedRecordId` and `rowWithin` in `models`, and
  `readById` on a descriptor.
- `readRecordById` in `data-access`, and `searchedId` and `idNotFound` on the list store.
- An optional second argument of `ResourceGateway.read`: what the list around the read
  shows. Only the product list reads it, to add the price at the chosen scope.
- An optional `nounOf` on `ReferenceLookup`, for the noun of "No product has this ID."
- `lib-record-id` in `ui`.
- The keys `resource.id.notFound`, `resource.id.notFoundHere`, `resource.id.copy`,
  `catalog.products.unnamed` and `people.baskets.unnamed`.
