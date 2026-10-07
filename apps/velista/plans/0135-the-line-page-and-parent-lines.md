# 0135: the line page and parent lines

> Asked for by the owner on 2026-10-07 and 2026-10-08. The line page shows a product as a
> name and nothing else, it does not draw the number on the list, and its two buy
> histories take most of its height. The owner also wants a line that holds other lines
> ("Las cosas del baño" is five lines), so that one number on the list moves all of them.
>
> **The mock is the design, and the owner chose it.** It is
> `apps/velista/plans/mocks/line-and-parent-lines/`, published at
> https://claude.ai/artifact/H73itc6D9Aa2nedUyhSKeP. Four layouts of the line page and
> three ways to add a line under a parent were drawn. The owner picked the product cards,
> the history and comments as rows, the card of lines, and a full page for adding. Do not
> bring the others back.
>
> **Stage 2 needs a backend plan that does not exist yet.** Section 12 states what that
> plan has to serve. Stage 1 needs nothing new from the backend. If the backend contract
> is not on your base branch, build stage 1, say plainly that stage 2 is left out, and
> stop.
>
> Prerequisite reading: velista `0043` (the line is a quantity), `0047`, `0065` and `0066`
> (the products of a line), `0083` (the line sheet edits the line), `0101` (the suggestion
> card), `0115` (similar products), `0117` (one field finds and adds), `0130` (one
> header), `0132` (what the shopping list costs), `0134` (the product page, and its sheet
> of lists), `libs/velista/feature-lists/src/lib/line-page/`, `list-page/`,
> `line-detail-sheet/`, `libs/velista/ui/src/lib/list/`,
> `libs/velista/feature-shell/src/lib/routes.ts`,
> `libs/velista/data-access/src/lib/lines/line-service.ts` and `line-store.ts`.

## Brief for the agent

### Objective

Rebuild the line page around the products of the line, move the buy history to a page of
its own, and (stage 2) let a line be a parent that holds other lines, with the page that
adds lines under it.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills. Read the velista UI rules in `CLAUDE.md` before
you touch a template.

### Context

Every statement below was read on `dev` at `b0ae5d95`.

- **The line page is `LinePage`** at `zones/:zoneId/lists/:listId/lines/:lineId`
  (`routes.ts`, declared before the list page). Its children are one sheet,
  `confirm/delete`, and the product sheet routes.
- **A row tap does not open the line page.** `ListPage.openLine` opens the sheet
  `lines/:lineId/detail` (`LineDetailSheet`). The only way to the page is the button in
  that sheet, `LineDetailSheet.openPage()`.
- **A product on the page is a chip with a name.** `LineProductChipVm` carries the brand
  and the template does not draw it. No price, no picture, no shop.
- **The page does not draw the number.** `LinePageVm` carries `quantity` and the template
  never reads it.
- **Two histories fill the page**: "On this list" from `LineStore.loadSettlements` and
  "Everywhere you shop" from `loadItemSettlements`, each a card that grows page by page.
  A row says who, how many, the price and the date. It does not name the product, though
  `LineSettlement.itemId` holds it.
- **Rename lives in the detail sheet.** `LineDetailSheet.save()` calls
  `LineStore.updateLine(lineId, { content })`. A refusal with `line_merge_required`
  draws the merge question. `LinePage` has no rename.
- **The number changes two ways.** The reel sends a signed delta
  (`LineStore.addQuantity`, `POST /v1/lines/:id/quantity`) and needs `DECIDE`. The sheet
  sends an absolute value through `updateLine`.
- **"Also on" matches any one product.** `LineServiceI.listsHoldingItem` is called once
  for each item id (`GET /v1/items/:id/lists`). The answer names a list and a group. It
  carries no line id and no line name, and it is capped at 20 lists.
- **Nothing copies a line to another list.** `line-merge.service.ts` says "a line never
  moves between lists". No route lists the lists of every group in one call. Plan `0134`
  section 4.3 plans `GET /v1/zones` plus one `GET /v1/zones/:zoneId/lists` for each
  group.
