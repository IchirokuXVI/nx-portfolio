# 0009 Velista as the main project

> Repo relative paths. Aliases only across library boundaries. Builds on `0004` (the
> landing grid and its cards), `0005` (the `projects/:slug` detail route) and `0008` (the
> paragraph list `detail-section`, `detail-toc` and `tech-chip-group` pieces).

## Brief for the agent

### Objective

Add Velista to the landingV2 project grid as the one large featured card, shrink the
Portfolio and Damocle'Sword cards to a single column each, and give Velista a detail page
at `/{locale}/projects/velista` with a general description of the project.

### Context

- The grid is data driven. `libs/landing-v2/data-access/src/lib/project/static-projects-data.ts`
  lists the projects in display order, and each entry's `visual` (`columnSpan`, `featured`)
  decides its size. `project-grid.html` spans a `columnSpan: 2` card across both columns,
  and `project-card.scss` gives a `featured` card the split layout (media beside text).
- Today Portfolio and Damocle'Sword are both `{ columnSpan: 2, featured: true }`, and
  Odontogram and Restaurant Point Of Sale are `{ columnSpan: 1, featured: false }`.
- Copy for a card lives in `static-projects-translation-data.ts`, one row per project and
  locale (`en`, `es`), joined by `ProjectMemory`. It is data, not i18n keys (see the
  `data-access` convention in the `nx-portfolio-angular-developer` skill).
- `ProjectMemory.resolve` builds `detailLink` as `/{locale}/projects/{detailSlug}` and
  `appLink` as `/{locale}/{appSlug}`. Both are relative router paths, and the second is
  stale (D1).
- `ProjectPage` (`libs/landing-v2/feature-project`) picks the content component for a slug
  from `CONTENT_BY_SLUG`. A new detail page is a content component in `libs/landing-v2/ui`
  plus one entry in that map. No new route.
- Velista is served two ways: mounted by the shell at `/velista/{locale}` on
  `ichirokuxvi.com`, and standalone on its own origin, `https://velista.app`, where it is
  an installable app (`apps/velista/plans/0013-own-origin-and-the-installable-app.md`).
- Velista is used in production by real users and is still in early development.

### Target state

- The grid shows, in this order: Velista (full width, featured), then Portfolio and
  Damocle'Sword side by side, then Odontogram and Restaurant Point Of Sale side by side.
- Velista's card links its title, image and "More details" to `/{locale}/projects/velista`,
  and "View project" to `/velista/{locale}` (D1). The string `velista.app` appears
  nowhere on the card.
- `/{locale}/projects/velista` renders a Velista detail page in both locales. It states
  that Velista has its own domain and links to `https://velista.app`. That link is the only
  place in `libs/landing-v2` the absolute URL appears.
- Lint and tests pass for every touched project.

### Scope

- Work only in:
  - `libs/landing-v2/data-access/src/lib/project/*` (data, translations, link builder, spec)
  - `libs/landing-v2/models/src/lib/project.ts` (the `appLink` doc comment only)
  - `libs/landing-v2/ui/src/lib/velista-content/*` (new)
  - `libs/landing-v2/ui/src/lib/project-card/*` (only the featured title size, see Design)
  - `libs/landing-v2/ui/src/index.ts`, `libs/landing-v2/ui/src/lib/landing-v2-ui-module.ts`
  - `libs/landing-v2/ui/assets/i18n/en.json`, `es.json`
  - `libs/landing-v2/feature-project/src/lib/project-page/*` (one `CONTENT_BY_SLUG` entry)
  - `apps/landing-v2-e2e/src/*` (card count and order, see Tests)
  - this plan file (the `> **PR:**` header, once the building PR exists)
- Do not touch: `apps/velista`, `libs/velista/*`, the shell's routes, `PortfolioContent`,
  `DamoclesContent`, `OdontogramContent`, `DetailPageShell`, `detail-section`, and any
  environment or deployment file.

### Constraints

- Load the `nx-portfolio-angular-developer` skill before writing Angular code, and the
  `design-taste-frontend` skill before changing the card or building the page.
- Zoneless, standalone, `OnPush`, signal inputs, matching the neighbouring content
  components.
- No new dependencies, no new models field, no new route.
- Card copy goes in the translation data. Detail page copy goes in the i18n JSON under
  `landingV2.detail.velista.*`. English first, then Spanish.
- No dashes as sentence punctuation in any copy or comment.
- Do not state a number of users anywhere.
- Deliver what is asked. Do not add a deep view, a screenshot capture, or a redesign of
  the other cards.

### Action boundaries

- Proceed with reversible, in scope edits, lint, tests and a slot served through
  `tools/dev/ng-slot.sh --up --apps shell,landingV2,velista`.
- Stop and ask before editing anything under Do not touch, and before changing link
  building beyond the D1 change.

### Progress evidence

Report each checkpoint (data, card, detail page, i18n, specs, live check) with the command
output or the file that proves it. Claim the live check only after loading both locales
through the shell.

## Decisions

### D1 The "View project" URL is `/velista/{locale}`

