# 0047: the line screens finish what they started

> Plan `0043` built two screens, the line detail sheet and the line page, and left seven
> things on them unfinished. One of the seven is a defect that only looks like working
> software because the development fixtures and the production catalog happen to share
> product ids: **against a real catalog, every line that carries products says it carries
> none.**
>
> The rest are smaller, and they have a shape in common. Each is a piece of plumbing that
> was laid and never connected: a parameter accepted and never passed, a field modelled and
> never drawn, a translation key written and never read, a flag hardcoded to the value that
> makes the control disappear. None of them fails loudly. All of them make the screen quietly
> less than `0043` describes.

## 1. Product names come from a fixture, in production

`line-detail-sheet.ts:130` and `line-page.ts:129` both build their view model with
`itemNameOf: (itemId) => catalogItemById(itemId)`. `catalogItemById` is exported from
`catalog-memory.ts`, and it closes over `ITEMS`, which is `[...MILK, ...BREAD, ...OIL]`, a
hand written fixture of a few Spanish products.

Against a real catalog every id misses. `catalogItemById` returns `null`, the templates take
their empty branch, and both screens render `list.page.noProducts`, "No products yet", for a
line that demonstrably carries products. The user is told the opposite of the truth about
their own data, on the two screens whose entire purpose is to show it.

This reads as working because the in memory dev fixtures use exactly those ids, so every
screenshot and every manual pass through the app in development is a pass. It is the failure
mode the repo's D4 rule exists to prevent, arriving from the other direction: not a backend
DTO trusted too far, but a fixture trusted as though it were one.

### 1.1 Why a batch read rather than the route that exists

