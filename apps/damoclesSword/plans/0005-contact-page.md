# 0005 — Contact page (Worker C)

> Executor note: do the steps in order; do not skip verification. Paths are
> repo-relative to `D:\Projects\nx-portfolio`. Never use relative imports across lib
> boundaries — use `@portfolio/<scope>/<lib>` aliases. **Commit locally only; never
> push.** You work in your own git worktree on branch `feat/damocles-contact`, dev
> ports **4230–4233**.

## Context
Flesh out the existing **Contact** page stub (`libs/damoclesSword/feature-contact`)
with three real sections, matching the reference design (dark/light alternating bands,
no background images — flat white/dark placeholders; assets come later). The page is
already routed at `/en/damoclesSword/contact` and in the header nav — do **not** touch
routing.

## Conventions (follow exactly — mirror `feature-home` and existing `section-*`)
- **Page component** thin: `imports: [DamoclesSwordUiModule]`, template lists section
  selectors in order; `.scss` sets `:host { --section-max-width: 1280px; }`. Change the
  stub `styleUrl` from `./feature-contact.css` to `.scss` (delete the `.css`).
- **Each section** = folder `libs/damoclesSword/ui/src/lib/section-<name>/`
  (`.ts/.html/.scss/.spec.ts`), selector `lib-damocles-sword-section-<name>`, standalone,
  wraps body in `<lib-damocles-sword-section-layout>`, passes already-translated
  `[title]="'section-<name>.main-title' | rokuT"` + `[borderAlignment]` (expose via
  `get BorderAlignment(){ return BorderAlignment; }` from `../enums/border-alignment`).
- **Background** via CSS-var overrides on `:host`: dark =
  `--section-bg:#0a0a0a; --section-color:#f5f5f0; --section-title-color:#fff;`
  light = `--section-bg: rgba(255,255,255,0.9); --section-color:#1a1a1a;`.
  `@import '../styles/variables';`; `Audiowide` font.
- **Register** each new section in `damocles-sword-ui-module.ts` + `ui/src/index.ts`.
- Reuse the shared **`ContactForm`** (see `0002`) for the publishing and general forms.

## Sections (in order)

### 1. `section-publishing` (dark) — title "Looking For Publishing" (`BorderAlignment.LEFT`)
Intro:
> We are seeking funding for our games in development. If you are a publisher and
> interested in our product, please do not hesitate to contact us so that we can shape
> the future of gaming together.
>
> These are the games we are currently seeking funding for:

Two-column layout: a **game card** on the left, the shared **`ContactForm`** on the
right (custom title = the game name).
Game card — **Starlit: Ascension**:
> Starlit: Ascension is a VR Shooter with a Catholic-futuristic setting, where you will
> be the test subject for an advanced experiment on the association of consciousness.
>
> In a world dominated by religion and technological advancement, you will be a subject
> with no memories who must piece together their past while facing numerous combat
> trials where you will annihilate alien beasts unleashed by a mysterious compound...
> Will you be able to survive and remember who you truly are?

Plus an **"Under Development"** badge and **Meta + Steam** icons. Add `meta-icon` and
`steam-icon` to `libs/shared/ui` copying the `play-icon` pattern exactly
(`import('./x.svg?raw')` + `DomSanitizer`, `@Input() color = 'currentColor'`), and
export both from `libs/shared/ui/src/index.ts` (only this worker edits that barrel).
Add each leaf `types/**/*.d.ts` include if a new svg raw import needs it (see the
project memory on asset-import types) — but `libs/shared/ui` already imports `?raw`
svgs, so it should already be configured.

Form usage (custom title):
```html
<lib-damocles-sword-contact-form>
  <lib-damocles-sword-double-bordered-title contact-form-title>
    {{ 'section-publishing.form-title' | rokuT }}
  </lib-damocles-sword-double-bordered-title>
</lib-damocles-sword-contact-form>
```
On the dark band set `--contact-label-color:#fff;`.

### 2. `section-hiring` (light) — title "We Are Looking For People" (`CENTER`)
Intro:
> Our team is growing steadily, and you could be the next to join if you're interested.
> Contact us using the form at the bottom of this page to get in touch. Go for it!
>
> These are the current vacancies that we need filled with the highest priority:

A vacancies table (**Role / Department / Short Description**):
- **Lead 3D Artist** · Graphic · We need a person with extensive artistic knowledge who
  is capable of leading a small art team while maintaining a consistent artistic style.
- **Concept Artist** · Design · We need a concept artist capable of adding their design
  ideas to their drawings to create unique sci-fi structures.
- **Producer** · Production · We need a skilled video game producer to manage the
  necessary tasks, timelines, and milestones within a SCRUM system.

(Optional: a `vacancy` domain in `libs/damoclesSword/data-access` following the
`*Memory` + `static-*-data` pattern; inline static data is fine otherwise.) Make the
table responsive (it must not cause horizontal page scroll — see the existing
`no-horizontal-scroll.spec.ts`; wrap in `overflow-x:auto` if needed).

### 3. `section-general-contact` (dark) — no title needed
The shared **`ContactForm`** with **all defaults** (default "Contact Us" title +
default send button) — demonstrates the no-slot path:
```html
<lib-damocles-sword-contact-form></lib-damocles-sword-contact-form>
```
Set `--contact-label-color:#fff;` on the dark band.

## i18n
Add keys under prefixes `section-publishing.*`, `section-hiring.*` (and any needed for
the general section) to **all three** `libs/damoclesSword/ui/assets/i18n/{en,es,fr}.json`.
English = real copy; es/fr = reasonable quick translations (English fallback if unsure).
**Append your block near the end of each JSON.**

## Page composition
`libs/damoclesSword/feature-contact/src/lib/feature-contact/feature-contact.html`:
three section selectors in order. Model `.ts`/`.scss` on `libs/damoclesSword/feature-home/`.

## Verify (port block 4230–4233)
1. `npx nx lint damoclesSword/ui shared/ui damoclesSword/feature-contact` and
   `npx nx test damoclesSword/ui shared/ui` — must pass.
2. Live: set shell port **4230**, remotes 4231/4232/**4233** (edit `port` in
   `apps/shell/project.json` + each remote `project.json`; `publicHost` in
   `apps/damoclesSword/project.json` → `http://localhost:4233`), then `npx nx serve shell`.
   Open `http://localhost:4230/en/damoclesSword/contact`. Confirm three sections render,
   bands alternate, both forms validate + show the mock success message, and the
   Meta/Steam icons show on the game card.
3. Playwright: add `apps/damoclesSword-e2e/src/contact.spec.ts` asserting the three
   sections, both forms, and no horizontal scroll on the vacancies table. Run:
   `$env:BASE_URL='http://localhost:4230/en/damoclesSword'; npx nx e2e damoclesSword-e2e --grep contact`.
4. **Revert the port files** (`git checkout -- apps/shell/project.json apps/landing/project.json apps/odontogram/project.json apps/damoclesSword/project.json`), then commit.

## Conflict discipline
Only create files under your `section-*` folders / feature lib / the two new icons; the
only shared files you edit are **additive**: `damocles-sword-ui-module.ts`,
`ui/src/index.ts`, `libs/shared/ui/src/index.ts` (icons — you alone), the three i18n
JSONs, and (if used) `data-access/src/index.ts`. Do not modify the shared `ContactForm`
/ `FormButton`. Do not commit port changes.
