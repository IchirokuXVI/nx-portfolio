# 0003 Home page

> Prerequisite reading: `0001` (architecture, routing, the extraction contract) and `0002`
> (tokens and theming). Structure follows the page plan template in `0001` section 9.
>
> **Status: mock published, awaiting approval.** Nothing is built from this plan until the
> mock is approved and the open questions in section 10 are answered.

## 1. Purpose

The home page is the app's front door **and** its dashboard. It is the route the installed
app opens on, so it has to serve two people at once: someone who has never seen the product
and needs to understand it and get in within a few seconds, and someone who opens it in a
supermarket aisle and wants to be inside their list in one tap.

Those are usually two separate pages. They are deliberately one route here, because the
product is meant to be installed and launched from a phone home screen: a marketing page
that a returning user has to navigate past every time would be a tax on the main use case.
So the route is **adaptive**: what it renders is a function of authentication state.

Route: `''` (that is, `/<locale>/luna-shopper`). **Public**, with authenticated variants.

## 2. Mock

**https://claude.ai/code/artifact/71175929-0234-4c6e-a277-e26db88e05d5**

Phone frames are 390 by 844. Five artboards:

| Artboard | State |
| --- | --- |
| Anonymous (first open) | No token. The front door. |
| Signed in (returning) | Registered user with zones and an active list. |
| Guest account + pending zone | Temporary user, plus a zone membership awaiting approval. |
| Day theme (signed in) | The same signed in screen in the light theme. |
| Empty / offline / error | Three phone frames: no zones yet, offline with queued changes, load failure. |

Working sources are in `apps/luna-shopper-frontend/plans/mocks/home/` and the canvas is
re-seeded from them, so edit those rather than the published page when the design changes.

## 3. States

Every state below is either drawn in the mock or described here as text. The page must not
be built until each has a defined appearance.

| State | Condition | Treatment |
| --- | --- | --- |
| Anonymous | No token | Hero, live list preview, create/join, Google, email sign in |
| Loading | Token present, zones not yet in | Skeleton cards, never a full page spinner |
| Empty | Authenticated, zero zones | Centred empty state, both entry actions promoted |
| Populated | Authenticated with zones | Resume card, then zone cards |
| Guest | `UserKind.TEMPORARY` | Populated, plus the secure account banner |
| Pending membership | A zone with `MembershipStatus.PENDING` | Dashed card, PENDING badge, no lists, not tappable through to content |
| Needs attention | Caller is OWNER or ADMIN and a join request is waiting | Violet row inside the zone card with a Review action |
| Offline | No connectivity | Banner, cached content, queued change count, presence suppressed |
| Error | Zone load failed | Centred error state, retry, copyable correlation reference |
| Zone marked for deletion | `ZoneStatus.MARKED_FOR_DELETION` | **Not drawn yet.** See section 10. |

Two notes on states that are easy to get wrong:

- **Loading is not a spinner.** The user opens this in a shop. Skeletons that match the
  final layout keep the page from jumping when data lands, and the resume card should come
  from cache instantly where one exists.
- **Offline is not an error.** The offline artboard deliberately keeps the primary action
  enabled: creating a list works offline and queues. Only actions that genuinely cannot work
  without the network, such as joining a zone by code, are disabled, and they say why.

## 4. Anatomy

Top to bottom. Component names are provisional. All components live in
`libs/luna-shopper-frontend/ui` unless marked otherwise.

| Region | Component | Notes |
| --- | --- | --- |
| App bar | `AppBarComponent` | Wordmark from `APP_BRAND`, search, account. Anonymous variant shows the locale switch instead of the account button |
| Hero (anonymous) | `HomeHeroComponent` | Display face headline, one paragraph, no navigation |
| Live preview (anonymous) | `ListPreviewCardComponent` | Static illustrative list showing the three line states. Not real data |
| Entry actions (anonymous) | `AuthActionsComponent` | Create, join, Google, email sign in, plus the "what is a zone" line |
| Guest banner | `GuestUpgradeBannerComponent` | Violet attention treatment, two actions, no dismiss X |
| Connection banner | `ConnectionBannerComponent` | Offline and reconnecting. Shared with every other page |
| Resume card | `ResumeListCardComponent` | Last opened list, progress, presence |
| Zone list | `ZoneCardComponent` in a `ZoneListComponent` | Role badge, counts, attention row, nested list rows |
| Bottom action bar | `BottomActionBarComponent` | Primary New list, secondary Join. Respects safe area insets |
| Empty / error | `EmptyStateComponent`, `ErrorStateComponent` | Shared, used by every page |

The page component itself lives in `libs/luna-shopper-frontend/feature-home` and holds no
presentation logic beyond choosing which of the above to render for the current state.

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

This is the main engineering finding of this design pass and it is a **blocking dependency**,
not a detail. Every summary number in the mock is currently unavailable:

| Shown in the mock | Available? |
| --- | --- |
| "3 members" | No. `MyZoneView` has no member count |
| "2 lists" | No. Only obtainable by listing each zone's lists |
| "12 items" | No. `ListView` has no line count |
| "7 of 12 ready" | No. Requires counting `LineStatus.READY` across all lines |
| "Ines wants to join" | No. No pending request count on the zone |
| Which list to resume | No. Nothing marks a most recently used list |

