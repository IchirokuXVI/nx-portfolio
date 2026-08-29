# 0032. Installing the app

> Prerequisite reading: `0013` (the own origin move, which is what made an install
> possible at all), `0002` sections 4 and 6 (the token ramps and the type scale this
> screen draws from), `0015` (the account page this adds a row to), and `0008`
> section 4.1 (why the invite screen is a page and not a sheet).
>
> Mocks: `plans/mocks/install/`.

## 1. Purpose

Plan `0013` made velista installable and then never mentioned it to anybody.

A search across `libs/velista` and `apps/velista` for `beforeinstallprompt` returns
nothing. So does one for `display-mode`, and one for the word install outside the
manifest. The app has a web app manifest, a service worker with a fetch handler, and
its own origin, which is the complete set of things Chromium asks for, and the only
way a person finds out is by opening a browser menu they have no reason to open.

This plan gives the fact a home. Three places, one state machine behind all three:

1. **A page**, `/{locale}/install`. A designed screen that explains what installing
   gets you, installs it where the browser allows that, and shows the steps where it
   does not.
2. **A row on the account page**, whose label is the answer rather than an invitation:
   it reads *Install the app* before, and *Installed* after.
3. **The invite screen**, where somebody is arriving at the product for the first time
   from a message in another app. That is the single best moment to ask, and there one
   press does both things: it installs, and it sends the join request.

## 2. What a browser will and will not tell us

Everything below is a constraint this design has to survive, and most of the decisions
in section 3 exist because of one of them.

### 2.1 The install prompt cannot be summoned

`beforeinstallprompt` is fired **at the browser's discretion**, once, and the only thing
a page may do is keep the event and call `prompt()` on it later, from inside a user
gesture. There is no API that asks whether installing is possible. So a page cannot ask
a question and render an answer. It can only listen, and react if something arrives.

Two consequences the screen has to be built around:

- **The listener has to be running before any of these screens exist.** The event fires
  early, and a listener attached in a page's constructor has already missed it. This is
  what makes an app level store the only possible home for it (D1).
- **A page rendered before the event arrives is not wrong, it is early.** The state has
  to be allowed to improve after first paint without the screen looking like it was
  loading (D4).

### 2.2 The event is only good once

After `prompt()` resolves, the event is spent. Chromium may fire a fresh one later if
the person dismissed the dialog, and may not. Holding on to a spent event leaves a
button that looks identical and does nothing, which is worse than no button.

### 2.3 Absence of the event is genuinely ambiguous

Chromium does not fire `beforeinstallprompt` when the app is **already installed**. It
also does not fire it on Firefox or on Safari, where installing works but is a menu item
rather than an API. And it does not fire it when something in the install criteria is
not met yet, for instance because the service worker has not finished registering.

So "no event" means one of: installed, unsupported, or not yet. Three different screens
share one signal, and the signal is silence. D3 is the answer.

### 2.4 What "installed" can honestly be known from

| Signal | What it actually proves | Where it works |
| --- | --- | --- |
| `matchMedia('(display-mode: standalone)')` | This page is being viewed **inside** the installed app | Everywhere modern |
| `navigator.standalone === true` | The same, on older iOS | iOS |
| the `appinstalled` window event | It was installed **from this tab**, just now | Chromium |
| `navigator.getInstalledRelatedApps()` | It is installed on this device | Chromium only, and see D8 |

Nothing on that list tells a browser tab that the app was installed last week on the
same device, and **no event fires when somebody uninstalls**. So installedness is a
belief, not a fact, and every screen that renders it has to stay useful when the belief
is wrong. That is D7, and it is the rule that shapes the copy more than any other.

### 2.5 Installing does not carry a session, but the origin does

Installing opens (or later launches) the app at the manifest's `start_url`, which is
`/`, with none of the current route and none of the current navigation state.

What it does carry is **the origin**, and therefore `localStorage`, and therefore the
token pair, because `StorageKeys.session` is stored per origin and the installed window
is the same origin as the tab that installed it. This is exactly the argument `0013` D3
made for moving off the portfolio's origin, arriving now with something concrete
attached to it: somebody can join a group in the browser and open the installed app to
find themselves signed in and already a member.