- **A line has no parent.** `Line` (`libs/velista/models/src/lib/domain.ts`), `LineView`
  (`libs/luna-shopper/contracts`) and `list_lines` have no parent field and no amount.
- **An add merges.** `LineService.add` raises an existing line when the name and the
  product identity match (`lineIdentities` in `core/src/app/lists/line-content.ts`) and
  answers `merged: true`. `LineApi.addLine` drops `merged`.
- **The order of a list is one `position`** for each line. `POST
  /v1/lists/:id/lines/reorder` renumbers only the lines it is given, from 1.
- **The field of the list is reusable.** `LineComposer` and `SuggestionList` in
  `libs/velista/ui/src/lib/list/` are presentational. The glue is in `ListPage`: the
  suggest effect (`CatalogServiceI.suggest`, three characters, 200 ms), the search of the
  held lines (`ListViewStore.search`), and `add`.
- **The reorder controls are reusable.** `LineList`, `LineRow` and `reorderWithinSlots`
  take any rows. The mode itself is a signal in `ListPage`.
- **No bulk settle exists.** `POST /v1/lines/:id/settle` takes one line.
- **Strings** are in `libs/velista/ui/assets/i18n/en.json` and `es.json`, under
  `list.page`, `list.line` and `list.detail`.
- **The UI word for a zone is "group".**

One fact was true on 2026-09-25 and was not read again: the line page was blank on a
cold load of its own URL, because it read the lines that the list page had loaded. Check
it first. Section 4 depends on the answer.

### Target state

Stage 1, with no backend change:

1. The line page has the header with a menu, the place and the number, the products as
   cards, and two rows for the buy history and the comments (sections 2 and 3).
2. The buy history is a page, `lines/:lineId/history` (section 5).
3. The menu renames and deletes (section 6).
4. The page loads on a cold arrival at its own URL (section 4).

Stage 2, after the backend plan of section 12:

5. A line can be a parent. Its page shows the card of its lines, their amounts, its cost
   and its order (section 7).
6. Lines go under a parent on the page `lines/:lineId/add` (section 8).
7. The list draws a parent with its lines under it (section 9).
8. A line shows its parent, the lists that hold the same line, and "Add to another list"
   (section 10).
9. Deleting a parent asks about its lines (section 6).

### Scope

- `libs/velista/models`: the view of the product cards, the view of the history page, the
  parent fields of `Line`, the view of a parent and of its lines, the arithmetic of
  section 7.2, the view of the add page, the grouping of rows under a parent. Each one is
  a pure function with its own spec.
- `libs/velista/data-access`: the parent fields in the mapper, the reads and writes of
  section 12 behind `LineServiceI`, their in memory doubles, and what `LineStore` has to
  hold for a parent.
- `libs/velista/ui`: the product card rail, the link rows, the card of lines, the amount
  control, the cost figures, the pick rows of the add page, the nested rows of the list.
- `libs/velista/feature-lists`: the line page, the history page, the products page, the
  add page, the menu, rename, copy and info sheets, the delete sheet, and the detail
  sheet of a parent.
- `libs/velista/feature-shell`: the routes of section 11.
- `libs/shared/ui`: any icon that does not exist yet (look first: the three dots, the
  info mark, the grip).
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **The mock decides the look.** Copy the spacing, the sizes and the words from the
  artboards. Where the mock and this text disagree, stop and ask.
- **No tinted containers and no new colour role.** Every artboard uses the tokens that
  exist. The warning sentence of the add page is plain secondary text.
- **Model every answer.** No backend DTO reaches a template (rule D4). Map from
  `unknown`.
- **Component styles use tokens.** `token-hygiene.spec.ts` rejects raw pixels other than
  `0px` and `1px`. Add a semantic token for a size that has none.
- **Sizes use `svh`.** The add page has to keep its bar above the keyboard, and `dvh` is
  refused by a spec.
- **A page path holds no `sheet` segment, and a sheet is declared with `sheet()`.**
- **Every back control names a fallback**: `PageNavigation.back(url)` on a page,
  `SheetNavigation.dismiss(url)` on a sheet.
