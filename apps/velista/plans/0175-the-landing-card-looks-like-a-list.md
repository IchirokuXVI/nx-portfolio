> **PR:** [#875](https://github.com/IchirokuXVI/nx-portfolio/pull/875)

# 0175: the landing card looks like a list, and the front door is one screen

> Asked for by the owner on 2026-10-30. The owner confirmed round 6 of the mock in
> `apps/velista/plans/mocks/landing-card/` (variant C):
>
> - **The card is the zone list in small.** A photo, the name with its price, a second line
>   with the kind and the size, one status word, and the quantity in its chip.
> - **The second line names no brand and never repeats the name** ("Semi-skimmed · 1 L").
>   The landing is marketing, and a real brand there reads as an endorsement.
> - **The head says who is here**: two faces and "Ana and Marc are here". No row is being
>   edited and no chip is lit.
> - **No hairline above the first row.**
> - **The paragraph under the headline is gone.**
> - **The page is exactly one screen.** It never scrolls, and Privacy, Terms and the version
>   are always visible at the bottom.
> - **The card shows as many rows as fit: four at 390 by 844, never fewer than two.** The
>   count, the total and the bar describe the rows on screen, never the hidden ones.
>
> `0176` is the e2e test that proves the page fits in every locale. Build `0175` first, or in
> the same PR. `0176` fails on `dev` today, because production already scrolls.
>
> Every fact below was read on `dev` at `8a01d669f` on 2026-10-30, and in production
> (`https://velista.app/en`, version 0.16.0) on the same day.
>
> Prerequisite reading: plan `0003` (the home page), plan `0007` (landing and home split),
> plan `0043` (the line is a quantity), plan `0071` (startup, the held ways in), plans `0144`
> to `0146` (the row a list draws), plans `0172` and `0173` (the foot and the terms line),
> the mock `apps/velista/plans/mocks/landing-card/index.html`, and in the code the files
> named under Context.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code, and
`design-taste-frontend` before you touch a template or a stylesheet.

### Objective

The landing page fills the screen exactly, at every size from 360 by 640 up, in every
locale, and never scrolls. The card under the headline is redrawn to look like a row of the
zone list today. It gives way, row by row, to whatever room the screen leaves it.

### Context

- **Production scrolls today.** At 390 by 844 the page is 852 px tall inside an 844 px
  scroller, so the version line sits 8 px under the bottom edge. At 360 by 640 it is 845 px
  tall, 205 px too many. The cause is `.page { min-block-size: 100% }` in
  `libs/velista/feature-landing/src/lib/landing-page/landing-page.scss`: the page is at
  least the screen, and grows past it. The scroller is `.app-page { overflow-y: auto }` in
  `libs/velista/ui/src/lib/layout/app-layout.scss:217-225`.
- **The page's parts, top to bottom** (`landing-page.html`): `lib-app-bar`, the delete
  notice (only after an account was deleted, held in memory by `AccountNotice`),
  `lib-home-hero`, `lib-list-preview-card`, `.spacer` (`flex: 1`, which pushes the ways in to
  the bottom), `lib-auth-actions`, and `.foot` (`lib-legal-links` and `lib-app-version`).
- **The hero** is `libs/velista/ui/src/lib/home/home-hero.ts` and `home-hero.scss`: the
  headline as two keys, then the paragraph `home.hero.body`. The headline is
  `font-size: clamp(2rem, 10.5vw, 2.5625rem)`. Only the landing uses `HomeHero`.
- **The card** is `libs/velista/ui/src/lib/home/list-preview-card.{ts,html,scss}`. It takes
  `listName`, `zoneName`, `lines: PreviewLineVm[]` and `shoppingNow`, is `aria-hidden`, and
  draws three text rows with initials. `PreviewLineVm` is in
  `libs/velista/models/src/lib/home-view.ts:112`. The lines are built in
  `LandingPage.previewLines` (`landing-page.ts`) with `RokuTranslatorService.t()`.
- **The ways in** are `libs/velista/ui/src/lib/home/auth-actions.{html,scss}`. Only the
  landing uses `AuthActions`. Buttons are `--app-button-height` (52 px) with a 12 px gap. The
  block also draws the group explainer, the OR divider, Google with the terms line under it
  (when the deployment offers Google and published terms), sign in with email, and, while
  the backend is not ready, one held sentence (`startup.actions.connecting` or
  `startup.actions.slow`) or a refused Google start.
- **The row the card copies** is `libs/velista/ui/src/lib/list/line-row.{html,scss}`: a
  picture of `--app-line-picture-size` with `--app-line-picture-radius`, two lines (name and
  price, then product and one status word), and the quantity chip. A settled row draws its
  name muted and its chip without a border. The status words are `line.indicator.bought`
  and `line.indicator.notAvailable`. The card copies the look of that row. It does not use
  `LineRow`, which is a control.
- **Strings that exist**: `home.progress.pending` ("{{pending}} of {{total}} pending" and
  "{{pending}} de {{total}} pendientes"), `line.indicator.bought`, `list.trips.row.notAvailable`
  ("Not in the shop", "No había en la tienda"), `home.preview.listName`,
  `home.preview.zoneName`. Assets are `libs/velista/ui/assets/i18n/{en,es}.json`. The usable
  locales are `APP_USABLE_LOCALES` (`libs/velista/feature-shell/src/lib/usable-locales.ts`),
  today `en` and `es`.
- **Images.** `libs/velista/ui/assets/` holds `brand`, `fonts` and `i18n`. The brand mark is
  imported with `?raw` (`libs/velista/ui/src/lib/brand/brand-mark.ts:61`). The app's own
  `assets` glob covers `apps/velista/public` only. The app is served on its own origin and
  under `/velista` on the portfolio (plan `0165`), so an image URL must resolve against the
  document's `<base>`, never from `/`.
- **The e2e suite** `apps/velista-e2e/src/landing.spec.ts` asserts that `/es` contains
  "Leche". That stays true.

### Target state

1. **One screen.** `.page` is exactly the height of `.app-page` (`block-size: 100%` and no
   `min-block-size`), and `overflow: hidden`. Top to bottom: the app bar, the notice when
   there is one, the headline, the card slot, the ways in, the foot. The foot is the last
   thing, at the bottom edge, above the safe area inset.
2. **The hero is the headline only.** The paragraph goes. The headline is
   `clamp(2rem, 9.6vw, 2.5625rem)`. At 10.5vw "Comparte y apunta." breaks onto a third line
   on 375 and 360 px wide phones, and takes a row from the card.
3. **The card slot takes the room that is left** (`flex: 1 1 auto; min-block-size: 0`). It is
   a size container (`container-type: size`), and the card inside it hides rows by the slot's
   height with `@container` rules. No script measures anything.
4. **The card** (mock, frame 390 by 844):
   - The head: the list name, the group name, then two faces (A and M, the second in the
     amber pair of colours) and "Ana and Marc are here".
   - The progress line: the count ("3 of 4 pending"), the estimated total at the right
     ("~€14.88"), and a 4 px bar under them filled to the share of drawn rows that are
     settled.
   - Four rows, in this order: Milk, bought, 0, settled. Eggs, 1. Bananas, 2. Olive oil, 1,
     not in the shop. Each row: a 36 px photo tile, the name and the price of one, then the
     kind and the size with the status word at the end, then the quantity chip.
   - No border above the first row. A hairline between rows.
   - Prices are formatted with `Intl.NumberFormat` in the page's locale, in euros.
5. **Rows give way from the middle.** Bananas goes first, then Eggs. Milk (bought) and Olive
   oil (not in the shop) always stay, because those two are the states that explain the
   product. With room for two rows and not for the progress line, the progress line goes.
6. **The count describes the drawn rows.** With four rows: 3 of 4 and the total of three.
   With three: 2 of 3. With two: 1 of 2, ~€8.95. Each variant is in the markup and the same
   `@container` rules show the one that matches. The bar follows. Each row carries
   `data-preview-row`, a settled row also `data-settled`, and each count variant carries
   `data-pending` and `data-rows` with its two numbers, so `0176` can compare them.
7. **At least two rows in the normal state** on every screen from 360 by 640 up, in every
   locale. When a held sentence or the delete notice takes room, the card gives way first,
   down to nothing, and the foot still does not move.
8. **On screens under 700 px tall** the group explainer and the OR divider are not drawn.
   They go before any row does. A `@media (max-height: 700px)` rule on the landing, because
   the page is the screen.
9. **Tighter ways in**, as the mock: buttons 48 px, one 8 px gap through the block, Google
   44 px, sign in with email 40 px, the foot 32 px. Words unchanged.
10. **On a narrow card** (slot narrower than 340 px) the group name is not drawn, rather than
    cut to two letters.
11. **Night works.** Every colour is a token. Draw the card on Night as well and look at it.
12. **The photos** are four square images with no brand, logo or label visible, at least
    96 by 96 px, served from the ui library's assets and resolved against the document's
    base. See O1.

### Scope

- `libs/velista/feature-landing/src/lib/landing-page/` (`.ts`, `.html`, `.scss`, specs)
- `libs/velista/ui/src/lib/home/` (`home-hero.*`, `list-preview-card.*`, `auth-actions.scss`,
  their specs)
- `libs/velista/models/src/lib/home-view.ts` (`PreviewLineVm` and its neighbours)
- `libs/velista/ui/assets/i18n/en.json`, `es.json`
- `libs/velista/ui/assets/` for the four photos, and whatever wiring the bundle needs to
  serve them
- `libs/velista/ui/src/lib/styles/_semantic.scss` for card tokens only

### Constraints

- The card stays decoration: `aria-hidden`, invented, translated. Nothing on it can be
  pressed or focused.
- No brand name and no branded packaging anywhere on the card.
- No JavaScript for layout. Rows, the count and the explainer give way through `@container`
  and `@media` rules.
- Every string in every usable locale. "Ana" and "Marc" stay the same names in every locale.
- The ways in keep their behaviour, their held state, their terms line and their order.
- Do not use `@angular/core/rxjs-interop` in this code.
- `prettier` per file, never over a folder.

### Action boundaries

- Change nothing outside Scope. If the page needs a change in `AppLayout` to stop scrolling,
  stop and say what and why.
- Do not change `LineRow` or any page other than the landing.
- Do not ship the Open Food Facts photos from the mock. If the owner has not supplied photos
  (O1), build with the product glyph tile the list draws for a product with no photo, and
  say so in the PR.
- Stop and ask before you remove a translation key that any other file reads.

### Progress evidence

- `npx nx run-many -t lint test -p velista-ui velista-feature-landing velista-models` green
  (check the project names with `npx nx show projects`).
- `npx nx build velista` green.
- `0176`'s spec green in both mobile projects.
- A screenshot of the landing at 390 by 844, 375 by 667 and 360 by 640, in English and in
  Spanish, on Day and on Night, set beside the mock's frames in the PR description.

## 1. Decisions

- **D1. One screen, by the page's own height.** The landing was designed as one screen (plan
  `0003`, open question 3) and drifted past it as the terms line and the foot arrived. The
  height rule makes the drift impossible: anything new takes room from the card, never from
  the foot.
