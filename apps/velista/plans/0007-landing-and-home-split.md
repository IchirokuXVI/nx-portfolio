# 0007. Splitting the front door from the dashboard

> Prerequisite reading: `0003` (the home page, its mock and its states), `0002`
> section 8 (wide screens), `0001` section 5 (the extraction contract).
>
> **This plan reverses a decision made in `0003`.** Section 1 says why, because a plan
> that quietly contradicts an earlier one is worse than no plan.
>
> **You will not see translated text while building this.** Every string on both
> screens renders as its raw key today. That is a defect in the shared localization
> library: velista ships the workspace's only nested translation JSON, and the library
> silently drops every nested branch when it registers a namespace. It is diagnosed and
> fixed in `libs/shared/localization/rokutranslator/plans/0004`, and wired up by `0006`.
> It is **not this plan's concern**. Build against the keys. Section 8 is the one place
> where these plans actually touch.

## 1. What changes, and what `0003` said

`0003` section 1 made the home page deliberately adaptive: one route, rendering a
front door or a dashboard depending on authentication state, on the reasoning that the
product is launched from a phone home screen and a returning user should not have to
navigate past a marketing page.

That reasoning still holds for the **returning user**, and this plan keeps it: a signed
in user who opens the app still lands on their dashboard in one navigation, because the
landing route redirects them there before anything renders. What changes is that the
two screens stop being one component.

| `0003`                                                  | This plan                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One route `''`, five states in one union, one component | Two routes. `''` is the landing, `home` is the dashboard                                             |
| `anonymous` is a state of the home page                 | `anonymous` is a **page**, and the dashboard has no such state                                       |
| Authentication decides what renders                     | Authentication decides **where you are**, and is enforced at the route rather than inside a template |

Three things drive the reversal:

1. **The two screens share almost nothing.** They share the app bar, and the app bar
   already branches internally on `signedIn`. Everything else is disjoint: the hero,
   the preview card and the auth actions appear only when anonymous; the resume card,
   the zone list, the guest banner and the bottom action bar appear only when signed
   in. One component importing eleven child components to render at most six of them
   at a time is the shape of two components.
2. **The landing page is unreachable once you have signed in, and nothing says so.**
   Today a signed in user pointed at `''` renders the dashboard, so the front door is
   not reachable, but that is a fact about a `@switch` in a template rather than a
   property of the route. Making it a redirect makes it checkable, and makes "signed
   in users never see the front door" a test rather than an emergent behaviour.
3. **The bundles.** A signed in user downloads the hero, the preview card and the
   auth actions on every cold load, and never renders them.

## 2. Routes

Inside `AppShellRoutes` (`libs/velista/feature-shell/src/lib/routes.ts`), both as
children of the existing `AppLayout` parent route, so both keep the locale guard, the
token scope and the connection screen.

| Path   | URL                      | Component     | Guard                | On failure         |
| ------ | ------------------------ | ------------- | -------------------- | ------------------ |
| `''`   | `/<locale>/velista`      | `LandingPage` | `anonymousOnlyGuard` | Redirect to `home` |
| `home` | `/<locale>/velista/home` | `HomePage`    | `authenticatedGuard` | Redirect to `''`   |

Both stay lazy (`loadComponent`), for the reason `routes.ts` already records: the split
looks pointless with one route and stops looking pointless with two. This is the two.

### 2.1 The guards

New file `libs/velista/feature-shell/src/lib/auth-guards.ts`. Two `CanActivateFn`s,
both reading `SessionStore.isAuthenticated()`.

`feature-shell` is allowed to import `@portfolio/velista/data-access`: rule D1
(`0004`) forbids that of `ui`, and this is not `ui`. `SessionStore` is provided on the
app injector rather than at root (rule D5, `0005`), and a route guard resolves against
the route injector, so it is visible. That is worth checking on the first run rather
than assuming, since it is exactly the class of mistake `0005` was written about.

**Building the redirect target.** Extraction contract item 5 forbids hardcoding the
`velista` mount segment, and the locale segment varies per navigation, so neither may
be written down. Both guards therefore derive the target from the URL they were handed:

```ts
const tree = router.parseUrl(state.url);
const primary = tree.root.children['primary'];
// authenticatedGuard fails  -> drop the trailing 'home' segment
// anonymousOnlyGuard fails  -> append a 'home' segment
```

which carries the locale and the mount through untouched, and keeps working in the
standalone build where `APP_BASE_PATH` is `''`.

### 2.2 The redirect is not a flash

Both guards run before either component is created, and both return a `UrlTree`, so
the router navigates without rendering the wrong page first. Same mechanism
`localeCorrectionGuard` already uses on the parent route.

### 2.3 Guard ordering on the parent

`localeCorrectionGuard` sits on the `AppLayout` route and `await`s
`RokuTranslator.changeLocale`. Parent guards resolve before child guards, so the locale
is settled before either of these runs. No interaction, recorded so it is not
rediscovered.

## 3. Where the two components live

`LandingPage` goes in a **new library**, `libs/velista/feature-landing`. `HomePage`
stays in `libs/velista/feature-home`.

| Option                                                   | Verdict                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both components in `feature-home`                        | Rejected. Imports cross a library boundary through the barrel, so `loadComponent(() => import('@portfolio/velista/feature-home').then(m => m.LandingPage))` pulls the whole barrel into one chunk and both pages ship together, which loses reason 3 in section 1 |
| Both in `feature-home`, deep imports to split the chunks | Rejected. `CLAUDE.md` forbids relative paths across library boundaries, and a deep path alias per component is worse than a library                                                                                                                               |
| A new `feature-landing` library                          | **Chosen.** Matches the `libs/<scope>/feature-*` convention, gives each route its own chunk, and gives the landing page its own spec file rather than a growing `describe` in someone else's                                                                      |

The cost is one `project.json`, one `jest.config.cts` and three tsconfigs, scaffolded
the way the other velista libs are. New leaf tsconfigs must include `types/**/*.d.ts`
in `include`, the same as every other project here.

## 4. What each component keeps

### 4.1 `LandingPage` (new, `feature-landing`)

Everything the `anonymous` branch of `home-page.html` renders today, lifted whole:

- `<lib-app-bar [signedIn]="false" [bordered]="false">` with the locale action
- `<lib-home-hero />`
- `<lib-list-preview-card>` with the preview lines, see section 7
- the `.spacer`
- `<lib-auth-actions>` with all four outputs

It injects no data token at all. It reads nothing from `ZoneStore`, and it does not
need `SessionStore` either, because the guard has already established that the viewer
is anonymous. Its handlers are the four `_notYetRouted` recordings from `HomePage`
(`zones.create`, `zones.join`, `auth.google`, `auth.login`) plus `settings`, moved
across unchanged, along with the comment explaining why they are recorded rather than
left unbound.

The `.page.anonymous` and `.spacer` rules move out of `home-page.scss` into
`landing-page.scss`. `.page` itself is duplicated, three lines, rather than shared
through a partial: `0002` keeps component layout in components.

### 4.2 `HomePage` (stays, `feature-home`)

Loses the `anonymous` branch and everything only that branch used: `HomeHero`,
`ListPreviewCard`, `AuthActions`, `previewLines`, and the four handlers listed above.
`accountInitial` stays, `state()` stays, the guest banner, resume card, zone list,
empty state, error state, skeleton and bottom action bar all stay. The app bar is now
unconditionally `[signedIn]="true"` and `[bordered]="true"`, so both inputs can be
dropped from the template and left at their component defaults, except `signedIn`
whose default is `false`.

### 4.3 `selectHomeState` and `HomeState`

