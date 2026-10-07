> **PR:** [#666](https://github.com/IchirokuXVI/nx-portfolio/pull/666)

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

## 3. What was built, and what the plan did not settle

Targets 1 to 10 are built, with the recommended answer of decisions A, B and C: no mock,
the bulk act as a control in the header of the queue, and an Import button that did not
change. The points below are the choices the builder made where the plan left room.

### The mark has two sentences

Target 1 names one sentence, "Probably a shop we hold". Target 3 says that a hint reads as
a hint. On the first catalog 5 of the 14 places with a candidate have only a hint, and two
of them stand 75 m and 209 m from a shop that is linked to its own place. "Probably" is not
true for those.

- A place that a strict rung found a shop for carries "Probably a shop we hold".
- A place whose every candidate is a hint carries "A shop of its chain is near", drawn
  with no wash.

The panel of the open place follows the same rule. With hints alone its heading is "A shop
of its chain is near", and it takes no amber, which the remodel keeps for a decision that
waits.

**For the owner:** say so if the line must read "Probably a shop we hold" for a hint too.
It is one function, `candidateMarkKey` in `place-view.ts`.

### "Create a new shop anyway" answers a refused import, and nothing else

The panel is now drawn from the list read, before any import. Its button "Create a new
shop anyway" and the sentence "Nothing was added" stay with a refused import, because
they are the answer to that refusal (decision C). A panel that the list read drew says
"Link the place to the shop that is the same one" and has no such button. A 409 of an
import replaces the list with its own candidates, as target 2 asks.

### The link form holds its own chain

Target 4 says the shop picker is over the chain of the chain picker, or of the first
candidate, "or it asks for a chain first". The form draws a chain picker of its own above
the shop picker, filled with that chain. So a person reads which chain the shops are of,
and names another one in the same place. It is a second signal and not the chain picker of
the import: a chain named to find a shop must not file a later import under that chain.

One source was added before the form asks. A place with no candidate and no picked chain
opens on the chain whose brand key it carries, when catalog holds that chain. The 34
places of El Jamón that the catalog lacks a shop for thus open on the shops of El Jamón.

The nearby panel follows the chain of the form too. A person who names Deza in the form
for a place with no brand sees the shops of Deza within 250 m, each with its button.

### The nearby panel after target 5

The harvester now names every shop of the chain within 250 m as a candidate. The nearby
panel reads the same shops, so for most places every shop of it is already above. The
panel then says "The shops of this chain near it are listed above" and not that the
catalog holds none. It still lists what no rung names: a shop with no position at the same
postal code, the shops of a chain a person picked, and the hints after a refused import
replaced the list with the strict candidates.

### The notice

- It is drawn under the header of the queue and not in the card, because a link takes its
  place out of the queue. After the last place of the queue there is no card.
- It names the place by its name and its street. Every place of El Jamón has the same
  name.
- It names the fields in one order of its own: the address, the city, the postal code, the
  country, the position, the provider reference, the floor area. A field that a later
  backend adds reads "another field".
- It goes when another place comes up.

### The other chain question

- `details.chain.name` is a localized name. It is read in the content language of the
  admin. With no readable name the sentence is "This place names another chain. Link it to
  this shop?".
- "Cancel" sends nothing and leaves no failure line above the queue.
- A second refusal after "Link anyway" is drawn as any other failure.

### The bulk act

- **The preview is a panel under the header, and its button is the confirm.** "Link N
  places" is drawn only while a dry answer with a place to link is on screen. The page
  refuses to send `apply` in any other state. No second dialog asks again.
- **The act is not narrowed by the chain filter.** The route reads every `NEW` place, and
  the preview says so.
- **Each line says what the link would fill**, from `filled` of the dry answer.
- **A skipped place is listed under "Left as they are"** with its reason. A reason that a
  later backend adds reads "Not linked".
- **A failed apply reads the queue again.** The harvester keeps the links it made before
  the failure (backend `0193`, section 6). The page says that the link stopped part way,
  marks nothing as linked, and reads the queue and the counts again.

### Outside the scope list: one slot in `queue-frame.ts`

`libs/luna-shopper-admin/ui/src/lib/harvest/queue-frame.ts` has a new slot,
`queueBanner`, between its header and its rows. The preview and the notice are drawn
there. The header of the frame is one row that the tools share with the view switch, so a
panel inside it is squeezed beside the switch. The slot adds no behaviour, and the two
other queues project nothing into it.

### The memory back end works its candidates out

Target 10 asks for candidates on two seed places. The memory harvester holds no list of
candidates. `place-linking.ts` in `data-access` holds the rules of backend `0193` as pure
functions (the chain a place names, the four rungs, what a link fills, the bulk decision),
and the memory harvester applies them to a copy of the shops and the chains of the catalog
seed. Three seed places have a candidate: one by reference, one within 50 m and one hint.
`place-seed-agrees.spec.ts` fails when the copy and the catalog seed differ.

A link in memory fills the copy and not the catalog seed, so a shop record that is opened
after a link shows the shop as it was. The two libraries share no table.

### What was looked at, and how

The places queue was walked in a browser against backend slot 0, which holds the first
catalog: 91 `NEW` places, 14 with a mark (9 "Probably a shop we hold", 5 "A shop of its
chain is near"). Slot 0 was only read. The walk stopped every request that could write
before it left the browser, and let through the sign in and the dry call of the bulk act,
which answered that no place carries the reference of a shop. The other chain question,
the notice and a preview with places were drawn from answers that the walk gave in place
of the gateway. No link was sent to a real back end by this build: the routes were walked
over a gateway by backend `0193`, and the specs of `harvest-api.ts` hold the requests.
