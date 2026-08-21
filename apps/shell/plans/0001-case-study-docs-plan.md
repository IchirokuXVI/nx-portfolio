# Case Study Documentation — Master Plan

> Multi-session effort. Read this file first at the start of every session, then
> continue the Q&A loop and append a session summary at the end.

## Goal

Produce a **detailed "how I built it" write-up for each app** so the portfolio's
project-detail pages can be built from real, first-hand information. The content
is captured as **Q&A** — Claude asks detailed questions, **Daniel answers in his
own words**, Claude analyzes the code, compares it to the answer, and asks
follow-ups to fill gaps.

## The file: `CASE_STUDY.md`

Each app gets a `CASE_STUDY.md` in its **root folder** (not `src/`). Chosen name
because these are portfolio *case studies* ("how I built this project") — the
standard term for this kind of write-up. Format inside each file:

- Grouped by topic. Each topic has one or more **Q:** lines and an **A:** block.
- `A:` blocks are written by Daniel. Claude may add a `> Note (Claude):` block
  under an answer to flag something the code shows that the answer missed — this
  is the "did you miss anything?" follow-up, captured in-file so it isn't lost.
- Status tag per question in the plan's question banks below: `[ ]` unanswered,
  `[~]` partial / needs follow-up, `[x]` answered & verified against code.

### File locations

| File | Scope |
|------|-------|
| `apps/shell/CASE_STUDY.md` | **Foundation / general portfolio**: Nx monorepo, module federation, locale-first routing, RokuTranslator localization, testing strategy, shared libs, environments. Docker/CI/CD lives in the docker file, not here (cross-reference it). |
| `apps/damoclesSword/CASE_STUDY.md` | The Damocle'Sword remote: game/VR studio showcase (home, about, news, projects, contact), data-access memory pattern, media handling. |
| `apps/odontogram/CASE_STUDY.md` | The Odontogram remote: interactive dental chart, CRUD, data-access memory/API service pattern, domain model (teeth, zones, treatments). |
| `apps/landing/CASE_STUDY.md` | The original landing remote. **Will be merged into the portfolio project-details later** (landingV2 replaced it at the shell root). Capture what's worth keeping. |
| `apps/docker/CASE_STUDY.md` | **Docker + Kubernetes/Helm infra**: custom `@portfolio/docker` Nx plugin (build/push executors, generator), Dockerfiles, reverse-proxy, certbot, CI/CD pipeline, k3s + Helm deploy. Non-Angular. |

> `landingV2` (the in-progress redesign) has its own plans under
> `apps/landing-v2/plans`; not part of this doc effort yet — revisit once it lands.

## The Q&A loop (how Claude runs each session)

1. Re-read this plan + the target file's current state.
2. Pick the next unanswered / partial topic (respect any order Daniel requests).
3. **Analyze the code first** — read the real implementation, note what it does.
4. Ask Daniel focused questions (a small batch, not all at once). Prefer depth:
   ask *why*, *what was hard*, *what was the alternative*, *what would you change*.
5. When Daniel answers, **compare against the code**. If the answer omits
   something the code reveals (or contradicts it), say so and **ask again** so
   Daniel can decide whether to elaborate. Repeat on the same topic as needed.
6. Write the confirmed Q&A into the app's `CASE_STUDY.md`; mark status in the bank.
7. End session: append a summary (≤50 lines) below and commit.

