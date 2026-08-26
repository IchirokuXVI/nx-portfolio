# Brand assets

The two files here are the **one deliberate exception** to rule N1 (plan 0001), which
otherwise keeps the product name out of every filename, class, token, route and
translation key. The mark is the identity itself, so these two carry it.

`AppBrand.wordmarkSrc` and `AppBrand.iconSrc` hold these filenames as **values**, and a
rename replaces these files and edits the provider and nothing more (plan 0002, section
5.1). Turning those values into URLs is not built yet, and section 5.3 records why: it
fails the production build, and nothing needs it until the favicon and manifest, which are
document level and belong to the standalone phase. `BrandMark` inlines the outline mark
instead, naming this one file directly, which is the same exception.

| File                   | Use                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `velista-mark.svg`     | Outline version in `currentColor`, two scribbles. Anywhere the amber tile is too loud, which is most places inside the app |
| `velista-app-icon.svg` | Full bleed amber tile with the boat in ink. App icon, favicon, install icon, store listing                                 |

The tile is **not** a `currentColor` icon: its scribbles are knocked out in the
background colour, so it only works on its own amber tile. Anywhere the mark has to
adopt the surrounding colour, use the outline version.

Both are stripped of the `<title>` and `aria-label` the plan artboards carry. An
accessible name baked into the file would be a second place the product name lives, and
the components supply it from `AppBrand.name` instead.

## Redrawing it

**Velista** comes from _velero_, a sailing boat; a _velista_ is the person sailing it.
The mark is a small sailboat carrying one oversized sail that is a sheet of paper with
handwriting on it. The sail is the shopping list, and the list is what carries you along.
The sail is deliberately far too large for the hull, so the paper reads first and the
boat second.

Four things are load bearing and a redraw must keep them (plan 0002, section 5.0):

- **The scribbles get longer as they go down**, following the sail widening toward the
  foot. That is what makes them read as written lines rather than as hatching.
- **The scribbles stop well short of the sail's trailing edge**, by roughly 1.4 to 1.9
  units in the 24 unit grid, with a comfortable margin at the mast side too. Running them
  to the edge makes the sail look striped and hides the curve.
- **The foot of the sail curves.** A straight bottom edge reads as a flag; the curve reads
  as paper.
- **It degrades by dropping detail, not by shrinking it.** The tile carries three
  scribbles, the outline two, and below roughly 16px they should become one bolder stroke,
  because three would merge into a smudge.
