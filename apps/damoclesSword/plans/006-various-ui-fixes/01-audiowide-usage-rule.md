# Plan 01 — Establish an Audiowide usage rule (weight/size)

**Point:** R1 (your finding #1). **Foundational** — plans 02, 03, 04 depend on the rule defined here.

## Problem
`Audiowide` is a single‑weight (400) geometric **display** font. At small sizes and weight 400 it reads poorly. It is currently applied at sub‑heading sizes in several components, which is exactly where it looks bad.

## Rule to adopt
> Use `Audiowide` (400 — its only weight) **only at font‑size ≥ 1.5em (~24px)**. For anything smaller (labels, sub‑titles, body copy) use the sans‑serif body font.

## Source of the font
- `libs/damoclesSword/ui/src/lib/styles/fonts.scss` — the single `@font-face` for Audiowide.
  - *Aside (optional, not required by this plan):* the `src` uses `url('…audiowide-regular.ttf') format('woff2')` — the `format()` says woff2 but the file is a `.ttf`. Harmless today but worth correcting to `format('truetype')` while in here.

## Approach
1. Add a small shared helper so the rule is enforced in one place rather than copied. In a shared partial (e.g. `libs/damoclesSword/ui/src/lib/styles/_typography.scss`, imported where needed):

   ```scss
   // Display font — only legible at >= 1.5em; never below.
   @mixin audiowide-display($size: 1.5em) {
     font-family: 'Audiowide', sans-serif;
     font-weight: 400;
     font-size: $size; // callers must pass >= 1.5em
   }

   // Body/label text — the site sans stack.
   @mixin body-text($size: 1em) {
     font-family: inherit; // resolves to the -apple-system system stack
     font-size: $size;
   }
   ```
2. Audit every `font-family: 'Audiowide'` occurrence (grep below) and classify each as **keep‑and‑size‑up** (≥1.5em) or **switch‑to‑body**. Individual components are handled by their own plans:

   | Occurrence | Current size | Decision | Handled in |
   | --- | --- | --- | --- |
   | `section-who-we-are.scss` / `section-future.scss` `.content-text span` | 1.15em | switch to body font | Plan 02 |
   | `contact-form.scss` `.field label` | 0.9em | switch to body font | Plan 03 |
   | form‑title `double-bordered-title` (Contact Us / Starlit) | ~1em | size up to ≥1.5em + uppercase | Plan 04 |
   | `section-services-contact.scss` `.contact-subtitle` ("TELL US YOUR NEEDS") | 1em | size up to ≥1.5em **or** switch to body | Plan 04 (co‑located) |
   | `info-card.scss` `.info-card-title` | 1.15em | size up to 1.5em **or** accept (short uppercase heading) — decide | this plan |
   | `double-bordered-title.scss` (as real section title) | 2em via `.section-title` | already compliant ✅ | — |
   | `main-header`, `logo-brand`, `language-selector`, `news-card`, `project-card`, `call-to-action-button`, `section-projects` | verify each | audit | this plan |

3. For `info-card-title` (1.15em): it is a short, uppercase heading, so it is borderline. **Recommendation:** bump to `1.5em` for consistency with the rule; if the design intends these smaller, document the exception here.

## Files
- `libs/damoclesSword/ui/src/lib/styles/fonts.scss`
- new `libs/damoclesSword/ui/src/lib/styles/_typography.scss` (mixins)
- audit target: every file in the grep result.

## Find every usage
```sh
grep -rn "Audiowide" libs/damoclesSword
```

## Verification
- Re‑run the screenshot harness (see reports) at 1920/1280/360; no Audiowide text should render below ~24px.
- Spot‑check `es.json` / `fr.json` locales — longer translated strings must not reintroduce tiny Audiowide.
- `npx nx lint damoclesSword-ui` and `npx nx test damoclesSword-ui`.

## Risk
Low. Pure styling. Main watch‑point: switching a component to the body font changes vertical rhythm slightly (line‑height), so re‑check the affected sections visually.
