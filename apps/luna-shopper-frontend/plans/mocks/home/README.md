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
- The wordmark is set in Instrument Serif, and it is the only place a display face is used
  apart from the hero headline.

Phone frames are 390 by 844, and there are deliberately no desktop artboards. Colour values
are literal here rather than tokenized, because
an artboard is a flat HTML file with no build step. They follow the token values in
`../../0002-design-system-and-theming.md`, so **if a token changes there, change it here
too** or the mock stops describing the system.

## Rebuilding the canvas

Edit the `.dc.html` files, then re-seed and republish to the **same** artifact URL. The
seeded output (`luna-shopper-home.html`) is a generated bundle of about 2.5 MB that embeds
the canvas editor, so it is git ignored and always rebuilt rather than edited.

Re-seeding is done through the `design` skill, which owns the helper script and the payload
template. Ask Claude to update the home page mock and it will re-seed from these files.
Editing the published canvas directly in the browser also works, but then these sources are
behind and need to be extracted back out before the next change.
