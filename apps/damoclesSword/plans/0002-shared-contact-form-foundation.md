# 0002 — Shared foundation (contact form, form button, info card, contact service)

> Status: **DONE** (built on `dev` before the parallel page workers). This file
> documents the shared pieces the three page workers **consume but must not modify**
> (beyond additive registration). Paths are repo-relative to `D:\Projects\nx-portfolio`.

## Why
Contact (publishing + general form) and Services (general form) share one reactive
form; About and Services share one card. Building these once, before the parallel
phase, removes the biggest source of cross-branch merge conflicts.

## What exists now (ready to import from `@portfolio/damoclesSword/ui` / `@portfolio/damoclesSword/data-access`)

### `ContactForm` — `lib-damocles-sword-contact-form`
`libs/damoclesSword/ui/src/lib/contact-form/`. Reactive form with fields email
(required + email), name, affair, message (required), links. Submits via the mocked
`ContactMock` (600 ms delay) and shows a success message. Two **projected slots with
defaults**:
- `[contact-form-title]` — override the heading. Default = a `DoubleBorderedTitle`
  with `contact-form.default-title` ("Contact Us").
- `[contact-form-submit]` — override the submit control. Default = a `FormButton`
  reading `contact-form.send`. **Any projected replacement must be `type="submit"`**
  and live inside the form (projection keeps it inside `<form>`).

Usage — custom title, default button:
```html
<lib-damocles-sword-contact-form>
  <lib-damocles-sword-double-bordered-title contact-form-title>
    {{ 'section-services-contact.form-title' | rokuT }}
  </lib-damocles-sword-double-bordered-title>
</lib-damocles-sword-contact-form>
```
Usage — all defaults (general contact):
```html
<lib-damocles-sword-contact-form></lib-damocles-sword-contact-form>
```
Theming CSS vars (set on the host or an ancestor): `--contact-input-bg`,
`--contact-input-color`, `--contact-input-border`, `--contact-label-color`,
`--contact-accent`, `--contact-accent-focus`, `--contact-error-color`.

### `FormButton` — `lib-damocles-sword-form-button`
`libs/damoclesSword/ui/src/lib/form-button/`. A real `<button>` (submits forms).
Inputs: `type` (default `'submit'`), `disabled` (default `false`). Label via
`<ng-content>`. Theming vars: `--form-button-bg`, `--form-button-color`,
`--form-button-accent`.

### `InfoCard` — `lib-damocles-sword-info-card`
`libs/damoclesSword/ui/src/lib/info-card/`. Card with `title` + `description` inputs
(already-translated strings), an optional `[media]` projection slot (neutral
placeholder box until assets arrive), and an accent bar. Theming vars:
`--info-card-accent`, `--info-card-title-color`, `--info-card-color`,
`--info-card-media-bg`. Used by About "Our Values" and Services "Our Approach".

### `ContactMock` / `ContactMessage` / `ContactServiceI`
`libs/damoclesSword/data-access/src/lib/contact/`, exported from
`@portfolio/damoclesSword/data-access`. `ContactForm` already injects `ContactMock`;
workers do not need to touch this. Swap to an `ApiConsumer`-based impl later.

## Shared i18n keys already added (en/es/fr)
`contact-form.default-title`, `.email-label`, `.email-placeholder`, `.name-label`,
`.name-placeholder`, `.affair-label`, `.affair-placeholder`, `.message-label`,
`.message-placeholder`, `.links-label`, `.links-placeholder`, `.send`, `.required`,
`.invalid-email`, `.success`.

## Registration (already done)
Registered in `libs/damoclesSword/ui/src/lib/damocles-sword-ui-module.ts` and exported
from `libs/damoclesSword/ui/src/index.ts`; `ContactMock` etc. exported from
`libs/damoclesSword/data-access/src/index.ts`.
