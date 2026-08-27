# 0003: App owned locale routing

## Implementation status

Not started. Depends on `libs/shared/localization/rokutranslator/plans/0005-app-owned-translator.md`,
which must land first: this plan is the migration, that one is the contract. Depends on
`0002` only for convenience, since retiring `landing` removes an app from the list below.

## Goal

Move the locale segment from above each app's mount to below it, and give every app
ownership of its own locale routing, its own translator instance and its own providers.

```
before   ichirokuxvi.com/{locale}/damoclesSword/about
after    ichirokuxvi.com/damoclesSword/{locale}/about
```

The shell stops owning a `:locale` route on everybody's behalf. It becomes what it should
have been: a host that mounts remotes and supplies nothing else.

## The rule, stated once

**`/{mount}/{locale}/{rest}`**, for every app, in both run modes.

There is no exception for the front page, and it is worth saying so because "locale first
is gone except for landing" invites a special case that does not need to exist. `landingV2`
mounts at the empty path, so its mount contributes no segment and the rule degenerates to
`/{locale}/{rest}` on its own. Same rule, no branch.

In a standalone build the mount is also empty, so an extracted app is `/{locale}/{rest}`
too. That is the property that makes extraction cheap: an app's route table is always
"locale, then my routes", relative to wherever it happens to be mounted.

### The one new ambiguity, and how the shell resolves it

At the shell root, `/en` means landingV2 in English and `/velista` means velista with no
locale yet. Both are a single segment directly under `/`.

The shell's route table tries **app mounts first**, then falls through to the empty path
app. That is the same ordering constraint already written above the velista entry in
`app.routes.ts` (an empty path route with `loadChildren` is not terminal, so it swallows
segments meant for its siblings). This plan does not introduce the hazard, it adds one more
reason the existing order is load bearing, and `app.routes.spec.ts` should assert it rather
than leave it to review.

`isLocaleSegment` cannot be used to disambiguate here and must not be reached for: a two
letter app mount would be indistinguishable from a locale, and the ordering rule is
correct regardless of how the mounts happen to be spelled today.

## The guard contract

One guard, from `rokutranslator-angular`, configured entirely from route `data`. Its three
cases are the D6 table in plan `0005` and are not restated here. Every app installs the
same guard on its parent route with its own `appKey`, `supportedLocales` and
`defaultLocale`, which is exactly the shape `damoclesSword`, `odontogram`, `landingV2` and
`velista` already use for `localeCorrectionGuard`.

What each app gains over today is the *insert* case, which the shell used to perform on
their behalf before the remote ever loaded. That is the entire behavioural addition.

## Per app work

The four migrations are near identical, which is why this is one plan. The shared
checklist is the work; the per app section is only what differs.

### Shared checklist, applied to every app

1. **Mount.** Introduce the app's mount as a value, matching velista's `APP_BASE_PATH`.
   `damoclesSword` gets `/damoclesSword`, `odontogram` gets `/odontogram`, `landingV2` gets
   `''`. The guard and the locale switcher both need it to find the locale segment relative
   to the mount rather than at index 0.
2. **Routes.** Add the locale segment below the mount in the app's own route table, and
   install the merged guard on the parent route.
3. **Translations.** Move the app's `RokuTranslatorModule.withConfig` call out of its UI
   module and into a `translation-providers.ts` in its shell library, composing
   `TranslationSource` descriptors the way velista does. The UI module keeps importing and
   exporting plain `RokuTranslatorModule` for the pipe.
4. **Providers.** Create an `app-providers.ts` for the app and attach it to the exposed
   route in `entry.routes.ts`, plus to `appConfig` for the standalone bootstrap. Use
   `provideEnvironmentInitializer` for anything that must *run* rather than merely be
   available.
5. **Readiness.** Add the `translationsReady` resolver on the parent route, after the
   guard.
6. **Data access.** Anything `providedIn: 'root'` in the app's `data-access` moves onto the
   app's provider array behind a service token, per rule D5.
7. **Locale switcher.** Update the call site so it rewrites the locale segment relative to
   the mount.
8. **Specs and e2e.** Update the URLs, see the e2e section.
9. **Verify, then commit.** See the commit protocol.

### damoclesSword

The largest of the three, and the one to do **last** among the non velista apps, because
everything that can differ differs here.

- It owns a locale switcher (`damocles-sword-wrapper.ts` calls `switchAppLocale`), so it is
  the first real exercise of the relative rewrite.
- `libs/damoclesSword/ui/damocles-sword-ui-module.ts` holds the `withConfig` call, with more
  than one namespace.
- Its `data-access` has four `providedIn: 'root'` services (`asset`, `contact`, `news`,
  `project`).
- 9 e2e specs, several of which navigate by locale.

### odontogram

The smallest. Its whole route table is one parent route with a component and no children.

- `withConfig` lives in `odontogram-ui-module.ts` and hand rolls the namespace dispatching
  loader that `composeTranslationLoader` now derives. Replacing it is the clearest single
  demonstration that the composed form is equivalent, so do this app **first** as the
  reference migration.
- Its `data-access` has four root provided services, one of which, `OdontogramApi`, is a
  real `ApiConsumer` reaching `OwnApiUrlResolver` and the global
  `libs/shared/environments`. It works today only because that resolver reads a module
  level constant rather than a DI token, which is the same latent problem velista hit,
  surviving on an accident. Moving it onto the app's providers is in scope; giving
  odontogram its own environment shaped API config is **not**, unless it falls out for
  free.