- **Dates use `Intl.DateTimeFormat`.** The month headings of the history page too.
- **No `@angular/core/rxjs-interop` in a service.**
- **Copy is for people not at home with apps.** Short sentences, ordinary words. The
  word "parent" never appears in the app. The app says "Lines under Bathroom things".
- **The amount arithmetic lives on the server.** The app computes a number only to show
  what will happen. It never writes a number that the server did not answer.

### Action boundaries

- Do not change the backend, the contracts or `openapi.json`. That is the backend plan.
- Do not change what a row tap on the list opens. It opens the detail sheet for every
  line, a parent too. The owner decided it.
- Do not build the product page. Plan `0134` builds it. A product card opens whatever a
  product opens on your base branch.
- Do not remove `LineDetailSheet`. It keeps its settle actions.

### Progress evidence

- `npx nx build velista` and `npx nx run-many -t lint test -p velista-models
  velista-data-access velista-ui velista-feature-lists velista-feature-shell` pass. Check
  the real project names with `npx nx show projects` first.
- A browser walk through the shell on a slot, in English and Spanish, at 390 pixels wide:
  a line with three products, a line with none, the history page with both scopes, a
  rename, a cold load of the line page URL. For stage 2: a parent raised from 0 to 2, a
  line lowered until the parent drops, lines added from the list and from the catalog
  with the keyboard up, a delete with the checkbox on and off.
- Screenshots of each walk beside the matching artboard.

## 1. What the owner decided

| Subject | Decision |
| --- | --- |
| Products on the line | Cards that scroll sideways: picture, name, size and brand, lowest price, its chain, price for each kilo or litre. The cheapest is marked |
| Buy history | Leaves the page. One row opens a page of its own |
| Comments | One row on the page |
| Rename | In the three dots |
| Number on the list | On the page, as a stepper |
| A parent | Holds lines only. No products and no group |
| The link | The line under a parent stores it. A line has at most one parent |
| The amount | Each line under a parent has the amount needed for 1 of the parent |
| Raising and lowering | The parent adds or takes away each amount. A line never goes below 0 |
| A line changed alone | Allowed. The parent drops when a line no longer holds enough, and rises when every line holds enough for one more |
| Buying a parent | Buys every line under it. Nothing is recorded for the parent itself |
| Deleting a parent | A checkbox, off by default, asks whether to delete its lines too |
| Taking a line out | The line keeps its number |
| Adding a line that exists | The line keeps its number. The parent drops when the line does not hold enough |
| Adding a new line | The line gets what the parent needs |
| The same thing under two parents | Two lines, each with its own parent and its own number. The owner accepts this for now and does not like it much |
| Merging | Two lines merge only when their parent is the same too |
| Adding lines | A full page, because of the keyboard. It searches the list and the catalog |
| "Also on" | Lists that hold a line with exactly the same products, whatever its name. For a parent, exactly the same lines |
| "Add to another list" | A line, also a parent with all its lines, is copied to other lists |
| The number of a parent | Always the largest number that every line under it can cover (section 7.2). Confirmed on 2026-10-08 |
| How much a buy of a parent buys | The whole number of each line under it, also what was added to a line by hand |
| A row tap on the list | Opens the detail sheet for every line, a parent too. The sheet has the buy button, the stepper and the name |
| The basket | Lines under parents merge across lists like any lines. The parents merge too: the merged parent holds every line of both, and equal lines add their numbers |
| Extras | The cost of a parent, the order of its lines. A parent is always open when the list loads, and a close is not remembered |

## 2. The line page of a line with products

Artboard `Main.dc.html`. Top to bottom:

1. **The header** (`PageHeader`, plan `0130`): back, the name of the line, and one
   action, the three dots. The dots open the menu sheet (section 6).
2. **The place and the number.** On the left "On {list}, in {group}" and under it "Added
   by {who}". On the right a stepper: minus, the number, plus. Each press is one
   `LineStore.addQuantity(lineId, ±1)`. A reader without `DECIDE` sees the number with no
   buttons. Minus is disabled at 0.