`HomeState` (`libs/velista/models/src/lib/home-view.ts`) loses its
`{ kind: 'anonymous' }` member. `selectHomeState` loses the early return that produced
it, and its `identity` input narrows from `Identity` to the authenticated shape.

The comment on that early return is worth keeping in spirit and moving to the guard:
"anonymous is checked first so a stale load state from a previous session can never
show a signed in shape to somebody who is not signed in" is now the guard's job, and it
does it strictly better, because it also stops the dashboard's constructor from firing
a request on behalf of a user who is not there.

`select-home-state.spec.ts` loses its anonymous cases. They do not move to the landing
spec, because there is no longer a function to test: the landing page has no states.

## 5. Centering on wide screens

### 5.1 Why it is not centered

`0002` section 8 and `app-layout.scss` already do the intended thing:

```scss
.app-main {
  @include tokens.app-from(tokens.$app-breakpoint-md) {
    max-width: tokens.$app-content-max; // 480px
    margin-inline: auto;
  }
}
```

That rule is correct and it fires. It centers `.app-main` **inside its host**, and the
host is the problem. `apps/shell/src/app/app.scss` sets the shell's own host to
`display: flex`, and the velista route is componentless at the shell level
(`app.routes.ts` mounts `velista/Routes` under a bare `:locale` path), so `AppLayout`
is a direct **flex item** of that row. `AppLayout`'s own `:host` is:

```scss
:host {
  display: block;
  min-height: 100%;
}
```

with no width and no `flex`, so it takes `flex: 0 1 auto` and sizes to its content
rather than to the row. A 480px column centered inside a box that is itself 480px wide
and pinned to the start of the row is exactly what is on screen: content at the left
edge, and the app's ground colour not filling the viewport either.

`min-height: 100%` is the same class of mistake on the other axis: a percentage height
against a parent with no definite height resolves to `auto`.

### 5.2 The fix

In `app-layout.scss`:

```scss
:host {
  flex: 1; // fill the shell's flex row
  min-inline-size: 0; // so a wide child cannot push the item past the viewport
  min-block-size: 100dvh;
}
```

`flex: 1` is harmless in the standalone build, where the host is not a flex item and
the declaration is simply ignored. `100dvh` matches what the shell already uses for its
own host and what `styles.scss` uses on `body`.

### 5.3 What stays phone shaped on purpose

`0002` section 8 is unchanged: wide screens are not designed, only kept from breaking,
and one centred 480px column is the phone layout given room. After 5.2 the app bar, the
content and the bottom action bar all sit inside that column, which is the intent. Do
not widen `$app-content-max` as part of this work.

## 6. Two defects in the app bar

Both are in `libs/velista/ui/src/lib/home/app-bar.*`, both are visible on the front
door, and neither has anything to do with the split. They are here because this plan is
the one that touches that file.

### 6.1 It draws the mark twice

`app-bar.html` opens with:

```html
<div class="lockup">
  <lib-brand-mark class="mark" />
  <lib-brand-wordmark class="wordmark" />
</div>
```

and `BrandWordmark`'s own template is `<lib-brand-mark class="wordmark__mark" /><span>{{ name() }}</span>`.
The wordmark **is** the lockup: mark plus name. So the header renders the sailboat,
then the sailboat again, then the word. That is the second icon.

**Fix:** delete the standalone `<lib-brand-mark class="mark" />` line, drop `BrandMark`
from `AppBar`'s `imports`, and delete the now dead `.mark` rule from `app-bar.scss`.
Keep `.lockup` and `.wordmark`, and keep the wordmark's `font-size: var(--app-text-xl)`,
which is what sizes both halves, since `BrandMark` is sized in `em`.

This also fixes an accessibility duplication that `brand-mark.ts` warns about in its
own comment: `BrandWordmark`'s host carries `role="img"` and `aria-label`, and the
standalone mark next to it was a second element for the same identity.

`brand-rename.spec.ts` renders the wordmark directly and is unaffected. Add an
assertion to the app bar's spec that the header contains exactly one brand mark, so the
duplicate cannot come back.

