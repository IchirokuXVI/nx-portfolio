# 0006. Translation registration, and why the page shows raw keys

> Prerequisite reading: `0005` (injector scope), `0001` section 5 (the extraction
> contract). This plan changes no design decision in either. It fixes the reason
> `/en/velista` renders translation keys instead of text, and it moves the
> registration of those translations to the layer that should own it.
>
> **Developed in parallel with `0007` (landing and home split).** Section 9 lists
> every file both plans touch and how to keep them out of each other's way.

## 1. What was reported, and what is actually true

Two things were raised.

| Reported                                                                                                               | Verdict                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `translation-providers.ts` belongs in `feature-shell`, because more than one library may want to register translations | **Confirmed as a design call, and it is the right one.** Section 5. The move is not what fixes the raw keys, though                                                          |
| RokuTranslator is not working: the page shows raw keys only                                                            | **Confirmed, and the cause is not in this app at all.** It is in `libs/shared/localization/rokutranslator`, and it is specific to the _shape_ of this app's translation JSON |

There are actually **two** independent defects behind the raw keys, and the second
one stays invisible until the first is fixed. Both are reproduced below rather than
reasoned about.

## 2. Finding 1: not one velista key is ever registered with i18next

### 2.1 The mechanism

`RokuTranslator.addTranslations` takes an eager path when the namespace is already
active, which it always is here (`RokuTranslatorService` calls `addNamespace` for
every namespace it owns before it calls `addTranslations`). That path ends in
`loadTranslations`, whose last line is:

```ts
// libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts
this.i18nextInstance.addResources(this.formatLocale(locale), namespace, loadedTranslations);
```

`i18next.addResources` does this, and only this:

```js
addResources(lng, ns, resources, options = { silent: false }) {
  for (const m in resources) {
    if (isString(resources[m]) || Array.isArray(resources[m])) {
      this.addResource(lng, ns, m, resources[m], { silent: true });
    }
  }
  ...
}
```

**A top level value that is an object is skipped.** Not flattened, not recursed
into: dropped.

Every other app in this workspace ships **flat** translation JSON whose keys are
literal dotted strings:

```json
{ "app-title": "Damocle'Sword", "nav.home": "Home", "section-projects.main-title": "Relevant Projects" }
```

Every value there is a string, so every key survives. `velista`'s JSON is the only
**nested** one in the repo:

```json
{ "app-title": "Velista", "home": { "hero": { "headline": "One list. Everyone in sync." } } }
```

Five of its six top level values are objects, so five of six are dropped on the floor.

### 2.2 The evidence

Run against this workspace's own `i18next`, reproducing exactly what
`loadTranslations` does today, with both apps' real asset files:

```
nested  home.hero.headline -> "home.hero.headline"
nested  app-title          -> "Velista"
flat    nav.home           -> "Home"
velista store bundle keys  -> ["app-title"]
```

The velista bundle contains **one** key. That is the raw keys, in full.

### 2.3 It is worse than that in the browser

The count above is generous, because it loads the JSON through `require`. The real
loader is a webpack dynamic import:

```ts
loader: (locale) => import(`../../assets/i18n/${locale}.json`);
```

which resolves to a **module namespace object**, so the thing handed to
`addResources` is `{ default: {...}, vocabulary: {...}, zone: {...}, ... }`. Every
one of those values is an object, including `default`, so all of them are skipped;
and `app-title` has a hyphen in it, so webpack cannot emit a named export for it
either. In the browser the velista bundle is **empty**.

The lazy path already knew about this: the i18next backend `read` callback in the
same file unwraps `.default` before handing the object over. The eager path does not.
Two load paths, one of which was taught the lesson.

### 2.4 The fix

In `loadTranslations`, unwrap the module namespace and register the bundle with the
call that understands nested objects:

```ts
const loaded = unwrapDefault(await translations());

this.i18nextInstance.addResourceBundle(this.formatLocale(locale), namespace, loaded, /* deep */ true, /* overwrite */ true);
```

`unwrapDefault` is the `'default' in translations && typeof translations.default === 'object'`
check that already exists inline in the backend `read` callback, lifted to a module
level helper and used by both paths. Having the two paths disagree about the shape of
a loader's return value is what produced this bug, so leaving one copy of that rule is
part of the fix, not tidying.

### 2.5 The regression this could have caused, and why it does not

`addResourceBundle` with `deep` stores keys **as written**, so a flat file's
`"nav.home"` stays a single top level key rather than becoming `{ nav: { home } }`,
while `t('nav.home')` splits on the `.` key separator. That is a real risk to the four
apps that are working today, so it was tested rather than assumed. Both shapes through
the proposed call:

```
flat via addResourceBundle  nav.home                    -> "Home"
flat via addResourceBundle  section-projects.main-title -> "Relevant Projects"
flat via addResourceBundle  app-title                   -> "Damocle'Sword"
nested via addResourceBundle home.action.newList        -> "New list"
nested via addResourceBundle zone.role.owner            -> "OWNER"
```

i18next's lookup tries the joined key as well as the split path, so flat files keep
resolving. **`damoclesSword`, `landing`, `landingV2`, `odontogram` and
`shared/ui`'s not-found page are unaffected.** They are also the reason this bug
survived: the workspace convention has been flat JSON, and nothing enforced it, so
the first nested file to arrive found a code path that had never seen one.

### 2.6 Why not just flatten velista's JSON instead

It would work, and it is one file. It is rejected because it fixes one app and leaves
the trap armed for the next one, and because the nested shape is the better one for a
file this size: `home.action.*` as a nested branch is legible, and 60 dotted keys at
one indent level is not. The library claims to accept a `LoaderFunction` returning
`Record<string, string>` or `{ default: ... }`; it should honour the claim.

## 3. Finding 2: nothing re-renders when the translations arrive

This one is hidden behind Finding 1 today, and it will be the next bug reported if
only Finding 1 is fixed. Same shape as `0005` section 1: two provider and timing bugs
stacked, the second invisible behind the first.

### 3.1 The mechanism

`RokuTranslatorService`'s constructor kicks off the loads and keeps the promise:

```ts
Promise.all(promises).then(() => {
  this.loaded$.next(true);
  this.loaded$.complete();
});
```

Nothing waits on `loaded$`. The route injector is created, the service constructs, and
`AppLayout` and the page render **in the same tick**, before any dynamic import has
resolved. So the first paint renders keys, correctly, and the question is what happens
when the strings land a few milliseconds later.

`RokuTranslatorPipe` is `pure: false`, so it re-runs on every change detection pass
that **checks its view**. Under the shell the app is zone based
(`provideZoneChangeDetection` in `apps/shell/src/app/app.config.ts`), so the promise
resolving schedules a pass, and a view with the default change detection strategy is
checked and re-translates. That is precisely why `damoclesSword` and `landing` work.

**Every velista component is `OnPush`.** All fifteen of them. An `OnPush` view is
skipped unless it is marked dirty, and a promise resolving inside a service marks
nothing. The pipe reads `this._serv.locale()` to register a reactive dependency, but
the locale signal only changes when `RokuTranslator.onLocaleChange` fires, which
happens on an explicit locale switch and not on a load completing. So the keys
rendered at the first paint stay on screen forever.

### 3.2 The fix

Give the service a `loaded` **signal**, and have the pipe read it next to the locale:

```ts
// rokutranslator-service.ts
readonly loaded = signal(false);
// ...in the constructor
Promise.all(promises).then(() => { this.loaded.set(true); this.loaded$.next(true); this.loaded$.complete(); });
```

```ts
// rokutranslator-pipe.ts, in transform()
this._serv.locale();
this._serv.loaded();
```

One signal write, so every `OnPush` view holding a `| rokuT` binding is marked dirty
exactly once, at the moment there is something new to show. `loaded$` stays, because
`0007` and any `.ts` side caller may want to await it, and because removing a public
member is not this plan's business.

### 3.3 Why not block the route until the strings are ready

A resolver on `AppShellRoutes` that awaits `loaded$` would also work, and it would
avoid the flash of keys entirely rather than repainting over it. It is **not** chosen
here, for two reasons. It delays first paint on supermarket signal to avoid a flash
measured in milliseconds, which is the wrong trade for this product (`0002` section 6
makes the same call about the display face, and picks `font-display: swap`). And it
would be a velista only fix for a defect that belongs to the shared library, leaving
the next `OnPush` app to rediscover it.

Worth revisiting if the flash turns out to be visible in practice on a real device.
Recorded as open question O1.

## 4. Finding 3: the two load paths disagree, and only one of them was taught