It is also why the invite flow in D6 can afford to install and join in either order.

## 3. Decisions

### D1. One store, in `platform`, constructed at bootstrap

`InstallStore` lives in `libs/velista/platform` beside `BrowserFacade`, `ThemeStore` and
`ConnectionState`, and it is the only thing in this app allowed to touch
`beforeinstallprompt`, `appinstalled` or `display-mode`. Every screen reads signals.

It is **eagerly constructed**, through an initializer in `app-providers.ts`, and that is
not tidiness: per 2.1, a store created lazily by the install page has already missed the
event on every other route, which is every route somebody actually arrives on. Lazy
construction would make the button work only for people who deep linked to the install
page, which is nobody.

It is provided in `VELISTA_PLATFORM_PROVIDERS` rather than left `providedIn: 'root'`,
for the reason that file already records: under module federation, root is the shell's
injector, and this store depends on values the app provides.

### D2. Three states and no fourth

```ts
export type InstallState =
  /** Running inside the installed app, or known to have installed it. */
  | 'installed'
  /** A prompt is in hand. One press installs, with no instructions to read. */
  | 'ready'
  /** No prompt. The browser can still do it, by hand, and the page says how. */
  | 'manual';
```

There is deliberately no `unsupported` and no `unknown`.

`unknown` is rejected because it would have to be rendered, and the only honest way to
render it is a spinner over a question the browser may never answer (2.1).
`unsupported` is rejected because it is not a state of the app, it is a property of one
browser on one platform, and what somebody needs in that case is not the word no, it is
the steps. Both collapse into `manual`, which is the state that always has something to
show.

### D3. The steps are the floor. The button is the improvement.

The install page renders, from the first frame, the instructions for the browser it is
being read in. If a prompt arrives, a primary button appears **above** them and the
steps stay where they are, folded behind *Prefer to do it by hand?*.

The inverse design, a button that falls back to instructions, cannot be built: it would
have to decide which one to draw before the browser has told it anything, and it would
be wrong on Safari every time.

This also settles the case the request called browsers that cannot install it. There is
no screen that says the browser cannot. There is a screen that says how, and on the one
browser where it genuinely cannot be done, D9 says what goes there instead.

### D4. The page never waits, and never jumps

The primary slot is occupied from the first frame, so nothing moves when the state
improves. Before an event arrives the slot holds the `manual` step card; when
`beforeinstallprompt` lands, the button takes the top of that card and the steps fold.

The transition is a real change in what is possible and is allowed to be visible, but it
is announced politely rather than assertively (section 7) and it never reflows content
the reader is part way through, because it happens above everything, not inside it.

No `aria-busy`, no skeleton, no spinner anywhere on this page. There is nothing loading.

### D5. Under the shell, this page does not install. It points at the origin.

velista runs in two modes (`0013` D1, `app-root-route.ts`). Mounted at
`ichirokuxvi.com/velista` the document is the **portfolio's**, on the portfolio's
origin, with the portfolio's manifest and the portfolio's service worker. An install
triggered from there installs the portfolio, under the portfolio's name and icon.

So in the mounted mode all three affordances change into the same one thing: a link to
`https://velista.app/{locale}/install`. The account row reads *Get the app*, the install
page draws a single card naming the address, and the invite screen offers nothing extra
at all, because somebody mid join should not be sent to another origin.

The mount is already known: `APP_BASE_PATH` is `''` standalone and `/velista` mounted,
and a component may inject it safely (`0015`, and `0003` D7 on why a **guard** may not).
The origin on the other end is **not** known and has to be configured, which is D10.

### D6. Install and join is one gesture, in that order, without waiting

The invite screen's primary becomes **Install and join** when a prompt is in hand, with
*Just join in the browser* below it as a full alternative rather than a link.

