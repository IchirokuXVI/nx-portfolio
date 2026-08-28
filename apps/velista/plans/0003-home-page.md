# 0003 Home page

> Prerequisite reading: `0001` (architecture, routing, the extraction contract) and `0002`
> (tokens and theming). Structure follows the page plan template in `0001` section 9.
>
> **Status: mock approved by the user on 2026-08-25.** The design is settled. The remaining
> open items in section 10 are refinements and two undrawn states, none of which block
> starting the page once the app and libraries are scaffolded.

## 1. Purpose

The home page is the app's front door **and** its dashboard. It is the route the installed
app opens on, so it has to serve two people at once: someone who has never seen the product
and needs to understand it and get in within a few seconds, and someone who opens it in a
supermarket aisle and wants to be inside their list in one tap.

Those are usually two separate pages. They are deliberately one route here, because the
product is meant to be installed and launched from a phone home screen: a marketing page
that a returning user has to navigate past every time would be a tax on the main use case.
So the route is **adaptive**: what it renders is a function of authentication state.

Route: `''` (that is, `/<locale>/velista`). **Public**, with authenticated variants.

## 2. Mock

**https://claude.ai/code/artifact/71175929-0234-4c6e-a277-e26db88e05d5**

Phone frames are 390 by 844. Five artboards:

| Artboard | State |
| --- | --- |
| Anonymous (first open) | No token. The front door. |
| Signed in (returning) | Registered user with groups and an active list. |
| Guest account + pending group | Temporary user, plus a membership awaiting approval. |
| Day theme (signed in) | The same signed in screen in the light theme. |
| Velista mark and wordmark | The sailboat mark at 512, 64, 44, 30 and 16px, both lockups, and the outline variant. |
| Empty / no connection / error | Three phone frames: no groups yet, connection lost, load failure. |

**Phone only.** No desktop or tablet artboards are planned. Wide screens fall back to a
centred column per `0002` section 8, which is a media query rather than a design.

Working sources are in `apps/velista/plans/mocks/home/`, and the published page is
generated from them by `mocks/build-index.mjs`, so edit those rather than the published
page when the design changes. See `mocks/README.md`.

## 3. States

Every state below is either drawn in the mock or described here as text. The page must not
be built until each has a defined appearance.

| State | Condition | Treatment |
| --- | --- | --- |
| Anonymous | No token | Hero, live list preview, create/join, Google, email sign in |
| Loading | Token present, groups not yet in | Skeleton cards, never a full page spinner |
| Empty | Authenticated, zero groups | Centred empty state, both entry actions promoted |
| Populated | Authenticated with groups | Resume card, then group cards |
| Guest | `UserKind.TEMPORARY` | Populated, plus the secure account banner |
| Pending membership | A zone with `MembershipStatus.PENDING` | Dashed card, PENDING badge, no lists, not tappable through to content |
| Needs attention | Caller is OWNER or ADMIN and a join request is waiting | Violet row inside the group card with a Review action |
| No connection | `navigator.onLine` is false, or a request fails with no network | **Blocking** full screen state, reloads itself when the connection returns. See 3.1 |
| Error | Group load failed | Centred error state, retry, copyable correlation reference |

Two notes on states that are easy to get wrong:

- **Loading is not a spinner.** The user opens this in a shop. Skeletons that match the
  final layout keep the page from jumping when data lands, and the resume card should come
  from cache instantly where one exists.
### 3.1 Connection loss, and why this one is a placeholder

Decided by the user on 2026-08-25, and **explicitly temporary**. Losing the network shows a
single blocking screen: "You have lost connection", one line telling the user the page will
come back on its own, and a quiet Reload now button. When the connection returns, the app
reloads itself. There is no offline queue, no cached content behind the screen, and no
service worker. See `0001` section 8.

- **Detection** is `navigator.onLine` plus the window `online` and `offline` events, reached
  through the injectable browser facade rather than touched directly, so the standalone SSR
  build keeps working. A failed request with no network also trips it, because
  `navigator.onLine` reports the network interface, not whether the internet is reachable,
  and a phone attached to a captive portal reports true while nothing works.
- **The Reload now button is an addition**, not part of the brief. The automatic reload
  depends on an event that does not always fire on a flapping mobile connection, and without
  a manual way out the user is stuck on a dead screen. It is one quiet button, and it can be
  dropped if it is unwanted.
- **The reload must not fire while a dialog or an unsaved field is open**, or it discards
  what someone typed. Wait until the user is idle on the blocking screen, which they are by
  definition, and never reload a screen behind it.

