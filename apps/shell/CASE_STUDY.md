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
A:

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

**Q: How do remotes contribute their own translations (per-locale lazy namespace loaders)?**
A:

**Q: In MF config `roku-translator` is forced `singleton: true, strictVersion: true`. What broke — or would break — without it?**
A:

## Testing

**Q: What's the testing strategy across the workspace (unit vs e2e, the `*.shared-spec.ts` pattern, why e2e points at the shell)?**
A:

## Shared foundation

**Q: How are shared libs organized (`libs/shared/*`: environments, data-access, ui/icons) and what rules do you follow for using them?**
A:

**Q: Any deliberate performance / change-detection choices (e.g. `provideZoneChangeDetection({ eventCoalescing: true }))`?**
A:
