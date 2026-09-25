> **PR:** [#490](https://github.com/IchirokuXVI/nx-portfolio/pull/490)

# 0108: what the suggestion panel says

Four defects in the composer's typeahead panel (plan `0101`), found on a phone:

1. A search with no results draws the loading skeleton for a moment and then draws nothing.
   The user cannot tell whether the search ran.
2. "Ya está en tu lista" on a card is small secondary text and easy to miss.
3. With one result, the card sits at the bottom of a panel sized for two, with an empty raised
   surface above it.
4. Typing "alg" suggests "Discos desmaquillantes", and nothing on the card says why.

## What was found

- **1.** `suggestion-list.html` draws the skeleton while `suggesting()` is true and no cards
  exist, and draws nothing when the answer is empty. That is deliberate today ("No empty
  state, ever", in `suggestion-list.html` and `line-composer.html`). The user overrides it.
- **2.** `.already-h` in `suggestion-list.scss` is `--app-text-secondary`, `--app-text-2xs`,
  weight 600.
- **3.** `.panel` has `min-height: min(calc(2 * var(--app-suggestion-card) +
  var(--app-space-3)), var(--app-suggestions-card-cap))` and
  `.panel > :first-child { margin-block-start: auto }`. One 73 px card therefore sits at the
  bottom of a 154 px panel.
- **4.** The match is correct but unexplained. It is a **group** card. The reference group
  `cotton-pads` (`apps/luna-shopper-backend/catalog/src/app/db/reference/groups.ts`) is named
  "Discos desmaquillantes" and has the Spanish synonym "algodón". Group search matches name and
  synonyms as word prefixes, so `alg:*` matches "algodón". Item documents carry no synonyms
  since backend plan 0156, so no item card appears for "alg". The fix is to say why: when a
  group matched only through a synonym, the card names that synonym.

## Brief for the agent

### Objective

Make the suggestion panel say "no products found" instead of vanishing, size itself to the
cards it holds, make "already on your list" stand out, and show the synonym that made a group
card match.

### Context

- `libs/velista/ui/src/lib/list/suggestion-list.{ts,html,scss}` (the `placement === 'above'`
  card panel) and `line-composer.{ts,html}` (its host, `panelOpen`, `aria-expanded`).
- The state lives in the pages: `list-page.ts` (`suggestions`, `suggesting`, and the debounce
  effect) and the same in `basket-page.ts`.
- Tokens: `libs/velista/ui/src/lib/styles/_semantic.scss` (`--app-suggestion-card`,
  `--app-suggestions-card-cap`, `--app-suggestions-chrome`) and `_themes.scss`. Amber
  (`--app-action-quiet-*`) means "act" in velista. Violet (`--app-status-attention-*`) means
  "attention".
- The suggest read: `GET /v1/catalog/suggest`
  (`apps/luna-shopper-backend/gateway/src/app/catalog/catalog.controller.ts`,
  `catalog-suggest.service.ts`), groups from `ITEM_PATTERNS.searchOffers`, items from
  `ITEM_PATTERNS.search`, in `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts`.
  `search-term.ts` builds the query.
- The velista mapper for the suggest read is in `libs/velista/data-access` (rule D4: map from
  `unknown` into velista's own model).

### Target state

1. **No results.** When a finished search returns no cards, the panel shows one small row:
   "No products match “{{query}}”" / "Ningún producto coincide con «{{query}}»". If the
   composer can still add the typed text as a free line, the row says so in a second short
   line (read `LineComposer` to find out. Do not invent that behavior). The row is announced
   once through the existing `role="status"`. It goes away when the text changes or is
   cleared. The skeleton must not flash before it: if a result arrives in under about 150 ms,
   no skeleton is drawn at all.
2. **Size.** The panel is as tall as its cards, up to the existing cap. One card gives a one
   card panel, the no results row gives a one row panel. The panel still opens upward from the
   composer.
3. **Already on your list.** The "already" line uses the attention colour pair
   (`--app-status-attention-fg` on `--app-status-attention-bg`), as a small tinted label, and
   passes WCAG AA contrast in both themes. Check the rendered colours with `getComputedStyle`.
4. **Why it matched.** A group card that matched only through a synonym shows that synonym
   under its name: "Also called: algodón" / "También: algodón". A card that matched through its
   name shows nothing new.
   - First check whether the suggest response already carries the group's synonyms. If it
     does, decide in velista which synonym matched, with the same rule the server uses
     (accent folded, lower case, word prefix).
   - If it does not, add the matched synonym to the group entry of the suggest response in the
     backend. Then regenerate the committed OpenAPI document and the admin wire types (the two
     commands in CLAUDE.md). The field is optional and absent when the name matched.

### Scope

Work in `libs/velista/ui/src/lib/list` (suggestion list, line composer), the suggestion state
in `list-page.ts` and `basket-page.ts`, `libs/velista/data-access` (the suggest mapper and
model), `libs/velista/models`, the two translation files, their specs, and, only if target 4
needs it, the gateway and catalog suggest code, its contracts, `openapi.json` and
`wire-types.ts`.

Translation anchor: new keys go inside the `list.add.card` block, after `already`.

Other agents edit `line-composer.{ts,html}` (a disabled state for the basket) and the page files
at the same time. Keep your changes there to the suggestion state and the panel.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- `suggestion-list.scss` is close to the `anyComponentStyle` budget
  (`apps/velista/project.json`, warn 12 kb, error 20 kb compiled). Read the budget warning in
  `npx nx build velista` before and after, and keep the new rules small. If it goes over, move
  rules into a partial rather than raising the budget.
- Update the comments that say "No empty state, ever" so that they describe the new rule.
- Do not change search ranking, the synonym data or the fuzzy threshold.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- raising the style budget
- changing which results the search returns
- removing or editing a group synonym

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-data-access velista-feature-lists velista-feature-shopping-lists`
  green, `npx nx build velista` green with no new budget warning, and, if the backend changed,
  `npx nx affected -t lint test` for the backend projects and the stale document specs green.
- Specs for each of the four targets.
- A browser check against slot 3 at 390 px: type "zzzz" (no results row, no flash), a query
  with one result (one card panel), a product already on the list (tinted label), and "alg"
  (the card shows "También: algodón").
