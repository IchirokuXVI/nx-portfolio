# 0061: two controls that are the wrong size

> Client only, styles only. No template restructuring beyond one element moving into a shared
> component, no view model change, no new copy.
>
> Two unrelated sightings of the same underlying thing: a control whose size came from where it was
> written rather than from what it is.

## 1. The footer under "Get shopping list"

The home page and the shopping list history both end in a bar holding one primary action, and they
are **not the same bar**. They are two independent implementations that happen to look alike, and
they differ by four measurable things:

|                      | home, `bottom-action-bar.scss` `.bar`     | history, `shopping-lists-page.scss` `.footer`       |
| -------------------- | ----------------------------------------- | --------------------------------------------------- |
| padding, block start | `--app-space-3`                           | `--app-space-3`                                     |
| padding, inline      | `--app-space-5`                           | `--app-space-5`                                     |
| padding, block end   | `calc(--app-space-5 + --app-safe-bottom)` | `calc(--app-space-6 + env(safe-area-inset-bottom))` |
| background           | `--app-surface-ground`                    | none, so the page's `--app-surface-base` shows      |
| button gap           | `--app-space-2`                           | `--app-space-3`                                     |
| the button           | `flex: 1`, beside a square secondary      | `inline-size: 100%`, alone                          |

The visible defect the user reported is the third row: 16px against 20px, so the history's footer
is 4px taller than home's for the same button. The second row is the one nobody has noticed yet and
is worse, because the two bars are different colours on the two screens somebody moves between with
one tap.

`--app-safe-bottom` is defined as `env(safe-area-inset-bottom, 0px)`, so the two safe area
expressions are equivalent and only the token spelling differs. The history footer should use the
token like everything else in the app.

### 1.1 The fix is one bar, not two agreeing numbers

Editing four numbers until the two files match leaves two files that have to keep matching, and
they have already failed at that once. The bar is a shell: a top rule, a ground, the safe area
inset, and one row of actions. That belongs in `libs/velista/ui` once.

**`BottomActionBar` becomes the shell**, and the two screens supply their contents:

- Keep the component's current name and place, `libs/velista/ui/src/lib/home/bottom-action-bar.ts`.
  It is already imported by the home page and already carries the correct measurements.
- Give it content projection for the row, so the history page can put its own single button in it
  rather than receiving home's pair of outputs. Home's existing `getList` and `joinZone` outputs
  stay exactly as they are, projected content or not, because rewriting home's call site is not
  what this plan is for.
- The history page drops its `.footer` and `.primary` rules and uses the component.

If projection turns out to want more than one slot, the cheaper answer is acceptable and should be
taken: extract the four bar properties into a `bottom-bar` mixin in the velista ui styles and
`@include` it from both places. That still leaves two buttons styled twice, which is the smaller of
the two duplications, and it still makes the numbers have one home.

### 1.2 The numbers that win

Home's, unchanged: `--app-space-5` block end, `--app-surface-ground`, `--app-space-3` inline gap.
They are the ones on the screen every session starts on, so adopting them moves the screen fewer
people look at.

The **button** keeps `min-block-size: var(--app-button-height)` on both, which the two already
agree on, and the glyph gap settles on home's `--app-space-2`.

### 1.3 One thing that must not regress

The history page's `:host` and `.page` are a flex column where only the middle scrolls and the
footer is `flex: none`. Home's bar sits at the end of its own container. Whatever the shared shell
becomes, it must not introduce its own positioning: it is a block that a parent places. A
`position: fixed` in a shared bar would break exactly one of the two screens and it would be the
one nobody opened while making the change.

## 2. The Add button on a postal code

In `postal-code-list`, the form that adds a postal code ends in two buttons that are not a pair:

```scss
.primary {
  @include page.primary-action;
} // 52px, --app-text-base, --app-space-6 inline
.quiet {
  @include page.quiet-action;
} // 44px, --app-text-sm,  --app-space-3 inline
```

So **Add** is 8px taller than **Cancel**, two points larger in its text, and carries twice the
horizontal padding. Side by side in a flex row, it reads as a mistake rather than as emphasis.

### 2.1 Why the mixins are not what is wrong

`primary-action` and `quiet-action` describe two different jobs, and both descriptions are right
where they were written. `quiet-action`'s own comment says it is "a secondary action beside a line
of copy", which is what it is on the account page: a small bordered button at the end of a row.
`primary-action` is a page's main commitment, and 52px is the right size for one.

The mistake is using the row scale button as the **cancel of a form** whose submit is at page
scale. `postal-code-list` is the only place in the app that pairs them, which is why nothing else
looks wrong: `account-page` uses both, in different places, doing their proper jobs.

So the fix is local to `postal-code-list.scss` and the two mixins are not edited. Editing
`quiet-action` to be 52px would grow every row button on the account page and the profiles page,
which is three screens changed to fix one form.

### 2.2 What the two buttons become

The form's actions are a **submit and its cancel**, so they share a size and differ only in weight:

- `.primary` keeps `primary-action`.
- `.quiet` keeps `quiet-action` for its border, transparent ground and text colour, and then
  overrides `min-block-size` to `var(--app-button-height)` and `font-size` to
  `var(--app-text-base)` so it matches the button beside it.
- Add matches Cancel's inline padding down from `--app-space-6` to something the pair can share.
  `--app-space-5` on both is the smallest change that reads as deliberate; the exact token is a
  judgement to make against the rendered screen, and the rule is only that **both take the same
  one**.

The comment on those overrides should say what it is doing, because a local override of a shared
mixin is the kind of thing that gets deleted as redundant: these two are a submit and its cancel,
so they are one control pair at one size, and `quiet-action`'s row scale is not that.

### 2.3 The touch target does not shrink

Both end at `--app-button-height`, which is 52px, comfortably above `--app-touch-target`. Nothing
in this section can make a target smaller and no branch of it should be able to.

## 3. Tests

Neither half is unit testable in a way that would catch a regression: jsdom computes no layout, and
a spec asserting a class name asserts nothing about size.

What is worth having:

- The shared bar shell gets the spec `bottom-action-bar.spec.ts` already has, extended so that
  projected content renders and home's two outputs still fire. That guards the refactor, not the
  measurements.
- `postal-code-list.spec.ts` is unchanged. The form's behaviour is untouched.
- Both halves are **verified by looking**, on a slot, at a narrow viewport, in both themes. Note in
  the PR which screens were opened: home, `/shopping-lists`, and `account/profiles` with the add
  form open.

## 4. Out of scope

- **The basket page's composer dock** and the sheet shells, which have their own bottom insets for
  their own reasons and are not this bar.
- **Auditing every other `--app-safe-bottom` expression in the app.** There are a dozen, they are
  consistent, and touching them is a sweep nobody asked for.
- The `primary-action` and `quiet-action` mixins themselves, per section 2.1.
