# Velista home page mock sources

The design for `../../0003-home-page.md`, and for the split into a front door and a
dashboard in `../../0007-landing-and-home-split.md`.

Published: https://claude.ai/code/artifact/71175929-0234-4c6e-a277-e26db88e05d5

How these folders work, how to rebuild `index.html`, and the conventions every artboard
follows are in **`../README.md`**. Read that first.

| File | Artboard |
| --- | --- |
| `Main.dc.html` | Anonymous, first open |
| `Authenticated.dc.html` | Signed in, returning user |
| `TemporaryAccount.dc.html` | Guest account, plus a group pending approval |
| `DayTheme.dc.html` | The signed in screen in the light theme |
| `Brand.dc.html` | The Velista mark, wordmark lockups and size tests |
| `States.dc.html` | Empty, no connection and error, three phone frames in one artboard |

Two things this design decided that are easy to undo by accident:

- Losing the network is **one blocking screen that reloads itself**, not a banner over
  cached content. A temporary simplification, recorded in `../../0003` section 3.1.
- The join request row names the **first** requester and adds "and X more want to join"
  only when there is more than one. `Authenticated.dc.html` shows the multi case.

`DayTheme.dc.html` exists because the bright Night ramps fail as text on white: mint and
amber both land near 1.9:1 on `#ffffff`. Each status role resolves to a different
primitive per theme, 400 on Night and 700 on Day.