### 6.2 The locale button opens nothing

**Reported from the running app: clicking the language control does nothing at all.**
Confirmed, and it is two faults stacked, so fixing either one alone still leaves a
control that lies.

1. **Nothing is wired to it.** The button emits `changeLocale`, and the only handler in
   the app is `HomePage.changeLocale()`, which calls `_notYetRouted('settings')`. That
   pushes a string onto an array nothing renders. There is no menu, no navigation and
   no locale change: the chevron promises a disclosure that does not exist.
2. **The label is a constant.** `AppBar.locale` defaults to `'EN'` and no template in
   the app binds it, so `/es/velista` renders a control reading `EN` while the page
   around it is in Spanish. Somebody who landed on the wrong language sees the switcher
   already claiming to be on the language they wanted.

This matters more here than it would in most places, because it is the **only** control
on the anonymous screen that is not an authentication action, and `app-bar.ts`'s own
comment gives the reason it exists: "someone who has not signed in may well be on the
wrong language and has nothing else to do up here".

#### The split of responsibility

Rule D1 (`0004`) is what shapes this: `ui` may not inject a service, so the app bar
cannot switch a locale. It can perfectly well own a menu, because open and closed is
presentation state and nothing else.

| Piece                                                                                          | Owner         |
| ---------------------------------------------------------------------------------------------- | ------------- |
| Whether the menu is open, which locale is marked current, keyboard and outside click dismissal | `AppBar`      |
| Which locales are offered, and what happens when one is picked                                 | `LandingPage` |

#### `AppBar`'s side

- `locales = input<readonly string[]>([])`, the options to draw. An empty list renders
  the label with no chevron and no menu, which is the right degenerate case for an app
  that ever ships with one language enabled.
- `localeChange = output<string>()`, carrying the locale code that was picked. It
  **replaces** the existing `changeLocale` output, which meant nothing beyond "somebody
  pressed a button"; the page no longer needs to be told about the press.
- A private `menuOpen` signal, toggled by the existing `.locale` button.
- The menu is a list of `<button type="button">`, one per locale, in a container
  positioned under the control. The current locale is marked with `aria-current="true"`
  rather than by colour alone.
- The trigger carries `aria-haspopup="menu"` and `[attr.aria-expanded]="menuOpen()"`.
  A chevron that rotates on open is the visual half of the same statement.
- Dismissal: a `(document:click)` host listener that closes when the click landed
  outside this component's host, and `(document:keydown.escape)`, which returns focus to
  the trigger. `LanguageSelector` in `libs/damoclesSword/ui` already does the outside
  click half with `ElementRef.contains`, and that is the shape to copy rather than
  reinvent. It does **not** get copied wholesale: it is a zone based component with a
  `console.log` inside a `computed` and flag images this app has no assets for.
- Picking a locale emits and closes, so no component in `ui` ever holds a locale.

The menu is drawn in the app bar's own stacking context, not through an overlay service.
There is one of these, on one screen, sitting under a control that is already
positioned; a CDK overlay would be a dependency and a portal for a dropdown of two.

#### `LandingPage`'s side

```ts
private readonly _localeStore = inject(RokuLocaleStore);

/** Reads the store signal, so the label follows an in-place switch. */
readonly locale = this._localeStore.locale;

switchLocale(locale: string): void {
  void this._localeStore.switchAppLocale(APP_KEY, locale);
}
```

`RokuLocaleStore.switchAppLocale` is the shared mechanism from rokutranslator `0003`,
and it already does all three parts: persists the choice under this app's key, calls
`RokuTranslator.changeLocale` so the `pure: false` pipe re-translates in place, and
rewrites the leading locale segment of the URL with a router navigation rather than a
reload. `damoclesSword`'s wrapper calls it exactly this way, so nothing new is needed in
the localization library for this.

