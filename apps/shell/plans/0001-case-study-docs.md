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
- [~] Why micro-frontends + Module Federation for a *portfolio*? Real motivation.
      (Partial: "deploy each separately". Still want a line on runtime MF vs one
      bundled app specifically.)
- [ ] Shell as host: how remotes are declared/lazy-loaded via `X/Routes` aliases.
- [x] Locale-first routing: full `window.location.href` reload on locale change.
      (Answered: locale is sent to the backend, so a soft nav would require
      re-fetching all data with the new locale; full reload does it cleanly.
      Follow-up left: clarify the trigger is the programmatic switcher, not URL edits.)
- [ ] Locale-first routing: why route `:locale` first at all (still unasked).
- [ ] Locale detection + why en/es/fr (ASKED as Q4, NOT yet answered; Daniel's next
      message was about Q3 instead, so Q4 is still open). Note: the global supported
      locales are changing in the localization refactor, so revisit en/es/fr after.
- [ ] The "remote renders blank on its own port" design — why intentional, how it works.
- [~] RokuTranslator: why hand-roll an i18next wrapper instead of ngx-translate/transloco?
      (ANSWERED then put ON HOLD by Daniel. A full organized answer is in-file with his
      clarifications folded in, but he will REWRITE it from scratch after the localization
      refactor lands. DO NOT edit that answer further; the previous text must be preserved.)
- [~] RokuTranslator: per-locale lazy namespace loaders, how remotes contribute i18n.
      (Mechanism covered via the hand-roll answer + Claude note; could get its own tidy answer.)
- [~] Why force `roku-translator` as a MF singleton (`strictVersion`)? What broke without it?
      (Why-singleton answered; sharper "locale state fragments across remotes" confirm pending.)
- [ ] Testing strategy across the workspace (Jest + Cypress/Playwright e2e, shared-spec pattern).
- [ ] Shared libs layout (`libs/shared/*`): environments, data-access helpers, ui/icons.
- [ ] Zone change detection config / any perf choices in `app.config.ts`.
- [ ] SUPPORTED_LOCALES en/es/fr — why these, how locale is detected/persisted.

### damoclesSword
- [ ] What is Damocle'Sword? The real project this showcases (Starlit Ascension, VR).
- [ ] Data-access "memory" pattern (`*-memory.ts` + `*-service.ts` + static data). Why?
- [ ] How static content + per-locale translation data are structured & served.
- [ ] Media (mp4/avif): how large assets are handled, why avif, the equal-media-size rule.
- [ ] feature-home / about / news / projects / contact — notable implementation details each.
- [ ] Contact form: is it wired to a backend? contact-mock vs real service.

### odontogram
- [ ] What the odontogram is (dental chart) and why you built it.
- [ ] Domain model: teeth numbering, zones, tooth-treatment status, treatment types.
- [ ] The interactive chart rendering — SVG? how tooth zones are drawn/clicked.
- [ ] memory vs api service (`odontogram-api.ts` vs `odontogram-memory.ts`) + shared-spec tests.
- [ ] full CRUD feature — state management, how edits persist.
- [ ] Any backend integration (BACK_API_* env) vs in-memory demo mode.

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

