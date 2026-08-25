# feature-shell: the routed, locale-aware wrapper

`feature-shell` is the remote's route table plus its locale-aware wrapper. It is
what `apps/my-app/src/app/remote-entry/entry.routes.ts` lazy-loads. Copy from
`libs/landing-v2/feature-shell` or `libs/damoclesSword/feature-shell`.

## How the locale context reaches you

The shell owns `/:locale/...`. Two guards cooperate:
- **`localeGuard`** (on the shell's `:locale` route) — if the first URL segment is
  not a valid locale, it redirects to `/<guess>/<path>`. The guess order is: the
  app's last-used locale (persisted as `roku-locale:{appKey}`), then the browser
  locale, then the default.
- **`localeCorrectionGuard`** (on your feature-shell's root route) — validates that
  locale against **this app's** supported set (from route `data`) and corrects the
  URL with a router navigation (no reload) if the app does not support it.

So your feature-shell declares which locales it supports; the guards handle the
rest.

## `routes.ts`

A parent route that renders a shared `Layout`/wrapper (site chrome hosting a
`<router-outlet>`), guarded by `localeCorrectionGuard`, carrying the locale set in
route `data`; children are the actual pages. Re-export it from the lib's `index.ts`
under an app-specific name.

```ts
// libs/my-app/feature-shell/src/lib/routes.ts
import { Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import { MY_APP_APP_KEY, MY_APP_DEFAULT_LOCALE, Layout } from '@portfolio/my-app/ui';
import { MyAppWrapper } from './my-app-wrapper/my-app-wrapper';
import { MY_APP_USABLE_LOCALES } from './usable-locales';

export const MyAppShellRoutes: Route[] = [
  {
    path: '',
    component: Layout,
    canActivate: [localeCorrectionGuard],
    data: {
      appKey: MY_APP_APP_KEY,
      supportedLocales: MY_APP_USABLE_LOCALES,
      defaultLocale: MY_APP_DEFAULT_LOCALE,
    },
    children: [
      { path: '', component: MyAppWrapper },
      // detail pages, lazy: { path: 'thing/:slug', loadComponent: () => import(...) }
    ],
  },
];
```

```ts
// libs/my-app/feature-shell/src/index.ts
export * from './lib/routes';
```

## `usable-locales.ts`

The enabled subset (the app's choice), defaulting to every AVAILABLE locale;
restrict here to disable one. Drives both the route-data guard above and the
language switcher (which reads it from route data).

```ts
import { MY_APP_AVAILABLE_LOCALES } from '@portfolio/my-app/ui';
export const MY_APP_USABLE_LOCALES: string[] = [...MY_APP_AVAILABLE_LOCALES];
```

## The wrapper component

A thin routed component. Two responsibilities, use either or both:

1. **Load + localize data**: inject the data-access **tokens** (typed as the
   interfaces), resolve the current locale, and re-fetch on language change via the
   RokuTranslator service's `withLocale` (see `references/localization.md`), passing
   already-localized data down to the presentational `ui` components.
2. **Host sub-routes + language switch**: import the `ui` module + `RouterOutlet`,
   read the locale signal from `RokuLocaleStore`, and switch in place with
   `RokuLocaleStore.switchAppLocale(MY_APP_APP_KEY, lang)` (no reload).

`odontogram` needs no wrapper (its CRUD feature is the routed component);
`damoclesSword` and `landingV2` use one because they have sub-routes and/or a
header language selector.