3. **The parent row** (stage 2, section 10). Absent in stage 1.
4. **"Any of these will do"**, with "Change" on the right. The link reads "Add a
   product" while the line has none. Section 3.
5. **Two rows**: "Buy history" with the count of purchases, and "Comments" with the
   count. The first opens the history page. The second opens the comments sheet over the
   line page.
6. **"Also on"** and "Add to another list". In stage 1 this section keeps the answer and
   the heading it has today, drawn as rows and not as chips. Stage 2 changes what it
   means (section 10).

Gone from the page: the two tiles (rate and last bought), both history cards, the dashed
"prices" box and the Delete button at the foot. The rate and the last purchase are on
the history page. Delete is in the menu.

A line with no products shows the heading, one sentence ("No products yet. Any brand
will do."), and "Add a product". It has no empty card.

## 3. The product cards

- One card for each product of the line, in a row that scrolls sideways. A card is 156
  wide, so a third card is cut by the edge and shows that the row scrolls.
- A card holds: the picture (`CatalogItem.imageUrl`, or the carton glyph on the sunken
  tile), the name on two lines at most, "size · brand" from `productDetailText`, the
  lowest price near the person, and one caption with the chain and the unit price.
- The card with the lowest price takes the word CHEAPEST. Compare the unit price first
  and the price second, as `catalog.similar` does. With one product, no card takes it.
- A product with no price near the person says "no price" where the price is. It never
  takes the word.
- A press opens the product (the sheet today, the page after plan `0134`).
- **Prices come from the read the product sheet uses** (`ProductShopPrice`). Ask for the
  cards on screen and the next two, not for all hundred. Cache by item and profile.
- **Editing is a page**, `lines/:lineId/products`, artboard `Products.dc.html`. "Change"
  opens it. It is a page and not a sheet because of the keyboard, the same reason as the
  add page of section 8. The cards carry no buttons.
- The page has one field, "Search the catalog to add a product", which is not focused on
  arrival, so the products are in sight first. Under it are the products of the line,
  each with its cross. A product that the catalog put there also has "Keep" (plan
  `0065`).
- Typing replaces the list with catalog results, drawn like the catalog rows of the add
  page, each with "Add". This is the search that the page has today (`startAdding`),
  moved here. The refusal of a full line (`productsFull`) is one sentence under the
  field.
- The clusters of plan `0065` ("From {group}", "Added by you") are the two headings of
  that page. The rail does not split.
- The counter `count/cap` is drawn only from 90 products up.

## 4. Loading the page

The page has to draw on a cold arrival: a shared link, a reload, the history page going
back. Make `LinePage` call `LineStore.load(listId)` when the list is not held, and draw
a skeleton of the header, the number and two cards while it waits. An unknown line id
draws the not found state that the list page uses.

## 5. The history page

Artboard `History.dc.html`. Route `lines/:lineId/history`, a page, title "Buy history".

- Under the header: "{line}, on {list}".
- **Two scopes** as a segmented control: "This list" and "Everywhere you shop". The
  second is absent for a line with no products, as today.
- **Three figures**: how many times, how often ("every 9 days", from the estimate that
  the tiles used, absent under three purchases), and what was last paid for one.
- **One card for each month**, newest first. The heading is the month from `Intl`, with
  the year when it is not this year.
- **A row**: the day, "{who} bought {n}" or "{who} found none" in the danger text, and
  under it the product that was bought ("name · brand"), from `LineSettlement.itemId`
  through the names the page already reads. A row with no product has one line. The
  price is on the right. A reverted row keeps the treatment it has today.
- "Show older" appends a page of the scope on screen.
- Empty: one sentence. Loading: three skeleton rows.

Move the code of both history sections out of `LinePage`. Do not keep two copies.

## 6. The menu, rename and delete

Artboards `Menu.dc.html` and `Delete.dc.html`.

- **The menu** is a sheet over the line page with a title (the name) and rows: "Change
  the name", "Add to another list" (stage 2), "Take it out of {parent}" (stage 2, only
  under a parent), and "Delete this line" in the danger text. A row the reader may not
  use is absent, not disabled.
