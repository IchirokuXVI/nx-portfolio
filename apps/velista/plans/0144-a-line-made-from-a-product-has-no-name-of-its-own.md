# 0144: a line made from a product has no name of its own

> Asked for by the owner on 2026-10-11: "When a line comes directly from a product, its
> user label IS NOT filled automatically, only the product. When displaying the line, if it
> doesn't have a user label, the product name is shown instead."
>
> His later choices, in his words: "Let's go with N2" (the name is typed on a sheet with
> one field), and on the line page "Add a name" under the name of the list.
>
> **The mock is the design.** It is `apps/velista/plans/mocks/list-lines/`
> (`NameSheet.dc.html`, `LineNoName.dc.html`), published at
> https://claude.ai/artifact/Jg7JBG2LdNNj4FFaM1w6Ve.
>
> **Build backend plan `0207` section 1 first.** If `LineView` has no `named` on your base
> branch, say so and stop.
>
> Plan `0145` draws the row of the list with the name this plan gives. Plan `0146` is the
> catalog that chooses the products of a line.
>
> Prerequisite reading: backend `0207` section 1, velista `0135` sections 3 and 5 (the
> line page, its menu and its rename sheet), `0083` (the sheet of a row edits the line),
> `0117` (one field finds and adds), `0134` section 14 (how the catalog adds), the sheet
> rule and the back rule in `CLAUDE.md`,
> `libs/velista/ui/src/lib/list/line-composer.ts` (`choose`),
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts`,
> `libs/velista/models/src/lib/catalog-holdings.ts`,
> `libs/velista/feature-lists/src/lib/rename-line-sheet/`,
> `libs/velista/feature-lists/src/lib/line-menu-sheet/`,
> `libs/velista/feature-lists/src/lib/line-detail-sheet/` and
> `libs/velista/data-access/src/lib/lines/line-memory.ts`.

## Review of 2026-10-11: settle these before you build

A review of pull request #696 checked this plan against the code on `dev`. It found no
false statement about that code. The rule of section 2 for the lines of the old app
leaves four cases open. Each one is a decision of the **owner**: ask, and do not choose.

1. **A product that is renamed later.** An old line whose name was the name of its product
   stops to match after the rename. It then reads as a line that a person named, and it
   shows the old product name as that label. Curation renames products often.
2. **An old line made from a group card.** Its `content` is the name of the group, which
   matches no product. It stays named, while section 3 makes a new group line not named.
   The same kind of line is thus drawn in two ways.
3. **A product name that did not load.** "Save with an empty field" sends the name of the
   shown product as `content`. No rule says what it sends when that name is absent.
4. **An empty `en` name.** The comparison must skip it, or each line with an empty name
   matches.

One place is absent from section 5: the `about-products` sheet of velista `0137` (pull
request #692) prints `{{line}}`, and it takes the drawn name too.

## Brief for the agent

### Objective

Make a line know whether a person named it, stop naming the lines that come from a product,
show the name of a product where a line has no name, and let a person give a line a name
or take it away.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-copywriting` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **A line has `content`, and it is required.** `toLine` maps it
  (`data-access/src/lib/mapping/mappers.ts:372`). The cap is `LINE_CONTENT_MAX_LENGTH`,
  400.
- **A card chosen in a composer sends the name of the product as `content`.**
  `LineComposer.choose` (`line-composer.ts:395`) takes `catalogName(...)` of the item or of
  the group, with `itemIds`. The plus of the catalog tab does the same through
  `CatalogAddStore.add` (`catalog-add-store.ts:271`, `:383`).
- **The catalog finds "the line that has the product under this name"** with
  `sameLineName` (`catalog-holdings.ts:135`). It compares the name of the line with the
  name of the product.
- **The rename sheet** is `…/lines/:lineId/sheet/name`. Its field starts with
  `line.content`, and Save needs text that is not empty and not the same
  (`rename-line-sheet.ts:89`). It sends `updateLine(line.id, { content })`, and it asks the
  merge question on `line_merge_required`.
- **The menu of the line page** has Rename and Delete (`line-menu-sheet.ts:96`).
- **The sheet of a row** on the list page also renames (`line-detail-sheet.ts:669`).
- **After backend `0207`**: `LineView` has `named`. An add accepts `named`. A
  `PATCH /v1/lines/:id` accepts `named`, and a write of `content` with no flag names the
  line. A line with no product is always named.

### Target state

1. `Line` carries `named`, and one pure function answers the name to draw (section 1).
2. A line that says it is named, and whose name is the name of one of its products, is
   drawn as not named (section 2).
3. A line made from a card is made with `named: false` (section 3).
4. The name sheet gives a name and takes it away (section 4).
5. The line page and the sheet of a row show the drawn name and offer "Add a name"
   (section 5).

### Scope

- `libs/velista/models`: `Line.named`, the function of section 1, its spec.
- `libs/velista/data-access`: the mapper, the add and update bodies, `LineStore`,
  `CatalogAddStore`, the basket add, and the in-memory line service.
- `libs/velista/ui/src/lib/list/line-composer.ts`: what a chosen card sends.
- `libs/velista/feature-lists`: the rename sheet, the menu sheet, the line page, the sheet
  of a row, and the titles of the other sheets and pages of a line.
- `libs/velista/feature-shopping-lists`: only what its composer sends for a chosen card.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **The mock decides the look** of the sheet and of the line page.
- **`content` is still sent with every add.** For a line made from a card it is the name of
  the product, as it is today. The server needs it, and `sameLineName` reads it.
- **One function decides the name to draw.** No template compares names or reads `named`
  by itself.
