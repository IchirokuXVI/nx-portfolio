# Plan 02 — About: body copy should not use the display font

**Point:** R6 (was C1). Depends on the rule in Plan 01.

## Problem
The two dark About sections render multi‑line **body paragraphs in `Audiowide` at 1.15em (~18.4px)**, while every other body paragraph on the site (including "OUR VALUES" on the same page) uses the `-apple-system` sans stack. It is hard to read and visually inconsistent.

## Root cause (exact)
- `libs/damoclesSword/ui/src/lib/section-who-we-are/section-who-we-are.scss` lines ~26–31:
  ```scss
  .content-text span {
    font-family: 'Audiowide', sans-serif;
    font-size: 1.15em;
    line-height: 1.8;
    white-space: pre-line;
  }
  ```
- `libs/damoclesSword/ui/src/lib/section-future/section-future.scss` — identical block. **Both** must change.
- Markup: `section-who-we-are.html` / `section-future.html` wrap the copy in `<span>{{ '…body' | rokuT }}</span>`.

## Proposed fix
Switch these paragraphs to the body font; keep the reading rhythm.
```scss
.content-text span {
  font-family: inherit;      // -apple-system system sans stack
  font-size: 1.0625em;       // ~17px; tune to match Home body copy
  line-height: 1.7;
  white-space: pre-line;     // keep — the copy relies on line breaks
}
```
- Keep `white-space: pre-line` (the translated body strings contain intentional paragraph breaks).
- Match the size/line‑height to Home's body copy (`.subsection-description`, ~19.2px / `.card-main-content`) so About reads like the rest of the site.

### Alternative (if the brand insists on Audiowide here)
Per Plan 01 you *could* instead bump to `font-size: 1.5em`, but for **long‑form paragraphs** that is large and still a display face — **not recommended**. Switching to the body font is the right call for body copy.

## Files to change
- `libs/damoclesSword/ui/src/lib/section-who-we-are/section-who-we-are.scss`
- `libs/damoclesSword/ui/src/lib/section-future/section-future.scss`

## Verification
- Screenshot About at 1920/1280/360: "WHO WE ARE" and "IN THE FUTURE" paragraphs now match the sans‑serif of "OUR VALUES".
- Confirm the `pre-line` breaks still render (no collapsed paragraphs) in en/es/fr.
- `npx nx test damoclesSword-ui` (both section specs), `npx nx lint damoclesSword-ui`.

## Risk
Low. Section height shrinks a little (sans is more compact than Audiowide); re‑check the media box still aligns beside the text at desktop and stacks under it below the 800px container query.
