> **PR:** [#484](https://github.com/IchirokuXVI/nx-portfolio/pull/484)

# 0103: the shop picker that finds you

> **Mock first.** There is no mock for this plan yet. The session that builds it adds the
> redesigned picker to `mocks/buying-at/` (the one from `0102`): recent shops at the top,
> the "Near me" button, the list of nearby shops with distances, the message after an
> automatic pick, and the copy for each reason there was no pick. It stops for the user's
> review before any code.
>
> Backend half: `apps/luna-shopper-backend/plans/0164`, the shops near you and the ones you
> bought at. Needs `0102` first: this plan redesigns the picker `0102` moved into `ui`.
>
> Prerequisite reading: `0058` (the device says where you shop), `0078` section 4 (the
> picker as it is), `0102`, and backend `0164` sections 2 to 4.

Choosing a shop by searching is slow when the person is standing in it. Two things make it
fast: the shops the person bought at recently, drawn first, and a "Near me" button that asks
the device where it is and, when the answer is clear, picks the shop.

## Brief for the agent

### Objective

Redesign the shop picker to draw the person's recent shops first and to offer "Near me",
which picks a shop automatically by the rule of backend `0164` section 3 and says so, or
otherwise lists the nearby shops with their distances.

### Context

- **The picker body** lives in `libs/velista/ui/src/lib/shops/` after `0102`, used by
  `ShopPickerSheet` in `feature-shopping-lists` and by the get a list sheet in
  `feature-home`.
- **The geolocation reader** is `BrowserGeolocationReader` behind `GEOLOCATION_READER`
  (`libs/velista/platform/src/lib/geolocation-reader.ts`, around lines 69 to 183). It calls
  `getCurrentPosition` (around line 141) with `enableHighAccuracy: false`, a ten second
  timeout and a maximum age, and has a `permission()` check that shows no prompt. It is used
  today by `location-sheet.ts` and the setup's `place-step.ts`.
- **The routes** (backend `0164`): `POST /v1/baskets/:id/shops/nearby` inside a basket,
  `POST /v1/catalog/shops/nearby` in the get a list sheet (no basket exists yet), and
  `GET /v1/account/recent-shops`.
- **Rule D4**: map both answers from `unknown` into velista's own models.

### Target state

- The reader accepts options per call. The picker's call asks for
  `enableHighAccuracy: true`, a fifteen second timeout and a maximum age of zero. The other
  two callers keep what they have.
- "Near me" / "Cerca de mí" is a button in the picker. The permission prompt appears only
  after the person presses it, as `0058` requires. The position's `accuracy` is sent as
  `accuracyMetres`.
- **A pick** sets the shop, closes the picker, and shows a message that names the shop and
  the distance, with a way to change it: "Buying at Mercadona, Calle Mayor 3 (120 m).
  Change" / "Comprando en Mercadona, Calle Mayor 3 (120 m). Cambiar". The message stays until
  the person dismisses it or changes the shop.
- **No pick** draws the candidates at the top of the picker, nearest first, each with its
  distance, and one line of copy for the reason:
  - `AMBIGUOUS`: "Several shops are close. Choose yours."
  - `LOW_ACCURACY`: "Your location is not precise enough to choose for you."
  - `OUTSIDE_PROFILE`: "This shop is outside your areas." Draw the shop with the warning from
    `0102`, as a candidate, not as a pick.
  - `NONE_NEARBY`: "No shop within 750 m."
- A refused permission, a timeout or an error draws one line and leaves the rest of the
  picker working.
- **Recent shops** are the first section of the picker for a signed in person, newest first,
  from `GET /v1/account/recent-shops`, above the chain buttons and the search. The section is
  not drawn when the list is empty, and never for a guest.
- Spanish copy is written for every string above, in the voice of the existing
  `basket.view.shop.*` keys.

### Scope

Work only in `libs/velista/platform` (the reader's options), `libs/velista/models`,
`libs/velista/data-access`, `libs/velista/ui/src/lib/shops/`, the two sheets that host the
picker, their specs and the two translation files.

Do not touch: the backend, the rule of the automatic pick, `location-sheet.ts`,
`place-step.ts`, the usual filter (`0104`).

### Constraints

- Use `nx-portfolio-angular-developer` and `design-taste-frontend`.
- **The client never decides the pick.** It draws `pick` or `noPick` from the answer.
- **A coordinate is never stored**, in memory past the request, in storage, or in a log.
- **Pressing is required.** Never ask for the position on page load, even when permission
  was already granted.
- **Assumption to confirm:** a guest gets "Near me" through the basket route, and can pick a
  nearby shop that is not in the owner's list. The user said guests see the same shops as the
  owner, which this reads as the list, not as a ban on "Near me".
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- writing code before the mock is reviewed
- asking for the position without a press
- ranking recent shops by anything other than the last purchase
- showing recent shops to a guest

### Progress evidence

After each step, state what was built and paste the output that proves it:

- A reader spec: the options reach `getCurrentPosition` per call, and the other callers are
  unchanged.
- Component specs, one per answer: a pick with its message, each `noPick` reason, a refused
  permission, and recent shops present, empty, and absent for a guest.
- `npx nx build velista` and the affected lint and tests.
- A browser walk on a slot with a mocked position beside a seeded shop, and one between two
  shops.
