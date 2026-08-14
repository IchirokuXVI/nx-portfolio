# Shell — Case Study (Foundation & General)

> How the portfolio's foundation was built. Answers (`A:`) are written by Daniel.
> `> Note (Claude):` blocks flag things the code shows that an answer may have missed.
> Docker / CI/CD / Kubernetes are documented in `apps/docker/CASE_STUDY.md`.

## Why this stack

**Q: Why an Nx monorepo? What did it give you over a plain workspace or polyrepo?**
A: Mostly to learn, but also because I have multiple independent apps and wanted to
be able to deploy each one separately if needed. I would definitely do it again. I
have learnt a lot, especially about Nx and building small libraries, and now that the
project is bigger (though still not huge) everything is easier to understand and
reuse this way. I still have plenty to learn about microfrontends and monorepos, but
the methodology that Nx follows seems great, so I will keep learning as much as
possible.

**Q: Why build a portfolio as micro-frontends with Module Federation instead of one Angular app?**
A: _(Partially covered above — the "deploy each app separately" motivation. TODO:
a sentence specifically on choosing runtime Module Federation over one bundled app.)_

## Module federation topology

**Q: The shell is the only host. How does it declare and lazy-load remotes (the `damoclesSword/Routes` alias trick)?**
A:

**Q: Remotes render a blank page on their own port by design. Why did you make that choice and how does it work?**
A: Each remote is built specifically to work inside the shell, so I do not think it
makes much sense to run or test one on its own, since the styles and the rest of the
context the shell provides could differ from how the remote actually renders in
production. I am not certain this is the best approach. Micro frontends and module
federation are still relatively new and not many projects use them, so I could not
find much guidance either way.

How it works: each remote bootstraps a `RemoteEntry` component whose template is
completely empty, and its `remoteRoutes` load the real `feature-shell`. When you open
a remote on its own port the router still matches the routes, but there is no
`router-outlet` to render them into, so the page comes back blank. The shell is what
provides the outlet (and the global styles and locale context) when it lazy loads the
remote.

> Note (Claude): Open decision Daniel raised, worth revisiting. Whether a remote
> "should" be runnable standalone is a real fork. My take: keep production behavior as
> is (remotes only through the shell), because the remotes genuinely depend on shell
> provided globals. If standalone dev/test becomes painful, the clean fix is a thin
> dev-only host harness per remote that supplies the same global styles and
> `RokuTranslator` init, rather than making each remote a full independent app. Low
> priority for a portfolio; not worth investing until the dev loop actually hurts.

## Locale-first routing

**Q: The top-level route is `:locale` handled by `LocaleWrapperComponent`. Why route locale first?**
A:

**Q: On a locale change you rewrite the URL with a full `window.location.href` navigation instead of an Angular router nav. Why the full reload?**
A: Because I add the locale to the backend requests, so an in app navigation would
mean re-requesting all of the data again with the correct locale. That seemed like
too much work and something that could easily create problems, so instead I do a
full page reload, which re-fetches everything for the new locale cleanly.

> Note (Claude): For the write up, worth clarifying the trigger. In the code this
> full reload only fires when the locale is changed programmatically (for example an
> in app language switcher) while the URL still shows the old locale. When the user
> edits the locale segment in the URL directly, a separate `paramMap` subscription
> calls `RokuTranslator.changeLocale` and Angular routing handles it without a
> reload, so there is no reload loop.

**Q: Supported locales are en/es/fr. Why these, and how is the active locale detected / persisted?**
A:

## Localization: RokuTranslator

**Q: Why hand-roll an i18next wrapper (`RokuTranslator`) instead of ngx-translate / transloco / Angular i18n?**
A:
> STATUS: On hold. Daniel will rewrite this answer from scratch after the
> localization refactor lands (see `libs/shared/localization/rokutranslator/plans`).
> Do not edit this answer further. The previous answer is preserved below, with the
> clarifications from the session where it was put on hold already folded in.

**The motivation.** I wanted each app to be able to have its own locales, since the
apps are different and some of them might not need localization at all. I tried
Transloco, a few other libraries, and even i18next on its own, but none of them felt
right, so I spent several days thinking about a different approach. What I landed on
was a wrapper around i18next, reusing its key resolution and namespacing, that lets
me isolate the translations of each library. It still has rough edges, such as a
namespace being overridden without any notice and no real way to share translations
between libraries, but for now I like the implementation.

**The two levels.** The design has two layers:

1. `RokuTranslator`, a framework agnostic wrapper around i18next. It is a singleton
   that holds the current locale and the registered namespaces. I made it a singleton
   because I could not find a clean way to configure localization once in the shell
   and then share that configuration across all of the apps.
2. `RokuTranslatorService`, the Angular adapter. This one is not a singleton; an
   instance is provided for each library that needs localization. It exposes a
   `provide` method (`provideRokuTranslator`) that makes configuration easy,
   registers everything it needs inside `RokuTranslator`, and is meant to keep each
   library scoped to its own namespace. This gives me the benefit of the singleton
   being shared across the whole app without configuring it multiple times, plus the
   benefit of a per library instance whenever one is needed.

I am not sure this is the correct architecture, but it is the one I reached after a
lot of thinking and trying different things.

