# 0172: the privacy policy and the terms are public pages

> Asked for by the owner on 2026-10-27. Google will not publish the OAuth consent screen of
> velista until a public privacy policy lives on the verified domain and the home page links
> to it (PR #841: "The OAuth consent screen is External and in Testing mode, so only its test
> users can sign in with Google until it is published, which waits on the privacy page").
> Luna Shopper is open source and meant to be deployed by anyone, so the repository ships
> **templates** and each operator fills them with their own values. Nothing about the owner's
> own deployment (his name, his contact, his providers) is committed.
>
> This plan draws the two documents, at `/{locale}/privacy` and `/{locale}/terms`, signed out,
> from text in the repository and from the operator's settings that backend plan `0231`
> serves. It also adds the links that point at them and one attribute on every product photo.
> Plan `0173` (accepting the terms) and plan `0174` (voice only where the server can
> transcribe) read the same settings through the store this plan adds.
>
> Every fact below was read on `docs/velista-privacy-terms-plans` (from `origin/dev` at
> `c6241a693`) on 2026-10-27.
>
> Prerequisite reading: backend `0231` (the public settings route, the terms version, the
> feature flags), plan `0001` section 6.2 (the route table), plan `0005` (locale routing),
> plan `0071` (the startup gate), plan `0033` (the install page: the precedent for a public
> page with no guard), plan `0165` (velista on its own origin), plan `0168` section 1 D5 (state
> that `ui` draws lives in `platform`), rule D4 in `libs/velista/data-access` (map from
> `unknown`), rule N1 (the product name is a value, never a literal), and in the code
> `libs/velista/feature-shell/src/lib/routes.ts`, `libs/velista/platform/src/lib/startup-gate.ts`,
> `libs/velista/feature-account/src/lib/account-page/account-page.html`,
> `libs/velista/feature-auth/src/lib/*-page/*.html`,
> `libs/velista/feature-landing/src/lib/landing-page/landing-page.html`,
> `libs/velista/ui/src/lib/list/product-picture.ts`, `libs/velista/ui/src/lib/photo/photo-viewer.ts`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code, `nx-generate` before
you scaffold the new library, `design-taste-frontend` before you draw the pages, and
`antislop` with `antislop-copywriting` before you write any text, including the two
documents.

### Objective

velista serves a privacy policy at `/{locale}/privacy` and terms of service at
`/{locale}/terms`, in English and Spanish, to anybody, signed in or not. Each page is drawn
from a structured document in the repository, filled with the operator's values (app name,
controller name, contact email, terms version, dates) from backend `0231`'s public route, and
a section about a feature the operator has turned off is not drawn. The account page, the
sign in page, the register page, the upgrade page and the front door link both documents.
Every product photo is requested with `referrerpolicy="no-referrer"`. The English and the
Spanish texts are each written on their own and then compared for meaning, so neither reads
as a translation.

### Context

- **There is no legal page today.** No route under `:locale` in
  `libs/velista/feature-shell/src/lib/routes.ts` names privacy or terms (the table runs from
  L715 to L1879).
- **A public page is a route with no guard.** `install` (routes.ts L1269 to L1279) carries
  no `canActivate` and no `canMatch`, and `routes.spec.ts` L785 to L805 asserts the absence,
  because "an absent guard is easy to read as an oversight". `authenticatedGuard`,
  `anonymousOnlyGuard` and `guestOnlyGuard` live in `auth-guards.ts` (L77, L96, L154).
  `setupGuard` (`setup-guard.ts` L84) only runs where a route names it, so a route that names
  no guard is reached by everybody, signed in or not, in setup or not.
- **The route must come before the front door.** Every route with a non empty path comes
  before `''` (routes.ts L692 to L704, asserted by a spec), and the `**` page is last.
- **The startup gate holds every page but the front door** until the backend has answered
  once (`startup-gate.ts` L28 and L113 to L121; `app-layout.html` L52 to L74). The legal
  pages need the backend's settings to be true, so they wait like any other page.
- **The product name is a value.** Rule N1: no component, token, route, class, key or asset
  file name carries it. The documents name the app only through the operator's `appName`.
- **Translations are one namespace today.** `VELISTA_UI_TRANSLATIONS`
  (`libs/velista/ui/src/lib/translations.ts`) loads `libs/velista/ui/assets/i18n/{locale}.json`
  (114 kB English, 121 kB Spanish), and `translation-providers.ts` composes the sources. The
  locales are `['en', 'es']` (`libs/velista/ui/src/lib/app-locales.ts`).
- **Where the links go.**
  - Account page: the `exit` section and `<lib-app-version />` close the page
    (`account-page.html` L335 to L355).
  - Sign in: the footer is at `sign-in-page.html` L72 to L77.
  - Register: the footer is at `register-page.html` L90 to L95.
  - Upgrade: the footer is at `upgrade-page.html` L71 to L75.
  - Front door: `landing-page.html` L34 to L51 ends with `<lib-auth-actions>` and
    `<lib-app-version />`. The page does not scroll by design (L45 to L50), so a new line
    competes with the spacer.
