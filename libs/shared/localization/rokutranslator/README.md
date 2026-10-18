# localization/rokutranslator

This library was generated with [Nx](https://nx.dev).

## Building

Run `nx build localization/rokutranslator` to build the library.

## Running unit tests

Run `nx test localization/rokutranslator` to execute the unit tests via [Jest](https://jestjs.io).

## The starting locale

`init` with no locale starts with the first supported browser language. When the
browser speaks none of them, it starts with `defaultLocale` from the config, and
without one with the first entry of `supportedLocales`. An app therefore always
starts with a real locale, and the locale guard corrects it from the URL. In Angular,
pass the default as `defaultLocale` to `provideRokuTranslator`.

## The route that carries `localeGuard` re-runs it on a locale change

An app installs `localeGuard` on a componentless parent route, and the locale is the
`:locale` segment of a child route. With the router default (`paramsChange`), a move
from `/en` to `/es` changes only the param of the child. The parent guard then does
not run, and a browser back after a language switch keeps the old language under the
new URL.

So the route that carries the guard also sets
`runGuardsAndResolvers: rerunOnLocaleSegmentChange` from
`@portfolio/localization/rokutranslator-angular`. That function compares the first
segment below the route and nothing else, so a change of a list id or any other param
does not re-run the guard. `changeLocale` returns early for a locale it already
announced, so the re-run that follows a language switch costs nothing.

```ts
{
  path: '',
  canActivate: [localeGuard],
  runGuardsAndResolvers: rerunOnLocaleSegmentChange,
  children: [{ path: ':locale', component: Layout, children: [...] }, { path: '**', component: NotFound }],
}
```