Worth stating once, since this plan is the record: **this is the weakest part of the
design.** The product is a shopping list used in a supermarket, and this behaviour is at its
worst exactly there. It is a deliberate simplification to get the app shipped, and it is the
first thing the PWA work should replace. Nothing in this page's structure depends on it.

## 4. Anatomy

Top to bottom. Component names are provisional. All components live in
`libs/velista/ui` unless marked otherwise.

| Region | Component | Notes |
| --- | --- | --- |
| App bar | `AppBarComponent` | Wordmark from `APP_BRAND`, search, account. Anonymous variant shows the locale switch instead of the account button |
| Hero (anonymous) | `HomeHeroComponent` | Display face headline, one paragraph, no navigation |
| Live preview (anonymous) | `ListPreviewCardComponent` | Static illustrative list showing the three line states. Not real data |
| Entry actions (anonymous) | `AuthActionsComponent` | Create, join, Google, email sign in, plus the "what is a zone" line |
| Guest banner | `GuestUpgradeBannerComponent` | Violet attention treatment, two actions, no dismiss X |
| No connection screen | `ConnectionLostComponent` | Blocking, covers the page. Shared with every other page. See 3.1 |
| Resume card | `ResumeListCardComponent` | Last opened list, progress, presence |
| Zone list | `ZoneCardComponent` in a `ZoneListComponent` | Role badge, counts, attention row, nested list rows |
| Bottom action bar | `BottomActionBarComponent` | Primary New list, secondary Join. Respects safe area insets |
| Empty / error | `EmptyStateComponent`, `ErrorStateComponent` | Shared, used by every page |

The page component itself lives in `libs/velista/feature-home` and holds no
presentation logic beyond choosing which of the above to render for the current state.

Component names keep the code word Zone per rule N2 in `0001`, so `ZoneCardComponent`
renders something a user reads as a group. That mismatch is intentional and must not be
"fixed" by renaming the component.

### 4.1 The join request line

Decided with the user. The attention row inside a group card **always names the first
requester**, and only mentions a count when there is more than one:

| Requests | Renders |
| --- | --- |
| 1 | `Ines wants to join` |
| 3 | `Ines and 2 more want to join` |

The mock shows the multi case, since the single case is the obvious one. Three things this
has to get right:

- **The verb changes with the count**: "wants" for one, "want" for many. That is a single
  agreement in English and it is different again in Spanish, so these are **two separate
  translation keys**, never one key with a suffix appended.
- **The count excludes the named person.** Three pending requests render as "and 2 more",
  not "and 3 more".
- **"First" needs a defined order**, otherwise the name changes on every reload and the row
  looks broken. Order by request time, oldest first, and take that name. The backend already
  orders membership listings, so this is a matter of using the same order rather than
  whatever arrives first.

A long name plus the counter must not push the Review action off screen: the name truncates
with an ellipsis and the counter and action never shrink.

## 5. Data

### 5.1 What the gateway offers today

Verified against the gateway controllers and the contracts library rather than assumed:

| Call | Returns |
| --- | --- |
| `GET /v1/zones?cursor&limit&order` | `ZonePage`, that is `Paginated<MyZoneView>` |
| `GET /v1/zones/:zoneId/lists` | Paginated `ListView` |
| `POST /v1/zones` | Creates a zone, mints a temporary user when anonymous, returns tokens |
| `POST /v1/zones/join` | `MembershipView`, same token handshake |
| `GET /v1/lists/:id/lines` | Paginated `LineView` |

`MyZoneView` is `{ id, name, joinCode, status, ownerUserId, config, myRole, myStatus }`.
`ListView` is `{ id, zoneId, name, createdByUserId }`.

Realtime: subscribe to the zone room for each visible zone, so a membership change, a new
list, or a rename appears without a refresh.

### 5.2 The mock asks for data the API does not have

> **Status: the user is implementing this on the backend now (2026-08-25).** It is recorded
> here as the requirement the home page places on the API, not as an open question. The
> shapes below are what this screen needs; the backend plan owns how they are delivered.

Every summary number in the mock was unavailable when this page was designed:

| Shown in the mock | Available? |
| --- | --- |
| "3 members" | No. `MyZoneView` has no member count |
| "2 lists" | No. Only obtainable by listing each zone's lists |
| "12 items" | No. `ListView` has no line count |
| "7 of 12 ready" | No. Requires counting `LineStatus.READY` across all lines |
| "Ines and 2 more want to join" | No. No pending request count, and no requester name, on the zone |
| Which list to resume | No. Nothing marks a most recently used list |

Note the join request row needs **both** a count and the oldest requester's **name**, per
section 4.1. A bare count is not enough to render the line.

