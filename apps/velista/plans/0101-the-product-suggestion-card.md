# 0101: the product suggestion card

> **Status, 2026-09-23: build this plan without the assistant.** All development on the
> assistant is on hold, and backend `0147` and `0148` say so. The card continues. The
> assistant's sheet (the `Assistant` artboard, rule 7 in section 3 and its acceptance
> criterion) is out of scope until the assistant resumes. Do not build it, and do not
> build a placeholder for it.

> **Decided 2026-09-24.** Section 4 is closed: the lines already holding the product use
> `lib-quantity-stepper`. The group popover is a CDK overlay (`@angular/cdk` is already a
> dependency). Photographs do not ship until backend `0126` to `0129` land, so the card
> always draws the state with no photograph until then.

> Mock: `mocks/typeahead/`, published at https://claude.ai/artifact/GASRtmT5Y74jM7fywGeMK3.
> Reverses `0063` section 6.5, which refused to draw a chain on a typeahead row.
> Backend half: `apps/luna-shopper-backend/plans/0161` (every chain's price, the scope map,
> the group's products) and `0162` (the pack count). Section 2 says which part of the card
> waits on which.
>
> The typeahead offers a one line row: a name, a brand, and a price. The person choosing
> from it is choosing a product to buy, and the row tells them almost nothing about the
> product. This plan makes that row a card: a photograph, the brand, the name, the
> packaging format, the price, the price per unit when it differs from the price, the
> chains that sell it with the cheapest named first, a way through to the product, and
> the lines that already hold it.
>
> **This plan is deliberately short. The canvas is the specification.** Eleven artboards
> draw every state at the size it really is, and the ten notes on them carry the rules
> and the reasoning. What is written here is the scope, the dependency, the decisions
> that are already settled, and the one question that is not. The session that builds
> this reads the canvas for the rest.
>
> Prerequisite reading:
>
> - `0063` in full. This plan changes its section 6.5 and keeps the rest of it.
> - `0043` section 6, what the composer offers after three characters.
> - `0078`, prices from one shop, and the scope to chain mapping this reuses.
> - `0002-design-system-and-theming.md`.
> - `libs/velista/ui/src/lib/list/suggestion-list.ts` and `quantity-stepper.ts`.
> - `mocks/typeahead/` in a browser.

## Brief for the agent

### Objective

Replace the one line suggestion row with the card the canvas draws, in the composer on
the zone list page and the composer on the basket page, and nowhere else.

### Context

- The control is `lib-suggestion-list` in `libs/velista/ui/src/lib/list/`. It stays
  there. **It is not a general component and is not promoted to `@portfolio/shared/ui`**,
  because it reads a catalog suggestion and answers with a line, which is velista's
  vocabulary and nobody else's.
- `GET /v1/catalog/suggest` and `GET /v1/baskets/{id}/catalog/suggest` both answer
  `CatalogSuggestResponse`, which is `{ suggestions }` and nothing else.
- A suggestion is `{ kind: 'group' | 'item', item, group }`. The item is a full
  `ItemView`. It carries `imageUrl`, and an `offers` array only once backend `0161` asks
  for it. velista's `CatalogItem` maps neither. Section 2 has the detail.
- The typeahead also receives suggestions it did not search for. The assistant produces
  them from one spoken sentence, and the canvas gives them their own sheet rather than
  the panel. **The assistant is on hold, so this build draws no such sheet.** The panel
  shows only what the composer searched for.
- `lib-quantity-stepper` in the same directory is the app's stepper: a pill, two 44px
  targets, a tabular number, disabled at each end rather than clamping,
  `LINE_QUANTITY_MIN` 0 and `LINE_QUANTITY_MAX` 100000 from `@portfolio/velista/models`.

### Target state

The composer on both screens offers cards. Three fit on a 390 by 844 phone with the
keyboard open. Pressing the button on a card adds a line, pressing anything else on the
card does not, and nothing in the panel closes the keyboard. A group offers its products
behind a reveal and explains itself through a popover.

### Scope

Work only in:

- `libs/velista/ui/src/lib/list/` (the suggestion list, and a new popover)
- `libs/velista/models/src/lib/domain.ts` (the fields section 2 adds)
- `libs/velista/data-access/src/lib/catalog/` (mapping them)
- the two feature libraries that mount the composer
- `apps/velista/plans/mocks/typeahead/` only if the canvas is found to be wrong

Do not touch: the basket read, the line sheet, `lib-quantity-stepper` itself, the admin
app, or any backend service.

### Constraints

- Use the `design-taste-frontend` skill for the drawing and the
  `nx-portfolio-angular-developer` skill for the Angular.
- Colours come from `0002` through tokens. The canvas writes them literally because an
  artboard has no build step. The component has one, so it uses the tokens.
- The UI says **group** and **grupo** where the code says zone. Rule N2 in `0001`.
- Every new string is localized through the existing namespaces.
- `svh` and not `dvh`, per the velista UI rules.

### Action boundaries

Stop and ask before:

- changing any backend service, contract or migration, including the one section 2 needs
- promoting the control out of `libs/velista/ui`
- adding a dependency, or reaching for a popover library other than CDK overlay

### Progress evidence

After each step, state what was built and paste the output of the target that proves it.
A claim that a state matches the canvas names the artboard it was compared against.

## 1. What is being built

The card, at 73px collapsed, drawn on the `Main` and `BasketPage` artboards. A 48px
photograph on the left (32px minimum, 64px maximum, and the `Sizes` artboard is why 48
was chosen), then three lines of type, then a 44px button down the right edge that is the
only thing on the card that adds it.

Around that: the chain row that expands into every shop's price (`Expanded`), the group
that reveals its products (`Group`) and explains itself (`GroupInfo`), the section naming
the lines that already hold the product, the Day theme (`Day`), the loading, priceless and
stale states (`Edge`), and the arithmetic that fixes every height (`Budget`).

The `Assistant` artboard draws the sheet the assistant reviews its rows in. It is not
built, because the assistant is on hold.

## 2. What the app cannot draw yet

Checked against the code on 2026-09-24. An earlier version of this section said every
shop's price is already sent. It is not, on the suggest routes, and that is corrected below.

**On the wire, and velista does not map it.** No backend work:

- `ItemView.imageUrl`. The field exists. It holds nothing until the Open Food Facts
  import lands, which is backend `0126` to `0129`, written and not built. **Photographs do
  not ship in this build.** The card draws the state with no photograph, which `Edge`
  draws, on every product until those plans land.

**Missing, and planned in backend `0161`.** The card cannot draw these parts without it:

- **Every chain's price.** `ItemView.offers` exists, but catalog fills it only when a read
  asks for `offers: 'all'`, and neither search behind the suggest routes asks. So the
  expanded chain row has nothing to list, and the collapsed row has no other chains to count.
- **A `scopes` map on `CatalogSuggestResponse`.** An offer names a `priceScopeId` and
  nothing resolves it, so no row can name a chain. This is the server change `0063` section
  6.5 declined to ask for, and asking for it is what this plan reverses. `0161` answers
  chain names only, with no shop address, because the card names chains.
- **The group's products.** `ProductGroupOfferView` carries `itemIds` and one
  `cheapestItem`. `0161` adds `members`, the cheapest five with name, brand and price. The
  total is still `itemIds.length`.

**Missing, and planned in backend `0162`:**

- **The pack count.** "Pack 6". `ItemView` carries `unitSize` and `defaultUnit`, so a six
  pack of litre cartons reads "6 L", like a six litre jug. `0162` adds `packCount`, a whole
  number from 2 or null, and velista renders "Pack 6" or "Pack de 6" from it. It is a
  number and not the printed words, so a container word such as "Brik" is not drawn.

**What can be built before them:** the card layout, the price, the unit price, the stale and
priceless states, the keyboard rules, the viewport height, the grid pattern, the lines
already holding the product, and the stepper. The chain row, its expansion and the group
reveal wait for `0161`. The pack line waits for `0162`, and a card with a null `packCount`
draws no pack line, so the card ships without it too.

**Neither. velista can answer it itself:**

- **The lines that already hold the product.** The list page holds its own lines and the
  basket view holds its rows, each already naming the list it came from, so this is a
  join in the client and not a field to ask for.
- **Changing the quantity of those lines.** The list page already updates a line, and the
  basket already sends `POST /v1/baskets/{id}/rows/{rowKey}/demand` with a `lineId` and a
  `quantity`.

## 3. The rules the mock settles

Stated here so they are not re-argued. The notes on the canvas carry the reasoning.

1. **The card is not the target.** One button adds the product, and it is a column down
   the right edge, 44px wide, stretching to the three lines of type that describe the
   product and no further. The row also carries a chain row, a link to the product and,
   on a group, a reveal and an explanation, so a tap anywhere else was a guess at which
   of five things somebody meant.
2. **Nothing in the panel closes the keyboard.** Every button and link in there
   cancels `mousedown`, because the browser moves focus on mousedown and iOS Safari
   raises a synthetic one first. Not `pointerdown` and not `touchstart`: those carry the
   panel's scroll.
3. **The panel scrolls and never grows.** Its height is a `min()` of three cards and what
   the viewport leaves, and the viewport comes from `window.visualViewport`, because an
   iOS keyboard does not shorten `100dvh`. It is bottom anchored by `margin-top: auto` on
   its first child, because a flex column that pushes content down cannot be scrolled
   back up to what overflowed.
4. **A group is one line.** Which of its products gets bought is settled at the shop, by
   price, so its own number is labelled `from 0,89 EUR`.
5. **The unit price is drawn only when it differs from the price**, which covers plain
   units and a one litre carton with the same rule.
6. **The cheapest chain is the only one named** on the collapsed row.
7. **The assistant does not fill the typeahead.** Its rows are reviewed in a sheet, they
   include rows the catalog matched nothing to, and nothing exists until one button is
   pressed. The rule stands for when the assistant resumes. This build draws no sheet.
8. **`role="option"` cannot hold three buttons.** The pattern that fits is the ARIA
   combobox with a grid popup, and that is a change to the existing markup rather than an
   addition to it.
9. **The free text row is gone.** The composer button already adds the typed words.

## 4. The question the mock left open, now decided

The section naming the lines a product is already on draws each line with
`lib-quantity-stepper`, 44px per row, not the 32px count chip. The section acts rather than
informs: it increases a line instead of adding the product again. Decided on 2026-09-24. The
`Edge` artboard draws both, and the stepper is the one to build. `Budget` priced the section
with the 32px chip, so each already line costs 12px more than it shows there. Recompute the
heights with 44px, and state the new figures in the PR.

## 5. Not in this plan

- The sheet the assistant reviews its rows in (`Assistant`), and anything else that
  belongs to the assistant. All development on the assistant is on hold.
- A product detail page. The card links to one. This plan does not build it.
- Steering anybody toward a shop, or saying a second trip is worth it. Backend backlog
  `0004`, and `0063` section 6.5's second reason still stands: naming the cheapest chain
  on the card is where a price came from, not advice about where to go.
- Promoting the control, or using it anywhere but the two composers.
- The list row changes the canvas assumes: the zone list row drops the done control and
  shows the photograph instead, and the basket row gains the photograph and keeps its
  settle control. Those are one paragraph each and belong to their own plan, but the
  panel arithmetic here depends on the row staying 56px.

## 6. Acceptance criteria

- [ ] Three cards fit the panel on a 390 by 844 phone with the keyboard open, and two on
      a 375 by 667 one.
- [ ] Pressing the button adds the line. Pressing the card, the chain row, the reveal or
      the link adds nothing.
- [ ] Pressing anything inside the panel leaves the field focused and the keyboard up.
- [ ] A product with no photograph, no price, or a stale price draws the state `Edge`
      draws for it.
- [ ] The collapsed row names the cheapest chain and no other, and expanding names every
      shop with its own price.
- [ ] A group is collapsed like any other card, reveals at most five products with a
      count of the rest, and its badge opens the popover.
- [ ] The popover is positioned against the badge and is not clipped by the panel.
- [ ] The section naming lines already holding the product shows the line's own words,
      and on the basket the list above it.
- [ ] `npx nx lint velista && npx nx test velista` pass.

## 7. Verification

```sh
npx nx test velista/ui
npx nx test velista/data-access
npx nx test velista/feature-lists
npx nx test velista/feature-shopping-lists
npx nx lint velista
npx nx build velista
```

Then, on a slot with the seeded Mercadona catalog and postal code 14013: open a zone
list, type `leche`, and compare the panel against `mocks/typeahead/index.html` at 100%.
Repeat on the basket, where the already section names a list as well as a line.
