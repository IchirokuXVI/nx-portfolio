# Velista entry flow mock sources

The design for `../../0008-creating-and-joining-a-group.md`: the two ways into the
product that need no credentials.

Published: https://claude.ai/code/artifact/eb800fe2-6786-4528-9f43-2d638f6e5acb

How these folders work, how to rebuild `index.html`, and the conventions every artboard
follows are in **`../README.md`**. Read that first.

| File | Artboard |
| --- | --- |
| `CreateGroup.dc.html` | The name sheet: opening, filled, and in flight |
| `JoinCode.dc.html` | The code sheet: opening, filled, and refused |
| `JoinLink.dc.html` | Arriving cold on a shared link, with no page underneath |
| `AfterEntry.dc.html` | The two outcomes, both of them the dashboard |

**Night theme only**, by decision: every colour role here is one `0003` already proved
on Day, so a Day artboard would restate an answer rather than find one.

Three things this design decided that are easy to undo by accident:

- **The button says "Ask to join", never "Join".** Core lands every join in PENDING with
  no access until an owner or admin approves it.
- **Nothing may name the group behind a code before you ask**, because no endpoint
  resolves a code to a zone. It names itself immediately after, because `listMine`
  returns PENDING memberships joined to their zone.
- **Neither sheet asks who you are.** `username` is optional on both DTOs and the
  backend fills it from the global username. One field per sheet is the intended shape,
  not a shortcut.

The keyboard is drawn as a labelled band rather than a real keyboard, so the height the
sheet actually sits at is visible and checkable.