Rendering the mock as drawn with today's API means, for a user with three zones: one call
for the zones, three for their lists, and one full line fetch per list just to compute a
progress bar. On supermarket signal that is unacceptable, and it gets worse per zone.

**Three options, with a recommendation.**

1. **Extend `MyZoneView` with a summary block** (recommended, and the direction being
   built): `memberCount`, `listCount`, `pendingRequestCount` and
   `firstPendingRequesterName`, plus a small `lists` preview array carrying
   `{ id, name, lineCount, readyCount }` for the first two or three lists. Home then costs
   exactly one request. The counts are cheap aggregates in core's own database, and core
   already owns every table involved.
2. **A dedicated `home.summary` endpoint** returning precisely this screen's payload. Fast
   and clean, but it couples a backend endpoint to one screen's layout, which is the kind
   of thing that ages badly.
3. **Client side aggregation.** No backend change, but the request fan out above. Rejected.

Option 1 needs a backend plan of its own in `apps/luna-shopper-backend/plans/`. Until it
exists, the home page can be built against a mocked data-access service behind its DI token,
which is the repo's normal pattern anyway, so **frontend work is not blocked, only the
final wiring is.**

**The resume card** is a separate question. Rather than adding backend state, the client
should remember the last opened list id on the device and resolve it on load. That keeps it
working offline, and it is per device, which is arguably more correct than a server side
"most recent" that would fight between someone's phone and their tablet.

## 6. Localization

Namespace `velista`, English and Spanish, registered by the ui library the same way
`libs/landing-v2/ui` does it. Per rule N1 in `0001`, **no key contains the product name**,
and the product name reaches the template as a value from `APP_BRAND`.

**Keys keep the code word `zone`.** This looks odd next to values that read "group", and it
is deliberate: per rule N2 the user facing word is a translation **value**. Keeping keys on
the code word means the day the word changes again, or differs per locale, not a single key
or template moves. So `home.action.createZone` has the value "Create a group".

Keys this page introduces:

| Key | English |
| --- | --- |
| `home.hero.headline` | One list. Everyone in sync. |
| `home.hero.body` | Shared shopping lists for the people you actually shop with. Changes show up on everyone's phone as they happen. |
| `home.action.createZone` | Create a group |
| `home.action.joinCode` | Join with a code |
| `home.action.google` | Continue with Google |
| `home.action.emailSignIn` | Sign in with email |
| `home.zoneExplainer` | A group is the household or flatmates you share lists with. You can start without an account. |
| `home.section.resume` | Pick up where you left off |
| `home.section.zones` | Your groups |
| `home.action.newZone` | New group |
| `home.action.newList` | New list |
| `home.progress.ready` | {{ready}} of {{total}} ready |
| `home.presence.shopping` | {{names}} are shopping now |
| `home.guest.title` | You are shopping as a guest |
| `home.guest.body` | This phone is the only thing holding your account. Add an email or Google to keep your groups and lists if you lose it. |
| `home.guest.secure` | Secure my account |
| `home.guest.later` | Not now |
| `home.pending.waiting` | Waiting for {{name}} to let you in |
| `home.request.wantsToJoin.one` | {{name}} wants to join |
| `home.request.wantsToJoin.many` | {{name}} and {{count}} more want to join |
| `home.request.review` | Review |
| `home.empty.title` | No groups yet |
| `home.empty.body` | A group is the household or flatmates you share lists with. Start one, or join someone else's with their code. |
| `connection.lost.title` | You have lost connection |
| `connection.lost.body` | Check your wifi or mobile data. This page reloads on its own as soon as you are back. |
| `connection.lost.reload` | Reload now |
| `home.error.title` | We could not load your groups |
| `home.error.body` | Something went wrong on our side. Nothing you saved has been lost. |
| `home.error.retry` | Try again |
| `home.error.reference` | ref {{correlationId}} |
| `home.error.copyReference` | Copy reference |

Spanish is written at implementation time, not machine translated in this document. The
user facing word is **grupo**, and Spanish makes that more than a find and replace:

- **Gender agreement.** `grupo` is masculine, so it is "tu grupo" and "tus grupos", and the
  empty state is "Todavía no tienes grupos", not a noun dropped into an English frame. This
  is precisely why the whole phrase is one key rather than a noun assembled at runtime.
- **The join request line needs its own plural rule.** `wantsToJoin.one` becomes
  "{{name}} quiere unirse" and `.many` becomes "{{name}} y {{count}} más quieren unirse".
  The verb changes in both languages, which is the reason these are two keys.
- **Length.** Spanish runs roughly 20 percent longer, and "Crear un grupo" is longer than
  "Create a group", so the two entry buttons, the role badges and the join request row all
  need checking at 320px width.