Not a separate defect, but the reason Findings 1 and 2 were both possible. The eager
path and the lazy backend `read` path each decode a loader's return value, and only
`read` unwraps `.default`. `unwrapDefault` from section 2.4 collapses that. The
acceptance criteria in section 7 include a test for the eager path specifically,
because the lazy path is the one that had one.

## 5. Moving the registration to `feature-shell`

### 5.1 What moves, and what does not

The current comment in `libs/velista/ui/src/lib/translation-providers.ts` argues that
the providers must stay in `ui` because "the loader is a relative dynamic import of
this library's own asset folder, so it has to be resolved from a file that sits next
to those assets". That argument is **correct about the loader** and wrong about the
providers. They are two different things, and splitting them is the whole move:

| Thing                                        | Owner                                 | Why                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The loader, and the namespace name it serves | The library that owns the asset files | A relative `import()` is resolved against the file it is written in, and `CLAUDE.md` forbids a relative path across a library boundary. So it cannot live anywhere else |
| The `provideRokuTranslator(...)` call        | `feature-shell`                       | There is exactly one per app injector, it decides the default namespace, and it is the app's composition, not any one library's                                         |

### 5.2 The shape

Each contributing library exports a plain descriptor next to its assets:

```ts
// libs/velista/ui/src/lib/translations.ts
export const VELISTA_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'velista',
  locales: APP_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
```

and `feature-shell` composes every descriptor it knows about into the one call:

```ts
// libs/velista/feature-shell/src/lib/translation-providers.ts
const sources = [VELISTA_UI_TRANSLATIONS];

export const VELISTA_TRANSLATION_PROVIDERS: Provider[] = provideRokuTranslator({
  locales: APP_AVAILABLE_LOCALES,
  defaultNamespace: 'velista',
  namespaces: sources.map((s) => s.namespace).filter((ns) => ns !== 'velista'),
  loader: (locale, namespace) => (sources.find((s) => s.namespace === namespace) ?? sources[0]).loader(locale),
});
```

`TranslationSource` is a small interface, and it belongs in
`@portfolio/localization/rokutranslator-angular` next to `LoaderFunction`, because
nothing about it is velista specific and `odontogram` is already hand rolling this
exact dispatch inline in its UI module.

The dispatching loader is not invented here: it is the shape `odontogram` already uses
(`libs/odontogram/ui/src/lib/odontogram-ui-module.ts`), where a single loader switches
on the `namespace` argument. What is new is that each library states its own entry
instead of the composition site knowing about everybody's asset folders.

### 5.3 Adding the second library later

The point of the move, stated so the next person does not have to re-derive it: a
future `feature-lists` that ships its own `assets/i18n` exports its own
`TranslationSource`, and `feature-shell` adds it to the `sources` array. One line, in
the layer that already knows every library the app is made of. Nothing in `ui` changes,
and no library learns about another library's assets.

### 5.4 Direction check

`feature-shell` already imports from `ui` (`AppLayout`, `APP_KEY`,
`APP_DEFAULT_LOCALE`). `ui` must not import `feature-shell`, and after this move it
still does not. No cycle.

### 5.5 The one import site that changes

`apps/velista/src/app/app-providers.ts` imports `VELISTA_TRANSLATION_PROVIDERS` from
`@portfolio/velista/ui`; it will import it from `@portfolio/velista/feature-shell`.
The providers stay exactly where `0005` put them, on the app injector, and the comment
above them explaining why stays true and stays where it is.

## 6. Not a finding, but worth knowing: the browser tab is broken by the same bug

`apps/shell/src/app/app.routes.ts` sets `title: 'app-title'` with
`data: { titleNs: 'velista' }`, and `RokuTitleStrategy` resolves it through the same
singleton. Since section 2.3 leaves the velista bundle empty in the browser, the tab
falls back to `titleFallback: 'Velista'`, which happens to be the right string for the
wrong reason. Finding 1 fixes it properly. No change needed here, and it is listed so
nobody spends an afternoon on it separately.

## 7. Acceptance criteria

1. `RokuTranslator.addTranslations` registers a **nested** JSON object such that
   `t('home.hero.headline', { ns: 'velista' })` returns the sentence, not the key. A
   unit test in `libs/shared/localization/rokutranslator` covering the **eager** path,
   since only the lazy one was ever exercised.
