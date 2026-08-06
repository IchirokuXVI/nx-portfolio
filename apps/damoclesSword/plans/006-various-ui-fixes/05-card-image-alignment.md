# Plan 05 — Align card images regardless of title height

**Point:** R2 (your finding #2). Affects Services "WHAT DO WE DO?" → OUR APPROACH and About → OUR VALUES.

## Problem
`info-card`s sit side‑by‑side in a row. Each card is an independent vertical flex stack (title → media → description → bar), so when one card's **title wraps to more lines than its neighbours**, its title box is taller and pushes **its own media box down** — the placeholder images no longer share a top edge.

Measured (Services OUR APPROACH, 1920):
- "Direct Contact With The Client" (1 line, h23) → image top **582px**
- "Professional And Innovative Development" (2 lines, h46) → image top **605px**
- "Investigation Of New Technologies" (2 lines, h46) → image top **605px**

→ 23px misalignment. About OUR VALUES has the same structure; it only looks fine today because all four English titles are one line — it will break with a longer string or in es/fr.

## Root cause (exact)
- `libs/damoclesSword/ui/src/lib/info-card/info-card.html` — `<article>` with `.info-card-title` (h3) then `.info-card-media`.
- `libs/damoclesSword/ui/src/lib/info-card/info-card.scss` — `.info-card { display:flex; flex-direction:column; gap:1em; }`. Nothing normalises title height across sibling cards.
- Parent rows: `section-what-we-do` (OUR APPROACH) and `section-our-values` lay the cards out in a flex/row.

## Proposed fixes (pick one)

### Option A — reserve a fixed title height (smallest change) ✅ recommended
Give the title a min‑height of two lines so every card's media starts at the same Y:
```scss
.info-card-title {
  // 1.15em * line-height ~1.2 * 2 lines. Confirm actual line-height.
  min-height: 2.8em;
  display: flex;
  align-items: flex-end;   // multi-line and single-line titles bottom-align to the media
}
```
Pros: local to `info-card`, no parent changes. Cons: fixed for 2 lines; a 3‑line title (rare, long locale) would still push down — pick a min‑height that covers the worst real string.

### Option B — CSS subgrid (most robust)
Make the parent row a grid and let each card share title/media/description rows:
```scss
/* parent row (section-what-we-do / section-our-values) */
.cards-row { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 1.5em; }
/* info-card :host */
:host { display: grid; grid-row: span 4; grid-template-rows: subgrid; }
```
Pros: images align for any number of title lines, no magic numbers. Cons: touches parent sections + `info-card :host`; verify subgrid support against the project's browser targets.

## Files to change
- `libs/damoclesSword/ui/src/lib/info-card/info-card.scss` (Option A) — and its parents `section-what-we-do` + `section-our-values` for Option B.

## Verification
- Re‑run the alignment probe at 1920/1280/360 for **both** sections; every card's media `top` should match within its row.
- Force the failure first: temporarily set an OUR VALUES title to a long string (or switch locale to es/fr) and confirm images still align after the fix.
- `npx nx test damoclesSword-ui`, `npx nx lint damoclesSword-ui`.

## Risk
Low for Option A (verify the min‑height covers the longest real title in every locale). Medium for Option B (subgrid browser support + parent refactor).