- `odontogram-e2e` is one of the two projects CI excludes for pre existing tsconfig
  breakage, so its specs are not currently a safety net. Do not discover this at the end.

### landingV2

The interesting one, because its mount is empty.

- Its locale segment stays at index 0, so nothing about its URLs changes. What changes is
  *who decides*: the shell used to insert the locale before landingV2 loaded, and now
  landingV2's own guard does it.
- Because the shell's wildcard and the empty path app interact, this app is the one that
  proves the ordering rule in the section above. Assert it.
- `language-switch.ts` in `libs/landing-v2/ui` is its switcher.
- `withConfig` lives in `landing-v2-ui-module.ts`. Note the comments in `layout.ts`,
  `project-page.ts` and the three `*-content` components that explain why they sit where
  they do relative to the module's providers; those reasons change when the providers move
  to the app injector, so the comments need updating with the code.

### velista

Mostly done already, and it is the reference for steps 3 through 6. What is left:

- The locale segment moves below `/velista`, so `appPath` in `libs/velista/platform` flips
  from `['', locale, ...mount, ...segments]` to `['', ...mount, locale, ...segments]`.
- The parent route in `libs/velista/feature-shell/src/lib/routes.ts` takes the merged
  guard.
- Resolve plan `0005` D9's loose end here: `app-providers.ts` currently imports
  `translation-providers.ts` by relative path across a library boundary. Whatever the
  contract plan settles, velista is where it is implemented first.
- 2 e2e specs.

## The shell

The shell's own change is a deletion, and it is the last one, after every app owns its
locale.

- `apps/shell/src/app/app.routes.ts` loses the `:locale` parent route and its
  `canActivate: [localeGuard]`. Each app's entry moves up to the top level, keyed by its
  mount, with the empty path landingV2 entry still last before the wildcard.
- `apps/shell/src/app/app.config.ts` loses
  `provideAppInitializer(() => RokuTranslator.init(...))`. The shell no longer has a
  translator.
- `apps/shell/src/app/locale-wrapper-component.ts` goes away, along with its job of keeping
  the URL's locale segment in sync.
- `RokuTitleStrategy` is decided by plan `0005` D10. Whichever option wins, the
  `titleNs` / `titleFallback` route data comes out of `app.routes.ts`.
- `apps/shell/src/app/app.html` stays a bare `<router-outlet>`. The shell drawing no chrome
  is what makes all of this possible and should not change.

## Commit protocol

Daniel's instruction, and it is the right shape for a migration where each step is
independently verifiable.

**One commit per app, and the app works before the commit.** Working means, at minimum:
`nx lint`, `nx test` and `nx build` green for that app and its libraries, and the app
serving through the shell with its URLs in the new shape and its language switcher
functioning.

Suggested order, chosen so each step de risks the next:

1. `rokutranslator` and `rokutranslator-angular`, the contract from plan `0005`. Both
   guards still exported, both shapes still supported, so nothing breaks yet.
2. **odontogram**, the reference migration and the smallest.
3. **landingV2**, which proves the empty mount case.
4. **damoclesSword**, the largest, with the switcher and the most e2e.
5. **velista**, which is mostly the `appPath` flip and the guard.
6. **the shell**, deleting locale first routing once nothing depends on it.
7. Cleanup: drop the compatibility left in step 1, update
   `module-federation.shared.ts`'s prose, update CLAUDE.md.

Steps 2 through 5 can be reordered, but the shell must be last and the library first.

## e2e

15 specs assert locale first URLs today: damoclesSword 9, landingV2 4, velista 2. They are
the real acceptance test for this plan, and they should be updated **with** each app's
commit rather than in a batch at the end, so a broken app is caught by the step that broke
it.

Two specs deserve attention rather than a find and replace:

- `apps/shell-e2e/src/e2e/locale-redirect.cy.ts` asserts that the leading segment of every
  path is a locale. That assertion is exactly what this plan reverses, so the spec is
  rewritten, not adjusted: the new invariant is that the segment **after the mount** is a
  locale.
- `apps/damoclesSword-e2e/src/language-switch.spec.ts` visits both `/en/damoclesSword` and
  the bare `/damoclesSword`, which makes it the closest thing to a test of the insert case.
  Keep both, translated to the new shape, and add the unsupported locale case so all three
  guard rows are covered end to end.

`odontogram-e2e` is excluded in CI, so if odontogram is the reference migration its specs
need repairing or its verification has to be manual. Decide which when the step starts,
and do not assume the suite is protecting anything.

## Acceptance criteria

1. Every app serves at `/{mount}/{locale}/{rest}`, and `landingV2` at `/{locale}/{rest}`.
2. Visiting an app with no locale inserts one and keeps the rest of the path.
3. Visiting an app with an unsupported but locale shaped segment resolves it, per the D6
   table.
4. Switching language in any app rewrites only that app's locale segment, and leaves any
   other app's remembered locale untouched.
5. Two apps reachable in one session hold independent locales. Set damoclesSword to Spanish
   and landingV2 to English, navigate between them, and neither changes the other.
6. No file outside the localization libraries reads or writes `segments[0]` as a locale.
7. The shell has no translator, no `:locale` route and no locale wrapper.
8. `nx run-many --all --target=lint test build` green, and every e2e project that CI runs
   green.

## Out of scope

velista's own origin and its PWA, which is `apps/velista/plans/backlog/0001`. Any change to
translation content or namespace names. Renaming `landingV2`. SSR.

## Open questions

Both are inherited from plan `0005` and must be answered there before step 1, not here:
the D6 row three behaviour, and which of the D10 title options.