- **D2. The card gives way, the ways in never do.** The card is decoration. The buttons and
  the foot are the page's purpose and a legal requirement.
- **D3. Two rows minimum in the normal state**, bought and not in the shop, because those
  two show what the product is. Wanted rows go first.
- **D4. No brands on the landing.** The second line is the kind and the size.

## 2. Strings

New keys, English and Spanish. The builder chooses the key names under `home.preview`.

| Meaning | English | Spanish |
|---|---|---|
| Who is here | Ana and Marc are here | Ana y Marc están aquí |
| Milk | Milk | Leche |
| Eggs | Eggs | Huevos |
| Bananas | Bananas | Plátanos |
| Olive oil | Olive oil | Aceite de oliva |
| Milk detail | Semi-skimmed · 1 L | Semidesnatada · 1 L |
| Eggs detail | Free range · 12 units | Camperos · 12 uds. |
| Bananas detail | Canary Islands · 1 kg | Canarias · 1 kg |
| Olive oil detail | Extra virgin · 1 L | Virgen extra · 1 L |

Reused: `home.progress.pending`, `line.indicator.bought`, `list.trips.row.notAvailable`,
`home.preview.listName`, `home.preview.zoneName`. The keys `home.preview.line.bread`,
`home.preview.line.tomatoes` and `home.hero.body` lose their last reader; remove them if
nothing else reads them.

Sample prices: Milk 0.94, Eggs 2.35, Bananas 1.79, Olive oil 8.95, in euros.

## 3. Not in this plan

- The e2e overflow test. That is `0176`.
- The home page for a signed in person, and the zone list itself.
- A third locale. `0176` covers it by itself when one is added.

## 4. Open decision for the owner

- **O1. The four photos.** The mock uses Open Food Facts photos of real packaging. Those are
  CC BY-SA, need credit, and show brands. The owner supplies four photos with no brand
  visible (milk, eggs, bananas, olive oil), or names another source. Until then the build
  draws the glyph tile.
