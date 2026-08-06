# 0003 — Services page (Worker A)

> Executor note: do the steps in order; do not skip verification. Paths are
> repo-relative to `D:\Projects\nx-portfolio`. Never use relative imports across lib
> boundaries — use `@portfolio/<scope>/<lib>` aliases. **Commit locally only; never
> push.** You work in your own git worktree on branch `feat/damocles-services`, dev
> ports **4210–4213**.

## Context
Flesh out the existing **Services** page stub
(`libs/damoclesSword/feature-services`) with five real sections, matching the
reference design (dark/light alternating bands, no background images — flat
white/dark placeholders; assets come later). The page is already routed at
`/en/damoclesSword/services` and in the header nav — do **not** touch routing.

## Conventions (follow exactly — mirror `feature-home` and existing `section-*`)
- **Page component** is thin: `imports: [DamoclesSwordUiModule]`, template lists
  `<lib-damocles-sword-section-*>` in order; `.scss` sets `:host { --section-max-width: 1280px; }`.
  Change the stub's `styleUrl` from `./feature-services.css` to `.scss` (delete the `.css`).
- **Each section** = folder `libs/damoclesSword/ui/src/lib/section-<name>/` with
  `.ts/.html/.scss/.spec.ts`, selector `lib-damocles-sword-section-<name>`, standalone,
  wraps its body in `<lib-damocles-sword-section-layout>`, passes an already-translated
  `[title]="'section-<name>.main-title' | rokuT"` and a `[borderAlignment]`
  (`get BorderAlignment(){ return BorderAlignment; }`, from
  `../enums/border-alignment`). Import `RokuTranslatorPipe` from
  `@portfolio/localization/rokutranslator-angular`.
- **Background** via CSS-var overrides on the section `:host`: dark =
  `--section-bg:#0a0a0a; --section-color:#f5f5f0; --section-title-color:#fff;`
  light = `--section-bg: rgba(255,255,255,0.9); --section-color:#1a1a1a;`. `@import '../styles/variables';`
  for `$theme-blue #00b7f5` / `$theme-yellow #ffcb26` / `$theme-dark #1a1a1a`; titles
  and bars use the `Audiowide` font.
- **Register every new section** in `libs/damoclesSword/ui/src/lib/damocles-sword-ui-module.ts`
  (`components` array + import) and export from `libs/damoclesSword/ui/src/index.ts`.
- **CTA links** reuse `CallToActionButton` (`lib-damocles-sword-call-to-action-button`).
- Reuse the shared **`InfoCard`** and **`ContactForm`** (see `0002` — already built).

## Sections (in order)

### 1. `section-what-we-do` (dark) — title "What Do We Do?" (`BorderAlignment.LEFT`)
Intro (two paragraphs):
> Our customer services specialize in integrating interactive technology that offers
> reality within the ecosystem and objectives of each company that decides to work
> with us.
>
> We handle the development proposals based on each client's needs, always
> prioritizing their business objectives and the contribution our product can make to
> their brand. We also manage the proposed development, working diligently to create
> the best possible product tailored to the client's goals.

Then a **"Our Approach"** subheading + a row of **3 `InfoCard`s** (title + description,
no media projected):
- **Direct Contact With The Client** — short blurb about dealing directly with clients.
- **Professional And Innovative Development** — short blurb.
- **Investigation Of New Technologies** — short blurb.

### 2. `section-how-we-work` (light) — title "How We Work" (`CENTER`)
Intro:
> At Damocle'Sword we always strive for customer satisfaction through our services,
> adapting to their vision and objectives for the product to be developed, always in
> accordance with a methodology that allows us to contact the customer regularly.
>
> Before starting a project, we carry out the following phases:

