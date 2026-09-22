# The product typeahead

The mock for `0101`. Eleven artboards: the two screens the typeahead is used on, a group
opened, the popover that says what a group is, the sheet the assistant reviews its rows
in, the Day theme, a card with every shop price open, the thumbnail sizes, the vertical
budget, the other states, and the three places the button that adds could have gone.

Built on this canvas the usual way, so `build-index.mjs typeahead` rebuilds `index.html`
from the artboards and `canvas.json`. Two things about it are not usual.

## It has photographs

Every other folder here draws with CSS alone. This one cannot: the card is a product card
and its subject is a 48px photo, so a grey square would not answer the question the
canvas was drawn to answer.

`photos/` holds twelve front photos from [Open Food Facts](https://world.openfoodfacts.org),
which publishes them under CC BY-SA 3.0. They are 127 KB in total. They stand in for
`ItemView.imageUrl`, which exists on the wire already and holds nothing until the Open
Food Facts import lands (backend `0126` to `0129`).

The consequence for publishing: `index.html` references them by relative path, so it is
no longer one file that can be published alone. Publish it with `photos/` passed beside
it as supporting files, or the cards come up blank. Opening `index.html` from disk is
unaffected.

## Each artboard carries the whole stylesheet

The other folders style with inline attributes. Eleven artboards drawing the same card
cannot, so the token sheet from `../0002-design-system-and-theming.md` sits in each
artboard's `<helmet>`, once per file, and the build scopes each copy to its own artboard.

**So a token change has to be applied to all eleven files.** They are byte identical from
the top of the sheet down to each artboard's own additions, which is what makes a prefix
check a safe way to patch them. That duplication is also why `index.html` here is 416 KB,
against 187 KB for the largest of the others.

## What the canvas assumes and the app does not have

Section 2 of the plan is the authority. In short: the suggestion response carries no
`scopes` map, so no row can name a chain today, and that is the one server change the
card cannot be built without. The rest is either already on the wire and unmapped, or a
join velista can do for itself.