- **Change the name** opens a sheet with one field (`initialFocus="first"`, the one case
  the rules allow) and Save. It calls `LineStore.updateLine(lineId, { content })` and
  keeps the merge question of plan `0083`. Lift that logic out of `LineDetailSheet` so
  both use one piece.
- **Delete** opens the existing `DeleteLineSheet`. For a parent (stage 2) the sheet
  gains one sentence, "Its 5 lines stay on {list}, with the numbers they have now.", and
  one checkbox, "Delete its 5 lines too", off when the sheet opens. The sentence changes
  to "Its 5 lines are deleted too." while the box is on.

## 7. A parent line (stage 2)

Artboards `Parent.dc.html`, `ParentReorder.dc.html` and `Info.dc.html`.

### 7.1 The page

A line is a parent when at least one line names it. Its page has the same header, place
and stepper, and then:

- **"Lines under {name}"** with the info button, and one caption: "How many of each you
  need for 1 {name}".
- **One card.** A row is the name of the line, "{n} on the list" under it, and the
  amount in the quantity chip on the right. A press on the name opens that line's page.
  A press on the chip opens the amount control: the same reel as a list row, writing the
  amount and not the number on the list.
- **"Add lines"** on the left under the card, which opens the add page (section 8), and
  **"Change the order"** on the right.
- **The cost**: two figures, "about 11,10 € for 1 {name}" and "about 24,35 € for what is
  on the list", and one sentence, "Cheapest prices today. 2 lines have no price yet."
  The rules are those of plan `0132`. With no priced line the figures are absent and the
  sentence says so.
- **Comments**, "Also on" and "Add to another list" as on any line.

A parent has no "Any of these will do" section, no products page and no "Buy history"
row.

### 7.2 The amounts

The server owns these rules (section 12). The app needs them in one pure function,
`parentPreview`, only to say what will happen on the add page.

- Raising the parent by 1 adds each amount to its line.
- Lowering it by 1 takes each amount away. A line stops at 0.
- A line can be changed alone, from its row on the list or from its own page.
- After any change, the number of the parent is the largest number that every line under
  it can cover: the smallest of `floor(number on the list / amount)` over its lines.
  This one sentence gives all three rules the owner stated: the parent drops when a line
  no longer holds enough, it rises when every line holds enough for one more, and
  lowering the parent by 1 lowers that smallest value by 1.
- A parent with no lines left is an ordinary line again, and keeps its number.

### 7.3 Changing the order

"Change the order" swaps each amount for a grip and two arrows, the controls of the
reorder mode of the list (`LineRow` with `reordering`). "Done" replaces "Change the
order" in the heading. Back ends the mode before it leaves the page. The order of the
card is the order of the rows under the parent on the list.

### 7.4 The info sheet

The info button opens a sheet with the four sentences and the two row example of the
artboard. Its first sentence is the point of it: the number beside a line here is not
the number on the list.

## 8. The add page (stage 2)

Artboards `AddPage.dc.html` and `AddPagePicked.dc.html`. Route `lines/:lineId/add`, a
page, title "Add lines". It exists only for a line that may be a parent: a line with no
products and no group, whose reader holds `WRITE`.

- **One field** with a visible label, focused on arrival. Reuse `LineComposer` only if
  it takes a visible label and no voice. If not, use a plain field and the same
  constants (`SUGGEST_MIN_CHARS`, `SUGGEST_DEBOUNCE_MS`).
- **"Add “{text}” as a new line"** directly under the field while it has text. It adds a
  pick with no product.
- **"On {list}"**: the lines of this list that match, from the held lines. Not offered:
  the parent itself, a line already under this parent, and a line that has lines of its
  own. A line under another parent is offered. Its row says "Under {other}. This adds a
  second line", and picking it makes a new line and leaves the first alone.
