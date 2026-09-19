# 0092: the tour

> Backend half: `apps/luna-shopper-backend/plans/0130`, which must be merged first.
> Depends on `0090` (the bar, which is the first thing the tour points at) and `0091`
> (the setup, which offers it).
> Mock: `mocks/tour/`, published at https://claude.ai/artifact/YbfH7bVn7DGC1MFqWdqNvS.
>
> velista has a group, a list inside it, a basket built from every list, an assistant
> and a microphone, and a new person finds none of them. This plan is five cards drawn
> over the real app, each one lighting the control it is about, each one with the same
> way out. It runs after the setup and plays again from the account screen.
>
> Prerequisite reading: `0090` in full, `0091` sections 6 and 7, `0015` (the account
> page and its rows), `0002` (sections 4 and 7, colour and elevation), backend `0130`
> section 3, and `libs/velista/ui/src/lib/layout/app-layout.ts`.

## Brief for the agent

### Objective

Build a tour that dims the app, lights one real control at a time, explains it in two
sentences, and ends for good whether it was finished or skipped.

### Context

- `AppLayout` is the parent of every page and already draws things over the outlet.
  Rule D1 forbids it from injecting `Router`, `ActivatedRoute` or anything from
  `data-access`, and `layering.spec.ts` enforces that.
- `0090` put `AppNav` in the same place and answered its visibility from a `platform`
  service that does read the router. That is the pattern this plan follows.
- `app-providers.ts` is the one file that may see both `platform` and `data-access`. It
  already starts `AppHistory.watch()` in an environment initializer.
- Backend `0130` serves `appState.tourSeenAt` and `PATCH /v1/account/app-state` with
  `tourSeen: true`.
- The account page's rows are `lib-account-row` in `libs/velista/ui/src/lib/account/`.

### Target state

Somebody who presses **Show me around** is taken through five stops over the real
screens, presses **Next** four times, and lands back on home. Somebody who presses
**Skip the tour** on any card lands on home immediately. Neither is asked again, and
both can play it from the account screen.

### Scope

Work only in:

- `libs/velista/ui/src/lib/tour/` (the card and the spotlight, presentational)
- `libs/velista/ui/src/lib/layout/app-layout.ts` (rendering them)
- `libs/velista/platform/src/lib/tour/` (the store, the stop table, the anchors)
- `libs/velista/feature-account/src/lib/account-page/` (one row)
- `apps/velista/src/app/app-providers.ts` (wiring the finish to the write)
- The screens that gain an anchor directive, one line each

Do not touch: the shape of any screen the tour points at. An anchor is an attribute,
never a wrapper.

### Constraints

- Follow the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- **Rule O6 governs every word.** Two sentences a card. Say what the thing is for, not
  what it is called. Name no sub feature.
- No `@angular/core/rxjs-interop`. No `dvh`.
- The tour must not break the back button: see section 6.

### Action boundaries

Stop and ask before: adding a dependency (no tour library), changing a route path,
changing any screen's layout to make an anchor fit, or making the tour modal in a way
that traps a person with no way out.

### Progress evidence

After each section output: the files changed and the spec you ran.

## 1. What is being built

| Thing | Where |
| --- | --- |
| `TourCard`, presentational | `ui/src/lib/tour/tour-card.ts` |
| `TourSpotlight`, the dimming and the ring | `ui/src/lib/tour/tour-spotlight.ts` |
| `libTourAnchor`, a directive | `platform/src/lib/tour/tour-anchor.ts` |
| `TourStore`, the state and the driving | `platform/src/lib/tour/tour-store.ts` |
| `TOUR_STOPS`, the table | `platform/src/lib/tour/tour-stops.ts` |
| One account row | `feature-account/.../account-page` |

## 2. How a control is found

An element declares itself: `<nav libTourAnchor="nav">`. The directive registers its
id and its `ElementRef` with `TourStore` on init and removes it on destroy.

This is the whole mechanism, and it is chosen over querying the DOM because the screens
live in six lazy loaded libraries. A query by class or by test id would break silently
the first time somebody renames a wrapper, and it would find nothing at all on a screen
that has not been loaded yet.

Anchors this plan adds, one attribute each:

| Id | Element |
| --- | --- |
| `nav` | the bar, in `AppLayout` |
| `groups` | the groups section on home |
| `group-lists` | the list rows inside a group card on home |
| `basket-tab` | the third tab |
| `assistant` | the assistant button in the app bar |
| `list-composer` | the composer on a zone list |

## 3. The stops

`TOUR_STOPS` is a plain array. Each entry: an id, the anchor id, the route to be on,
where the card sits relative to the anchor, and the two copy keys.

1. **`nav`** on home. "These three take you everywhere."
2. **`groups`** on home. "A group is who you shop with."
3. **`group-lists`** on home. "Inside a group are lists."
4. **`basket-tab`** on the shopping list tab. "One list for the whole trip."
5. **`assistant`** on home. "Ask instead of looking."
6. **`list-composer`** on a zone list. "Say it instead of typing it."

**Stop 6 is not shown to a new account**, and neither is stop 3 if there is no group.
A stop whose anchor cannot exist is dropped before the first card is drawn, which is
what lets a card say "1 of 5" and mean it. `TourStore.start()` therefore computes the
list once, from what the account holds, and never changes it mid run.

The rule in one line: **the tour points at what is there, and never fakes a screen.**
The alternative, five pictures of the app, teaches nothing, because somebody shown a
drawing of a button still has to find the button, and the drawing does not change when
the screen does.

## 4. A card

Drawn by `AppLayout`, over everything except a sheet: the scrim dims the whole screen,
the anchor is drawn bright with a 2px `--app-action-quiet-fg` ring, and the card sits
beside it, above when the anchor is at the bottom and below when it is at the top.

The card carries: "3 OF 5", a title, two sentences, then **Skip the tour** and
**Next**. Both are 48px tall. Skip is in the same place on every card and is never a
cross in a corner. The last card says **Finish** instead of Next.

Nothing else on the screen responds while a card is up. A tour that half works is worse
than no tour, and a person who taps the dimmed app and gets a half navigation is lost
in a way the tour cannot recover from.

## 5. Driving the app

`Next` moves to the next stop's route first, waits for its anchor to register, then
draws the card. Nobody has to find a screen in order to be shown it.

If an anchor does not register within a short window, that stop is dropped and the tour
moves on rather than showing a card pointing at nothing. Log it. A dropped stop does
not change the total on the cards, because the total was fixed at the start, so a card
may say "4 of 5" and be followed by the end. That is the honest failure: a wrong count
is cheaper than a card floating over a screen with nothing lit.

## 6. Getting out

Three ways, and all three end the run and mark it seen:

- **Finish** on the last card.
- **Skip the tour** on any card.
- **The back button or the back gesture.** A tour is not a history entry, so back must
  end it rather than leaving the cards over a screen that has changed underneath. The
  tour navigates while it runs, so it must not leave those entries behind either: every
  navigation it makes replaces rather than pushes, and the run ends on home.

Ending writes `PATCH /v1/account/app-state` with `tourSeen: true`, fire and forget, and
the store's own `seen` signal flips at once. The write goes out from an effect in
`app-providers.ts`, because `TourStore` lives in `platform` and may not reach the API
itself.

## 7. Playing it again

One new row at the end of the account screen, `Show me around again`, in the accent
colour and never disabled. It goes home and starts at the first stop.

A replay is the same tour with however many stops the app can show that day, so
somebody who has since made a group and a list sees six cards rather than four. It does
not clear `tourSeenAt`: that is a fact about the past, not a switch.

**The setup is not replayed and gains no row.** Its three answers already have their
own screens, which the tour itself points at.

## 8. When it starts by itself

Once, from `setup/done`, when the person presses Show me around.

It never starts by itself again, including after an update that adds a screen. An app
that decides on its own to interrupt somebody who has used it for a year has to be
right every time, and the account row costs one tap for the person who wants it.

## 9. Copy