- `home.presence.shopping` needs single and plural name forms in both languages rather than
  string concatenation, for the same reason.
- The `connection.*` keys are **not** `home.*` on purpose: the blocking screen is shared by
  every page, so its copy does not belong to this one.

## 7. Accessibility and input

- Every control in the mock is at least 44 by 44, including the icon buttons in the app bar
  and the copy reference button.
- The two entry actions and the bottom action bar sit in the bottom third, in thumb reach.
  Nothing destructive appears on this page at all.
- The bottom action bar adds `env(safe-area-inset-bottom)` so it clears the home indicator.
- Zone cards are a single tap target with the chevron as an affordance, not a separate
  button. The nested list rows are their own targets, which needs care: nested interactive
  elements must not be nested `<button>`s. Use a card level link with the list rows as
  sibling links, not children.
- Role and status are never colour alone: OWNER, MEMBER and PENDING are text labels, and
  line statuses in the preview carry distinct icons as well as distinct colours.
- The correlation reference is selectable text as well as a copy button, because a user
  reading it out over the phone is a real support path.
- Presence updates and "changes waiting to sync" announce through a polite live region.
- Verified at 200 percent text zoom and at 320px width.

## 8. Acceptance criteria

- [ ] `/<locale>/velista` resolves to this page, and an e2e test asserts it, guarding
      the shell route ordering trap described in `0001` section 6.1.
- [ ] All ten states in section 3 render, including the two not yet drawn once they are.
- [ ] Anonymous state offers exactly four ways in: create, join, Google, email.
- [ ] Creating or joining a zone while anonymous mints a temporary user, stores the tokens,
      and lands the user in the zone without a separate registration step.
- [ ] The guest banner appears for `UserKind.TEMPORARY` only, is dismissible, and does not
      reappear within the same session after dismissal.
- [ ] Both themes are implemented and verified against the contrast floor in `0002`.
- [ ] Losing the network shows the blocking screen, and regaining it reloads the page
      without discarding an open dialog or a field the user was typing into.
- [ ] A realtime membership or list change updates the page without a manual refresh.
- [ ] No product name string appears anywhere outside `APP_BRAND` and the translation files,
      and the app bar renders the neutral mark with no wordmark until a name exists.
- [ ] No component references a primitive token directly.
- [ ] The word "group" appears **only** in translation values. A search for `group` in the
      TypeScript, template and route sources returns nothing (rule N2).
- [ ] The join request row names the oldest requester, uses the singular form for one
      request and the plural form with a count excluding that person for more, and truncates
      a long name without pushing the Review action off screen.
- [ ] Unit tests cover the state selection logic; the data-access service is behind a DI
      token with an in-memory implementation.

## 9. Out of scope

Zone detail, list detail, the join by code flow itself, the auth screens, and the account
upgrade flow: each gets its own plan and mock. Search, though the entry point is drawn in
the app bar. Install prompts and service worker caching, deferred to the standalone phase
per `0001` section 5. Any locale beyond English and Spanish.

## 10. Open questions

Resolved since the mock was approved, kept here as a record:

- ~~Does the UI say "zone"?~~ **Decided: group in English, grupo in Spanish, code unchanged.**
  See rule N2 in `0001` and section 6 above.
- ~~Where do product specific icons live?~~ **Decided: in this app's own ui library.** See
  `0002` section 9.
- ~~Is a desktop layout needed?~~ **Decided: no.** Phone only, with a centred column fallback.
- ~~What is the product called?~~ **Decided: Velista**, with the sailboat and paper sail mark.
- ~~How is offline handled?~~ **Decided: minimally and temporarily.** See section 3.1.

Still open:

1. **Is the resume card worth its complexity?** It is the fastest path to the main use case
   and the strongest argument for the home page being the landing page, but it depends on
   device stored state plus per list counts. If the counts in section 5.2 are slow to land,
   the page still works without it.
2. **The `MARKED_FOR_DELETION` group state is deliberately skipped for now** (user decision,
   2026-08-25). A user can still reach it after an owner deletes their account, so the page
   must not crash on it: render such a group as a plain, non tappable card until it gets a
   real treatment. That is the whole requirement for this phase.
3. **Does the anonymous state need more than one screen of marketing?** The mock is
   deliberately one screen with no scroll, on the theory that the entry actions matter more
   than persuasion. If this route is ever expected to rank in search, it needs real
   marketing content below the fold, and that pulls the SSR question in `0001` section 4.3
   forward.
4. **Whether the Nx project is renamed to `velista`** before scaffolding. See `0001`
   section 2. It does not change this page, only the paths it lives at.
