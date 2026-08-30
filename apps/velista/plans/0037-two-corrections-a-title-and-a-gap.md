# 0037: two corrections, a title and a gap

> Two small things, unrelated to each other except in being small. The assistant's title is
> a size smaller than the wordmark it replaces, so walking from home into the assistant
> makes the word in the top left jump. And the comment composer's send button sits four
> pixels from the box it belongs to, which is close enough to read as a mistake.
>
> Both are one declaration each. They are written down because the reason for each value
> matters more than the value, and because both sit on rules from `0002` that a later change
> could undo by accident.

## 1. The assistant title is a size smaller than the wordmark

Home draws `AppBar`, whose lockup is `BrandWordmark`, whose name is set at
`--app-text-2xl`, `clamp(24px, 7vw, 32px)`. The assistant is a destination with its own
header rather than the app bar (`0032` section 2), and its title is set at
`--app-text-xl`, `clamp(20px, 5vw, 24px)`.

On a 390 wide phone that is 27px becoming 20px. The two words sit in roughly the same place
on two screens one tap apart, in the same face, in the same colour, at two different sizes,
and the transition is exactly what the report describes: the text goes slightly wrong on the
way in and there is no obvious reason why.

**The title takes `--app-text-2xl`.** That is the whole fix, and the reason it is the right
one rather than shrinking the wordmark is that `2xl` is the page title step. `_semantic.scss`
labels it so: `xl` is for section headings, `2xl` is for page titles, and "Assistant" is the
title of a page.

Two details go with it, because half a match reads worse than none:

- **The letter spacing matches too.** `--app-tracking-wordmark` exists because a short word
  in a wide serif needs air between its characters at this size to read as a mark rather
  than as a word. "Assistant" and "Asistente" are short words in the same face at the same
  size, standing where the mark stood, so they want the same treatment. `0002` records that
  the hero deliberately does not inherit this, and the reason given is the size: at 41px the
  same value is far too loose. That reason does not apply here, because the size is the
  same.
- **The weight and the line height are already right** at 400 and `--app-leading-heading`,
  and nothing about them changes.

### 1.1 The display face, and a rule that needs amending rather than breaking

`0002` section 6 permits the display face in two places, the wordmark and the hero headline
on the public home page, and says it is "absent from every authenticated screen, so the app
itself stays on the system stack".

**The assistant title already uses `--app-font-display`**, and has since `0032`. So the rule
already has a third case, undocumented, and this plan is either the moment to remove it or
the moment to write it down.

Write it down. The assistant is the one authenticated destination whose header replaces the
wordmark rather than sitting under it, and matching the thing it replaced is the entire
point of this correction. What the rule is protecting is a product where every screen is set
in a serif, and one title in one destination header is not that. `0002` section 6 gains a
third entry: **a destination header that stands in for the wordmark**, which is a rule with
a boundary rather than an exception with none.

### 1.2 What it costs

The header grows by a few pixels on a phone, since the title's line box passes the back
button's touch target. The back button's own target is set by `min-block-size` and does not
move. The bar is `flex` with `align-items: center`, so nothing else in it needs adjusting.

The account page and the credential screens draw their own headers in the same shape
(`0009`, `0015`). **They are not changed here.** Their titles are section headings above a
form, not a name standing where the wordmark stood, and making all of them `2xl` because one
of them should be would be the same mistake in the other direction. If they turn out to want
it, that is a look at all of them together and not a side effect of this one.

## 2. The send button is four pixels from the box

`.composer` in `comment-composer.scss` sets `gap: var(--app-space-2)`, which is 4px. At that
distance the button reads as attached to the textarea rather than beside it, and on a dark
theme where both have their own fill, the two shapes very nearly touch.

**`--app-space-4`, which is 12px.** One step up would be 8px, which is still inside the range
where two adjacent filled shapes read as one control. 12px is the gap this app uses between
things that belong together but are separate, and it is what the line composer already puts
between its field and its stepper.

Everything else about the composer stays. `align-items: stretch` is what makes the button
exactly as tall as the box beside it, and the comment on it explains that `flex-end` made it
read as two adjacent controls rather than one composer. That was a correction in the same
family as this one and this plan does not undo it: the button still matches the box's height,
it just stops crowding it.

## 3. What is tested

Neither is a behaviour, so neither gets a behavioural test. What gets checked:

- The existing `assistant-page` and `comment-composer` specs stay green, which is the real
  assertion here: a size change that broke a spec would mean something was reading the size,
  and nothing should be.
- The design token check in `0002` section 12, which is that every value used is a token.
  Both of these are, and an inline `12px` or `28px` in either file is the failure mode this
  plan is most likely to be implemented as.

## 4. Exit criteria

- Going from home to the assistant leaves the word in the top left at the same size, in the
  same face, with the same tracking.
- `0002` section 6 names the third place the display face is permitted.
- No other header in the app changed size.
- The comment composer's button is visibly separate from its box in both themes, and is still
  exactly as tall as it.
- No inline pixel value was added to either stylesheet.