- **"From the catalog"**: the answer of `CatalogServiceI.suggest`, as rows with the
  picture, the name, "size · brand", the price and the chain. Picking one makes a new
  line with that product. Groups are dropped by `productSuggestions`, as in the list.
- **A pick** is a checkbox row. A picked row gains a stepper for its amount, starting at
  1, and its small text changes: "Stays at {n} on the list" for a line that exists, "New
  line, gets {n} on the list" for a new one.
- **With the field empty**, the picks move into their own group at the top, "Going under
  {name}", and the rest of the list follows.
- **The bar** sits on the keyboard. While typing it is one line: "Under {name}", the
  count of picks, and "Add". With the keyboard away it is the warning sentence and the
  full button, "Add 2 lines".
- **The warning sentence** appears when `parentPreview` says the parent will drop:
  "{name} will go from 2 to 1. There is only 1 Cotton pads on the list." With several
  causes, name the line that holds the least.
- **Add** sends every pick in one request (section 12). On success the page goes back to
  the parent with `PageNavigation.back`. On a refusal it stays, keeps the picks, and
  says what failed above the button.
- Leaving with picks and no add asks once, with the confirm sheet the app already has.

The list has to be whole for this page: load it until `LineStore.isComplete(listId)`.

## 9. The list (stage 2)

Artboard `Rows.dc.html`.

- A line under a parent is drawn under that parent, indented, and nowhere else in the
  section. `composeListGroups` gains the nesting. The order under a parent is the order
  of section 7.3.
- A parent row has a chevron before its name and "{n} lines, about {cost}" under it.
  The cost is absent with no priced line.
- **Every parent is open when the list loads.** The chevron closes it for this visit.
  The state is a set of ids in the page. It is not stored anywhere.
- The reel of a parent row sends the same delta as any row. The rows under it update
  from the answer.
- A press on a parent row opens the detail sheet, like any other line. For a parent the
  sheet keeps the name, the stepper and the buy button, and its link to the page. It
  drops what a parent cannot have: the product names, "which one did you get" and the
  rate facts.
- **The buy button of that sheet buys every line under the parent**, each for the whole
  number it has on the list (section 12). "Not available" is absent for a parent. The
  parent page has no buy button of its own.
- While searching, the list is flat as today. A line under a parent says "Under {name}"
  in its small text.
- Reordering the list moves a parent with its lines. A line under a parent has no grip
  in the list. Its order is changed on the parent page.

## 10. A line and the rest of the app (stage 2)

- **The parent row.** A line under a parent shows one row between the number and the
  products: "Under {parent}" and "{amount} for each". It opens the page of the parent.
- **"Also on"** changes meaning. It lists the other lists the reader can read that hold
  a line with exactly the same products, whatever that line is called. A row is the
  list, "in {group}", the other name when it differs ("as “Champú”"), and the number
  there. A press opens that line. For a parent, the match is exactly the same lines with
  the same amounts. The caption beside the heading says which: "lists with the same
  products" or "lists with the same lines".
- **"Add to another list"** opens the sheet of `ToList.dc.html`: every list the reader
  can write, under its group, as checkboxes. The list the line is on is switched off and
  says "It is on this list". A list that already holds the same line is switched off and
  says "Already there". For a parent the sheet says "Its 5 lines go with it, with the
  same amounts." The copy starts at 0 on the new list. Reuse the read of lists that plan
  `0134` section 4.3 builds, when it is on your base branch.

## 11. The routes

All under `zones/:zoneId/lists/:listId/lines/:lineId`.

| Path | Kind | Stage |
| --- | --- | --- |
| `history` | page | 1 |
| `sheet/menu` | sheet | 1 |
| `sheet/name` | sheet | 1 |
| `products` | page | 1 |
| `sheet/comments` | sheet | 1 |
| `sheet/confirm/delete` | sheet, exists | 1 |
| `add` | page | 2 |
| `sheet/amounts` | sheet | 2 |
| `sheet/copy` | sheet | 2 |

