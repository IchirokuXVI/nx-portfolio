# 0051: a title that is not a mark

> One declaration, reported the way the last one was: the header on
> `/shopping-lists/:id` does not look like the rest of the app. It is bigger, it is
> in a different face, and it is set at a different size.
>
> It became so yesterday. `0048` replaced a hand drawn header on that screen with
> the destination bar the assistant and the history draw, and took the title's
> treatment along with the bar. The bar was the right thing to take. The title was
> not, and the reason it was not is worth writing down, because `0037` is the plan
> that established the treatment and this is the boundary it did not have to draw
> at the time.

## 1. What the wordmark treatment is for

`0037` section 1 raised the assistant's title to `--app-text-2xl` and gave it
`--app-tracking-wordmark`, so that walking from home into the assistant does not make
the words in the top left change size. Home draws `AppBar`, whose lockup is
`BrandWordmark`; a destination with no app bar has a title standing exactly where the
mark stood, and half a match reads worse than none.

Section 1.1 then amended `0002` section 6 to permit the display face in a third place:
**a destination header that stands in for the wordmark.** A rule with a boundary rather
than an exception with none, as it says.

The boundary it did not need to state is the one this plan states now.

**Every title the treatment has ever been given is a word of the product's own.**
"Assistant". "Shopping lists". "Install". They are fixed strings, they are short, they
are the app naming a place inside itself, and that is what makes setting them as a mark
say something true: the thing in the top left is still the app's name for where you are.

## 2. Why the basket is not one of them

A basket's title is `basket.name`, which is whatever the person who generated it called
their shopping list, and when there is no name it is the date it was generated, formatted
in the reader's locale. It is content. It is as long as somebody felt like typing.

Set as a mark it does three things wrong at once:

- **It is too big for what it is.** `--app-text-2xl` is `clamp(24px, 7vw, 32px)`: 27px on
  a 390 wide phone, against the `--app-text-xl` the list page gives the same kind of
  string. A name is not more important than the basket under it.
- **It wraps, and the wrap moves the screen.** The declaration that came with it was
  `overflow-wrap: anywhere`, so "Compra semanal del piso" takes three lines at that size
  and pushes the face row, the progress line and the first product down with it. The
  history's title never wraps, because "Shopping lists" is two words that were chosen.
- **The tracking is for a short word.** `--app-tracking-wordmark` is 0.05em because a
  short word in a wide serif needs air between its characters to read as a mark. A
  sentence of somebody's own text at that spacing reads as a sentence that has been
  stretched.

## 3. What it takes instead

**The step the list page gives the same string**: `--app-font-display` at
`--app-text-xl`, weight 400, no wordmark tracking, one line with an ellipsis.

`ListHeader` sets a list's name that way, and the list page is the one other screen in
this app that is a shopping list somebody is carrying around a shop. Two screens of the
same kind, titled by the same kind of string, now set it the same way. The display face
stays, so the basket does not read as a plainer screen than the list it came from; only
the mark's size and the mark's spacing go, because the basket's title is not a mark.

`0002` section 6's third entry is unchanged and still correct. It is now read with the
qualification this plan adds: **a destination header stands in for the wordmark when its
title is the app's own word for the place. A title that is the reader's own text is
content, and takes the page's content title step.**

## 4. The bar under it

One more thing on the same screen, from the same commit and visible for the same reason.

`.page` includes the `basket-shared` page mixin, whose `padding: var(--app-space-4)` is
for a page whose content starts at the top. This one starts with the bar, so the padding
left a strip of `--app-surface-ground` above it and the rule under the bar floated a
little way down the screen rather than closing a header. The history's bar and the
assistant's are both flush.

**`padding-block-start: 0` on `.page`.** The notch inset stays on `.bar`, which is the
thing that has to clear it.

## 5. What is not changed

- **The history page and the assistant page.** Both title a place with the app's own
  word for it, which is exactly the case the treatment is for.
- **The bar itself**: the same padding, the same rule, the same chevron and the same
  glyph class as the history's. `0048` was right about the furniture.
- **The face row, the sheets and every other screen.** Nothing outside
  `basket-page.scss` and its template moves.
