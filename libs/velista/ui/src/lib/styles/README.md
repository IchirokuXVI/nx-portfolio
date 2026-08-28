# The design system

Implements plan 0002 (`apps/velista/plans/0002-design-system-and-theming.md`). Read that
first for the reasoning; this file is the map and the working rules.

## Files

| File               | Layer   | Holds                                                                                                |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `_primitives.scss` | 1       | The colour ramps. **The only literal colours in the app.**                                           |
| `_semantic.scss`   | 2 and 3 | The theme independent half: type, space, radius, motion, touch, focus geometry, component knobs.     |
| `_themes.scss`     | 2       | The colour half: `theme-night` and `theme-day`, and nothing else.                                    |
| `_tokens.scss`     | none    | The entry point. Everything writes `@use '../styles/tokens' as tokens;` and nothing reaches past it. |

The tokens land on the app's own root element via `app-layout.scss`, never on `:root`
(plan 0001, extraction contract item 4). On extraction that one selector becomes `:root`
and nothing else changes.

## Rules

**T1. A component may only reference semantic or component tokens.** Referencing a
layer 1 primitive is a bug, because it will not follow a theme change. Referencing a
hand written colour will not follow anything at all.

**T2. Never place white or light text on `--app-action-bg`.** Amber with white text is
about 1.9:1. `--app-action-fg` exists so this cannot be gotten wrong by accident.

**T3. Input fields are never below 16px** (`--app-field-font-size`). iOS Safari zooms the
viewport when a focused input is smaller, which on a phone form is a jarring, hard to
undo jump.

**No raw pixels in a component.** The scales exist so the phone layout stays one system.
`1px` is exempt: a hairline is one device pixel by definition.

## What enforces them

Three specs, all in the normal `nx test velista/ui` run. None of them needs a new tool.

- **`token-hygiene.spec.ts`** scans every `.scss` under `libs/velista` and
  `apps/velista/src` for literal colours, colour functions, named colours, layer 1
  primitive references and raw pixel values. The four files in the table above are the
  only exemptions, and that list is the design system. It also asserts its own patterns
  still fire, so a broken regex fails loudly instead of passing silently.
- **`contrast.spec.ts`** compiles `app-layout.scss` with Dart Sass, resolves every
  `var()` chain and alpha tint back to real channels, and checks every token pair that is
  actually used together in **both** themes: text on all four surfaces, status text
  inside its own chip fill, the action label on all three button states, input outlines,
  and the focus ring. It reads the compiled stylesheet rather than a second copy of the
  palette, so it cannot reassure you about values the app no longer uses.
- **`../brand/brand-rename.spec.ts`** rehearses the rename by providing a different
  `AppBrand` and asserting nothing of the old name survives in anything a person can read
  or hear: the visible text and every accessible name.

## What the contrast check changed

Running it over both themes for the first time moved four values off what the plan
sketched. Each is recorded in a comment beside the token, and in section 4.6 of the plan:

| Token                       | Plan          | Now           | Why                                                           |
| --------------------------- | ------------- | ------------- | ------------------------------------------------------------- |
| Night `--app-text-muted`    | `neutral-500` | `neutral-400` | 3.99:1 on a raised card, which is exactly where metadata sits |
| Day `--app-text-muted`      | `neutral-500` | `neutral-550` | 4.09:1 on the Day ground; `neutral-600` is already secondary  |
| Night `--app-border-strong` | 18% white     | 35% white     | An input outline has to clear 3:1; 18% is about 1.7:1         |
| Day `--app-border-strong`   | `neutral-300` | `neutral-500` | Same, 1.7:1 on a white card                                   |

This is the same exercise that produced the plan's own 400 versus 700 rule, and it is the
reason every page mock has to include a Day artboard.

## Adding a theme

A theme is a class on the app root that redefines the colour roles listed at the top of
`_semantic.scss`, and nothing else. Write the mixin in `_themes.scss`, include
`app-contrast-preferences` at its tail (it has to live inside the theme rule to outrank
it), forward it from `_tokens.scss`, add a `:host(.theme-x)` block in `app-layout.scss`,
and add the name to `AppTheme`. The contrast spec will then cover it automatically.
