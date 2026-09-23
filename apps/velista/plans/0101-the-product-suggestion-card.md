# 0101: the product suggestion card

> **Status, 2026-09-23: build this plan without the assistant.** All development on the
> assistant is on hold, and backend `0147` and `0148` say so. The card continues. The
> assistant's sheet (the `Assistant` artboard, rule 7 in section 3 and its acceptance
> criterion) is out of scope until the assistant resumes. Do not build it, and do not
> build a placeholder for it.

> Mock: `mocks/typeahead/`, published at https://claude.ai/artifact/GASRtmT5Y74jM7fywGeMK3.
> Reverses `0063` section 6.5, which refused to draw a chain on a typeahead row.
> Needs one server change before any of it can be built. Section 2 says which.
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
  `ItemView`, which already carries `imageUrl` and an `offers` array beside `bestOffer`.
  velista's `CatalogItem` maps neither. Section 2 has the detail.
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
- deciding the open question in section 4
- adding a dependency, or reaching for a popover library

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

Three different problems, and only one of them is a server change.

**Already on the wire, and velista does not map it.** No backend work:

- `ItemView.imageUrl`. The field exists. It holds nothing until the Open Food Facts
  import lands, which is backend `0126` to `0129`, written and not built. So the card
  needs the state where there is no photograph, which `Edge` draws, and it needs it
  permanently rather than as a courtesy.
- `ItemView.offers`, an array of `ItemOfferView`, each with `price`, `unitPrice`,
  `unitPriceLabel`, `observedAt`, `stale` and `priceScopeId`. Every shop's price is
  already being sent. `CatalogItem` reads `bestOffer` alone.

**Missing, and the card cannot be built without the first one:**

- **A `scopes` map on `CatalogSuggestResponse`.** An offer names a `priceScopeId` and
  nothing resolves it. The basket read composes exactly this map so a row can turn that
  id into a chain and a shop, and the suggest response has no equivalent, so no row can
  name a chain today. This is the server change `0063` section 6.5 declined to ask for,
  and asking for it is what this plan reverses. Everything else on the card can be built
  without it. The chain row cannot be built at all.
- **A packaging format.** "Pack 6", "Docena". `ItemView` carries `unitSize`,
  `defaultUnit`, `ean` and `sku`, and none of them is the words on the packet.
- **The group's products.** `ProductGroupOfferView` carries `group`, `itemIds`, `offer`
  and `cheapestItem`, so one product is named and the rest are ids. The card draws five,
  cheapest first, with name, brand and price, and states how many there are in total.

**Neither. velista can answer it itself:**

- **The lines that already hold the product.** The list page holds its own lines and the
  basket view holds its rows, each already naming the list it came from, so this is a
  join in the client and not a field to ask for.

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

## 4. The question the mock leaves open

The section naming the lines a product is already on draws its quantity as a plain count
chip, 32px per row, so the section informs and does not act. The alternative is
`lib-quantity-stepper`, which takes the row to 44px and buys back the original intent:
increase a line instead of adding the product again. The `Edge` artboard draws both.

**Decide this before building, and do not decide it while building.**

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
npx nx test velista-ui
npx nx test velista-data-access
npx nx test velista-feature-list
npx nx lint velista
npx nx build velista
```

Then, on a slot with the seeded Mercadona catalog and postal code 14013: open a zone
list, type `leche`, and compare the panel against `mocks/typeahead/index.html` at 100%.
Repeat on the basket, where the already section names a list as well as a line.
