# 0045 Your shopping list: the card, the sheet, and the history

> **This is a page plan** and follows the template in `0001` section 9.
>
> Server half: `apps/luna-shopper-backend/plans/0050` (the generated list itself) and
> `0051` (who may generate, which is `WRITE` on the sources). The screen a row opens
> into is `0044`'s basket. This plan is the owner's side: making one, seeing the
> current one, and finding the old ones.
>
> It revises the home page (`0003`, `0007`, `0019`): the resume card leaves, and the
> dashboard's primary action starts working.

## 1. Purpose

`0019` section 4 turned the dashboard's dead **New list** button into **Get shopping
list** and shipped it disabled, because the feature behind it was parked. This plan is
that feature's screens. A person on the dashboard presses the button, says what the run
should draw from, and gets the list they will carry around the shop. The next time they
open the app, that list is the first thing on the page, and the ones from before are one
tap away.

The **resume card is removed to make the room**. "Pick up where you left off" answered
the question "what was I doing" with device local guesswork (the last list this device
opened, `0003` section 5.2). The shopping list card answers it with server truth: the
basket you are in the middle of. Where the resume card had to be talked out of showing a
stale list, the shopping list card cannot show one, because an `ACTIVE` generated list
either exists for this account or does not.

## 2. Mock

Drawn in `mocks/shopping-lists/`, published at
<https://claude.ai/code/artifact/4e6d5569-dd04-4a77-a46a-8aff2e051cd9>, awaiting
approval. Not ready for development until it is approved (`0001` section 9).

| Artboard | Frames |
| --- | --- |
| `Home.dc.html` | The dashboard with the shopping list card in the resume card's old place, and the enabled Get shopping list button |
| `HomeNoList.dc.html` | The same dashboard with no active list: no card, no gap, the section simply absent |
| `GetSheet.dc.html` | The generation sheet: name, profile, sources with a zone expanded, and the submit |
| `History.dc.html` | The history page populated, plus its empty state |

Phone frames 390 by 844, Night only: every colour role here is already proven on Day by
`0003`, so the mock README's rule says no Day artboard is drawn.

## 3. States

### 3.1 The home page

All of `0003`'s states stand. What changes is one section and one button:

| State | Shopping list section |
| --- | --- |
| No generated list ever, none active | Absent entirely. No header, no empty card, no gap |
| One or more `ACTIVE` lists | The card, showing the most recently generated `ACTIVE` list |
| Only finished lists exist | Absent, but the History link still reachable through the sheet's header and the account page is not needed: see 3.3 |
| Loading | The card renders from the first `generatedList.listMine` page alongside the zone skeletons, never after them |

