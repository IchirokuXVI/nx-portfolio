# feature-shell: the routed, locale-aware wrapper

`feature-shell` is the app's route table plus its locale-aware wrapper. It is
what `apps/my-app/src/app/remote-entry/entry.routes.ts` lazy-loads. Copy from
`libs/damoclesSword/feature-shell` or `libs/landing-v2/feature-shell`.

## How the locale is settled

The app owns its locale segment: `/{mount}/{locale}/{rest}`. The shell owns no
`:locale` route. One guard, `localeGuard`, sits on the feature-shell's parent
route and reads two things:

- `appKey`, `supportedLocales` and `defaultLocale` from that route's `data`;
- the mount from `data.mountPath`, which the app's `entry.routes.ts` states. It
  comes through route data, not DI, because a guard cannot reliably reach a
  route's own `providers` injector.

Before anything below the guard renders, the segment after the mount is a
supported, canonical locale. The guard adopts a valid locale, rewrites `en-US` to
`en`, replaces an unsupported locale, or inserts a missing one. It never routes
to a not-found page.

## `routes.ts`

```ts
// libs/my-app/feature-shell/src/lib/routes.ts
import { inject } from '@angular/core';
import { Route } from '@angular/router';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { MY_APP_APP_KEY, MY_APP_DEFAULT_LOCALE } from '@portfolio/my-app/ui';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { MyAppWrapper } from './my-app-wrapper/my-app-wrapper';
import { MY_APP_USABLE_LOCALES } from './usable-locales';

export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [localeGuard],
    title: localizedTitle('app-title'),
    // Hold activation until the strings are in.
    resolve: { translationsReady: () => inject(RokuTranslatorService).loaded$ },
    data: {
      appKey: MY_APP_APP_KEY,
      supportedLocales: MY_APP_USABLE_LOCALES,
      defaultLocale: MY_APP_DEFAULT_LOCALE,
    },
    children: [
      {
        path: ':locale',
        component: MyAppWrapper, // the chrome, below the guard
        children: [
          // pages, lazy: { path: 'about', loadComponent: () => import(...) }
          { path: '**', redirectTo: '' },
        ],
      },
      // Required. A parent with children matches only if a child matches, so
      // without this a URL with no locale never reaches the guard that inserts
      // one. Not a `redirectTo`: redirects run before guards and would loop.
      { path: '**', component: NotFoundComponent },
    ],
  },
];
```

```ts
// libs/my-app/feature-shell/src/index.ts
export { appRoutes as MyAppRoutes } from './lib/routes';
```

The table says nothing about where the app is mounted. In a standalone build the
mount is `''` and the same routes serve `/{locale}/...`.

## `usable-locales.ts`

The enabled subset (the app's choice), defaulting to every AVAILABLE locale;
restrict here to disable one. Drives both the guard above and the language
switcher.

```ts
import { MY_APP_AVAILABLE_LOCALES } from '@portfolio/my-app/ui';
export const MY_APP_USABLE_LOCALES: string[] = [...MY_APP_AVAILABLE_LOCALES];
```

## The wrapper component

A thin routed component on the `:locale` route. Two responsibilities, use either
or both:

1. **Load + localize data**: inject the data-access **tokens** (typed as the
   interfaces), resolve the current locale, and re-fetch on language change via the
   RokuTranslator service's `withLocale` (see `references/localization.md`), passing
   already-localized data down to the presentational `ui` components.
2. **Host sub-routes + language switch**: import the `ui` module + `RouterOutlet`,
   read the locale signal from `RokuLocaleStore`, and switch in place with
   `RokuLocaleStore.switchAppLocale(MY_APP_APP_KEY, lang, mountPath)` (no reload).
   Read `mountPath` with `inject(APP_MOUNT_PATH)`; without it the switch rewrites
   the mount segment instead of the locale.

See `libs/damoclesSword/feature-shell/src/lib/damocles-sword-wrapper/`.
