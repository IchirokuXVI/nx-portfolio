# The header mock, and the fragment every artboard copies

Plan `0130` gives the app one header. This folder draws it, and this file is the contract
for the same header in every other mock folder. An artboard that draws a page inside the
signed in chrome copies the fragment below and changes only the title, the left end and
the actions.

## The fragment

```html
<header class="ph">
  <!-- left end: a back button OR an icon, never neither and never both (H4) -->
  <button class="ph-lead" type="button" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"></path></svg></button>
  <!-- <span class="ph-icon"><svg width="24" height="24" ...></svg></span> -->
  <h1 class="ph-title">Compra semanal</h1>
  <div class="ph-actions">
    <button class="ph-act" type="button" aria-label="Filter and order"><svg width="22" height="22" ...></svg></button>
    <button class="ph-text" type="button">Near me</button>
  </div>
</header>
```

```css
/* plan 0130: the one page header. 64px, one title style, always a bottom border. */
.ph { flex: none; height: 64px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--app-border-subtle); background: var(--app-surface-ground); }
.ph-lead { flex: none; width: 44px; height: 44px; margin-left: -12px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.ph-icon { flex: none; width: 24px; height: 24px; margin-right: 8px; display: flex; align-items: center; justify-content: center; color: var(--app-text-primary); }
.ph-title { flex: 1 1 auto; min-width: 0; margin: 0; font-family: Marcellus, Georgia, serif; font-size: 20px; line-height: 28px; font-weight: 400; letter-spacing: 0.05em; color: var(--app-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-actions { flex: none; display: flex; align-items: center; margin-right: -10px; }
.ph-act { position: relative; flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.ph-text { flex: none; height: 44px; padding: 0 10px; display: flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; background: transparent; color: var(--app-action-quiet-fg); font: inherit; font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer; }
```

An artboard with literal colours and no `--app-*` variables writes the values in place of
the variables. Day: ground `#f7f8fc`, border `#dde1ed`, primary text `#111420`, secondary
`#525a78`, quiet action `#8a5a12`. Night: ground `#0a0c14`, border
`rgba(255, 255, 255, 0.08)`, primary text `#f7f8fc`, secondary `#c2c8db`, quiet action
`#ffb454`. When the artboard already names these roles, use its own values.

## The rules a redraw follows

1. **The header is the first child of the phone frame and never scrolls.** It is 64px tall
   on every page and in every state, loading included.
2. **A header holds only a title.** A subtitle, a progress line, a logo, a role chip, a
   count or a quiet text like "near 28013" leaves the header and becomes the first line of
   the content under it.
3. **The brand bar shows on home only.** On home it is this same fragment: the brand mark in
   `ph-icon`, `Velista` as the title, and the offline mark, the assistant and the account
   avatar as the actions. Every other page loses the brand bar, so the page gets shorter by
   one row. Let the content take the space.
4. **The title is 20px Marcellus on every page, home included.** That is the size the plan
   recommends. The review can still pick the larger one, and then one search and replace
   over `.ph-title` changes every artboard.
5. **A page with a way back draws the chevron. A page with none draws its icon.** A tab's
   icon is the one its tab shows in the bottom bar: home, the product glyph for the catalog,
   the basket.
6. **While a page loads, the title is the word for the kind of page**: Group, List, Product,
   Shop, Walk, Supermarket, Categories. Never a grey block, never a sentence.
7. **Quick actions are 44px buttons at the right.** Text actions (Near me, Walks, Done, Stop)
   stay text, in `ph-text`. A status pill that sat in a bar stays, before the text action.
8. **The close X** takes the back position on the two pages that use it today, with the same
   `ph-lead` box.

## Per page

The table in section 4 of the plan is the authority. The cases that are easy to get wrong:

| Page | Left | Title | Actions |
| --- | --- | --- | --- |
| home | brand mark | Velista | offline mark when not live, assistant (quiet action colour), avatar |
| list | back | the list's name | filter (with its count badge), then the gear |
| basket (`live`, `:basketId`) | basket icon | Shopping list | share, map, the ellipsis menu |
| basket history | back | Your shopping lists | none |
| catalog | product glyph | Catalog | none. "near 28013" joins the tools row |
| picker (`catalog/supermarket`) | back | Supermarket | Near me, as `ph-text` with the locate glyph |
| a chain's page | back | the chain's name | none. Logo and shop count are the first content line |
| account, profiles, supermarkets, install | back | the page's title, beside the chevron | none |
| assistant | back | Assistant | none |
| line page | back | the line's text | none |
| shop map pages | back or close, as today | as today | as today, in the slot |

On the list page the List settings text link is gone: it is the gear in the header. The
tools row holds only what is left, and it is not drawn when nothing is left. On the basket
page the filter button stays in the tools row, and the history, people and finish buttons
are gone from the header: they are rows of the menu sheet.

## Glyphs

```html
<!-- gear: list settings, and mapping settings on the walks page -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
<!-- filter -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h8M18 7h2M4 17h2M12 17h8"></path><circle cx="14.5" cy="7" r="2.3"></circle><circle cx="9.5" cy="17" r="2.3"></circle></svg>
<!-- share -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17.5" cy="6" r="2.8"></circle><circle cx="6.5" cy="12" r="2.8"></circle><circle cx="17.5" cy="18" r="2.8"></circle><path d="M9 10.7l6-3.4M9 13.3l6 3.4"></path></svg>
<!-- map -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.2 9 4l6 2.2L21 4v13.8L15 20l-6-2.2L3 20z"></path><path d="M9 4v13.8M15 6.2V20"></path></svg>
<!-- ellipsis: the menu -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.75"></circle><circle cx="12" cy="12" r="1.75"></circle><circle cx="18.6" cy="12" r="1.75"></circle></svg>
<!-- close -->
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg>
<!-- locate: Near me -->
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6.2"></circle><circle cx="12" cy="12" r="1.9" fill="currentColor"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"></path></svg>
<!-- brand mark, home's icon -->
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M11 3v13"></path><path d="M11 4c4 3 6 7 6 12H11"></path><path d="M4 19h16l-2 2H6z"></path></svg>
<!-- home tab, catalog tab (product), basket tab -->
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2"></path><path d="M5.8 10v9.2h12.4V10"></path></svg>
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="7" width="12" height="13" rx="2"></rect><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.84 11 9.36 4"></path><path d="M18.16 11 14.64 4"></path><path d="M3.2 11h17.6"></path><path d="M4.52 11l1.41 7.4a2 2 0 0 0 1.76 1.6h8.62a2 2 0 0 0 1.76-1.6l1.41-7.4"></path></svg>
```

## Building

```sh
node apps/velista/plans/mocks/build-index.mjs header
```