**Why the singleton, the real constraint.** The deeper reason for the singleton is
initialization. `RokuTranslator` has to be initialized when the app starts, and in a
micro-frontend setup only the shell (the host) can use `provideAppInitializer`. I
cannot run an app initializer inside a remote or inside a library, so the only place
to configure localization once is the shell. Making `RokuTranslator` a singleton
configured in the shell was my way around that constraint. This same constraint is
why the supported locales are currently global rather than per app, which is
something I want to change (see Known issues below).

**Namespace priority overriding.** The priority based override, where a later
registered namespace can override an earlier one, exists mainly because it was the
easiest thing to implement. I could allow multiple loaders per namespace instead,
but I have not built that yet and it is not planned for now.

**Known gaps.** I am sure I am missing features that mature localization libraries
offer, but I have not needed any of them so far. The one I can think of is a report
of missing translations, meaning a key that is present in one language file but
absent in others, and that should be trivial to add.

**Known issues I plan to fix.** Two things are not right today, and a refactor is
planned:
1. Namespace leaking. `RokuTranslator.t` (and `RokuTranslatorService.t`) only take a
   string; they do not scope the lookup to the calling library's namespace. So if two
   libraries use the same key, the translation is shared between them, which I think
   is wrong and should not happen. Separately, the translation loader for a namespace
   is overwritten if a second `RokuTranslatorService` is created with a namespace that
   is already in use. The planned fix is to give the pipe and the service `t()` method
   a second, optional namespace argument (defaulting to the library's default
   namespace) and have the service concatenate `namespace + ':' + key` so it uses the
   i18next namespace explicitly and cannot leak into other libraries.
2. Global supported locales. Right now the supported locales are configured once in
   the shell, but each app might support a different set. I would like this resolved
   dynamically from the locales each service instance (or namespace) declares, rather
   than one hardcoded global list.

**Why build it at all.** Honestly, I probably did not need my own library. I mainly
wanted to learn how to build a proper, robust library, not a feature library but an
actual standalone one, and then integrate it into a real project. `RokuTranslator`
has no dependencies I can recall other than i18next, and it can be used without
Angular; the Angular adapter is optional on top. I chose to build on i18next to save
myself some work, and I might remove that dependency eventually, though that is far off.

> Note (Claude): Confirmed with Daniel. The namespace scoping is not enforced today
> (`RokuTranslator.t` resolves against the full namespace array in priority order,
> `defaultNS` being every namespace), so a `RokuTranslatorService.t()` call can pick
> up a key from another library's namespace. Daniel considers this a bug; a refactor
> is planned (see `libs/shared/localization/rokutranslator/plans`). Two other accurate
> details to fold into the final write-up: (1) the boot fallback chain in `init()`
> (config locale, then `localStorage` 'roku-locale', then browser locale, then the
> supported list); (2) the per locale, per namespace lazy loaders (a custom i18next
> `backend`) are what let a remote register its own translations at runtime.

**Q: How do remotes contribute their own translations (per-locale lazy namespace loaders)?**
A:

**Q: In MF config `roku-translator` is forced `singleton: true, strictVersion: true`. What broke, or would break, without it?**
A: _(The "why a singleton" reasoning is covered under the RokuTranslator answer
above: one shared instance so the shell configures localization once and every
remote reads the same locale and namespaces. Still open, a sharper version to
confirm next time: concretely, if each remote loaded its own copy, the locale state
would fragment so remotes could display different languages at the same time, which
is the failure `strictVersion` is guarding against.)_

## Testing

**Q: What's the testing strategy across the workspace (unit vs e2e, the `*.shared-spec.ts` pattern, why e2e points at the shell)?**
A:
**Shared specs for data access.** The shared specs came out of testing the data
access layer. I know the types each service is supposed to return, so I thought: why
not write one shared spec that every implementation of that service must pass? It
covers the basic functionality that all implementations have in common. On top of
that, each implementation has its own specific spec, and the first thing that
specific spec does is run the shared one. So every implementation gets the shared
contract tests plus its own detailed tests. I am not sure there is a better way to do
this, but it seems to work great.

**e2e through the shell.** All the e2e tests point at the shell rather than each
remote's own url, because the end user is meant to use the shell, not a remote on its
own. The tests are still organized per remote; they simply use the shell url instead
of the remote's url. I am still learning e2e testing, especially with micro
frontends, so I will probably change how this works at some point. There is always
room for improvement.

> Note (Claude): Confirmed against `odontogram-service.shared-spec.ts` and
> `odontogram-memory.spec.ts`: the implementation spec calls
> `runSharedOdontogramServiceTests(factory)` before its own `describe`, as described.
> One idea for later: the shared suite currently asserts mostly the method contract
> (each call returns an Observable, the service is created), while the real CRUD
> behavior (correct results, `NotFoundResourceError`) lives in the per-implementation
> spec. If you want the memory and API implementations guaranteed to behave
> identically, you could push more of those behavioral assertions into the shared
> suite so both are held to the same contract.

## Shared foundation

**Q: How are shared libs organized (`libs/shared/*`: environments, data-access, ui/icons) and what rules do you follow for using them?**
A:

**Q: Any deliberate performance / change-detection choices (e.g. `provideZoneChangeDetection({ eventCoalescing: true }))`?**
A:
