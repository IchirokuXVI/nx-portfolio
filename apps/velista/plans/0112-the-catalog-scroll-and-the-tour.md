> **PR:** [#494](https://github.com/IchirokuXVI/nx-portfolio/pull/494)

# 0112: the catalog scroll and the tour

Three small fixes found on a phone after plan `0106` made the app frame a non scrolling column:

1. The catalog shows a scrollbar while it scrolls. The user wants none.
2. The tour's first card is cut off a little at the bottom.
3. The tour's microphone card on a zone list says to hold the button. The button is a toggle:
   one tap starts listening and another tap stops.

## Brief for the agent

### Objective

Hide the catalog's scrollbar while keeping it scrollable, make the first tour card fully
visible, and correct the microphone copy in both languages.

### Context

- **Scrolling after `0106`.** The frame's `.app-page` slot
  (`libs/velista/ui/src/lib/layout/app-layout.scss`) scrolls every page that has no scroller of
  its own, and the catalog is one of them. `catalog-page.scss` still opens with a stale comment
  saying scrolling is page level. The hidden scrollbar pattern exists twice, inline:
  `chain-chips.scss` and `suggestion-list.scss` (`scrollbar-width: none` plus
  `::-webkit-scrollbar`). There is no shared mixin.
- **The tour.** Stops are in `libs/velista/platform/src/lib/tour/tour-stops.ts`. The first stop
  is `nav`, anchored on the bottom bar, placement `above`. Placement is `placeCard()` in
  `libs/velista/ui/src/lib/tour/tour-spotlight.ts` (`CARD_GAP`, `SCREEN_EDGE`, viewport from
  `documentElement.clientHeight`). The card has no max height. The spotlight re-measures on
  `window:resize`, `window:scroll` and after every render. Since `0106` the window never
  scrolls, so `window:scroll` never fires.
- **The copy.** `tour.voice.body` in `libs/velista/ui/assets/i18n/es.json` ("Mantén pulsado el
  micrófono...") and `en.json` ("Hold the microphone..."). The button is in
  `libs/velista/ui/src/lib/list/line-composer.html`: a click starts listening, and a `.stop`
  button stops it.

### Target state

1. **Catalog.** The catalog scrolls with no visible scrollbar on Chrome, Firefox and Safari. No
   other page changes. The stale comment in `catalog-page.scss` describes the real scroller. If
   you add a mixin for the pattern, use it in the two existing places too.
2. **First tour card.** Reproduce the defect first at 390 x 844 and at 360 x 640, in both
   languages, in both run modes, and find the cause by measuring (`getBoundingClientRect` of the
   card, the ring and the bar). Then:
   - the whole card, including its buttons and its shadow edge, is inside the viewport and not
     under the bar, on every stop at both sizes
   - a card too tall for the free space scrolls inside itself rather than leaving the screen
   - the spotlight re-measures when `.app-page` scrolls (listen in the capture phase or on the
     scroller), so a stop does not drift after `0106`
3. **Copy.** `tour.voice.body` says to tap the microphone, speak, and tap again to stop, for
   example "Toca el micrófono, di lo que falta y vuelve a tocarlo para terminar." / "Tap the
   microphone, say what is missing, and tap it again to finish." Keep the second sentence about
   busy hands. Check every other string in both files that mentions holding the microphone.

### Scope

Work in `libs/velista/feature-catalog` (the page stylesheet, and the page only if it has to
own its scroller), `libs/velista/ui/src/lib/layout` only if the catalog cannot be targeted
otherwise, `libs/velista/ui/src/lib/tour`, `libs/velista/platform/src/lib/tour` only if a stop
needs a new placement, the two translation files, and their specs.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- `100svh` only, and `token-hygiene.spec.ts` rejects raw pixel values except `0px` and `1px`.
- Keep keyboard and screen reader scrolling of the catalog working.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- hiding scrollbars on any page other than the catalog
- changing which stops the tour has or their order

### Progress evidence

- `npx nx run-many -t lint,test -p velista/ui velista/feature-catalog velista/platform` green,
  and `npx nx build velista` green.
- The measurements before and after for the first card, in the PR body.
- A spec for the re-measure on the page scroller, and one asserting the new copy has no "hold"
  or "mantén".