- **The front door is the Google home page.** On velista's own origin the mount is empty
  (`app-root-route.ts`), so `https://velista.app/` reaches `localeGuard`, which inserts the
  locale, and an anonymous visitor lands on `LandingPage` (routes.ts L1807 to L1848). A URL
  with no locale, such as `https://velista.app/privacy`, also works: the guard inserts one.
- **Product photos are drawn in two places**: `ProductPicture` (`product-picture.ts` L70 to
  L77, "the only place that draws a product photo") and `PhotoViewer` (`photo-viewer.ts`
  L49). The wire's `imageUrl` is, for a chain that is turned on, an address on that chain's
  host (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts` L1360 to L1367).
  `ChainLogo` (`chain-logo.ts` L49) draws an operator set logo; every logo is null today
  (its doc, L33).
- **What the browser stores.** `libs/velista/platform/src/lib/storage-keys.ts` lists every
  key: the session, the theme, view choices, the last list, the install state, update
  attempts, dropped writes, a support session, basket sessions and visit notices, and the
  walk lab's own IndexedDB (`feature-walk-lab/src/lib/storage/walk-db.ts`). None is analytics.
  `apps/velista/src/index.html` loads nothing from another origin (no font host, no script).
- **No server render.** `apps/velista/project.json` has no SSR or prerender target, so the
  pages are drawn by the browser. A crawler that runs no script sees an empty document
  (section 7).

### Target state

1. **The settings store.** A root service `OperatorSettingsStore` in
   `libs/velista/data-access/src/lib/operator/`, exported from the barrel. It reads backend
   `0231`'s public route once per document, the first time the backend is ready
   (`BackendReadiness.wasReady()`), maps the body from `unknown` into the model
   `OperatorSettings` in `libs/velista/models` (rule D4), and exposes
   `readonly settings: Signal<OperatorSettings | null>` (null until the first answer) and
   `readonly state: Signal<'idle' | 'loading' | 'ready' | 'failed'>`, plus `reload()`. A
   failed read is retried by `reload()` and by the next readiness edge, never in a loop.
   `app-providers.ts` injects it in an environment initializer so the read goes out at start.
   The route is `GET /v1/legal/settings` (backend `0231` section 2, `LegalSettingsView`),
   public, cached by the server for 300 s. The model mirrors it with velista's own types,
   mapped in one mapper (`mapping/operator-mappers.ts`):

   | Model field | Wire field of `0231` section 2 |
   | --- | --- |
   | `appName: string` | `appName` (the server falls back to "Luna Shopper") |
   | `controllerName: string \| null` | `controllerName` |
   | `contactEmail: string \| null` | `contactEmail` |
   | `published: boolean` | `published`, true when both of the above are set |
   | `terms: { version, updatedOn, acceptanceRequired }` | `terms.version`, `terms.updatedOn` (`YYYY-MM-DD`), `terms.acceptanceRequired` |
   | `privacyUpdatedOn: string` | `privacy.updatedOn` (`YYYY-MM-DD`) |
   | `features: { googleSignIn, assistant, transcription, offsiteBackups, supportAccess }` | `features.*` |
   | `processors: { hosting, email, aiText, offsiteBackups }` | `processors.*`; `aiText` is mapped to velista's own union `'anthropic' \| 'google' \| null`, an unknown value to null |
   | `retention: { auditTrailDays, adminLoginFailureDays, expiredGrantDays, applicationLogDays, assistantLogDays, backupDays }` | `retention.*`; `backupDays` null when off site backups are off |

   A body that lacks `appName` or `terms.version`, or whose `retention` numbers are not whole
   numbers, maps to null and the store answers `failed`. A missing flag maps to `false`, so a
   missing field never offers a feature. `published: false` is **not** a failure: it is a
   supported deployment that has published no documents (`0231` section 2, the 0026 rule),
   and the page says so (target 5).
   Plans `0173` and `0174` read this store and nothing else for these facts. If either is
   built before this plan, its builder builds **this target exactly as written** and this
   plan's builder finds it there.
2. **A new library, `libs/velista/feature-legal`**, scaffolded with the Nx Angular library
   generator in the shape of `feature-install` (tags, lint and test targets copied from it),
   with the alias `@portfolio/velista/feature-legal`. Run `npx nx reset` after scaffolding.
   It holds one page component, `LegalPage`, the document renderer, and the assets.
3. **The documents are structured assets, not translation keys.** Four files:
   `libs/velista/feature-legal/assets/legal/privacy.en.json`, `privacy.es.json`,
   `terms.en.json`, `terms.es.json`. They are loaded by the page with a dynamic
   `import()` of the one file it needs, in the shape `VELISTA_UI_TRANSLATIONS` uses, so the
   app's start never downloads a legal text and a reader downloads one document in one
   language. The shape (a TypeScript type `LegalDocument` in the library, and a spec that
   parses all four files against it):

   ```ts
   interface LegalDocument {
     templateVersion: string;           // the version of this text in the repository
     title: string;
     sections: LegalSection[];
   }
   interface LegalSection {
     id: string;                        // stable, the same in both languages
     when?: LegalFeature;               // drawn only when that feature is on
     heading: string;
     blocks: LegalBlock[];
   }
   type LegalFeature = 'googleSignIn' | 'assistant' | 'transcription'
     | 'offsiteBackups' | 'supportAccess' | 'emailProvider' | 'hostingProvider';
   type LegalBlock =
     | { kind: 'paragraph'; text: string; when?: LegalFeature }
     | { kind: 'list'; items: string[]; when?: LegalFeature }
     | { kind: 'table'; head: string[]; rows: LegalRow[] };
   interface LegalRow { cells: string[]; when?: LegalFeature }
   ```

   `emailProvider` counts as on when `processors.email` is not null, `hostingProvider` when
   `processors.hosting` is not null. Text holds placeholders `{{appName}}`,
   `{{controllerName}}`, `{{contactEmail}}`, `{{termsVersion}}`, `{{emailProvider}}`,
   `{{hostingProvider}}`, `{{backupProvider}}`, `{{aiTextProvider}}` (the provider's name,
   drawn from a fixed velista table: `anthropic` is "Anthropic", `google` is "Google"), and
   one per retention number (`{{auditTrailDays}}`, `{{expiredGrantDays}}`,
   `{{applicationLogDays}}`, `{{assistantLogDays}}`, `{{backupDays}}`), so **every period
   the policy states is the number the deployment enforces** (`0231` section 2 reads each from
   the key plan `0233` or k8s `0018` enforces with). Two link tokens, `[[privacy]]` and
   `[[terms]]`, draw a link to the other document.
4. **The renderer is a pure function, and no HTML is injected.**
   `renderLegalDocument(doc, settings, links)` in `feature-legal/src/lib/render.ts` returns
   a view model: sections filtered by `when`, blocks filtered by `when`, and each text split
   into runs of `{ text }`, `{ email }` (every `{{contactEmail}}` becomes a `mailto:` link)
   and `{ link: 'privacy' | 'terms' }`. Placeholders are replaced as text. The template binds
   runs with interpolation only: no `innerHTML`, no `DomSanitizer`. An unknown placeholder or
   token is a spec failure, never drawn. Its spec covers: a section with `when` is dropped
   when its feature is off and drawn when on; an operator value containing `<b>` is drawn as
   the five characters; every `{{contactEmail}}` is a mail link; a table row with `when` is
   dropped when off; a placeholder whose value is null (a provider with no name) fails the
   spec unless its block carries the matching `when`; the `ids` of the English and
   the Spanish file of each document are the same list in the same order (this is what keeps
   the two languages describing the same sections).
5. **The page.** `LegalPage` draws `PageHeader` with a back control
   (`PageNavigation.back(fallbackUrl)`, fallback the front door `appPath(locale, base)`, which
   sends a signed in reader on to home through `anonymousOnlyGuard`), the title, one line
   "Version {{termsVersion}}, changed on {date}" on the terms and "Changed on {date}" on the
   policy (the date through `Intl.DateTimeFormat` in a `try`, never `DatePipe`; the line is
   left out when the date is null), a short table of contents of the drawn sections as in
   page anchors, and the sections as `h2` with their blocks. The dates are `terms.updatedOn`
   and `privacyUpdatedOn`, parsed as calendar dates (no time zone shift). One component
   serves both documents, told which by route `data` (`{ document: 'privacy' | 'terms' }`).
   While the store is `loading` it draws the app's spinner; on `failed` it draws one sentence
   and a retry that calls `reload()`. When `published` is false it draws no document, only
   one sentence: "Whoever runs this copy of {{appName}} has not published a privacy policy
   yet." (and the terms equivalent), because a template with no controller is not a policy. Reading width is capped with the existing column token, the
   page scrolls, and it works at 320 px.
6. **The routes.** Two entries under `:locale`, before `''`, beside `install`:
   `{ path: 'privacy', data: { document: 'privacy', [NAV_CHROME]: NO_NAV_CHROME } }` and
   the same for `terms`, each lazy loading `LegalPage`, with **no** `canActivate`, no
   `canMatch` and no children. Each carries a localized title (`localizedTitle`, keys
   `legal.privacy.title` and `legal.terms.title`). `routes.spec.ts` gains a describe "the
   legal pages" that asserts, as it does for `install`, that both exist, come before `''`, and
   carry no guard; a comment on each route says the absent guard is a decision (Google's
   review needs the URL signed out, and `0173`'s prompt links here).
7. **The links.** A small presentational component `LegalLinks` in `libs/velista/ui`
   (`ui/src/lib/legal/legal-links.ts`, exported): two `routerLink`s, Privacy and Terms, as a
   quiet row of text, taking `privacyUrl` and `termsUrl` inputs that the container builds
   with `appPath`. It is drawn:
   - on the account page, after the `exit` section and before `<lib-app-version />`;
   - on sign in, register and upgrade, after the `authFooter` paragraph, inside
     `lib-auth-screen` (check how `AuthScreen` projects; put it where the version would go on
     the front door);
   - on the front door, between `<lib-auth-actions>` and `<lib-app-version />`, on the same
     line as the version if the page does not fit at 360 x 640 otherwise (decide in the
     browser, record it).
   Keys `legal.link.privacy` ("Privacy") and `legal.link.terms` ("Terms") in both
   `en.json` and `es.json` ("Privacidad", "Condiciones"; improve with the copy skill).
8. **The photos.** `referrerpolicy="no-referrer"` on the `img` of `ProductPicture` and of
   `PhotoViewer`, unconditionally, and on `ChainLogo`'s `img`. Each with a one line comment:
   the photo is fetched from the chain's own site, and the address of the page somebody is
   reading is not that site's business. `product-picture` and `photo-viewer` specs assert the
   attribute.
9. **The texts.** Write the four files from the outline in section 4, by the procedure in
   section 5. Commit the comparison table of section 5 into "What the build decided".
10. **An e2e check.** In `apps/velista-e2e` (it stubs the gateway), a spec
    `legal.spec.ts`: with the health route and backend `0231`'s settings route stubbed, a
    context with no session opens `/en/privacy` and `/es/terms`, sees the heading and the
    stubbed controller name, and never sees a sign in screen; with `transcription: false` the
    transcription section is absent. Add the settings stub to `support/gateway.ts`
    `stubBackendReady` so every existing spec answers it (section 6).

### Scope

- Work only in: `libs/velista/feature-legal/**` (new), `libs/velista/data-access/src/lib/operator/**`
  (new), `libs/velista/data-access/src/lib/mapping/operator-mappers.ts` and its spec,
  `libs/velista/data-access/src/index.ts`, `libs/velista/models/src/lib/` (one new file for
  `OperatorSettings`, and the barrel), `libs/velista/feature-shell/src/lib/routes.ts` and
  `routes.spec.ts`, `libs/velista/ui/src/lib/legal/**` (new) and the `ui` barrel,
  `libs/velista/ui/src/lib/list/product-picture.*`, `libs/velista/ui/src/lib/photo/photo-viewer.*`,
  `libs/velista/ui/src/lib/shops/chain-logo.*`, `libs/velista/ui/assets/i18n/en.json` and
  `es.json`, the account, sign in, register, upgrade and landing page templates, their
  containers (one computed each for the two URLs) and their specs,
  `apps/velista/src/app/app-providers.ts` (one initializer line),
  `apps/velista-e2e/src/legal.spec.ts` (new) and `apps/velista-e2e/src/support/gateway.ts`,
  `tsconfig.base.json` (the alias the generator adds), and the two date constants of
  `libs/luna-shopper/contracts/src/lib/legal/legal-documents.ts` (section 5.4, nothing else
  in that file).
- Do not touch: anything under `apps/luna-shopper-backend`, the rest of `libs/luna-shopper/**`, the
  gateway's `openapi.json`, `k8s/**`, any values file, `apps/velista-luna-e2e/**`, the
  acceptance flows (plan `0173`), the composers (plan `0174`).

### Constraints

- Angular 21, zoneless, standalone components, signals, `inject()`. No
  `@angular/core/rxjs-interop` in `data-access` or `platform` (CLAUDE.md, locale routing).
- Rule D4: the settings body is `unknown` until the mapper says otherwise. No type from the
  backend's contracts crosses into velista.
- Rule N1: no file, key, class or route names the product. The documents say `{{appName}}`.
- No operator value is committed. The repository ships the template text and nothing about
  the owner's deployment: not his name, not his address, not his providers. A fixture in a
  spec uses invented values ("Example Controller", `privacy@example.org`).
- No dependency. No Markdown library: the shape in target 3 is the format.
- No `innerHTML` anywhere in the library.
- Dates through `Intl.DateTimeFormat` in a `try` (velista UI rules).
- Plan 0166 section 2's rules bind: no browser global outside `BrowserFacade`.
- Prose in files has no dashes as punctuation (the owner's rule).
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, scaffolding, specs, lint, builds and browser checks against
  a slot (`tools/dev/ng-slot.sh --up --apps velista`, pointed at a backend that runs `0231`).
- Stop and ask before adding a dependency, changing a backend file, changing another route,
  publishing a text that states something the code does not do (section 4.3), or editing a
  file outside the listed scope.

### Progress evidence

Report when each numbered target is done, and at the end. Ground each claim in a tool
result: the spec run, the lint run, `npx nx build velista` (only `nx build` type checks the
templates), the e2e run, and a screenshot of each page at 360 px in both languages and both
themes. Name every decision the plan did not settle in "What the build decided" at the end
of this file.

## 1. Decisions

- **D1. Public, with no guard, and behind the startup gate.** Google's review and plan
  `0173`'s prompt both need the pages reachable by anybody. The gate stays, because every
  sentence about the controller comes from the backend; a page that drew the template
  without it would print blanks where the law wants a name. `RENDERS_WHILE_CONNECTING` is
  not set.
- **D2. Documents, not translation keys.** A policy is two thousand words that one page in a
  thousand visits reads. As keys it would ride in the 114 kB file every start downloads, and
  its paragraphs would be split into keys that no translator can read as a document. A
  structured file per document per language is read whole by the person who writes it and
  loaded only by the page that draws it.
- **D3. Sections hide by flag, in the data.** The `when` field puts the condition beside the
  text it governs, so a writer who adds a section about a feature cannot forget the
  condition in a second file. The renderer is the one place that reads it.
- **D4. The store lives in `data-access` and is shared by three plans.** `0173` needs the
  version and the Google flag, `0174` needs the transcription flag. One read, one mapper.
- **D5. No referrer on every product photo, not only on chain hosts.** A check for the host
  would need a list of chain hosts, which is a catalog nobody curates. An owner's own photo
  loses nothing by not receiving a referrer.
- **D6. One `LegalLinks` component in `ui`.** Five screens draw the same two links, and the
  copy and the order must not drift.

## 2. Not in this plan

- Accepting the terms, the checkbox, the line under the Google button, the guest notice and
  the prompt (plan `0173`).
- Hiding voice (plan `0174`).
- The backend route, the version, the operator's values and how they reach the cluster
  (backend `0231`; the k8s plan of this batch).
- A data export endpoint (the owner: requests by email for now).
- A cookie banner (the owner: none, see section 4.7).
- Server rendering or prerendering of the two pages (section 7).
- The Play Store data safety form for the Android app (plan `0167`), which should be filled
  from the same inventory once this text exists.

## 3. Dependencies

- **Backend `0231`** must be merged and `GET /v1/legal/settings` on `dev` in `openapi.json`.
  Without it the store has nothing to read; stop and say so. What this plan needs from it:
  the route, `LegalSettingsView` (target 1), and `LEGAL_TEMPLATES` (section 5.4).
- **Backend `0232` (account deletion) and `0233` (retention)**, and k8s `0018` (log
  retention). The policy reads every period from the settings, so a number cannot be wrong,
  but the sentence "your account is deleted with what follows" can be. `0231` section 6 says
  `0233` should be deployed before the documents are published. The builder checks each
  claim of section 4.3 against `dev` and reports any the code does not yet do; the owner
  decides whether to publish with the claim or wait (O5).
- **Backend `0235` and `0236`** for the voice and assistant sections: the claim "a recording
  is transcribed on our own servers" is true only after `0235`; the child safety instruction
  only after `0236`. Both sections are behind `when` flags, and `features.transcription` is
  false until `0235`'s transcriber answers (`0231` section 3), so the voice section cannot
  appear early. The assistant section can: check `0236` is on `dev` or drop that sentence.

## 4. The outline of both documents

The builder writes the text; this is what it must say. Every section names its `id`. A
section marked `when` is drawn only when that feature is on. The inventory below is the
owner's brief of 2026-10-27 checked against the entities named; the builder verifies each
row against the entity files under `apps/luna-shopper-backend/*/src/app/entities/` and marks
in "What the build decided" any row the code contradicts.

### 4.1 Privacy policy, sections in order

1. `who` **Who we are.** `{{appName}}` is run by `{{controllerName}}`, the controller of the
   data. Contact: `{{contactEmail}}`. The software is Luna Shopper, open source; this
   instance is run by the controller named, not by the authors of the software.
2. `summary` **In short.** Five sentences: what we keep, why, that we sell nothing and show
   no ads, that we use no analytics, how to ask for a copy or a deletion.
3. `data` **What we keep, why, on what legal basis, and for how long.** One table: category,
   what it is, why, basis (GDPR art. 6(1)(b) contract, (c) legal obligation, (f) legitimate
   interest), how long. Rows:

   | Category | What | Why | Basis | Kept |
   | --- | --- | --- | --- | --- |
   | Account | Email, user name, password stored only as a hash, the kind of account, sign in dates | To give you an account and sign you in | Contract | Until you delete the account |
   | Guest account | A generated name, no email | To let you create or join a group without signing up | Contract | Until you delete it, or after a grace period once it belongs to no group (`orphan-user-reaper.service.ts`, `ORPHAN_USER_GRACE`) |
   | Google identity (`when: googleSignIn`) | Your Google account id, email and name | To sign you in with Google | Contract | Until you delete the account |
   | Groups and lists | Groups, members, lists, lines, quantities, comments in text | The service itself | Contract | Until deleted; on account deletion, kept for the other members with your name removed |
   | Voice comments (`when: transcription`) | The recording and its written transcript | So the group can hear and read what you said | Contract | The recording is deleted with your account; the transcript stays for the group with your name removed |
   | Shopping profiles | Postal codes, a place or address you type, chosen supermarkets and shops, preferences | To show the shops and prices near you | Contract | Until you delete the profile or the account |
   | Your position | Coordinates, only when you press the button that finds shops near you (`shop-finder.ts` L141 to L149) | To find shops near you | Contract | Used for that answer; the builder verifies it is not stored and says so, or states the period |
   | Shopping trips and purchases | Baskets, what was bought, where, at what price | Your history and the prices others see | Contract; for prices kept after deletion, legitimate interest | Until deleted; on account deletion, kept with your name removed |
   | Shop maps | Walks recorded inside a shop when you map it | To draw the shop's map for everybody | Legitimate interest | Kept with your name removed |
   | People on a shared basket | The name typed by a person who joins a shared basket, and their browser's user agent (`basket-participant.entity.ts` L139) | To show who is shopping and keep their place | Contract | With the basket |
   | Assistant conversations (`when: assistant`) | What you write or say to the assistant and its answer | To answer you | Contract | `{{assistantLogDays}}` days in logs |
   | Security records | Sign ins, password changes, account changes, with before and after values | To protect accounts and investigate abuse | Legitimate interest | `{{auditTrailDays}}` days |
   | Links we email | Email verification, password reset and sign in links, and Google sign in states | To prove a request is yours | Contract | Removed `{{expiredGrantDays}}` days after they expire |
   | Server logs | Requests to our servers, which can include your IP address | To run and fix the service | Legitimate interest | `{{applicationLogDays}}` days |
   | Support sessions (`when: supportAccess`) | That an operator opened the app as you to help, when and for how long (plan `0194`) | To help you when you ask | Legitimate interest | `{{auditTrailDays}}` days |
   | Backups (`when: offsiteBackups`) | Copies of all of the above | To recover from a failure | Legitimate interest | `{{backupDays}}` days |

4. `assistant` (`when: assistant`) **The assistant.** Use the facts of backend `0236`
   section 7, which was written for this section: what the provider receives for one message
   (the message, the conversation on screen, the names of the groups, lists and items the
   turn reads, the app name the person uses) and that it receives no email and no account
   id; that replies are checked automatically and the assistant is told the reader may be a
   child; that it is automated, not a person; the per person allowance (`0234`); our logs
   for `{{assistantLogDays}}` days. Text you send is processed by an AI
   provider to understand it and act on your lists. A child safety instruction is part of
   every request. The provider does not use it to train models (the builder confirms the
   provider's commercial terms say so, or removes the sentence). The provider is
   `{{aiTextProvider}}`. See `processors`.
5. `voice` (`when: transcription`) **Voice.** A recording is turned into text on our own
   servers. No third party receives it.
6. `processors` **Who else handles data.** Categories, never a list of companies beyond what
   the settings name: a hosting provider that runs our servers (named `{{hostingProvider}}`
   when `when: hostingProvider`, else by category); an email provider (`when:
   emailProvider`: "We send email through {{emailProvider}}"); off site backup storage
   (`when: offsiteBackups`, named `{{backupProvider}}` when set); the AI provider for the
   assistant (`when: assistant`, `{{aiTextProvider}}`); Google, only to sign you in (`when:
   googleSignIn`). No third party for voice: it is transcribed on our own servers (`when:
   transcription`). Each processes data only on our
   instructions, under a data processing agreement. (Google sign in: Google acts as its own
   controller for your Google account.)
7. `photos` **Product photos.** Many product photos load directly from supermarket websites.
   When your browser loads one, that website receives your IP address, as with any website.
   We tell your browser not to send which page you were reading. Name the category
   ("supermarket websites that product photos load from"), never a list.
8. `transfers` (`when: assistant`) **Outside the European Economic Area.** If a provider
   above is outside the EEA, transfers rely on an adequacy decision (such as the EU US Data
   Privacy Framework) or standard contractual clauses. The builder states this generically
   and marks it for the owner (section 8, O4).
9. `google` (`when: googleSignIn`) **Sign in with Google.** We ask Google only for your email
   address and your basic profile, and we use them only to sign you in. We do not read your
   contacts, your mail or anything else in your Google account, and we do not share what
   Google gives us. This wording mirrors Google's "Limited Use" disclosure, which the review
   checks for.
10. `storage` **Storage on your device. No cookie banner.** The app keeps on your device only
    what it needs to work: your session, your theme and language, what you last had open, and
    offline copies of the app. No analytics, no advertising, no tracking. Because all of it is
    strictly necessary, no consent banner is shown (ePrivacy art. 5(3); in Spain LSSI art.
    22.2).
11. `rights` **Your rights.** Access, a copy, rectification, deletion, restriction, objection,
    portability. How: email `{{contactEmail}}` from the address on the account, saying what
    you want; we answer within one month. You can delete your account yourself on the account
    page. You can complain to your data protection authority; in Spain, the AEPD (aepd.es).
12. `deletion` **When you delete your account.** What is removed, what stays with your name
    removed (the rows "kept with your name removed" above), and that backups hold a deleted
    account for up to `{{backupDays}}` days before they expire (`when: offsiteBackups` on
    that sentence).
13. `minors` **Children.** The app is for everyone. Under 14, use it with a parent's or
    guardian's permission (LOPDGDD art. 7). We do not knowingly collect more from children
    than from anybody else, and a parent can ask us to delete a child's account.
14. `security` **Security.** In transit encryption, passwords stored as hashes, access limited
    to the operator.
15. `support` (`when: supportAccess`) **When you ask for help.** An operator can open the
    app as you, for a limited time, to see what you see. A strip at the top of the screen
    shows it the whole time, and it is recorded (plan `0194`; the builder words it from
    that plan's rules).
16. `changes` **Changes.** The date at the top. A change that matters is announced in the app.

### 4.2 Terms of service, sections in order

1. `who` **Who provides the service.** `{{appName}}`, run by `{{controllerName}}`,
   `{{contactEmail}}`.
2. `accept` **Accepting these terms.** By creating an account, including a guest account when
   you create or join a group, or by continuing with Google, you accept these terms. Version
   `{{termsVersion}}`. When they change, the app asks you to accept the new version. The
   privacy policy is a separate document that explains how data is used ([[privacy]]); it is
   not part of what you accept.
3. `service` **What the service is.** Shared shopping lists, prices gathered from supermarkets,
   shop maps. Free. No guarantee of availability.
4. `prices` **Prices are information, not offers.** Prices and photos come from supermarket
   websites and from people; they can be wrong or out of date. The shop's price at the till
   is the one that counts.
5. `minors` **Age.** Everyone may use it. Under 14, with a parent's or guardian's permission.
   No age check.
6. `account` **Your account.** Keep your password to yourself. A guest account lives on one
   device until you add an email.
7. `conduct` **What you must not do.** Unlawful content, harassment, spam, automated scraping,
   attacks on the service, misuse of the assistant to run up costs or produce harmful content.
8. `content` **What you write.** It stays yours. You let us store and show it to the people
   you share it with, and keep it with your name removed after you leave (as the policy says).
9. `assistant` (`when: assistant`) **The assistant can be wrong.** Check what it wrote. It has
   limits on how much one person can use it.
10. `voice` (`when: transcription`) **Voice.** A transcript can mishear.
11. `ending` **Ending.** You can delete your account at any time. We can suspend an account
    that breaks these terms.
12. `liability` **Liability.** As far as the law allows. Nothing here limits the rights a
    consumer has under the law of their country.
13. `law` **Law.** The law of the controller's country; consumers keep the courts of their
    residence. The builder keeps this generic: the template does not name a country, and the
    owner decides (section 8, O3).
14. `changes` **Changes.** How a new version is announced and accepted.
15. `open-source` **The software.** Luna Shopper is open source under its licence; these terms
    cover this instance, not the code.

### 4.3 Claims the builder checks against `dev` before publishing

Each of these is a statement about the code. For each, cite the file that does it or say it
is not done yet: that each retention number of the settings is enforced by the key it is read
from (`0233`, k8s `0018`); what account deletion removes and unlinks (`0232`); that the assistant sends a child
safety instruction; that no analytics script exists; that the position is not stored; that
Google is asked only for `email` and `profile` (the strategy's `scope` in the auth service);
that transcription runs on the operator's servers when on.

## 5. Writing the two languages

The owner wants neither language to read as a translation. The procedure, in this order:

1. **English pass.** Write `privacy.en.json` and `terms.en.json` from section 4 and the
   inventory, in plain English for people not at home with apps (short sentences, ordinary
   words, the reason before the rule), with `antislop-copywriting` loaded.
2. **Spanish pass, separately.** Start a fresh subagent (Opus 5.5) that is given section 4,
   the inventory and the shape of target 3, and **not** the English files. It writes
   `privacy.es.json` and `terms.es.json` in natural Spanish from Spain, using the terms a
   Spanish reader expects ("responsable del tratamiento", "RGPD", "LOPDGDD", "AEPD",
   "condiciones del servicio"), with the same section `id`s in the same order.
3. **Meaning comparison.** A third pass reads both files side by side and builds one table
   per document: section id, then every claim in it (a data category, a purpose, a basis, a
   period, a recipient, a right, an obligation), with a column per language saying whether
   the claim is present and in what words. Any claim present in one language and absent or
   different in the other is a mismatch. Fix each mismatch by correcting the side that is
   wrong against section 4, in that language's own words, never by copying the other
   language's sentence. Do not align sentence order or sentence count; only meaning.
4. **Version.** `templateVersion` is a date, `YYYY-MM-DD`, the day the texts' meaning last
   changed. In the PR that adds the texts, set `LEGAL_TEMPLATES.terms.version` and
   `LEGAL_TEMPLATES.privacy.updatedOn` in `libs/luna-shopper/contracts/src/lib/legal/legal-documents.ts`
   (backend `0231` section 1) to that same date, and add a spec in `feature-legal`,
   `template-version.spec.ts`, that imports `LEGAL_TEMPLATES` and asserts the terms files'
   `templateVersion` equals `LEGAL_TEMPLATES.terms.version` and the privacy files' equals
   `LEGAL_TEMPLATES.privacy.updatedOn`. A spec importing a contracts constant is not rule D4's
   concern (no wire type reaches app code); if lint's module boundaries refuse it, record how
   it was solved. A later wording fix that changes no meaning bumps neither, because a bump of
   the terms asks every account to accept again.
5. Put the final comparison tables in "What the build decided", one row per claim.

## 6. e2e

- `velista-luna-e2e` gates the staging deploy (`k8s/e2e/velista-luna/gate.sh` L136 to L139)
  and drives the real backend. Nothing in it opens a legal page, and the links are new rows
  that no selector of `support/app.ts` matches. It is unaffected; run it once on a slot to
  show so.
- `velista-e2e` (same gate, L126 to L131) stubs the gateway through
  `support/gateway.ts`. An unstubbed settings route fails the store's read, which changes
  nothing on the front door in this plan (the store's `failed` only affects the legal pages),
  but add the stub to `stubBackendReady` anyway so `0173` and `0174` inherit a ready one.
  The front door's height grows by the links row: run `landing.spec.ts` and the layout
  checks at its viewports.

## 7. The Google consent screen, the owner's checklist

The owner does this in the Google Cloud console of project `velista-512817` (PR #841), after
this plan is deployed to production:

- [ ] App name: Velista. Support email: an address of the owner's.
- [ ] Application home page: `https://velista.app/`.
- [ ] Privacy policy link: `https://velista.app/privacy` (the guard adds the reader's
      language; check it opens signed out in a private window).
- [ ] Terms of service link: `https://velista.app/terms`.
- [ ] Authorized domain: `velista.app` (it also covers `api.velista.app`, where the redirect
      URI lives). The domain must be verified in Google Search Console under the same Google
      account.
- [ ] Scopes: `openid`, `email`, `profile` only. These need no sensitive scope review; brand
      verification still checks the home page and the policy link.
- [ ] The front door links the policy in view without signing in (target 7).
- [ ] Publish the app (Testing to In production), then merge PR #841 if it is still open.
- [ ] Unverified: whether Google's reviewer runs scripts. The pages are drawn by the browser
      (no server render). If the review reports an empty page, a prerendered copy of the two
      pages is a follow up plan.

## 8. Decisions that are the owner's

- **O1.** The controller's identity shown: the owner's first name and one surname (no
  postal address), and a contact address. Both are set through `0231`'s operator
  configuration and never written in this repository.
- **O2.** Whether to have a lawyer read the two Spanish texts before publishing. This plan
  produces a careful template, not legal advice.
- **O3.** The governing law clause names no country in the template. The owner may want
  Spain named for his instance; that needs a settings field `0231` does not have.
- **O4.** Providers are named only where `0231` gives a name (`processors.*`), and by
  category otherwise. The owner fills `processors.hosting` and `processors.offsiteBackups`
  in his operator file if he wants them named. The transfer section stays generic: whether
  Anthropic relies on the Data Privacy Framework or on standard clauses is a fact the owner
  confirms from Anthropic's terms before publishing.
- **O5.** Shipping before every retention claim is enforced (section 3).

## 9. Choices that are mine

- The names `OperatorSettingsStore`, `OperatorSettings`, `LegalPage`, `LegalLinks`,
  `renderLegalDocument`, `feature-legal`, the file names and the `LegalDocument` shape.
- Documents as assets loaded by the page (D2), and the `when` field (D3).
- No referrer on every product photo and on chain logos (D5).
- A missing feature flag reads as off; a body with no `terms.version` fails the store; an
  unpublished deployment draws one sentence instead of a document.
- Legal pages without the bottom bar.
- The outline of section 4 and the order of sections.