Numbered phases (1‑2‑3, styled like the design's numbered blocks):
1. We meet with you to understand your goals and needs.
2. We developed a proposal consistent with the objectives, which establishes:
   Project Requirements · Development Blocks · Time and estimated budget for each block.
3. Following this, we regularly show progress updates to allow room for any necessary
   adaptations or changes.

Then "Characteristics of the projects we carry out:" + two feature blocks:
- **Scalable And Modular** — They are prepared to grow and adapt, reducing the typical
  problems of a fixed development such as the need to add new content to the project.
- **Budget‑Friendly** — Being modular, we adapt the project to the needs of budget and
  development time.

### 3. `section-where-we-fit` (dark) — title "Where We Fit In" (`RIGHT`)
Intro:
> Thanks to the capabilities offered by the technology we specialize in (virtual
> reality) and our knowledge of video games and gamification, our products are
> perfectly suited to different types of needs:

Row of **4 `InfoCard`s**:
- **Technology Companies** — Our products fit perfectly within the diversification
  plans of technology companies. Virtual reality technology allows for the creation of
  large quantities of projects tailored to the specific technologies of each company.
- **Cultural Projects** — With the rise of technological integration of gaming into
  cultural aspects, virtual reality can play a very valuable role in this sector. From
  interactive museums to virtual tours of important locations, everything is possible.
- **Worker Training** — The immersion and interactivity offered by virtual reality
  makes it perfect for training programs. Depending on the training objectives each
  company needs, several projects can be proposed to address those needs.
- **Integrated Gamification** — We also integrate gamification into our projects, using
  game theory to foster interest and focus among users in the projects carried out.

Closing paragraph:
> Additionally, if you don't see your type of company reflected in these sections but
> believe we can offer value, we invite you to contact us so we can explore the
> different options available. We are always open to new developments.

### 4. `section-projects-detailed` (light) — title "Our Projects" (`LEFT`)
Two detailed project cards. Reuse `ProjectCard` if it fits the tag-chip layout;
otherwise build a small local `detailed-project-card` in this lib (title bar + media
placeholder + description + a row of tag chips). Consider a `services-project` domain in
`libs/damoclesSword/data-access` following the `*Memory` + `static-*-data` pattern (see
`news`/`project` domains) — optional; static component data is acceptable if simpler.
- **Realistic Interactor** — A simulator that tests realism in virtual environments,
  both in terms of graphics and interactions with the generated environment. An ongoing
  development that strives for pure realism; a showcase of our development and design
  capabilities. Tags: Platform = Virtual Reality (VR) · Engine = Unreal Engine 5 ·
  Sector = Training · Experience = Immersive.
- **VR Sickness Reducer** — A test designed to reduce dizziness caused by exposure to
  VR, consisting of 5 phases where the intensity is gradually increased; the gradual
  approach reduces symptoms. Tags: Platform = Virtual Reality (VR) · Engine =
  Unreal Engine 5 · Sector = Investigation · Experience = Immersive.

### 5. `section-services-contact` (dark) — no `SectionLayout` title needed
Wrap the shared **`ContactForm`**, projecting a custom title via `[contact-form-title]`
and using the default submit button:
> Heading: "Are You Interested In Our Work?" with sub-line "Tell Us Your Needs".
```html
<lib-damocles-sword-contact-form>
  <lib-damocles-sword-double-bordered-title contact-form-title>
    {{ 'section-services-contact.form-title' | rokuT }}
  </lib-damocles-sword-double-bordered-title>
</lib-damocles-sword-contact-form>
```
On the dark band set `--contact-label-color:#fff;` so labels read.

## i18n
Add keys under prefixes `section-what-we-do.*`, `section-how-we-work.*`,
`section-where-we-fit.*`, `section-projects-detailed.*`, `section-services-contact.*`
to **all three** files `libs/damoclesSword/ui/assets/i18n/{en,es,fr}.json`. English =
real copy above; es/fr = reasonable quick translations (English fallback if unsure).
**Append your block near the end of each JSON** to keep merge conflicts trivial.

## Page composition
`libs/damoclesSword/feature-services/src/lib/feature-services/feature-services.html`:
list the five section selectors in order. Model the `.ts` and `.scss` on
`libs/damoclesSword/feature-home/`.

## Verify (port block 4210–4213)
1. `npx nx lint damoclesSword/ui damoclesSword/feature-services` and
   `npx nx test damoclesSword/ui` — must pass (only your new files).
2. Live: in your worktree, set shell port to **4210** and remotes to 4211/4212/**4213**
   (edit `port` in `apps/shell/project.json` + each remote `project.json`, and
   `publicHost` in `apps/damoclesSword/project.json` → `http://localhost:4213`), then
   `npx nx serve shell`. Open `http://localhost:4210/en/damoclesSword/services`.
   Confirm all five sections render, bands alternate dark/light, and the form validates
   + shows the mock success message.
3. Playwright: add `apps/damoclesSword-e2e/src/services.spec.ts` asserting each
   section is visible and the form validates. Run with your port, e.g. PowerShell:
   `$env:BASE_URL='http://localhost:4210/en/damoclesSword'; npx nx e2e damoclesSword-e2e --grep services`
   (pre-start your shell so `reuseExistingServer` attaches, or set `webServer.url` to
   4210 locally).
4. **Revert the port files** (`git checkout -- apps/shell/project.json apps/landing/project.json apps/odontogram/project.json apps/damoclesSword/project.json`), then commit.

## Conflict discipline
Only create files under `section-*`/your feature lib; the only shared files you edit are
**additive**: `damocles-sword-ui-module.ts`, `ui/src/index.ts`, the three i18n JSONs,
and (if used) `data-access/src/index.ts`. Do not modify the shared `ContactForm` /
`FormButton` / `InfoCard` / `ContactMock`. Do not commit port changes.