The order inside the handler is forced by the platform. `prompt()` requires transient
user activation, and awaiting a network round trip first spends it, so the call has to
be the first statement of the handler with no `await` before it. The join request is
started in the same tick and the two proceed together:

```ts
const prompting = this._install.prompt();       // synchronous call, keeps the gesture
const joining = this._zones.joinZone(this.code);
await prompting;                                // let the dialog close first
const outcome = await joining;
```

`await prompting` before the navigation is the part worth keeping: navigating out from
under an open browser install dialog is at best untidy and at worst dismisses it, and
the join is in flight throughout, so the wait costs nothing.

A dismissed install is not a failed join, and a failed join is not a failed install. The
error, if there is one, is the join sheet's existing message set (`entryErrorKey`),
rendered after the dialog closes, on a screen that is still there.

When there is no prompt, the screen is unchanged from what ships today: one primary,
*Join the group*. The invite screen does not grow a tutorial. Somebody who wants the app
finds it on the account page a minute later, which is where D5's row lives.

### D7. Every state of every screen stays useful when the belief is wrong

Per 2.4, `installed` is a belief with no uninstall event behind it. So:

- The install page's `installed` state is **not** a dead end. It confirms, and below the
  confirmation it keeps *Not on your home screen? Show the steps*, which opens the same
  guide the `manual` state renders.
- The account row's `installed` form is a **statement, not a disabled button**: a value
  row with an `ok` chip, exactly the shape `0015` already uses for a confirmed email. A
  disabled control invites a reader to work out why; a statement does not.
- No copy anywhere says *you already have this*. It says *Installed*, which is a report
  of what this browser believes and reads as one.

### D8. `related_applications` is deliberately not added

`navigator.getInstalledRelatedApps()` is the one API that could tell a browser tab that
the app is installed on this device, and it requires a `related_applications` entry in
the manifest pointing at the manifest's own absolute URL.

That absolute URL is the problem. `manifest.webmanifest` is a static file in `public/`,
identical in the staging and production images, and every velista image except the
shell's is environment agnostic on purpose (CLAUDE.md, and `0014`, which went to some
trouble to keep it that way by injecting URLs at build time rather than committing
them). Putting `https://velista.app/...` in it makes staging claim production's install.

The mechanism is Chromium only and the fallback covers the common cases, so the trade is
one degraded belief on one engine against the environment agnosticism of the image, and
the image wins. What is given up: somebody who installed the app last week, then opens
the site in a browser tab on the same phone, sees `manual` rather than `installed`. D7 is
what makes that survivable, and it is the reason D7 exists.

> Open question, cheap to settle and worth settling before this is final: whether Chrome
> accepts a **relative** `url` in `related_applications`, resolved against the manifest.
> If it does, the entry is environment agnostic after all and this decision reverses. It
> is written as a decision rather than a question because the design must not depend on
> the answer.

### D9. The guides are chosen by user agent, and the user agent decides nothing else

Which steps to show is the one place a user agent read is legitimate: the steps differ by
browser, and there is no capability to feature detect *how a menu is laid out*.

The read is confined to one pure function, `installGuideFor(userAgent, standalone)`,
returning an `InstallGuide` union, and it is used for nothing else. Whether to offer the
button is `InstallState`, and `InstallState` never consults it. Four guides:

| Guide | Steps |
| --- | --- |
| `ios-safari` | Share, then Add to Home Screen, then Add |
| `android-menu` | The browser menu, then Install app or Add to Home screen |
| `desktop-chromium` | The install icon at the end of the address bar |
| `desktop-safari` | File, then Add to Dock |

And one that is not a guide: **`desktop-firefox`**, which cannot keep a site as an app at
all. That frame names the browsers on the same machine that can, and offers a bookmark
instead. It is the only place in this design that says something is not possible, it says
it in one sentence, and it still ends with something to do.

Anything unrecognised falls to `android-menu`, whose wording is the most generic of the
four and is true of nearly every browser menu.

### D10. The standalone origin is configured, not written down