2. The same test file covers a loader returning `{ default: {...} }`, which is what
   every `import()` of a JSON file actually returns.
3. A regression test asserting a **flat** dotted-key file still resolves, so the four
   working apps are pinned by a test rather than by section 2.5.
4. `RokuTranslatorPipe` re-renders an `OnPush` host when the load completes. Testable
   without a browser: render a component with a deferred loader, assert the key, resolve
   the loader, `await fixture.whenStable()`, assert the string, with **no**
   `detectChanges()` forcing the issue.
5. `VELISTA_TRANSLATION_PROVIDERS` is exported from `@portfolio/velista/feature-shell`
   and no longer from `@portfolio/velista/ui`.
6. `npx nx run-many --all --target=test` and `--target=lint` pass. The four other apps'
   suites are the regression gate for section 2.5.
7. Serving `/en/velista` shows English text on the anonymous screen, and switching the
   locale switches it.

## 8. Files touched

| File                                                                                | Change                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts`                 | `unwrapDefault` helper; `loadTranslations` uses `addResourceBundle(deep, overwrite)`; `read` uses the helper |
| `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-service.ts` | `loaded` signal alongside `loaded$`                                                                          |
| `libs/shared/localization/rokutranslator-angular/src/lib/rokutranslator-pipe.ts`    | reads `loaded()` in `transform`                                                                              |
| `libs/shared/localization/rokutranslator-angular/src/lib/provide-rokutranslator.ts` | exports the `TranslationSource` interface                                                                    |
| `libs/velista/ui/src/lib/translations.ts`                                           | **new.** The `VELISTA_UI_TRANSLATIONS` descriptor, next to the assets                                        |
| `libs/velista/ui/src/lib/translation-providers.ts`                                  | **deleted.** Its reasoning is preserved in the new files rather than lost                                    |
| `libs/velista/ui/src/index.ts`                                                      | export swap                                                                                                  |
| `libs/velista/feature-shell/src/lib/translation-providers.ts`                       | **new.** The composition                                                                                     |
| `libs/velista/feature-shell/src/index.ts`                                           | export it                                                                                                    |
| `apps/velista/src/app/app-providers.ts`                                             | one import path                                                                                              |

## 9. Overlap with `0007`, and how to keep them apart

`0007` splits the home page into a landing route and a home route. The two plans are
close to disjoint, but not quite. Three contact points, in decreasing order of risk.

| Contact point                             | Detail                                                                                                                                                                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/velista/feature-shell/src/index.ts` | Both add an export. `0006` adds `translation-providers`, `0007` adds the auth guards and possibly the landing route entry                                                                                                                                                                                                                | A one line textual conflict at worst. Whoever merges second re-adds their line                                                                                                                                                                          |
| `libs/velista/ui/assets/i18n/*.json`      | `0007` adds `home.preview.line.*` keys for the preview list, and moves nothing. `0006` does not edit these files at all                                                                                                                                                                                                                  | No conflict. `0006` deliberately leaves the JSON alone, which is also why section 2.6 rejects flattening it                                                                                                                                             |
| `RokuTranslatorService.loaded`            | **The real dependency, and it runs one way only.** `0007` needs to translate the preview lines from a `.ts` file via `RokuTranslatorService.t()`, and a `computed` that calls `t()` must depend on something that changes when the strings arrive, or it caches the keys forever. That something is the `loaded` signal from section 3.2 | `0007` writes `this._t.loaded(); this._t.locale();` at the top of that `computed` and codes against it as though it exists. If `0006` has not merged yet the line will not compile, which is the correct time to find out, and `0007` section 8 says so |

**Neither plan blocks the other from starting.** `0007` can be built and reviewed
entirely against raw keys on screen: every string it touches is already a key that
already exists, and the screen being untranslated is `0006`'s defect and explicitly
not `0007`'s concern.

## 10. Open questions

**O1. Should the app hold first paint until the strings are ready?** Section 3.3 says
no and repaints instead. Revisit if the flash of keys is visible on a real phone on a
cold load, and if it is, the fix is a resolver on `AppShellRoutes` awaiting `loaded$`,
not a change to the pipe.

**O2. Should flat translation JSON be migrated to nested?** Out of scope. Once section
2.4 lands, both shapes work, and there is no functional reason to touch the four
working apps. If it is ever done it should be one app per commit with its own suite as
the gate.
