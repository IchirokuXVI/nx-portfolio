# 0002 — data-access: projects (+damoclesSword, visual config) & hero info-table

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Prereq: `0001` (libs exist). Build everything in `@portfolio/landing-v2/data-access`
> and `@portfolio/landing-v2/models`, mirroring `libs/damoclesSword/data-access`'s
> `project` domain (structural table + per-locale translation table + `*Memory`).

## A. Projects domain

### A.1 Models — `libs/landing-v2/models/src/lib/project.ts`
Extend the current landing `Project` shape with **visual config** so the grid can
give some projects more columns than others (brief requirement #4).

```ts
export interface ProjectVisual {
  /** Columns the card spans in the 2-col desktop grid. 1 or 2. */
  columnSpan: 1 | 2;
  /** Featured cards use the wide split layout (image beside text). */
  featured: boolean;
}

export interface Project {
  id: string;
  /** Proper noun — same in every locale. */
  name: string;
  repoLink: string;
  /** Route to the in-portfolio detail page, e.g. '/en/projects/odontogram'. */
  detailLink?: string;
  /** Route to the live app, e.g. '/en/odontogram'. */
  appLink?: string;
  /**
   * Project screenshot. Optional: when absent, the card renders a generic
   * placeholder (0003) — there is no media-kind discriminator.
   */
  image?: string | Promise<string>;
  visual: ProjectVisual;
}

export interface ProjectTranslation {
  id: string;
  projectId: string;
  locale: string;
  /** Short one-liner under the title on the card. */
  tagline: string;
  description: string;
}

export type TranslatedProject = Project & ProjectTranslation;
```

Also export a small `ProjectTag` if you keep the tag chips from the mockup
(`Angular`, `Nx`, `WebSocket`…) — structural (locale-independent), so put the tag
list on `Project` (`tags: string[]`) rather than in translations.

### A.2 Structural data — `static-projects-data.ts`
Four projects. `name` and `tags` are locale-independent. Set `visual` per the
approved layout (Portfolio featured full-width; damoclesSword a wide highlight;
Odontogram + POS standard). Every project supplies an `image` screenshot; any project
missing one renders the generic placeholder (0003).

| id | name | columnSpan | featured | detailLink | appLink | repoLink |
|----|------|-----------|----------|-----------|---------|----------|
| 1 | Portfolio | 2 | true | `/{loc}/projects/portfolio` | `/{loc}` | this repo |
| 2 | Damocle'Sword | 2 | true | `/{loc}/projects/damoclesSword` | `/{loc}/damoclesSword` | this repo |
| 3 | Odontogram | 1 | false | `/{loc}/projects/odontogram` | `/{loc}/odontogram` | this repo |
| 4 | Restaurant Point Of Sale | 1 | false | — (deferred) | `/{loc}/point-of-sale` | this repo |

> `detailLink` paths are namespaced under `projects/` because landingV2 mounts at the
> locale root; `/{loc}/odontogram` and `/{loc}/damoclesSword` belong to the real
> remotes (that's what `appLink` targets). Portfolio's `appLink` is the site root
> `/{loc}` (the landing page itself).

- Locale is injected when the service builds links (the `*Memory` gets `locale` in
  `getList(locale)`); store link **templates** or build them in the service like
  `libs/landing/data-access` does with `appLink` per translation. Simplest: keep
  `appLink`/`detailLink` **in the translation rows** (they already carry the locale in
  v1) — choose one approach and be consistent. Recommended: build in the service from
  a locale-independent slug, so structural data stays DRY.
- `tags`: Portfolio `['Angular','Nx','Module Federation']`; Damocle'Sword
  `['Angular','VR','Micro-frontend']`; Odontogram `['Angular','SVG']`; POS
  `['Angular','WebSocket','Responsive']`.
- Odontogram + POS `image`: reuse the existing screenshots. They currently live in
  `libs/landing/data-access/assets/{odontogram,pos}_screenshot.png`. Copy them into
  `libs/landing-v2/data-access/src/assets/` and `import(...)` them the same lazy way
  (`import('../../assets/odontogram_screenshot.png').then((m) => m.default)`).
- Damocle'Sword `image`: it has no landing screenshot yet. **Recommended:** capture a
  screenshot of the served damoclesSword home hero and add it as
  `assets/damocles_screenshot.*`. Until captured, leave `image` unset so the card
  shows the generic placeholder (0003) rather than a broken image. (Alternative: reuse
  an existing damocles asset such as `starlit-logo.avif`.)

### A.3 Portfolio visual — decided: Nx module-federation graph image (brief req #7)
A screenshot of this very site inside this very site would be self-referential and
create an image loop, so Portfolio does **not** use a home-page screenshot. Decision
(D-portfolio-image): Portfolio's `image` is a **dedicated "module-federation graph"
image** — gold nodes (`shell`, `landing`, `odontogram`, `damoclesSword`) joined by thin
lines on the dark ground, echoing `nx graph`. It's meaningful (this portfolio *is* an
Nx module-federation monorepo) and on-brand.

- Ship it as a **real image asset** in `libs/landing-v2/data-access/src/assets/`
  (e.g. `portfolio_graph.png`/`.svg`), so it flows through the normal `image` path —
  **no special-casing** in the card, and it participates in the placeholder-when-absent
  rule like any other project.
- Generate it once during implementation (match the dark ground + gold `#f2d45b`
  accent). If it isn't ready when the card is first built, leave `image` unset so the
  generic placeholder shows, and drop the asset in later — no code change needed.

### A.4 Translations — `static-projects-translation-data.ts`
`en` + `es` rows per project (English is default/fallback). Reuse the v1 copy for
Portfolio / Odontogram / POS; **add Damocle'Sword** (below). Add a short `tagline`
per project (new — the card one-liner):

- **Portfolio** — tagline EN "This site — an Nx module-federation monorepo" /
  ES "Este sitio — un monorepo Nx con module federation". Description: reuse v1
  `landing/data-access` Portfolio copy (EN id 1 / ES id 2).
- **Damocle'Sword** — tagline EN "VR game studio site, ported into the portfolio" /
  ES "Web del estudio de videojuegos VR, integrada en el portafolio".
  Description EN:
  > A marketing site for Damocle'Sword, a VR game studio, built as an Angular
  > micro-frontend. Home, About, Services and Contact pages share a translated
  > (EN/ES/FR) component system with a reactive contact form and a data-access layer
  > for news and projects — including their VR titles such as STARLIT: ASCENSION.
  Description ES:
  > Un sitio de marketing para Damocle'Sword, un estudio de videojuegos VR, construido
  > como micro-frontend de Angular. Las páginas de Inicio, Nosotros, Servicios y
  > Contacto comparten un sistema de componentes traducido (EN/ES/FR) con un
  > formulario de contacto reactivo y una capa de datos para noticias y proyectos,
  > incluidos sus títulos VR como STARLIT: ASCENSION.
- **Odontogram** — reuse v1 copy (EN id 3 / ES id 4); tagline EN "Dental chart with
  per-zone treatments & patient history" / ES "Odontograma con tratamientos por zonas
  e historial de pacientes".
- **Restaurant Point Of Sale** — reuse v1 copy (EN id 5 / ES id 6); tagline EN
  "Full restaurant POS with remote printing & live sync" / ES "TPV de hostelería con
  impresión remota y sincronización en vivo".

### A.5 Service — `projects-memory.ts`
Copy the shape of `libs/damoclesSword/data-access/src/lib/project/project-memory.ts`:
`getList(locale)` joins each `Project` with its `ProjectTranslation` (fallback `en`),
resolves `image` promises as needed, builds `appLink`/`detailLink` from the slug +
locale, and returns `of<TranslatedProject[]>(...)`. Add a `projects-service.ts`
interface (`ProjectServiceI`) like the other domains. Export both from
`libs/landing-v2/data-access/src/index.ts`. Add a `projects-memory.spec.ts` asserting
list length = 4, locale fallback works, and every project has a `visual`.

## B. Hero info-table domain (brief requirement #2)

The desktop hero's right-hand "facts" card must be **built from a data-access class**,
same convention: a structural table + a per-locale translation table joined by a
service.

### B.1 Model — `libs/landing-v2/models/src/lib/info-fact.ts`
```ts
export interface InfoFact {
  id: string;
  /** Display order in the table. */
  order: number;
  /** Optional icon key resolved to a shared/ui icon in the UI (0003). */
  icon?: string;
}
export interface InfoFactTranslation {
  id: string;
  factId: string;
  locale: string;
  /** e.g. "FOCUS", "STACK". */
  label: string;
  /** e.g. "Web apps & automation". */
  value: string;
  /** Optional secondary line (e.g. "Working remotely"). */
  note?: string;
}
export type TranslatedInfoFact = InfoFact & InfoFactTranslation;
```

### B.2 Data — `static-info-facts-data.ts` + `static-info-facts-translation-data.ts`
Structural rows (id/order/icon) and EN/ES translations. Content (approved —
D-hero-copy):

| id | order | label EN / ES | value EN / ES | note EN / ES |
|----|-------|---------------|---------------|--------------|
| 1 | 1 | FOCUS / ENFOQUE | Web apps & automation / Apps web y automatización | — |
| 2 | 2 | STACK / STACK | Angular · Nx · TypeScript | — |
| 3 | 3 | ALSO / TAMBIÉN | Docker · k8s · CI/CD | — |
| 4 | 4 | BASED / UBICACIÓN | Spain / España | Working remotely / En remoto |

### B.3 Service — `info-facts-memory.ts`
`getList(locale)` returns ordered `TranslatedInfoFact[]` (fallback `en`), exported
from the lib index, with a `.spec.ts` (order ascending, fallback works). The UI
(`0003`) renders this array; **no hardcoded rows in the template.**

## Verify
1. `npx nx lint landing-v2/data-access landing-v2/models` — pass.
2. `npx nx test landing-v2/data-access` — the projects + info-facts specs pass.
3. Confirm assets copied and resolve (build `landingV2` dev — no missing-asset errors).
4. Commit: `feat(landing-v2): projects (+damocles, visual config) & info-table data`.

## Conflict discipline
Everything is new under `libs/landing-v2/{models,data-access}`. Do not modify
`libs/landing/*` or `libs/damoclesSword/*`. Copying screenshot assets in is fine.