D5 needs a URL to send a mounted reader to, and it must differ between staging and
production. It follows `0014` exactly: a new `APP_STANDALONE_ORIGIN` token in
`velista/models`, provided by the app layer from `environment.ts`, read from
`process.env['VELISTA_APP_URL']` and substituted at compile time by the `DefinePlugin` in
`webpack.config.ts` and `webpack.prod.config.ts`, whose defaults are
`http://localhost:4205` and `https://velista.app`.

It goes in its own token rather than into `AppApiConfig`, which describes where the
**backend** is and would be a lie about this value.

`velista-bundle.spec.ts` already asserts that no literal `process.env` survives into the
emitted bundle, so the new read is covered by a test that exists.

### D11. The manifest earns the dialog it deserves

Two fields the manifest is missing, both cheap:

- **`description`**, which Chromium renders in the rich install dialog and which is
  simply absent today.
- **`id`**, set to `"/"`. Without it the app's identity is derived from `start_url`, so a
  later change to `start_url` would read as a **different app** to an installed browser
  and orphan every existing install. Setting it now costs nothing and closes that off
  permanently.

And one that is more than cheap and is therefore work rather than a line:
**`screenshots`**, with `form_factor` set, which is what upgrades Chromium on Android
from the mini infobar to the full install dialog. Two are enough, one narrow and one
wide, exported from the running app rather than from the mocks so they show the product.

The manifest stays environment agnostic throughout. See D8 for the one field that would
have broken that.

## 4. The screens

Mocks: `plans/mocks/install/`. Phone frames, 390 by 844, Night only. This screen
introduces no colour role that `0003` and `0015` have not already proved, so there is no
Day artboard, per the rule in the mocks README.

### 4.1 The install page

A route, not a sheet, by `0009` section 4.1's test as `0015` applied it: it is deep
linkable, it is somewhere a person goes deliberately, and it is the URL you would put in
a message. Public, with no guard, for the same reason: the whole point of a link is that
it can be sent to somebody who has never signed in.

Top to bottom: the back button in the shape the account page already uses, the app mark,
a Marcellus headline, one sentence about what installing gets you, the primary slot (D3,
D4), and three short lines about what changes once it is installed. Those three lines
are claims about behaviour and each has to be true of the build that ships: full screen
with no browser chrome, one tap from the home screen, and the last opened list still
readable when the signal drops, which is the service worker `0013` turned on.

The three states are drawn in `Install.dc.html`; the five guides in
`InstallGuides.dc.html`.

### 4.2 The account row

A new section between *You* and *Getting in*, headed **The app**, holding one row.

| State | Row |
| --- | --- |
| `ready` | *Install the app*, with a detail line and a chevron. Presses install directly. |
| `manual` | *Add it to your home screen*, with a chevron, going to `/install` |
| `installed` | *The app*, value *Installed*, `ok` chip, no chevron, not a button (D7) |
| mounted | *Get the app*, detail `velista.app`, opening the standalone origin (D5) |

`ready` is the one row in this app that performs a browser action instead of navigating,
and it is worth it: the whole value of a captured prompt is that it removes the trip.
Pressing it and dismissing the dialog leaves the row exactly as it was, and the state
falls back to `manual` if the event is not re-fired (2.2), which changes the label to the
one that navigates. Nothing is stuck.

The section is absent for nobody. Even in the mounted mode it renders, as the link,
because a portfolio visitor reading velista's account page is precisely somebody who
might want the real thing.

### 4.3 The invite screen

`JoinLinkPage` grows one branch, guarded by `installState() === 'ready'` **and** the
standalone mode (D5).

```
[ Install and join ]           primary
[ Just join in the browser ]   secondary, full width, not a link
```

The secondary is a real button and not a quiet link because it is not a lesser choice:
somebody on a shared or work phone should not have to decline something in order to
accept the thing they came for. *Not now*, which exists today and returns to the front
door, stays below both, unchanged.

Anything other than `ready` renders exactly what ships today.

### 4.4 What the guides say

Copy lives in translations, in both languages, keyed as in 5.6. Every step string names
what the reader taps, and the exact menu wording is **verified on a device** rather than
recalled, which is a line item in section 8.