Declare the three pages as their own routes before the line page, as the line page is
declared before the list page. `routes.spec.ts` has to keep both of its assertions.

## 12. What the backend has to serve

No backend plan for this exists. The next free number in
`apps/luna-shopper-backend/plans` is `0196`. This section is the list of needs, not the
design.

1. **The link.** A line names its parent and holds an amount of at least 1. Both are on
   `LineView`. The parent and the line are on the same list. A line with products or a
   group cannot be a parent, and a parent cannot take a product. A parent cannot have a
   parent (section 14, question 1).
2. **The arithmetic of section 7.2**, in the transaction that already locks the list,
   for every write that moves a number: the delta, the absolute write, a settle, a
   revert, an approval. One answer carries every line that moved.
3. **Adding under a parent**, several picks in one request, each one either a line that
   exists (it keeps its number) or a new line (it gets amount times the number of the
   parent). All or nothing. `POST /v1/lists/:id/lines/batch` exists and nothing calls
   it.
4. **Taking a line out** (it keeps its number) and **changing an amount**.
5. **The order under a parent.** Today's reorder renumbers the given lines from 1, which
   would put them above the rest of the list.
6. **Deleting a parent** with or without its lines.
7. **Buying a parent**: every line under it settled in one request, each as its own
   `LineSettlement`, each for the whole number it has on the list. Nothing for the
   parent.
8. **The identity of a line gains its parent, inside a list.** An add under a parent
   merges only into a line under that parent. An add with no parent never merges into a
   line under one.
9. **The basket merges across parents.** Lines under parents of different lists merge
   into one basket row by today's `mergeKey`, as if they had no parent. The parents
   merge too. The merged parent holds every line of all of them, and lines that are the
   same add their numbers. What makes two parents the same is open (section 14).
10. **"Also on" by the whole product set**, answering the line id, the line name and the
    number, and for a parent by its lines and amounts.
11. **Copying a line to other lists**, a parent with its lines, starting at 0.
12. **The cost of a parent**: for 1 of it and for what is on the list, with the count of
    lines that have no price, by the rules of backend `0132`'s estimate.
13. **Realtime**: one event for a write that moves several lines, so that a second
    person's list does not show half of it.

## 13. Strings and tests

**Strings.** New keys go under `list.page`, `list.history`, `list.parent` and `list.add`
in both files. Spanish first for "Las cosas del baño" style names: check each sentence
with a long parent name at 390 pixels. The heading "Lines under {name}" and the row
"Take it out of {name}" wrap to two lines. They do not shrink and do not cut the name.

**Tests.**

- Pure functions, each with a spec: the card view (the cheapest rule, no price, one
  product), the month grouping of the history, `parentPreview` (raise, lower to 0, a
  line with extra, a line with too few, no lines), the nesting in `composeListGroups`,
  the offers of the add page (what is refused and why).
- Component specs for the stepper without `DECIDE`, the menu without `MANAGE`, the
  delete sheet with the box on and off, the add page bar in both states.
- `routes.spec.ts` for the new paths.
- `no-unguarded-history-back.spec.ts` keeps passing.
- The e2e suite `apps/velista-luna-e2e`: one walk that makes a parent, raises it, lowers
  a line, and deletes the parent with its lines.

## 14. Not in this plan, and open questions for the owner

Not in this plan: a parent inside a parent, the product page, a remembered close of a
parent, a note on a line whose number no longer matches its parent, the shop map.

Open questions:

1. **Can a parent be under a parent?** The mock refuses it ("Has lines of its own").
2. **What makes two parents the same in the basket?** The owner decided that parents
   merge and that the merged parent holds every line of both. A parent has no products,
   so this plan reads "the same" as the same name, by the rule that lines with no
   products follow today (`text:` plus the normalized name).
3. **Where does a line go when it is bought and its parent is not?** This plan keeps it
   under its parent, with the bought mark that a row has today.

Answered by the owner on 2026-10-08, and now in section 1: the number of a parent, how
much a buy of a parent buys, what a row tap opens, and the basket.
