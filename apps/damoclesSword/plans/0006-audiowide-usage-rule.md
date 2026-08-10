# Plan 0006 — Establish an Audiowide usage rule (titles only)

**Point:** R1 (your finding #1). **Foundational** — plans 0007, 0008, 0009 depend on the rule defined here.

## Problem

`Audiowide` is a geometric **display** font (weights 400 and 600). It is meant for **titles and headings**. The problem is not its size — it reads fine below 1.5em — it is that several components apply it to **main content text** (body copy, form labels, list items, sub-titles/captions), where a display face is the wrong tool and looks out of place next to the rest of the site's body copy.

## Rule to adopt

> Use `Audiowide` (400 / 600) **only for titles and headings**. Every other piece of text — body copy, form labels, list items, sub-titles/captions, status messages, placeholders — uses the sans-serif body font. Size is not the deciding factor; **role** is.

## Source of the font

- `libs/damoclesSword/ui/src/lib/styles/fonts.scss` — the `@font-face`(s) for Audiowide.
  - _Aside (optional, not required by this plan):_ the `src` uses `url('…audiowide-regular.ttf') format('woff2')` — the `format()` says woff2 but the file is a `.ttf`. Harmless today but worth correcting to `format('truetype')` while in here.

## Approach

No new helpers or mixins are needed. The fix is uniform: on any element that carries **content** rather than a title, replace

```scss
font-family: 'Audiowide', sans-serif;
```

with the body font (`font-family: inherit;`, which resolves to the site's `-apple-system` system sans stack). Leave title/heading elements on Audiowide as-is.

Audit every `font-family: 'Audiowide'` occurrence (grep below) and classify each as **title → keep** or **content → switch to body font**. The content offenders are:

| Occurrence                                                                 | Role                | Decision            | Handled in    |
| -------------------------------------------------------------------------- | ------------------- | ------------------- | ------------- |
| `section-who-we-are.scss` / `section-future.scss` `.content-text span`     | body copy           | switch to body font | Plan 0007     |
| `contact-form.scss` `.field label`                                         | form labels         | switch to body font | Plan 0008     |
| `contact-form.scss` `.contact-form-success`                                | status message      | switch to body font | Plan 0008     |
| `section-services-contact.scss` `.contact-subtitle` ("TELL US YOUR NEEDS") | sub-title / caption | switch to body font | Plan 0009     |
| `section-how-we-work.scss` `.phase-items li`                               | list items          | switch to body font | **this plan** |

Every remaining Audiowide usage is a genuine title/heading (e.g. `double-bordered-title`, `.section-title`, `info-card-title`, `feature-title`, `.subheading`, card titles, header/logo/nav, buttons) and **stays on Audiowide** — verify each while auditing, but no change is expected.

### `.phase-items` list items (handled here)

`libs/damoclesSword/ui/src/lib/section-how-we-work/section-how-we-work.scss` — `.phase-items li` (~line 72) sets `font-family: 'Audiowide', sans-serif;`. These are content list items, not titles, so switch them to the body font:

```scss
.phase-items {
  li {
    // ...existing background / border-left / padding...
    font-family: inherit; // system sans stack — not a title
    font-size: 0.85em;
  }
}
```

## Files

- `libs/damoclesSword/ui/src/lib/styles/fonts.scss` (optional `format()` aside)
- `libs/damoclesSword/ui/src/lib/section-how-we-work/section-how-we-work.scss` (`.phase-items li`)
- audit target: every file in the grep result.

## Find every usage

```sh
grep -rn "Audiowide" libs/damoclesSword
```

## Verification

- Re-run the screenshot harness (see reports) at 1920/1280/360; no body copy, label, list item, or caption should render in Audiowide — only titles/headings.
- Spot-check `es.json` / `fr.json` locales — longer translated strings must not reintroduce Audiowide in content.
- `npx nx lint damoclesSword-ui` and `npx nx test damoclesSword-ui`.

## Risk

Low. Pure styling. Main watch-point: switching a component to the body font changes vertical rhythm slightly (line-height), so re-check the affected sections visually.