Decided with the user: the card and the detail page link to `/velista/{locale}`, a
relative path, and never to `https://velista.app`. That is the URL Velista answers on under
the shell, which mounts it at `velista` and lets Velista's own guard settle the locale
below it (the app owned locale rule, `/{mount}/{locale}/{rest}`).

`ProjectMemory.resolve` still builds `appLink` as `/{locale}/{appSlug}`, the shape from
before landingV2 plan 0003. Under the current routes that path falls through to the empty
path landingV2 entry and renders its not found page. So change the builder: when `appSlug`
is not empty, `appLink` is `/{appSlug}/{locale}`. An empty `appSlug` (Portfolio) stays
`/{locale}`.

The builder is shared, so the Odontogram and Damocle'Sword links become
`/odontogram/{locale}` and `/damoclesSword/{locale}`. That is a fix to the same defect,
not a separate change: update the `projects-memory.spec.ts` expectation for Odontogram and
the `Project.appLink` doc comment example in `libs/landing-v2/models/src/lib/project.ts`.
The content specs pass a fixture string through and need no change.

### D2 No new visual field

"Bigger" is the existing featured layout. Velista is the only card with
`{ columnSpan: 2, featured: true }`, so it is the only full width card with the image
beside the text. Portfolio and Damocle'Sword become `{ columnSpan: 1, featured: false }`,
the same as Odontogram. The one styling change is a larger title on a featured card, so
the main card reads as the main card and not only as a wider one.

### D3 A single view detail page

The request asks for a general description "for now". The page uses `DetailSection`
paragraph lists, `DetailToc` and `TechChipGroup`, the pieces `0008` built, and has no
highlight or deep view swap. A deeper page later adds a `deep` list per section without
changing the structure.

### D4 No screenshot yet

Velista has no screenshot asset in `libs/landing-v2/data-access/src/assets`. The card and
the detail page render the generic placeholder until one exists. Adding an image later is a
data change (`image: () => import(...)`), which `static-projects-data.ts` already
documents.

## The card

### Data

Add Velista as the first entry of `PROJECTS`, with the next free id:

```ts
{
  id: '5',
  name: 'Velista',
  tags: ['Angular', 'NestJS', 'PWA'],
  repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
  visual: { columnSpan: 2, featured: true },
  detailSlug: 'velista',
  appSlug: 'velista',
}
```

Set Portfolio and Damocle'Sword to `visual: { columnSpan: 1, featured: false }`. Keep the
remaining order: Portfolio, Damocle'Sword, Odontogram, Restaurant Point Of Sale. The
grid's `grid-auto-flow: dense` then pairs them two by two.

Ids are positional labels and are not sorted on, so `id: '5'` first in the array is
correct. Do not renumber the existing projects.

### Copy (translation rows `9` and `10`)

English:

- tagline: `A shared shopping list app, live in production`
- description: `A collaborative shopping list app for groups and households, with real time
  lists, a shared basket for the trip and prices from real supermarkets. It runs on its
  own domain with real users and is still in early development.`

Spanish:

- tagline: `Una app de listas de la compra compartidas, en producción`
- description: `Una app colaborativa de listas de la compra para grupos y hogares, con
  listas en tiempo real, una cesta compartida para ir a comprar y precios de supermercados
  reales. Funciona en su propio dominio con usuarios reales y sigue en una fase temprana de
  desarrollo.`

Adjust wording for length after seeing it in the card, but keep the two facts: in
production with real users, and early development.

### Design

- `project-card.scss`: under `.project-card--featured`, raise `&__title` on desktop
  (about `1.5rem`) and let the description use the extra width. Nothing else on the card
  changes.
- Check the placeholder initial at the featured size. It already scales with `clamp`.

## The detail page

### Component

`libs/landing-v2/ui/src/lib/velista-content/velista-content.{ts,html,scss,spec.ts}`,
selector `lib-landing-v2-velista-content`, input `project = input.required<TranslatedProject>()`.
Export it from `index.ts`, add it to `LandingV2UiModule`, and register
`velista: VelistaContent` in `CONTENT_BY_SLUG`.

It renders `DetailPageShell` with `title`, `tagline`, `repoLink`, `appLink` and
`heroImage` from the project, as `DamoclesContent` does. So "Visit live app" uses the same
relative link as the card.

Structure, top to bottom:

1. **Own domain note**, first in `[body]`: one short paragraph saying Velista has its own
   domain, and an external link to `https://velista.app` (`target="_blank"`,
   `rel="noopener"`, visible text `velista.app`). The URL is a constant in the component,
   not translated. Style it as a note distinct from body prose, reusing the landingV2
   tokens in `styles/_variables.scss`.
2. **Sections** as `DetailSection` paragraph lists (below).
3. **`[side]`**: `DetailToc` over the sections, then `TechChipGroup` with the groups below.

### Sections

Keys follow `0008`: `landingV2.detail.velista.sections.<id>.title` and
`.p1`, `.p2`, and so on. Every section is two to four short paragraphs. Write the final
prose from these facts and do not add claims beyond them.