## 5. Work

### 5.1 `libs/velista/platform`

- `install-state.ts`: the `InstallState` union, the `InstallGuide` union, and
  `installGuideFor(userAgent, standalone)`, pure and the home of D9's test cases.
- `install-store.ts`: `InstallStore`. Signals `state`, `guide`, `canPrompt`. Method
  `prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>`, which clears the stored
  event whatever happens (2.2). Listens for `beforeinstallprompt` (preventing its default
  so Chromium's own infobar does not compete with the page) and `appinstalled`. Reads
  `display-mode` through `BrowserFacade.matchMedia`, which already memoises and already
  returns false on the server, so this store needs no platform branch of its own.
- `browser-facade.ts`: one addition, `openExternal(url)`, so D5's link and D9's bookmark
  hint never touch `window.open` from a component. Nothing else in the facade changes.
- `platform-providers.ts`: `InstallStore` added, with the comment saying why it is here
  and not `providedIn: 'root'` (D1).
- `storage-keys.ts`: an `installed` slot, built as `installed:{appKey}` like every other
  key there, holding the persisted `appinstalled` fact from 2.4.

### 5.2 `libs/velista/models`

`APP_STANDALONE_ORIGIN`, an `InjectionToken<string>` whose default is `''` meaning
unknown, per D10.

### 5.3 `libs/velista/ui`

- `install/install-panel`: the primary slot, which is the button, the step card, or the
  confirmation, and which owns D4's rule that the slot does not change height class.
- `install/install-steps`: a numbered list with a glyph per step.
- `install/install-benefits`: the three lines from 4.1.
- Icons, as components in `libs/shared/ui` if they are generic and in this app's icon set
  if they are not: a download glyph for install, the iOS share glyph for the Safari
  guide, and a check for the installed state. **Check `libs/shared/ui` first**: the check
  and the chevron already exist there.

### 5.4 `libs/velista/feature-install`

A new lib for one page, matching `feature-landing` and `feature-account`, which are also
small. `InstallPage`, plus its spec.

### 5.5 Routes

One entry in `libs/velista/feature-shell/src/lib/routes.ts`, **before** the `''` front
door like every other non empty path, and with no guard:

```ts
{
  path: 'install',
  loadComponent: () =>
    import('@portfolio/velista/feature-install').then((m) => m.InstallPage),
},
```

`routes.spec.ts` gets the assertion it makes for every other route: that it precedes the
empty path, and that it carries no `canActivate`, which is the deliberate part.

### 5.6 Translations

A new `install` namespace in `libs/velista/ui/assets/i18n/{en,es}.json`, plus three keys
under the existing `account` tree for the row. Sketch, English:

```
install.title              Keep Velista on your phone
install.body               ...
install.action             Install Velista
install.installed.title    Velista is installed
install.installed.body     ...
install.installed.reveal   Not on your home screen? Show the steps
install.manual.heading     Add it by hand
install.guide.iosSafari.step1 / .step2 / .step3
install.guide.androidMenu.*
install.guide.desktopChromium.*
install.guide.desktopSafari.*
install.guide.desktopFirefox.body / .bookmark
install.benefit.fullscreen / .oneTap / .offline
install.elsewhere.title    The app lives at velista.app
install.elsewhere.action   Open velista.app
account.app.section        The app
account.app.install        Install the app
account.app.add            Add it to your home screen
account.app.installed      Installed
account.app.elsewhere      Get the app
entry.joinLink.installAndJoin   Install and join
entry.joinLink.justJoin         Just join in the browser
```

Spanish is written at the same time, not after. The interface word is **group** and
**grupo**, never zone (rule N2).

### 5.7 The manifest and the app shell

- `description` and `id` in `manifest.webmanifest` (D11).
- Two screenshots into `public/screenshots/`, and their `screenshots` entries.
- `ngsw-config.json`: `/screenshots/**` folded into the existing lazy `assets` group, so
  the install dialog's images are cached like every other image rather than being the one
  asset group that is not.

### 5.8 The app layer

`app-providers.ts` provides `APP_STANDALONE_ORIGIN` from `environment.ts` and adds the
initializer that constructs `InstallStore` (D1). `webpack.config.ts` and
`webpack.prod.config.ts` gain the third `DefinePlugin` value (D10).

## 6. Rules

- **I1.** Only `InstallStore` touches `beforeinstallprompt`, `appinstalled`,
  `display-mode` or `navigator.standalone`. Any screen that wants to know injects it.
- **I2.** The stored event is cleared after `prompt()` resolves, always, including when
  it rejects (2.2).
- **I3.** A user agent read decides **which guide**, never whether a button exists (D9).
- **I4.** No state of the install page and no state of the account row is a dead end (D7).
- **I5.** In the mounted mode nothing calls `prompt()` and nothing registers a worker.
  Installing is a property of the standalone origin (D5, and `0013` D4 on the worker).
- **I6.** The manifest stays environment agnostic (D8, D11).

## 7. Accessibility

- The primary slot changing from a step card to a button is announced through **one
  polite live region** that exists from the first frame, in the shape `0015` used for the
  rename announcement: a region created at the moment its text appears is often not
  announced at all.
- The step list is an `<ol>`, so the count and the position are read out without the copy
  having to say *step 2 of 3*.
- The share and install glyphs are `aria-hidden`, and every step's text names the control
  in words, because a person who cannot see the glyph is exactly the person the steps are
  for.
- The `installed` chip is a word, not a colour, matching the confirmed and not confirmed
  chips `0015` established.
- Target sizes stay at the 44 pixel floor `0002` section 8 set.

## 8. Verification

- **Unit.** `installGuideFor` against a table of real user agent strings, including the
  iPad that reports as a Mac and therefore lands on `desktop-safari`, whose steps are
  wrong for it. Decide that case explicitly rather than letting it fall out.
- **Unit.** `InstallStore`: the event captured before any page exists, the state moving
  `manual` to `ready` on capture and to `installed` on `appinstalled`, and the event
  cleared after a prompt.
- **Component.** The account row's four forms, and the invite screen's two.
- **Route.** `install` precedes `''` and carries no guard.
- **By hand, on devices, and this is the part that cannot be skipped**: iOS Safari, Chrome
  on Android, Chrome and Edge on the desktop, Firefox on the desktop, and Safari on
  macOS. What is being checked is the **wording of the menus the steps name**, which no
  test in this repository can check, and which is the entire value of the guide.
- **By hand, once**: install, then open the installed window, and confirm the session is
  there (2.5). If it is not, something about the origin is not what `0013` believes.

## 9. Out of scope

- **A service worker update prompt.** velista has a worker and no way to tell somebody a
  new version is waiting. That is a real gap and a different plan.
- **Push notifications.** Related only by both being things a manifest can lead to.
- **A settings page.** Still outstanding from `0015`, still not this.
- **Anything about the portfolio's own installability.** D5 makes velista's install a
  property of velista's origin and touches nothing on the shell's.
- **Trusted Web Activity and store publishing**, which `0013` D3 named as a reason for
  the origin. The origin makes it possible; nothing here starts it.

## 10. Acceptance criteria

1. `/{locale}/install` renders on the standalone origin, for a signed out visitor, with
   no request made.
2. On Chromium, the primary is a working install button within a second of the worker
   registering, and pressing it opens the browser's own dialog.
3. On iOS Safari, the same URL renders the three Share steps and no button.
4. On desktop Firefox, it renders one sentence and a bookmark suggestion, and does not
   pretend an install is coming.
5. Viewed inside the installed app, all three surfaces read `installed`, and the install
   page still offers the steps.
6. The account row's label changes with the state, with no reload.
7. On an invite link with a prompt in hand, one press opens the install dialog and joins
   the group, and dismissing the dialog still joins.
8. Mounted at `/velista`, nothing prompts, and all three surfaces point at `velista.app`.
9. `nx run-many --all -t lint test build` is green, and no literal `process.env` survives
   into the emitted bundle.