**Get shopping list** is enabled for every authenticated user. `0051` section 2 gates a
run on `WRITE` over its sources; a user who holds `WRITE` nowhere finds that out inside
the sheet, where the source list is empty and says why, not from a dead button on the
dashboard (`0019` section 4's rule: the exception was temporary and this plan ends it).

### 3.2 The card

| State | Meaning |
| --- | --- |
| Active | Name, when it was generated, outstanding against settled counts, tap opens `0044`'s basket |
| Several active | The most recent one, with a quiet "and N more" line that goes to the history |
| Live update | `generatedList.updated` and `generatedList.lineSettled` on the owner's room move the counts while the page is open |

### 3.3 The history page

| State | Meaning |
| --- | --- |
| Populated | Every generated list of the caller, newest first, cursor paginated, `ACTIVE` ones first marked as such |
| Empty | "No shopping lists yet", with the one action being Get shopping list |
| Loading | Skeleton rows |
| Failed | The shared error state with retry |

**Nothing on this page deletes.** `0050` section 7 keeps deletion in the API; no screen
offers it for now, and archiving is out of scope with it. A history that cannot lose
entries is the point of keeping one.

### 3.4 The sheet

| State | Meaning |
| --- | --- |
| Ready | Name empty, its placeholder the date an unnamed list will show; profile row showing the default profile; sources defaulting to the profile's stored generation scope |
| Submitting | The submit disabled with the working treatment, one request, idempotent per `0050` section 4 |
| No sources | The caller holds `WRITE` on nothing: the source list is replaced by a sentence saying a group where they can write is needed first |
| Failed | The error under the submit, sheet stays open, nothing lost |

## 4. Anatomy

| Region | Component | Library |
| --- | --- | --- |
| Shopping list card | **new** `ShoppingListCardComponent`, replacing `ResumeListCardComponent` | `velista/ui` |
| Bottom action bar | unchanged, button wired to the sheet | `velista/ui` |
| Generation sheet | **new**, over the dashboard, route `home/get` | `feature-home` |
| History page | **new**, route `shopping-lists` | **new** `feature-shopping-lists` |
| History row | **new** `ShoppingListRowComponent` | `feature-shopping-lists` |
| Empty and error states | the shared components | `shared` |

The history page starts `feature-shopping-lists` because the basket screen (`0044`) will
live there too, and neither belongs in `feature-home` or `feature-lists`, which are both
zone shaped.

What is removed, and it is removal rather than disuse, per the rule that a control you
may not use is not drawn: `ResumeListCardComponent`, the `home.section.resume` key pair,
and the `StorageKeys.lastList` read in `HomePage`. The write of `lastList` stays, because
the list page still records it today and removing the write is a separate decision about
a shipped screen.

### 4.1 The sheet's three inputs

- **Name.** Optional and empty. An unnamed list is displayed as its generation date,
  localized, and a second unnamed list on the same day gets a number appended ("21
  August 2"), per `0050` section 1. Typing here stores a real name; leaving it empty
  stores none.
- **Profile.** One row showing the default shopping profile's name, tappable to switch
  when the user has more than one (`0049`). Absent when they have exactly one, per the
  absence rule: a chooser with one choice is furniture.
- **Sources.** The zones the caller belongs to, each expandable to its lists, each row a
  checkbox, prechecked from the profile's stored generation scope (`0049` section 1).
  Only lists where the caller holds `WRITE` appear at all (`0051` section 2). A zone
  checked whole means every list in it the caller can write, including ones created
  later, which is what `ALL` stores.

Submitting calls the create with what is checked, navigates to the new basket in
`0044`'s screen, and the card on the home page is showing it when the person comes back.

## 5. Data

- `GET /v1/generated-lists` (`generatedList.listMine`, `0050` section 7): the card and
  the history, cursor paginated.
- `POST /v1/generated-lists` (`generatedList.create`, `0050` section 4): the sheet's
  submit, with an idempotency key.
- `GET /v1/account/shopping-profiles` (`0049`): the profile row and the prechecked
  sources.
- Realtime, owner's own room: `generatedList.created`, `generatedList.updated`,
  `generatedList.lineSettled` (`0050` section 9, `0051` section 10) keep the card and
  the history's `ACTIVE` rows current.
- Store: a new `GeneratedListStore` in `data-access`, the usual signals over the list
  page cache, following `ZoneStore`'s shape.

## 6. Localization

| Key | en | es |
| --- | --- | --- |
| `home.section.shoppingList` | Your shopping list | Tu lista de la compra |
| `home.shoppingList.more` | and {{count}} more | y {{count}} más |
| `home.action.history` | History | Historial |
| `getList.title` | Get shopping list | Obtener lista de la compra |
| `getList.name.label` | Name | Nombre |
| `getList.profile.label` | Shopping profile | Perfil de compra |
| `getList.sources.label` | Draw from | Sacar de |
| `getList.sources.none` | You need a group where you can edit lists first | Primero necesitas un grupo donde puedas editar listas |
| `getList.submit` | Generate | Generar |
| `history.title` | Your shopping lists | Tus listas de la compra |
| `history.empty.title` | No shopping lists yet | Aún no hay listas de la compra |
| `history.status.active` | Shopping now | Comprando ahora |

An unnamed list’s display name is its formatted generation date plus the disambiguating
number, built client side (`0050` section 1); it needs no key of its own.

`home.section.resume` and its Spanish twin are deleted, not orphaned.

## 7. Accessibility and input

- The card is one button whose accessible name is the list's name plus its outstanding
  count; the "and N more" line is a separate link so the two destinations are two stops.
- The sheet's source tree is a real checkbox tree: zone rows are `aria-expanded`
  disclosure buttons, list rows are checkboxes, and a zone's checkbox reflects
  indeterminate when its lists disagree.
- Everything on the sheet is reachable and submittable with the keyboard, and the submit
  is 44px and not adjacent to the sheet's close.
- History rows are 44px minimum and their status is text, never colour alone.
- The history page announces new rows once when a page of results lands, not per row.

## 8. Acceptance criteria

- The resume card, its section header and its translation keys are gone from the
  dashboard, and no gap remains where they were.
- With no active generated list the section is absent; generating one puts the card
  there without a reload; settling lines in the shop moves its counts live.
- Tapping the card opens that basket; tapping "and N more" or History opens
  `shopping-lists`.
- Get shopping list is enabled, opens the sheet, and a user with no writable list reads
  why the source list is empty instead of finding a dead button.
- The sheet leaves the name empty with its date placeholder and prefills profile and
  sources; unchecking works per list and per zone;
  submitting once creates one run (double tap included) and lands in the basket.
- The history lists every run newest first, pages on scroll, marks active ones, and
  offers no way to delete anything.
- Every new string exists in both locales and no key from section 6 is missing.

## 9. Out of scope

- **The basket screen itself**, its settling and its sharing. `0044`.
- **Prices on the card or the rows.** Backlog 0004.
- **Archiving and deleting runs.** The API keeps them (`0050` section 7); no screen
  offers them yet, deliberately.
- **Editing a profile from the sheet.** The profile row names one; changing what it
  holds is `0046`'s page.
