# 0061 A place says which shop it may be

> Backend half: `apps/luna-shopper-backend/plans/0193` (a place links to the shop it is).
> Build this plan only after `0193` is merged. Every route, field and error code named
> here is defined there, and `wire-types.ts` holds them once `0193` regenerated it.
>
> Asked for by the owner on 2026-10-07. In the harvester section, "Discovered places" and
> "Source shops" read alike, a place gives no sign that the catalog already holds its shop,
> and the only way to link one is to press "Add to the catalog" and be refused.

The places queue learns three things: to say on each line that a place is probably a shop
we hold, to link a place to any shop of a chain, and to link in one act the places that
shops were made from. Both queues also say in their own words what they are.

## Brief for the agent

### Objective

Show the candidates that the list read now carries, on the line and on the open place. Add
"Link to an existing shop" with a shop picker, a link button on each shop of the nearby
panel, and a bulk act with a preview. Say what the link filled. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui` and
`antislop-human` skills.

### Context

Every statement below was read in the file it names, on `dev` at `b67f6f94`.

- **The queue** is `libs/luna-shopper-admin/feature-harvest/src/lib/places-queue-page.ts`.
  It lists `NEW` places only (`:701` to `:707`). One line of the column draws the name,
  the street, the city and the reference (`:345` to `:350`).
- **The candidates panel** (`:248` to `:293`) is drawn only from the details of a 409
  `place_matches_location` that an import answered (`_matches`, `:726`, set in `_settle`,
  `:1005`). It has "Link to this shop" per candidate and "Create a new shop anyway".
- **The nearby panel** (`:314` to `:339`) lists the shops of the chain within 250 m
  (`NEAR_METRES`, `place-view.ts:18`) and has no control. It reads the shops of the picked
  chain, or of the chain whose brand key the place carries (`_readCatalogNear`, `:1049`).
  A place with neither shows nothing.
- **`link`** (`:853`) sends `supermarketLocationId` and reads a `DiscoveredPlaceView`.
  After backend `0193` the answer is `{ place, filled }`.
- **A shop picker scoped to a chain exists.** `shops-queue-page.ts:299` to `:307` uses
  `lib-reference-picker` with `resource` `'locations'` and a scope of the chain. Copy that
  use, and write no new picker.
- **The chain picker** of the open place (`:201` to `:209`) holds `supermarketId`. It is
  cleared after every decision (`_reset`, `:1032`).
- **The texts** are `harvest.places.*` and `harvest.shops.*` in
  `libs/luna-shopper-admin/ui/assets/i18n/en.json`. `harvest.places.info.found` says
  "Discovery found this place and could not match it to a shop", which is not true for a
  place with a candidate.
- **The service** is `HARVEST_SERVICE`: `harvest-service.ts`, `harvest-api.ts` and the
  memory double `harvest-memory.ts`. A new method goes in all three.
- **What backend `0193` gives:** `candidates` on each `NEW` place of the list, each with
  `supermarketLocationId`, `supermarketId`, `label`, `address`, `city`, `postalCode`,
  `metres` and `rung` (`EXTERNAL_REF`, `NEARBY`, `ADDRESS` or `SAME_CHAIN_NEAR`). The link
  answer with `filled`. `acrossChains` on the link, and 409 `place_names_another_chain`
  with `details.chain`. `POST places/link-by-ref` with `{ apply }`, which answers `linked`
  and `skipped`.

### Target state

1. **A line says it.** A place with one candidate or more carries a mark on its line in
   the column: "Probably a shop we hold". The mark is text, never colour alone.
2. **The open place leads with its candidates.** The panel that a refused import drew is
   now drawn at once from `place.candidates`, above the chain picker. Each candidate shows
   the shop (label, else address), its city and postal code, the distance when there is
   one, the rule that found it, and "Link to this shop". A 409 of an import still replaces
   the list with its own candidates, as today.
3. **A hint reads as a hint.** A `SAME_CHAIN_NEAR` candidate says "Same chain, {{metres}}
   m away" and its button is the quiet kind. The three other rungs keep the primary
   button.
4. **"Link to an existing shop".** A quiet control on every open place, below the
   candidates. It opens the shop picker of the chain that the chain picker holds, or of
   the chain of the first candidate, or it asks for a chain first. A picked shop shows one
   line with its address and a "Link" button. Nothing is sent before that press.
5. **The nearby panel links.** Each shop of "Shops of this chain the catalog holds
   nearby" gets "Link to this shop". A shop that is already a candidate above is not
   listed twice.
6. **Another chain asks once.** On 409 `place_names_another_chain` the place stays in
   front, and one line says "This place names {{chain}}. Link it to a shop of another
   chain?" with "Link anyway" and "Cancel". "Link anyway" sends the same shop with
   `acrossChains: true`.
7. **The link says what it filled.** After a link, a notice names the fields from
   `filled` in words ("Filled the address, the city and the postal code"), or says that
   the shop already held everything. The queue moves to the next place, as today.
8. **The bulk act.** A control in the header of the queue: "Link places that shops were
   made from". It calls `link-by-ref` with no `apply` and shows the preview: one line per
   place with its shop, and the skipped ones with the reason. "Link {{count}} places"
   sends `apply: true`. Then the queue and the counts of the rail are read again. With
   nothing to link, the preview says so and offers no button.
9. **The two queues say what they are.** The info button of each names the difference:
   - Places: "A place is a shop that discovery found, on OpenStreetMap or in a chain's own
     list. Add it to the catalog, link it to a shop we hold, or reject it."
   - Source shops: "A source shop is the code a chain's website uses for one of its shops.
     Map it to one of our shops so that what the chain says lands there. It never creates
     a shop."
   `harvest.places.info.found` no longer says that nothing matched.
10. **The memory back end** answers all of it: candidates on two seed places (one by
    reference, one near), the link answer with `filled`, the other chain refusal, and the
    bulk act with its dry answer.

### Scope

- In: `feature-harvest` (`places-queue-page.ts`, `place-view.ts`, `places-queue.spec.ts`),
  `data-access/src/lib/harvest/` (`harvest-service.ts`, `harvest-api.ts`,
  `harvest-memory.ts` and their specs), `en.json`, and `shops-queue-page.ts` only if its
  info texts live in the component.
- Out: the shop queue's behaviour, the grouped view, the postal code page, the record page
  of a shop, the gateway, `openapi.json` and `wire-types.ts`.

### Constraints

- Types come from `Wire.*`. Add no manual type beside `wire-types.ts`.
- No resource path is composed outside the three files that
  `no-literal-resource-path.spec.ts` allows.
- A link is never sent without a press on a button that names it. The bulk act never sends
  `apply` before its preview is on screen.
- The panel is cleared when the place in front changes (`_reset`). The picked shop, the
  other chain question and the notice are answers about one place.
- Keep the queue behind its signal. A new `QueueStore` is built on every filter change.
- `ngModelChange` reads one write behind on these forms. Use the events the page already
  uses.
- No raw `<svg>`. An icon is a component of `libs/shared/ui`.

### Action boundaries

- Proceed with code, specs and a browser walk on a front end slot.
- For the walk, point at a Luna slot that already listens, or use the memory back end. Do
  not start a Luna slot for this plan, and never write slot 1.
- Stop and ask if `wire-types.ts` lacks a field named above. That means backend `0193` is
  not merged, or it was built differently.

### Progress evidence

- `places-queue.spec.ts`: the mark on a line with a candidate and none without, the panel
  drawn from the list read, a hint drawn with the quiet button, the picker flow, the link
  from the nearby panel, the other chain question and its second request, the notice for a
  full and an empty `filled`, the bulk preview, the bulk apply, and a panel cleared on
  skip.
- Specs of `harvest-api.ts` and `harvest-memory.ts` for the new method and the new answer.
- `npx nx build luna-shopper-admin` passes. `nx test` does not type check.
- A browser walk with screenshots: a line with the mark, the open place with a candidate,
  the picker, the other chain question, and the bulk preview.

## 1. Not in this plan

- A filter "has a candidate" and a count of such places on the rail. The candidates are
  worked out on the read (backend `0193`, decision 2A), so the server cannot filter on
  them.
- Opening hours, a phone number and a website of a shop. Catalog has no column for them
  (backend `0193`, decision 2D). The open place already shows the hours and the website
  that the place holds.
- Undoing a link.
- The places that name a shop, listed on the record page of that shop.

## 2. Decisions

**A. A mock before the build.**

- Recommended: no mock. The plan adds one mark, two buttons, one picker that exists and
  one preview list to a card that exists, and each uses a style the page already has
  (`.matches`, `.quiet`, `.near`).
- The other choice: a board in `plans/mocks/` first, if the owner wants to see the open
  place with candidates above the chain picker before it is built.

**B. Where the bulk act lives.**

- Recommended: the header of the places queue, as a control that is always there. It
  costs no request until a person presses it.
- The other choice: a banner that appears when the dry answer is not empty. It asks the
  harvester on every load of the queue.

**C. What the Import button does for a place with a candidate.**

- Recommended: nothing new. "Add to the catalog" stays, and the server still refuses it
  on the three strict rungs. The candidates above it already make the link the first
  thing a person reads.
- The other choice: hide the button while a strict candidate is shown, and keep "Create a
  new shop anyway" as the only way to import.
