# Shell — Case Study (Foundation & General)

> How the portfolio's foundation was built. Answers (`A:`) are written by Daniel.
> `> Note (Claude):` blocks flag things the code shows that an answer may have missed.
> Docker / CI/CD / Kubernetes are documented in `apps/docker/CASE_STUDY.md`.

## Why this stack

**Q: Why an Nx monorepo? What did it give you over a plain workspace or polyrepo?**
A:

**Q: Why build a portfolio as micro-frontends with Module Federation instead of one Angular app?**
A:

## Module federation topology

**Q: The shell is the only host. How does it declare and lazy-load remotes (the `damoclesSword/Routes` alias trick)?**
A:

**Q: Remotes render a blank page on their own port by design. Why did you make that choice and how does it work?**
A:

## Locale-first routing

**Q: The top-level route is `:locale` handled by `LocaleWrapperComponent`. Why route locale first?**
A:

**Q: On a locale change you rewrite the URL with a full `window.location.href` navigation instead of an Angular router nav. Why the full reload?**
A:

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