| Key | English | Spanish |
| --- | --- | --- |
| `tour.progress` | {{n}} of {{total}} | {{n}} de {{total}} |
| `tour.skip` | Skip the tour | Saltar la visita |
| `tour.next` | Next | Siguiente |
| `tour.finish` | Finish | Terminar |
| `tour.nav.title` | These three take you everywhere | Con estos tres llegas a todo |
| `tour.nav.body` | Home is where you are now. Catalog is every product in the shops near you. Shopping list is what you take to the supermarket. | Inicio es donde estás ahora. Catálogo son todos los productos de las tiendas que tienes cerca. Lista de la compra es lo que te llevas al supermercado. |
| `tour.groups.title` | A group is who you shop with | Un grupo es con quién compras |
| `tour.groups.body` | Your household, your family, the flat you share. Everybody in it sees the same lists at the same time. | Tu casa, tu familia, el piso que compartes. Todos ven las mismas listas a la vez. |
| `tour.lists.title` | Inside a group are lists | Dentro de un grupo hay listas |
| `tour.lists.body` | A list is what a group is running out of. Anybody in the group can add to it, from anywhere. | Una lista es lo que le falta a un grupo. Cualquiera del grupo puede añadir, desde donde esté. |
| `tour.basket.title` | One list for the whole trip | Una lista para toda la compra |
| `tour.basket.body` | Velista puts everything your groups need into one list, and tells you which shop sells each thing cheapest. You tick things off as you put them in the trolley. | Velista junta en una lista todo lo que necesitan tus grupos y te dice dónde sale más barato cada cosa. Vas marcando lo que metes en el carro. |
| `tour.assistant.title` | Ask instead of looking | Pregunta en vez de buscar |
| `tour.assistant.body` | Tell Velista what you need in your own words, the way you would tell a person. It writes it on the right list for you. | Dile a Velista lo que necesitas con tus palabras, como se lo dirías a una persona. Lo apunta en la lista que toca. |
| `tour.voice.title` | Say it instead of typing it | Dilo en vez de escribirlo |
| `tour.voice.body` | Hold the microphone and say what is missing. It is the quickest way to add something with your hands full. | Mantén pulsado el micrófono y di lo que falta. Es lo más rápido cuando tienes las manos ocupadas. |
| `account.tour.again` | Show me around again | Enséñamela otra vez |

## 10. Accessibility

- The card is a dialog: `role="dialog"`, labelled by its title, focus moved to it when
  it opens, and focus trapped inside it while it is up.
- Escape skips the tour, which is the same as the back button.
- The lit control is `aria-hidden` for the length of the card, because it is decoration
  in that moment. The card's own words name what is lit.
- Reduced motion turns the movement between stops into a cut. The dimming does not
  animate at all.
- Contrast: the card is a raised surface on a dimmed screen, and it must pass on both
  themes.

## 11. Not in this plan

- A tour of the catalog (`0093`). When that screen exists, it is one more entry in
  `TOUR_STOPS` and one anchor.
- Any second run offered by the app itself.
- Per device state. `tourSeenAt` is the account's, wherever it signs in.

## 12. Tests

- `tour-store.spec.ts`: the stop list is computed once at start; a missing anchor drops
  its stop; the total on the cards does not change mid run; every exit marks it seen
  once.
- `tour-anchor.spec.ts`: registers on init, removes on destroy, and a second element
  with the same id is refused loudly.
- `tour-card.spec.ts`: renders the progress, the two sentences and both buttons; the
  last card says Finish.
- `app-layout.spec.ts`: no card while a sheet is open; the card is above the bar.
- `account-page.spec.ts`: the row is present and starts the tour.
- A spec asserting that no card's body names a screen by its route or a feature by its
  product name, which is rule O6 as a test.

## 13. Acceptance criteria

- [ ] Show me around runs five cards on a new account, in the order of section 3.
- [ ] Each card lights a real control on the real screen it belongs to.
- [ ] Skip, Finish, back and Escape all end the run and mark it seen.
- [ ] A replay from the account row shows six cards once a list exists.
- [ ] The app never starts the tour by itself a second time.
- [ ] The back button after the tour does not walk back through its stops.
- [ ] `npx nx lint velista && npx nx test velista` pass.

## 14. Verification

```sh
npx nx test velista-ui
npx nx test velista-platform
npx nx test velista-feature-account
npx nx lint velista
npx nx build velista
```

Then, on a slot: finish the setup, take the tour, press back halfway through a second
run, and play it again from the account screen with a group and a list in place.