Rendering the mock as drawn with today's API means, for a user with three zones: one call
for the zones, three for their lists, and one full line fetch per list just to compute a
progress bar. On supermarket signal that is unacceptable, and it gets worse per zone.

**Three options, with a recommendation.**

1. **Extend `MyZoneView` with a summary block** (recommended): `memberCount`,
   `listCount`, and `pendingRequestCount`, plus a small `lists` preview array carrying
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

Namespace `lunaShopper`, English and Spanish, registered by the ui library the same way
`libs/landing-v2/ui` does it. Per rule N1 in `0001`, **no key contains the product name**,
and the product name reaches the template as a value from `APP_BRAND`.

Keys this page introduces:

| Key | English |
| --- | --- |
| `home.hero.headline` | One list. Everyone in sync. |
| `home.hero.body` | Shared shopping lists for the people you actually shop with. Changes show up on everyone's phone as they happen. |
| `home.action.createZone` | Create a zone |
| `home.action.joinCode` | Join with a code |
| `home.action.google` | Continue with Google |
| `home.action.emailSignIn` | Sign in with email |
| `home.zoneExplainer` | A zone is the household or group you share lists with. You can start without an account. |
| `home.section.resume` | Pick up where you left off |
| `home.section.zones` | Your zones |
| `home.action.newZone` | New zone |
| `home.action.newList` | New list |
| `home.progress.ready` | {{ready}} of {{total}} ready |
| `home.presence.shopping` | {{names}} are shopping now |
| `home.guest.title` | You are shopping as a guest |
| `home.guest.body` | This phone is the only thing holding your account. Add an email or Google to keep your zones and lists if you lose it. |
| `home.guest.secure` | Secure my account |
| `home.guest.later` | Not now |
| `home.pending.waiting` | Waiting for {{name}} to let you in |
| `home.request.wantsToJoin` | {{name}} wants to join |
| `home.request.review` | Review |
| `home.empty.title` | No zones yet |
| `home.empty.body` | A zone is the household or group you share lists with. Start one, or join someone else's with their code. |
| `home.offline.banner` | You are offline. Your changes are saved here and will sync when you are back. |
| `home.offline.queued` | {{count}} changes waiting to sync |
| `home.offline.noPresence` | Cannot show who is shopping while offline |
| `home.error.title` | We could not load your zones |
| `home.error.body` | Something went wrong on our side. Nothing you saved has been lost. |
| `home.error.retry` | Try again |
| `home.error.reference` | ref {{correlationId}} |
| `home.error.copyReference` | Copy reference |

Spanish is written at implementation time, not machine translated in this document. Two
things to watch: Spanish runs roughly 20 percent longer, so the two entry buttons and the
role badges need to be checked at 320px width, and `home.presence.shopping` needs plural
and single name forms in both languages rather than string concatenation.

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

- [ ] `/<locale>/luna-shopper` resolves to this page, and an e2e test asserts it, guarding
      the shell route ordering trap described in `0001` section 6.1.
- [ ] All ten states in section 3 render, including the two not yet drawn once they are.
- [ ] Anonymous state offers exactly four ways in: create, join, Google, email.
- [ ] Creating or joining a zone while anonymous mints a temporary user, stores the tokens,
      and lands the user in the zone without a separate registration step.
- [ ] The guest banner appears for `UserKind.TEMPORARY` only, is dismissible, and does not
      reappear within the same session after dismissal.
- [ ] Both themes are implemented and verified against the contrast floor in `0002`.
- [ ] The page renders from cache and is interactive before the network settles.
- [ ] A realtime membership or list change updates the page without a manual refresh.
- [ ] No product name string appears anywhere outside `APP_BRAND` and the translation files.
- [ ] No component references a primitive token directly.
- [ ] Unit tests cover the state selection logic; the data-access service is behind a DI
      token with an in-memory implementation.

## 9. Out of scope

Zone detail, list detail, the join by code flow itself, the auth screens, and the account
upgrade flow: each gets its own plan and mock. Search, though the entry point is drawn in
the app bar. Install prompts and service worker caching, deferred to the standalone phase
per `0001` section 5. Any locale beyond English and Spanish.

## 10. Open questions

1. **Does the UI say "zone"?** It is the backend's word and means nothing to a first time
   user. The mock keeps it and explains it in one line, which is the honest but not
   necessarily the best answer. "Group", "household" or "home" may read better. Changing it
   is a translation value change only, since the API keeps saying zone either way, so this
   is cheap to change now and awkward later once screenshots exist.
2. **Is the resume card worth its complexity?** It is the fastest path to the main use case
   and the strongest argument for the home page being the landing page, but it depends on
   device stored state plus per list counts. If the answer to section 5.2 is slow to land,
   the page still works without it.
3. **Two states are not drawn yet**: a zone in `MARKED_FOR_DELETION`, which a user can hit
   after an owner deletes their account, and the reconnecting state between offline and
   online. Both need a treatment before the page is built.
4. **Does the anonymous state need more than one screen of marketing?** The mock is
   deliberately one screen with no scroll, on the theory that the entry actions matter more
   than persuasion. If this route is ever expected to rank in search, it needs real
   marketing content below the fold, and that pulls the SSR question in `0001` section 4.3
   forward.
5. **Product specific icons**: `0002` section 9 asks whether they go in `libs/shared/ui`
   per CLAUDE.md, or in this app's own ui library. This page alone needs six new ones.