- **The name of a product is its name in the language of the reader**, through
  `catalogName`, and never the `content` of the line.
- **Copy is for people who are not at home with apps.** Short sentences and ordinary
  words.
- **The sheet rule and the back rule hold.** No new route is needed.

### Action boundaries

- Do not change the backend. If the contract lacks something, say what and stop.
- Do not change the row of the list. Plan `0145` owns it. This plan may change what
  `LineRowVm.content` holds, and nothing else of the row.
- Do not change the shopping list page, the purchases, the home cards or the shop map.
  They keep `content`.
- Do not change how the catalog finds the line that holds a product.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-lists velista/feature-shopping-lists velista/feature-catalog`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, in English and Spanish: add a product from the list field
  and see no name on its line page, add free text and see a named line, give the first
  line a name, take the name away, do both from the sheet of a row, and add a product from
  the catalog tab.

## 1. The name of a line

`Line` gains `named: boolean`, mapped from the wire. A value that is not a boolean maps to
`true`.

One pure function in `velista/models` answers the name of a line:

- **Input**: the line, and a way to read the name of a product in the language of the
  reader (it answers null while the product is not loaded).
- **Output**: the text to draw, and `own`, which says whether a person named the line.
- **A named line**: its `content`, with `own` true. Section 2 is the one exception.
- **A line that is not named**: the name of its product, with `own` false. The product is
  the favourite when the line holds it, or else the first product of the line. While that
  name is not loaded, the text is `content`.

Plan `0145` gives this function the product the row shows (the favourite, or else the
cheapest). Until then the first product is correct, because a line that is not named and
was just made holds one product.

## 2. A line that was named by the old app

Before this plan, every line made from a product got the name of that product as its name.
The backend marks all of them as named (backend `0207` section 1.4).

So the function of section 1 treats a named line as **not named** when its `content` is
the name of one of its products. The comparison folds both texts (no accents, lower case,
one space between words) and tries every language the product has a name in.

This is a rule of the screen. It writes nothing. A person who typed exactly the name of the
product loses nothing by it.

## 3. A line made from a card

Each of these sends `named: false` with the `content` and the `itemIds` it sends today:

- A product card chosen in the field of a list (`LineComposer.choose`).
- A group card chosen in the same field. Its `content` is the name of the group. The
  owner's sentence names products, so this case is my reading.
- The plus of the catalog tab (`CatalogAddStore.add`).
- A card chosen in the field of the shopping list, which adds through
  `POST /v1/baskets/:id/lines`.

Typed text and a line the assistant makes send no flag. They are named.

The in-memory line service (`line-memory.ts`) keeps the two rules of backend `0207`
section 1.2, so the specs that run on it see what the server does.

## 4. The name sheet

Artboard `NameSheet.dc.html`. It is the rename sheet of today, at the same route.

- **Title**: "Name this line". Under it, the product the line shows: its name, its brand
  and its size. A line with no product has no second line.
- **One field**, with the label "Name" above it. It starts with the name for a named line,
  and empty for a line that is not named. The sheet focuses the field, because its whole
  job is to type one value.
- **One sentence** under the field: "The name is only for this list. The product stays the
  same."
- **Save and Cancel.**
- **Save with text** sends `{ content }`. The server names the line.
- **Save with an empty field**, on a named line that holds a product, takes the name
  away. It sends `{ named: false, content }`, where `content` is the name of the product
  the line shows.
- **Save is not available** when the text is what the line has, or when the field is
  empty and the line has no product or no name.
- **The merge question** of today answers `line_merge_required` in both cases.
- Cancel, Escape and the scrim dismiss the sheet as they do today.

## 5. Where the name is drawn and offered

**Drawn with the function of section 1:**

- The title of the line page, of its menu sheet, and of the other pages and sheets of a
  line (products, history, supermarket, delete, comments).
- The title of the sheet of a row on the list page.
- `LineRowVm.content`, so the row of today already shows the name of the product for a
  line that is not named.
- The announcements the list page makes about a line.

**Offered:**

- **The line page** (`LineNoName.dc.html`): a line that is not named, and that the reader
  may edit, has the text action "Add a name" under "On <list>, in <group>". It opens the
  name sheet. A named line does not have it.
- **The menu of the line page**: the row reads "Add a name" for a line that is not named,
  and "Rename" for a named line. Both open the name sheet.
- **The sheet of a row**: its name field follows section 4 (empty for a line that is not
  named, and an empty save takes the name away). No second sheet opens over the list.

**Not changed:** the due rows, the trip rows, the shopping list, the purchases, the home
cards and the shop map draw `content`.

## 6. Strings and tests

**Strings.** New or changed keys in both files: "Name this line", "Name", the sentence
under the field, "Add a name", and the accessible name of the menu row.

**Tests.**

- The function of section 1: a named line, a line that is not named with its product
  loaded and not loaded, the favourite, and each case of section 2 (accents, case, a
  second language, a name that is only close).
- The mapper: `named` present, absent and of the wrong type.
- The composer, `CatalogAddStore` and the basket add: a card sends `named: false`, typed
  text sends no flag.
- The name sheet: the start value of each kind of line, the three saves, Save not
  available, the merge question.
- The line page and its menu: "Add a name" present and absent, with and without the right
  to edit.
- The sheet of a row: an empty save on a named line with a product.
- `line-memory.ts`: the two rules of the server.

## 7. Not in this plan

- The row of the list (plan `0145`).
- A name on the rows of the shopping list. Velista plan `0139` makes those rows products.
- A change of `content` when the products of a line change (backend `0207` section 4).