The label the app bar shows is `locale().toLocaleUpperCase()`, uppercased in the page
rather than in the bar, so the bar keeps taking a plain string.

#### Where the list of locales comes from

`APP_USABLE_LOCALES` lives in `feature-shell`, and `feature-landing` may not import it:
`feature-shell` lazily imports `feature-landing` in its route table, so the reverse
import closes a cycle in the project graph.

It is read from **route data** instead, which is what `usable-locales.ts`'s own comment
already says the switcher does ("which reads it from the route data, so the two always
agree"). The `AppLayout` route already carries `supportedLocales` for
`localeCorrectionGuard`, so the value is there with nothing to add to the route table:

```ts
private readonly _route = inject(ActivatedRoute);

readonly locales = (this._route.parent?.snapshot.data['supportedLocales'] ??
  []) as readonly string[];
```

Read from `parent` explicitly rather than relying on inheritance: Angular's default
`paramsInheritanceStrategy` of `emptyOnly` hands parent data to the landing route, whose
path is `''`, and **not** to `home`, whose path is not. Depending on that distinction
would make a copy of this line break the moment it moved to a page with a path.

#### What the signed in header does

Nothing, in this plan. `HomePage`'s app bar renders the search and account buttons
instead of the locale control (`@if (signedIn())`), so there is no locale switcher on
the dashboard at all, and `HomePage.changeLocale()` goes away with the output it
handled. Where a signed in user changes language is a settings screen question, and
settings has no plan and no mock yet. Recorded as **O4** in section 11 rather than
answered here.

#### Testing it

In `app-bar.spec.ts`, because that is where the behaviour now lives:

- The menu is not in the DOM until the trigger is clicked.
- Clicking the trigger renders one button per entry in `locales`, and the entry matching
  `locale` is marked `aria-current`.
- Clicking an entry emits `localeChange` with that code and closes the menu.
- A click on `document.body` closes an open menu, and `Escape` closes it.
- `aria-expanded` tracks the open state.

In `landing-page.spec.ts`, that picking a locale calls `switchAppLocale` with `APP_KEY`
and the chosen code, against a double. The switch itself is `RokuLocaleStore`'s own
behaviour and is already covered in the localization library; what this asserts is the
wiring that was missing, which is the actual defect.

## 7. Translating the preview lines

`previewLines` in `home-page.ts` is a hardcoded English array, and its comment argues
the strings should stay untranslated because they are "stand-in groceries" and a
translator would wonder what they are for. That call is reversed here: they are the
only words on the front door that describe what the product does, a Spanish speaker
reading `Milk / Bread / Tomatoes` sees an English app, and the comment's own worry is
answered by naming the keys so their purpose is obvious.

The array moves to `LandingPage` and becomes a `computed`. It has to be translated from
the `.ts` rather than the template, because it is a typed `PreviewLineVm[]` handed to
`ListPreviewCard` as one input, so `RokuTranslatorService.t()` is the tool:

```ts
private readonly _t = inject(RokuTranslatorService);

readonly previewLines = computed<readonly PreviewLineVm[]>(() => {
  // A dependency, not a statement: it re-runs this on a language switch, without
  // which the card keeps the previous language's groceries.
  //
  // Nothing here has to wait for the strings to load. `0006` section 4 puts a
  // resolver on the parent route, so this component cannot be created before the
  // namespace is ready, which is exactly the guarantee that lets a `.ts` caller
  // use `t()` at all.
  this._t.locale();

  return [
    { content: this._t.t('home.preview.line.milk.content'),     quantity: this._t.t('home.preview.line.milk.quantity'), status: 'READY',         by: 'A'  },
    { content: this._t.t('home.preview.line.bread.content'),    quantity: this._t.t('home.preview.line.bread.quantity'), status: 'PENDING',      by: null },
    { content: this._t.t('home.preview.line.tomatoes.content'), quantity: '',                                            status: 'NOT_AVAILABLE', by: 'M' },
  ];
});
```

New keys in `libs/velista/ui/assets/i18n/en.json` and `es.json`, under the existing
`home.preview` branch which already holds `listName` and `zoneName`:

| Key                                  | en       | es      |
| ------------------------------------ | -------- | ------- |
| `home.preview.line.milk.content`     | Milk     | Leche   |
| `home.preview.line.milk.quantity`    | 2 L      | 2 L     |
| `home.preview.line.bread.content`    | Bread    | Pan     |
| `home.preview.line.bread.quantity`   | 1        | 1       |
| `home.preview.line.tomatoes.content` | Tomatoes | Tomates |

The `by` initials stay hardcoded. They stand for people rather than words, and a letter
is not translatable.

## 8. Dependencies and overlap

Everything in this plan can be built, reviewed and merged while the app renders raw
keys. Three specifics so nobody stops on them.

1. **Raw keys on screen are expected.** Both screens will show `home.hero.headline`,
   `home.action.newList` and so on. Do not "fix" it here, do not flatten the JSON, do
   not add a workaround. The library fix lands in
   `libs/shared/localization/rokutranslator/plans/0004` and is wired up by `0006`;
   a second fix stacked on top of those would have to be unpicked.
2. **Nothing in this plan needs a new library API.** Section 7's `computed` reads only
   `locale()`, which exists today. What it does assume is `0006` section 4's route
   resolver, and the assumption is safe in the wrong direction: without the resolver
   the preview lines render as keys like everything else on the screen, and start
   working the moment `0006` lands. No compile break, no code to revisit.
3. **Do not add a `loaded$` subscription to a component to work around point 1.**
   Waiting for translations is decided once, at the app's entry point, in
   `feature-shell`. A page that does it for itself is a page that has to be found and
   undone later.

### Shared files

| File                              | This plan                                        | `0006`                                 |
| --------------------------------- | ------------------------------------------------ | -------------------------------------- |
| `feature-shell/src/lib/routes.ts` | replaces the child route with two guarded routes | adds a resolver to the parent route    |
| `feature-shell/src/index.ts`      | exports the auth guards                          | exports the providers and the resolver |

`routes.ts` is the only one worth coordinating, since both edit the same route table.
They touch different properties of different routes, so the merge is mechanical, but
whoever goes second should open the file rather than trust the diff. `0006` section 8
has the same table from the other side.

`en.json` and `es.json` belong to this plan alone: `0006` changes no translation JSON.

## 9. Acceptance criteria

> **Built 2026-08-26.** All met. Criteria 6a, 7 and 8 were the ones that needed a real
> browser, and they were checked there: `apps/velista-e2e/src/landing.spec.ts` drives
> the locale menu, reads the rendered Spanish and measures the content column at
> 1440px, and passes on all five browser projects.

1. An anonymous visitor to `/en/velista` sees the landing page: brand, hero, preview
   card, the four auth actions.
2. An anonymous visitor to `/en/velista/home` is redirected to `/en/velista`, and
   `HomePage` is never constructed. Assert on the redirect, not on the rendered DOM.
3. A signed in visitor to `/en/velista` is redirected to `/en/velista/home`, and
   `LandingPage` is never constructed.
4. A signed in visitor to `/en/velista/home` sees the dashboard in each of `0003`'s
   four remaining states: loading, empty, populated, error. The existing
   `home-page.spec.ts` cases for those states pass unchanged apart from the route.
5. Both redirects preserve the locale segment, and a redirect from `/es/velista/home`
   lands on `/es/velista`.
6. The header renders exactly one brand mark. Asserted in `app-bar`'s spec.
6a. **The locale control opens.** Clicking it on `/en/velista` reveals a menu with one
    entry per usable locale; picking `es` switches the page to Spanish in place, rewrites
    the URL to `/es/velista` without a reload, and the control then reads `ES`. Clicking
    outside the menu, or pressing `Escape`, closes it. This is checked in the browser as
    well as in the spec, because the reported symptom was "nothing happens on click" and
    a unit test that clicks a `DebugElement` cannot see a control that is not reachable.
7. At a viewport of 1440px the content column is 480px wide and horizontally centred,
   and the app's ground colour fills the viewport.
8. `previewLines` renders the translated strings, and switching the locale switches
   them without a reload. **Fully met**: rokutranslator `0004` landed on `dev` and
   `0006` wired it up, so the caveat this criterion was written under no longer holds.
   Asserted end to end, on the invented groceries specifically: `/es/velista` renders
   Leche rather than Milk, and picking `EN` from the menu switches the whole screen in
   place with a router navigation and no reload.
9. `npx nx run-many --all --target=test` and `--target=lint` pass, and
   `npx nx build velista` succeeds.

## 10. Files touched

| File                                                                            | Change                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `libs/velista/feature-landing/*`                                                | **new library.** `LandingPage`, its template, its stylesheet, its spec, project scaffolding |
| `libs/velista/feature-home/src/lib/home-page/home-page.ts`                      | drop the anonymous branch, its imports, its handlers and `previewLines`                     |
| `libs/velista/feature-home/src/lib/home-page/home-page.html`                    | drop the `@case ('anonymous')` block, fix the app bar bindings                              |
| `libs/velista/feature-home/src/lib/home-page/home-page.scss`                    | move `.anonymous` and `.spacer` out                                                         |
| `libs/velista/feature-home/src/lib/home-page/select-home-state.ts` and its spec | drop the anonymous branch and its cases                                                     |
| `libs/velista/models/src/lib/home-view.ts`                                      | `HomeState` loses `{ kind: 'anonymous' }`                                                   |
| `libs/velista/feature-shell/src/lib/routes.ts`                                  | two child routes with guards. **Also touched by `0006`**                                    |
| `libs/velista/feature-shell/src/lib/auth-guards.ts`                             | **new.** `authenticatedGuard`, `anonymousOnlyGuard`                                         |
| `libs/velista/feature-shell/src/index.ts`                                       | export the guards. **Also touched by `0006`**                                               |
| `libs/velista/ui/src/lib/layout/app-layout.scss`                                | `:host` fills the shell's flex row                                                          |
| `libs/velista/ui/src/lib/home/app-bar.html` / `.ts` / `.scss`                   | remove the duplicate mark (6.1); the locale menu, its state and its dismissal (6.2)         |
| `libs/velista/ui/src/lib/home/app-bar.spec.ts`                                  | **new.** One brand mark, and the locale menu's behaviour                                    |
| `libs/velista/ui/assets/i18n/en.json`, `es.json`                                | five preview line keys                                                                      |
| `tsconfig.base.json`                                                            | path alias for `@portfolio/velista/feature-landing`                                         |

## 11. Open questions

**O1. Should `home` be the app's default route instead of `''`?** That is, should the
mount redirect to `home` and the landing live at its own path such as `welcome`? It
would make the dashboard's URL the stable one for a home screen shortcut. Not chosen,
because the shortcut is installed against the mount and the guard already sends the
signed in user onward in one navigation. Worth revisiting when the standalone build and
the web app manifest land, since that is when a start URL has to be written down.

**O2. Where does a signed out user land after signing out?** `''`, by the same guard,
but the sign out flow is not built and gets its own plan. Nothing here needs to decide
it.

**O3. `0003`'s mock shows one adaptive screen.** The mock is still accurate about what
each screen looks like, and inaccurate about them being one route. It does not need
redrawing; this plan is the record of the change.

**O4. Where does a signed in user change language?** Not in the app bar: that half of
the header is search and account, and section 6.2 deliberately leaves it alone. It
belongs on a settings screen, which has neither a plan nor a mock, so the honest answer
today is that a signed in user changes it by signing out or by editing the URL. Worth
solving with the settings plan rather than by squeezing a second control into a header
that is already full.