**Standing rule — skipping/deferring questions (Daniel's request):**
- Some questions get parked and answered later. When a question is parked, tag it in the
  bank (with a reason) so it is not lost, and come back to it once unblocked.
- **Both refactors that were blocking questions have now LANDED on `dev`** (the worktree
  was fast-forwarded to `dev` `240a841` in Session 4), so the previously deferred sets are
  unblocked and being answered:
  1. ~~`DEFERRED (localization)`~~ — the RokuTranslator refactor is done (namespace
     scoping via i18next `{ ns }` + `nsSeparator: false`, per-app locales via
     `*_AVAILABLE`/`*_USABLE_LOCALES`, runtime no-reload locale switch, locale-first
     routing guards). All shell localization questions answered in Session 4.
  2. ~~`DEFERRED (di-wiring)`~~ — services now inject via interface tokens
     (`f3a7fc0`); the `ToothImageLoader` cache bug is fixed (`5b84a32`). The odontogram
     data-access / backend-vs-demo questions can now be answered.
- Note: several earlier answers were written against pre-refactor code and have been (or
  must be) revised to match `dev`: shell Q2 (was full reload, now soft switch) rewritten;
  odontogram data-access + cache notes need revisiting against the fixes.

**Standing style rules for transcribed answers (Daniel's request):**
- Organize each answer so topics flow in a sensible order; add short bold
  subheadings for longer answers. Correct grammar and make it readable and
  consistent. Keep Daniel's voice and facts; do not invent claims he did not make.
- No dashes as punctuation anywhere in these files (see memory `no-dashes-in-file-output`).
- Put anything the code reveals that Daniel did not say into a `> Note (Claude):`
  block, not into his answer text.

## Question banks

Legend: `[ ]` todo · `[~]` partial · `[x]` done. Add questions freely as code reveals more.

### shell (foundation / general)
- [x] Why Nx monorepo? What did it give you vs a plain workspace / polyrepo?
      (Answered: learning + independent deploys + easier reuse via small libs.)
- [x] Why micro-frontends + Module Federation for a *portfolio*? Real motivation.
      (Answered: building/learning goal; avoids reloading Angular+libs between apps;
      global shared-lib config (localization); enables locale-first routing that
      per-app nginx deploys could not; honestly over-engineered on purpose to showcase.)
- [x] Shell as host: how remotes are declared/lazy-loaded via `X/Routes` aliases.
      (Compiled from code: shell lists remotes, each exposes ./Routes, tsconfig path
      alias + import() in loadChildren; remotes are children of the :locale route; root
      '' loads landingV2.)
- [x] Portfolio overview + tech-stack summary section for a general detail page.
      (Added: apps list, runtime MF, k3s/staging+prod, Angular 21 / Nx 22 / TS 5.9 / i18next.)
- [x] Locale change mechanism (was full reload; now soft in-place switch).
      (REWRITTEN in Session 4 against dev: switcher -> RokuLocaleStore.switchAppLocale,
      no reload; refetchOnLocaleChange re-runs locale-keyed queries. Daniel built the
      soft switch to learn but still leans toward a hard reload; both tradeoffs recorded.)
- [x] Locale-first routing: why route `:locale` first at all.
      (Answered: shareable links that keep their language, cacheable per-language URLs;
      locale-less URLs redirect via localeGuard guess + per-app localeCorrectionGuard.)
- [x] Locale detection + why en/es/fr, persistence.
      (Answered: en/es for the portfolio, es native + en for computing/jobs; damocles
      en/es/fr per client. Order URL > stored > browser > default, stored beats browser
      deliberately. Per-app *_AVAILABLE vs *_USABLE_LOCALES.)
- [x] The "remote renders blank on its own port" design (why intentional, how it works).
      (Answered: remotes are built for the shell, standalone styles/context would differ;
      empty RemoteEntry template + no outlet on own port. Claude note captures the open
      "should remotes run standalone" decision + my recommendation.)
- [x] RokuTranslator: why hand-roll an i18next wrapper instead of ngx-translate/transloco?
      (REWRITTEN from scratch in Session 4 post-refactor: avoid Angular-specific libs
      (support churn), couldn't share ngx/transloco config across MFEs, per-lib namespaces,
      per-app locales. Old on-hold answer replaced; preserved in git history.)
- [x] RokuTranslator: per-locale lazy namespace loaders, how remotes contribute i18n.
      (Answered: translations are lib assets; libs declare what they CAN load
      (*_AVAILABLE_LOCALES) for portability; custom i18next backend.read pulls per
      locale/namespace loaders lazily; addTranslations eager-loads active namespaces.)
- [x] Why force `roku-translator` as a MF singleton (`strictVersion`)?
      (Answered: only shell can run provideAppInitializer + locale-first routing needs it
      early; one shared config; without it locale desyncs across apps and cross-namespace
      sharing breaks. Verified singleton/strictVersion/requiredVersion:auto in MF config.)
- [x] Testing strategy across the workspace (Jest + Cypress/Playwright e2e, shared-spec pattern).
      (Answered: shared contract spec run by each impl spec first, plus impl-specific
      tests; e2e all point at the shell url, organized per remote; e2e approach still
      evolving. Claude note suggests pushing more behavior into the shared suite.)
- [x] Shared libs layout (`libs/shared/*`): environments, data-access helpers, ui/icons.
      (Answered: own lib for reusable/framework-agnostic non-UI things e.g. RokuTranslator;
      build in app lib first then promote to shared only when truly shareable with little
      config; prefer small extracted shared pieces over big configurable components.)
- [x] Zone change detection config / any perf choices in `app.config.ts`.
      (Answered: eventCoalescing always on; lazy/async everything; signals for
      everything to minimize change detection. Confirmed signals used widely.)
- [x] Per-app locales, why these, detection/persistence. (Answered in Session 4 together
      with the locale-detection question above; no longer a global SUPPORTED_LOCALES set.)

### damoclesSword
- [ ] What is Damocle'Sword? The real project this showcases (Starlit Ascension, VR).
- [ ] Data-access "memory" pattern (`*-memory.ts` + `*-service.ts` + static data). Why?
- [ ] How static content + per-locale translation data are structured & served.
- [ ] Media (mp4/avif): how large assets are handled, why avif, the equal-media-size rule.
- [ ] feature-home / about / news / projects / contact — notable implementation details each.
- [ ] Contact form: is it wired to a backend? contact-mock vs real service.

### odontogram
- [x] What the odontogram is (dental chart) and why you built it.
      (Answered: built for Clinica Dental Gallardo, Cordoba/Malaga, ~2024 at Umitel,
      still in use; his first real frontend challenge.)
- [x] Domain model: teeth numbering, zones, tooth-treatment status, treatment types.
      (Answered + follow-ups resolved: teeth not persisted; treatments carry teeth[]
      and link to odontogram for history; crown 5 zones + front 2; status
      pending/completed. Deciduous teeth + generalTreatments modeled but not yet in this
      UI (planned). groupTeeth = grouped (shared, edit-once-affects-all) vs individual
      (separate treatment per tooth). Treatment = optional catalog/template.)
- [x] The interactive chart rendering: SVG? how tooth zones are drawn/clicked.
      (Answered + verified: not SVG; 2 images + 2 masks per tooth; rotated sqrt(2)*50%
      diamond clipped to triangles + center circle; `:has()` adjacency borders. The
      ToothImageLoader cache is now real on dev `5b84a32`; the CASE_STUDY note (5) was
      updated to say the in-service cache is now populated for the app session.)
- [x] Treatment visualization (colors/states per zone).
      (Answered: two colors pending/completed; extraction = X cross, implant = bars;
      zone-status precedence any-pending-wins.)
- [~] Image preloading: images loaded via JS, chart shown only once all load.
      (Covered via rendering answer: dynamic import() + forkJoin + LoadingNotifier;
      could expand the "show only when all loaded" coordination.)
- [x] memory vs api service + shared-spec tests.
      (Answered: memory backs tests AND lets him deploy without a backend to share early;
      switch is meant to be environment-driven but is memory-only today. Verified: token
      defaults to `OdontogramMemory`, both consumers inject the token, shared-spec holds
      both to one contract. Gap flagged: the env-driven switch is intent, not code yet.)
- [x] full CRUD feature: state management, how edits persist.
      (Answered: edit state = per-form ObservableMap keyed by dynamic
      ToothTreatmentDetailedForm; save = explicit Save button (auto-save gated off after
      500-1000 req/min vs ~10, plus websocket concurrency issues at the clinics) emits
      toothConfirmedChanges -> parent diffs create/update/delete via forkJoin; history is
      read-only w/ tempTreatments restore; hardest part = the history. Flagged a confirmed
      update-branch bug: `req.subscribe` inside req's own tap re-runs the update.)
- [x] Backend integration (BACK_API_* env) vs in-memory demo mode.
      (Answered: portfolio should have a backend, most services on it; not started yet.
      Roadmap = microservices in NestJS/Java/.NET + varied DBs (Cassandra etc.) to learn
      each. Verified: runs in memory today; `OdontogramApi`/`ApiConsumer`/`OwnApiUrlResolver`
      consume `BACK_API_*` env and are ready, but no backend exists in the repo.)

### landing (to be merged later)
- [ ] Original purpose vs landingV2. What's being kept/merged.
- [ ] projects / areas / project-areas data model — what it represented.

### docker (infra: Docker + k8s)
- [ ] Why a custom Nx `@portfolio/docker` plugin instead of `@nx-tools/nx-docker` etc.
- [ ] `build` executor: buildx, local cache keyed by image hash, auto build-args (NX_APP…).
- [ ] `push` executor + `pushToRegistry` flow; registry via `PORTFOLIO_DOCKER_REGISTRY`.
- [ ] The `application` generator (scaffolds a Dockerfile into a new app).
- [ ] static-docker vs dynamic-docker tags — how CI uses them.
- [ ] CI (`docker-ci.yml`): affected detection via last successful commit, build order.
- [ ] builder image: running tests inside it; why.
- [ ] reverse-proxy + certbot apps — TLS/Let's Encrypt flow.
- [ ] k8s: k3s cluster, Helm chart layout, reverse-proxy templates, LB IP pool.
- [ ] Deploy step: rsync k8s/ + `helm upgrade` over SSH. Why this vs GitOps/ArgoCD.
- [ ] Per-app Dockerfile (multi-stage Angular build + nginx static serve).

## Session summaries

### Session 1 — 2026-08-13
- Set up the whole effort: chose name `CASE_STUDY.md`, wrote this master plan
  with per-app question banks, created empty `CASE_STUDY.md` templates in
  shell, damoclesSword, odontogram, landing, and apps/docker roots.
- Analyzed: shell MF config (remotes now incl. `landingV2`; root path loads
  landingV2, not landing), `app.config.ts` (locales en/es/fr, appInitializer
  RokuTranslator.init), `app.routes.ts`, `LocaleWrapperComponent` (URL-locale
  sync via full-page nav on locale change), damocles MF config, CI workflow
  (affected-by-last-success-commit, builder image tests, rsync+helm deploy),
  docker `build` executor (buildx + local hash-keyed cache + auto build-args).
- Working in worktree `worktree-case-study-docs` (branch same name).
- **Next session:** start the actual Q&A. Began with the shell/foundation batch
  (Nx+MF motivation, locale routing, RokuTranslator). Awaiting Daniel's answers;
  transcribe into `apps/shell/CASE_STUDY.md` and run gap-checks against code.
- Open decision: confirm `CASE_STUDY.md` name with Daniel; confirm whether he
  wants to answer in-chat (Claude transcribes) or edit files directly.

### Session 2 — 2026-08-14
- Workflow settled: Daniel answers one question at a time in chat; Claude confirms
  the answer is fine (or flags gaps vs code), transcribes into the app file, then
  moves on. `CASE_STUDY.md` name confirmed and kept.
- New standing preference (saved to memory `no-dashes-in-file-output`): do NOT use
  dashes as punctuation in authored prose (comments, docs, these files). Rephrase.
  Apply this to every file written from now on.
- Answered & transcribed into `apps/shell/CASE_STUDY.md`:
  - Q1 Nx monorepo motivation (reworded per Daniel; he dropped the "apps must
    overlap to justify a monorepo" point on reflection, since these apps could be
    separate packages).
  - Q2 locale full-reload (locale goes to backend, reload re-fetches cleanly).
- Gap flagged in-file for later: the reload only fires for the programmatic
  language switcher, not URL-segment edits (separate `paramMap` path). Optional
  elaboration for Daniel.
- **Next session:** continue the shell/foundation batch. Next unanswered "why"
  questions to ask Daniel:
  1. RokuTranslator: why hand-roll an i18next wrapper vs ngx-translate/transloco?
  2. The MF singleton (`strictVersion`) for roku-translator: what actually broke
     without it (fragmented locale state)?
  3. Why route `:locale` first; how is the active locale detected/persisted;
     why en/es/fr.
  Then move to testing strategy + shared-libs questions, then pick the next app
  (suggest damoclesSword or odontogram). Remember: analyze code first, compare to
  the answer, ask again on gaps.
- Still working in worktree `worktree-case-study-docs`.

### Session 3 — 2026-08-14 (paused / on hold by Daniel)
- Q3 (why hand-roll RokuTranslator): Daniel gave a deep answer covering isolation per
  library, the two-level design (RokuTranslator singleton + per-lib
  RokuTranslatorService), namespace priority overriding, known gaps, and the learning
  goal. Transcribed and organized into `apps/shell/CASE_STUDY.md`.
- Verified against code (read `rokutranslator.ts`, `rokutranslator-service.ts`,
  `provide-rokutranslator.ts`). Confirmed the namespace scoping is NOT enforced:
  `RokuTranslator.t` resolves against all namespaces by priority, so keys leak between
  libraries. Daniel agrees it is a bug.
- Daniel surfaced the real reason for the singleton: only the shell can use
  `provideAppInitializer` in a micro-frontend setup, so init must live in the shell.
  Folded into the Q3 answer.
- **Q3 is now ON HOLD.** Daniel will rewrite that answer from scratch after a
  localization refactor. Previous answer preserved; DO NOT edit it further.
- Created a refactor brief at
  `libs/shared/localization/rokutranslator/plans/0001-localization-refactor.md`
  telling a future agent to inspect the localization architecture and produce a
  detailed fix plan for TWO problems:
  1. Namespace leaking. Fix direction: optional `namespace` arg on the pipe and
     service `t()`, defaulting to the lib's namespace; service builds `namespace:key`.
  2. Global supported locales should be per app, resolved dynamically from each
     service instance / namespace, while respecting the app-initializer constraint.
- Standing style rule added to this plan (organize/format/grammar-correct all
  transcribed answers; no dashes; code-only observations go in Claude notes).
- **Next session:** the shell/foundation batch continues. Q4 (locale detection +
  why en/es/fr) was asked but NOT answered yet, so start there (or wherever Daniel
  points). Q3 stays untouched until Daniel rewrites it. Also still open: MF singleton
  sharper confirm, how remotes contribute i18n (tidy answer), why `:locale` first,
  testing strategy, shared libs. Then move to the next app.
- Worktree `worktree-case-study-docs`.

### Session 4 — 2026-08-19
- Daniel had fixed things on the `dev` branch. The worktree was fast-forwarded from
  `e1f3c70` to `dev` `240a841` (my case-study commits are ancestors of dev, so it was a
  clean ff). Now analyzing the REAL current code, not the pre-refactor state.
- Big landed refactors on dev that supersede earlier answers:
  - Localization: namespace scoping via i18next `{ ns }` + `nsSeparator:false`; per-app
    locales (`*_AVAILABLE_LOCALES` in UI lib vs `*_USABLE_LOCALES` in feature-shell,
    on route `data`); runtime no-reload locale switch (`RokuLocaleStore.switchAppLocale`,
    `withLocale`/`refetchOnLocaleChange`); locale-first routing guards (`localeGuard`
    guess + `localeCorrectionGuard` per-app validate); `LocaleWrapperComponent` deleted;
    `RokuTitleStrategy` localizes titles. Plans 0001/0002/0003 under rokutranslator/plans.
  - DI wiring (`f3a7fc0`, `service-token.ts`) and ToothImageLoader cache (`5b84a32`) fixed.
- Answered & transcribed into `apps/shell/CASE_STUDY.md` (the whole localization set, all
  verified against dev code): Q3 hand-roll (rewritten from scratch), MF singleton, why
  `:locale` first, Q2 rewritten as the soft in-place switch (Daniel still prefers hard
  reload; both tradeoffs recorded), Q4 per-app locales + detection/persistence, remote
  i18n contribution. Commits f728a4b, b06036d, b5fbe6c, 771d9a5.
- Fixed a committed merge-conflict marker left in this plan (Session 3 refactor-brief path).
- **Next session:** localization is done. Remaining shell: micro-frontend motivation
  (partial) + the `X/Routes` alias/lazy-load mechanics (fillable from code, ask Daniel the
  "why runtime MF" angle). Then the newly-UNBLOCKED odontogram data-access questions
  (memory vs api token switch, backend vs demo) — re-read `service-token.ts` and which
  impl is bound first — plus the odontogram cache note needs updating to "cache now
  populated". Then damoclesSword / landing / docker+k8s (note: docker now has a
  staging+production release pipeline per CLAUDE.md; `release.yml`, `deploy-release.sh`).
- Worktree `worktree-case-study-docs` (now sitting on top of dev `240a841`).

