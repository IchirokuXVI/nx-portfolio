# Brand assets

The two files here are the **one deliberate exception** to rule N1 (plan 0001), which
otherwise keeps the product name out of every filename, class, token, route and
translation key. The mark is the identity itself, so these two carry it.

`AppBrand.wordmarkSrc` and `AppBrand.iconSrc` hold these filenames as **values**, and a
rename replaces these files and edits the provider and nothing more (plan 0002, section
5.1). Turning those values into URLs is not built yet, and section 5.3 records why: it
fails the production build. `BrandMark` inlines the outline mark instead, naming this one
file directly, which is the same exception.

The favicon and the web app manifest are the document level consumers that were waiting
on the standalone phase, and plan `0013` landed them. They still resolve no filename at
runtime: they name PNGs sitting in `apps/velista/public`, exported from these sources by
the recipe below, so `BrandAssetResolver` stays deferred and stays unneeded.

| File                   | Use                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `velista-mark.svg`     | Outline version in `currentColor`, two scribbles. Anywhere the amber tile is too loud, which is most places inside the app |
| `velista-app-icon.svg` | Full bleed amber tile with the boat in ink. App icon, favicon, install icon, store listing                                 |
| `velista-app-icon-small.svg` | The same tile with **one** bolder scribble instead of three. The favicon, at 16, 32 and 48                          |

The tile is **not** a `currentColor` icon: its scribbles are knocked out in the
background colour, so it only works on its own amber tile. Anywhere the mark has to
adopt the surrounding colour, use the outline version.

All three are stripped of the `<title>` and `aria-label` the plan artboards carry. An
accessible name baked into the file would be a second place the product name lives, and
the components supply it from `AppBrand.name` instead.

## The small variant, and why it is a third file

`velista-app-icon-small.svg` is the degradation rule below applied rather than
described. Exported straight from the full tile, the three scribbles merge: at 32 they
read as hatching across the sail, and at 16 as a smudge. Both are the failure the
fourth bullet names, and neither is fixable by resampling, because the problem is that
the detail is there at all.

So the small variant drops two scribbles and thickens the survivor to 1.7, keeping it
well short of the sail's trailing edge so the sail stays one shape instead of being cut
in half by an amber band. It is a **derivation, not a second identity**: a redraw of the
mark changes both files, and rule N1's exception still covers the mark rather than
growing a new member.

## Regenerating the raster set

Every PNG and the `.ico` in `apps/velista/public` comes from the two tiles here, so
they cannot drift (plan 0013 D6). They are files in `public/`, copied by the assets
glob, never imported: a TypeScript `import` of a brand SVG puts it through webpack's
`asset/resource` rule and **fails the velista production build** (plan 0002, section
5.3).

```sh
# any: the tile as drawn, rounded corners and all
magick -background none velista-app-icon.svg -resize 512x512 -depth 8 -strip icons/icon-512.png
magick -background none velista-app-icon.svg -resize 192x192 -depth 8 -strip icons/icon-192.png

# maskable: full bleed (Android applies its own mask, so the tile's own rounded
# corners would be clipped twice), boat scaled to the middle 80% safe zone
#   <rect width="24" height="24" fill="#ffb454"/>            <- drop rx
#   <g transform="translate(12 12) scale(0.8) translate(-12 -12)">  <- wrap the boat
magick -background none velista-app-icon-maskable.svg -resize 512x512 icons/icon-maskable-512.png

# apple touch: squared corners (iOS applies its own superellipse), and flattened,
# because iOS renders any alpha as black
magick -background '#ffb454' velista-app-icon-square.svg -resize 180x180 -alpha remove -alpha off -depth 8 -strip apple-touch-icon.png

# favicon: the small variant, all three sizes in one file
magick -background none velista-app-icon-small.svg -resize 48x48 -define icon:auto-resize=48,32,16 favicon.ico
```

The maskable and square inputs are two line edits of the full tile rather than committed
files, since nothing but this recipe ever reads them.

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