| id | Title | Content |
| --- | --- | --- |
| `overview` | Overview | A shared shopping list app: people join a group, keep lists together and shop from one basket. **It is in production with real users, and it is still in early development**, so it changes every week. It lives on its own domain and installs as an app on a phone. |
| `stack` | Stack | Frontend: Angular 21, standalone and zoneless, installable as a PWA, also mounted inside this portfolio as a micro-frontend. Backend: seven NestJS services (gateway, realtime, auth, core, catalog, harvester, assistant) talking over NATS, four Postgres databases through TypeORM, Redis, and Socket.IO for real time updates. An assistant built on Gemini adds lines from text or a voice recording. A separate back office manages the catalog. Deployed with Docker, Helm and k3s, with staging and production clusters. Tested with Jest and Playwright, including an e2e suite that shops against a real backend. |
| `evolution` | How it grew | It started as a shared list for a group, inside the portfolio. Real time updates and presence came next, then its own domain and the installable app. After that came the assistant, the shared basket that gathers lines from several lists for one trip, and guests. The latest stage is prices: a catalog of real products, shops found by postal code, and the harvester that keeps them current. |
| `catalog` | The hardest part: the catalog | Keeping a valid catalog and valid prices. The same product arrives from several chains under different names and formats, and names exist in two languages. Every price a source gives is kept side by side, and a policy decides on each read which one a shopper sees, with prices scoped to a shop, a region or a chain and falling through when one expires. A bad merge or a stale price is visible to a real shopper at the till. |
| `harvester` | The harvester | Every supermarket publishes differently: a JSON API, pages that print no price, weekly offers that vary across dozens of regions, a site that only answers a real browser, and printed leaflets read by a model. Automation proposes, and a person approves before a printed name is bound to a product. |
| `baskets` | Baskets and lists | A line can be asked for by several lists at once, split by the product actually bought, renamed into another line, and settled only when the trip finishes. All of it updates live for everyone shopping together, including guests without an account. |

### Chips

- **Frontend:** Angular 21, TypeScript, PWA, Module Federation
- **Backend:** NestJS, NATS, PostgreSQL, Redis
- **Deployment:** Docker, Kubernetes, Helm, GitHub Actions

Group titles are i18n keys: `landingV2.detail.velista.chips.frontend`, `.backend`,
`.deployment`.

### i18n keys

Add under `landingV2.detail.velista`: `domain_note`, the section titles and paragraphs, and
the three chip group titles. Spanish runs longer, so check wrapping in both locales.

## Tests

- `projects-memory.spec.ts`: Velista resolves with `detailLink` `/en/projects/velista`, an
  `appLink` of `/velista/en`, Spanish copy for `es`, and the list order starts with
  Velista. The Odontogram expectation becomes `/odontogram/es`.
- A new assertion there: no resolved `appLink` or `detailLink` starts with `http`.
- `velista-content.spec.ts`: renders the title and every section heading, renders the
  domain link with `href` `https://velista.app`, `target="_blank"` and `rel` containing
  `noopener`, and passes `appLink` through to the shell link.
- `project-card.spec.ts`: a featured card carries `project-card--featured`. Existing tests
  stay green.
- `apps/landing-v2-e2e/src/landing.spec.ts`: the first card is Velista, and the grid has at
  least five cards.
- `no-horizontal-scroll.spec.ts` needs no change. It crawls the links under `projects/`
  from the landing page, so it reaches `/{locale}/projects/velista` through the new card.

## Acceptance criteria

- [ ] Velista's "View project" and "Visit live app" go to `/velista/{locale}`, and the
      Odontogram and Damocle'Sword links go to `/{app}/{locale}` and render their app.
- [ ] The grid order is Velista, Portfolio, Damocle'Sword, Odontogram, Restaurant Point Of
      Sale, with Velista full width and the other four in pairs on desktop.
- [ ] On mobile every card is one column and nothing scrolls horizontally from 320 px.
- [ ] Velista's card and detail page links are relative. `velista.app` appears in
      `libs/landing-v2` only in `velista-content`.
- [ ] `/en/projects/velista` and `/es/projects/velista` render the domain note, the six
      sections, the table of contents and the chips.
- [ ] The overview says Velista is in production with real users and in early development,
      with no user count.
- [ ] Lint and tests pass for `landing-v2/data-access`, `landing-v2/ui` and
      `landing-v2/feature-project`.

## Verify

```sh
npx nx run-many -t lint test -p landing-v2/data-access landing-v2/ui landing-v2/feature-project
grep -rn "velista.app" libs/landing-v2        # one hit, in velista-content
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,landingV2,velista
```

Through the shell URL of the slot: open `/en` and `/es`, check the grid, follow Velista's
"More details", then "Visit live app", and make sure that it lands on Velista at
`/velista/{locale}`, not on the not found page. Do the same for Odontogram's "View project". Run `tools/dev/ng-slot.sh --down` when finished.

PR title: `feat(landingV2): velista as the main project (plan 0009)`.
