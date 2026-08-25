# Velista home page mock sources

Working sources for the home page design canvas described in `../../0003-home-page.md`.

Published canvas: https://claude.ai/code/artifact/71175929-0234-4c6e-a277-e26db88e05d5

## Files

| File | Artboard |
| --- | --- |
| `Main.dc.html` | Anonymous, first open |
| `Authenticated.dc.html` | Signed in, returning user |
| `TemporaryAccount.dc.html` | Guest account, plus a group pending approval |
| `DayTheme.dc.html` | The signed in screen in the light theme |
| `Brand.dc.html` | The Velista mark, wordmark lockups and size tests |
| `States.dc.html` | Empty, no connection and error, three phone frames in one artboard |
| `canvas.json` | Positions, artboard titles and the sticky notes |

The mark's source of truth is `../brand/velista-app-icon.svg` and `../brand/velista-mark.svg`.
The artboards inline copies of it, so a redraw has to be applied in both places.

Three conventions the artboards follow, all easy to undo by accident:

- The UI says **group** and **grupo**. The code says **zone**. See rule N2 in `../../0001`.
- Losing the network is **one blocking screen that reloads itself**, not a banner over
  cached content. This is a temporary simplification, recorded in `../../0003` section 3.1.
- The wordmark is set in Marcellus with `letter-spacing: 0.05em`, and the hero headline is
  the only other place a display face is used. The hero does **not** take that tracking.

Phone frames are 390 by 844, and there are deliberately no desktop artboards. Colour values
are literal here rather than tokenized, because
an artboard is a flat HTML file with no build step. They follow the token values in
`../../0002-design-system-and-theming.md`, so **if a token changes there, change it here
too** or the mock stops describing the system.

## Keeping these designs as docs in the repo

There are three layers, and they do different jobs. Use all three rather than picking one.

**1. The source, already committed.** The `.dc.html` artboards plus `canvas.json` in this
folder are the real design. They are plain, self contained HTML with inline styles and no
build step, so they survive with the repo whether or not the canvas or the tool that made
it still exists. This is the layer that matters most, and it is the one that is already
version controlled and diffable in a pull request.

**2. A local look, no artifact needed.** Open `index.html` in a browser. It embeds every
artboard side by side, straight off disk. Good for reading the repo on a plane, and for
anyone who cannot open the published canvas.

**3. Static images, for embedding in the plan docs.** Markdown cannot render an artboard,
so when a plan needs to *show* a screen rather than link to it, export an image:

- In the published canvas, use **Export** in the toolbar. PNG exports the selected
  artboard; Export PDF captures every visible artboard into one document.
- Save them under `exports/` in this folder, named after the artboard
  (`exports/authenticated.png`).
- Reference them from the plan with normal Markdown: `![Signed in](mocks/home/exports/authenticated.png)`.

Two caveats worth knowing before you rely on exports. They are **snapshots**: nothing keeps
them in step with the artboards, so re-export when a design changes or the docs start
lying. And PNG and PDF export does **not** embed Google Fonts, so exported text renders in
the fallback stack rather than in Marcellus. That is why the fallback is Georgia, which has
similar proportions, and it is worth checking an export before circulating one.

For a design that must stay correct forever, such as the brand mark, prefer a committed SVG
over an export: see `../brand/`.

## Rebuilding the canvas

Edit the `.dc.html` files, then re-seed and republish to the **same** artifact URL. The
seeded output (`velista-home.html`) is a generated bundle of about 2.5 MB that embeds
the canvas editor, so it is git ignored and always rebuilt rather than edited.

Re-seeding is done through the `design` skill, which owns the helper script and the payload
template. Ask Claude to update the home page mock and it will re-seed from these files.
Editing the published canvas directly in the browser also works, but then these sources are
behind and need to be extracted back out before the next change.