`GET /v1/catalog/items/:id` exists on the gateway and is account authenticated, which is all
these two screens are. It is the wrong shape anyway: a line carries a **set** of products
(backend `0048`'s `itemSetHash` is a hash of that set), so resolving a line's names through it
is one request per product, fired from a sheet that opens on a tap.

`ITEM_PATTERNS.getMany` already exists in `libs/luna-shopper/contracts` and is already
consumed, by exactly one caller: `generated-list-sharing.controller.ts:334`, added by velista
`0044` so a guest with no account could read the names in a basket. There is no general HTTP
route in front of it. Adding one is backend `0053` section 1, and this plan consumes it.

### 1.2 What changes here

`CatalogServiceI` gains a second method beside `suggest`. It takes item ids and answers their
names, and like `suggest` it **fails soft**: a name lookup that does not answer must never be
able to stop a sheet opening. The difference is what a failure draws. `suggest` failing draws
an empty dropdown, which is honest. This failing must **not** draw "No products yet", because
that is a claim about the line rather than about the request. It draws the product count with
no names, and says the names could not be loaded.

`catalogItemById` and the `MILK`/`BREAD`/`OIL` fixture stay where they are, in
`catalog-memory.ts`, reachable by `CatalogMemory` and by specs. Nothing outside
`data-access/catalog` imports them again. That is the actual rule this defect broke, and it is
worth stating as a rule rather than as a fix: **a `*Memory` module is imported by its own
token binding and by specs, never by a feature library.** A feature library that needs a value
asks the service interface for it.

## 2. The line page cannot add a product

`0043` section 5.3 asks the line page to list the line's products, remove one by its chip, and
**add one through the same search the composer uses**. The page does the first two. For the
third it draws a static "Add a product" chip that is not a control and does nothing, and a
line with no products draws only that.

The in code note says the dropdown lives on the list page deliberately. That is a defensible
position about where a search belongs, but it is not what the plan asks for, and as shipped it
is neither: the affordance is drawn, so the screen promises the gesture, and then declines it.
Either the chip is a control or it should not be drawn.

**It becomes a control**, reusing the composer's suggestion component rather than a second
one. A line reached from the line page is frequently a line somebody is correcting, and
sending them back to the list page's composer to add a product to a line they are already
looking at is the long way round.

## 3. Suggestions ignore where you shop

`0043` section 6 states the rule plainly, and `catalog-service.ts` restates it in the doc
comment on `suggest`: **the scope is where you shop.** `profileId` narrows the search to the
chains a profile actually visits, so a product from a shop the user never enters is not
offered.

`CatalogApi.suggest` accepts `profileId` and forwards it. The list page never passes one. So
the rule is documented in two places, implemented in the transport, and unenforced in the only
caller, which is the worst of the three states to be in: a reader of either document concludes
it works.

The composer passes the active profile's id, from the same store the profiles page writes
(`shopping-profile-store.ts`). With no profile resolved it passes nothing, which is the
documented honest behaviour for somebody who has set no profile up, and is unchanged.

## 4. The histories cannot be paged

`select-line-page.ts:71` and `:87` both set `hasMore: false` as a literal, on both the line
history and the item history. `HistorySectionVm.hasMore` is modelled, the store fetches one
page of twenty, and `list.page.more` ("Show more") exists in both locales and is read by
nothing.

The whole control is present except the two values that would make it appear. Wire `hasMore`
from the page the store actually holds, and give the sections a "show more" that appends.

Two details, because a history is not a list of things somebody scans idly. It is the answer
to "how often do we actually need this", so:

- **Appending, never replacing.** A second page joins the first. A history that redrew from
  page two would lose the recent rows, which are the ones the question is about.
- **The item history's filter is applied per page**, not once. Backend `0047`'s rule is that
  the cross list item history is filtered by the caller's read access **at request time**, so
  page two is filtered against access as it is when page two is asked for, not as it was when
  page one was.

## 5. Three things modelled and not drawn

- **`LineDetailVm.indicators` is passed `[]`.** The field exists so the sheet's header can
  agree with the row it opened from (`0043` section 5.1): a row showing "bought" that opens a
  sheet showing nothing is two answers to one question. It is dead today. The sheet passes the
  row's indicators through.
- **`list.detail.rateRough` ("every few weeks") is written and unread.** `0043` section 9 and
  backend `0047` section 9 both leave the hedge as a leaning rather than a decision: between
  three and six settlements, does the estimate give a number or a phrase? **Decide it here, in
  favour of the phrase.** A median computed from three intervals is a number with no business
  being one, and the copy already exists. Above six it gives the number.
- **`alsoOn` under reports and does not say so.** It is computed from whatever lists this
  session happens to have loaded, not from a query, because no endpoint answers "which other
  lists hold this item". It draws nothing when empty, which reads as "this is on no other
  list" when the truth is "nobody asked". Backend `0053` section 3 adds the query; until it
  lands, `alsoOn` is drawn only when the answer is known to be complete, and omitted (not
  drawn empty) when it is not.

## 6. Localization

No new key is needed for section 4 or section 5; `list.page.more` and `list.detail.rateRough`
both exist in `en.json` and `es.json` and are simply read. Section 1.2's failure line is new,
in both locales: it says the names could not be loaded, and it never says the line is empty.
Section 2 reuses the composer's existing search strings rather than a second set.

## 7. What is tested

`0043` left the two most testable things it built untested. `select-line-detail.ts` and
`select-line-page.ts` are pure functions, written that way deliberately, and neither has a
spec file. Between them they hold the median interval estimate, the three purchase floor, and
the "preselect the last product bought, filtered against the line's current set" rule, which
is the one most likely to break silently when a product leaves a line.

- Specs for both selectors, covering: the three purchase floor; the phrase between three and
  six and the number above; the preselect rule including a last bought product no longer on
  the line; `hasMore` from a full page and from a short one; the item history absent when the
  line has no item.
- Component specs for `LineDetailSheet` and `LinePage`: names drawn from the service, the
  failure line drawn instead of "No products yet" when the lookup fails, the add control
  present and adding, indicators drawn on the header.
- A spec asserting no feature library imports `catalog-memory`. This is a rule with one past
  violation and no natural enforcement, which is what makes it worth a test rather than a
  sentence.

## 8. Acceptance criteria

- A line carrying products shows their names on both the detail sheet and the line page,
  against a real catalog, with one request for the set rather than one per product.
- A name lookup that fails says so, and never says the line has no products.
- No feature library imports anything from `catalog-memory`.
- The line page adds a product through the composer's search, and the empty state's chip is a
  control rather than a decoration.
- Suggestions are scoped to the active profile, and are unscoped only when no profile resolves.
- Both histories page on demand, appending, with the item history refiltered per page.
- The detail sheet's header shows the same indicators as the row it opened from.
- An estimate from three to six purchases reads as a phrase; above six it gives a number.
- `alsoOn` is drawn when it is complete and omitted when it is not, and never drawn empty.

## 9. Out of scope

- **Prices and where to buy.** Unchanged from `0043` section 9: the region is drawn and stays
  empty until backend backlog `0004`.
- **The claim indicator** ("Ana is buying this"). It has no publisher, which is backend `0052`.
- **The basket's own screens.** `0048` and `0049`.
