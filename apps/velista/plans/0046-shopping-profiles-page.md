# 0046 Shopping profiles: where you shop, per profile

> **This is a page plan** and follows the template in `0001` section 9.
>
> Server half: `apps/luna-shopper-backend/plans/0049`, which owns every rule this page
> renders: the default profile that already exists, the one-default invariant, the
> deletion rules, and what a postal code resolves to.
>
> It touches the account page (`0015`) with one new row, and it is the screen behind
> `0049`'s `CATALOG_SCOPE_REQUIRED`: when the catalog refuses to answer because a
> profile is empty, this is where the user is sent.

## 1. Purpose

A profile is how the app knows where somebody shops: their postal codes, the chains they
will and will not set foot in, and the saving that makes a second stop worth it. One
person shops from home and from the office and from their parents' town in August, so
profiles are several, named, and switchable, with one of them the default that every
catalog read and generated run uses when nothing says otherwise.

The page is reached from the account screen, which gains a **Shopping profiles** row
under the existing account rows. It is one page for all profiles: a selector at the top
says which one is being edited, a plus beside it mints a new one, a trash deletes the
one on screen, and everything under the selector belongs to the selected profile.

## 2. Mock

Drawn in `mocks/profiles/`, published at
<https://claude.ai/code/artifact/8c20e218-365e-45ad-a401-e96b4ed1252d>, awaiting
approval. Not ready for development until it is approved (`0001` section 9).

| Artboard | Frames |
| --- | --- |
| `Profile.dc.html` | The page on the default profile: selector, name, address, postal codes, chains, threshold. Includes a profile with a long name, truncated to one line |
| `SwitchAndAdd.dc.html` | The selector open with several profiles, and the moment after tapping plus: a fresh profile, selected, cursor in its name |
| `Delete.dc.html` | The confirm sheet, both for an ordinary profile and for the default (whose copy says who becomes default) |
| `Account.dc.html` | The account page with the new Shopping profiles row, so `0015`'s screen is re-approved with the row on it |

Phone frames 390 by 844, Night only: no colour role here is new since `0003`, so no Day
artboard is drawn, per the mock README's rule.

## 3. States

### 3.1 The page

| State | Meaning |
| --- | --- |
| Loaded | The selected profile's settings, editable in place |
| First visit | The lazily created default profile (`0049` section 1.3), name shown as the localized default, everything else empty |
| Sent here by the catalog | Same page, opened with a banner explaining that a postal code or a chain is needed before prices can be shown (`CATALOG_SCOPE_REQUIRED`) |
| Saving | Per control, with the optimistic overlay `0004` section 7.2 already defines; a failed save restores the control and shows the failed treatment |
| Loading / failed | Skeleton of the form; the shared error state with retry |

### 3.2 The selector

| State | Meaning |
| --- | --- |
| One profile | The selector row shows its name and does not open; the trash is **absent**, because the last profile cannot be deleted (`0049` section 1.3) and a control you may not use is not drawn |
| Several | Tapping opens the list; the default profile is marked; choosing one swaps everything below |
| Adding | Plus creates a profile immediately with the localized default name, selects it, and focuses the name field. No modal asking for a name first: the name is a field like any other |
| Deleting | Trash opens the confirm sheet. Deleting the default names who becomes default in the confirm copy. After deletion the page shows the new default |

**R1. A profile name is one line, always.** The selector row, the open list, the sheet
in `0045`, and anywhere else a profile name appears render it on a single line with
`text-overflow: ellipsis`, and the layout never grows to fit it. The server caps the
name at 64 characters (`0049` section 5) so truncation is cosmetic; the full name is
still the control's accessible name, so a screen reader is not handed the ellipsis.

## 4. Anatomy

Top to bottom:

| Region | Component | Library |
| --- | --- | --- |
| App bar with back | existing | `velista/ui` |
| Profile selector row: name, default badge, plus, trash | **new** `ProfileSelectorComponent` | `feature-account` |
| Name field | the in place text field the account rename already uses | `velista/ui` |
| Address field | plain text field, one line, optional | `velista/ui` |
| Postal codes: chips with a label each, and an add field | **new** `PostalCodeListComponent` | `feature-account` |
| Supermarkets: one row per chain, include or exclude | **new** `ChainPreferenceListComponent` | `feature-account` |
| Saving threshold | numeric field with the currency suffix | `velista/ui` |
| Delete confirm | the existing confirm sheet | `shared/ui` |

The chain list is the whole catalog's supermarket listing (unscoped by design, `0049`
section 3), each row the chain's name and a control with two states: **included**, the
default, and **excluded**, drawn struck through rather than hidden, because "everything
except DIA" must leave DIA visible to un-exclude. There is no per location choice
anywhere on this page: the preference names the franchise, and which locations it
reaches is the resolver's business.

The account page (`0015`) gains one row, **Shopping profiles**, between the existing
rows and the sign out, using the same row component the page already uses, with a
`routerLink` to `account/profiles`.

## 5. Data

- `GET /v1/account/shopping-profiles`, `POST`, `PATCH /:id`, `POST /:id/default`,
  `DELETE /:id` (`0049` section 6).
- `GET /v1/catalog/supermarkets` for the chain list, unscoped, cached for the page's
  life.
- Realtime: `profiles.changed` on the user's own room keeps a second device's page
  current; this page emits nothing else.
- Store: `ShoppingProfileStore` in `data-access`, holding the list and the selected id,
  following `ProfileStore`'s shape.

## 6. Localization

| Key | en | es |
| --- | --- | --- |
| `account.row.profiles` | Shopping profiles | Perfiles de compra |
| `profiles.title` | Shopping profiles | Perfiles de compra |
| `profiles.defaultName` | My profile | Mi perfil |
| `profiles.default.badge` | Default | Predeterminado |
| `profiles.name.label` | Name | Nombre |
| `profiles.address.label` | Address | Dirección |
| `profiles.postal.label` | Postal codes | Códigos postales |
| `profiles.postal.add` | Add postal code | Añadir código postal |
| `profiles.postal.uncovered` | No supermarket we know reaches this code yet | Ningún supermercado que conozcamos llega aún a este código |
| `profiles.chains.label` | Supermarkets | Supermercados |
| `profiles.chains.excluded` | Excluded | Excluido |
| `profiles.saving.label` | A second stop must save at least | Una segunda parada debe ahorrar al menos |
| `profiles.add` | New profile | Nuevo perfil |
| `profiles.delete.title` | Delete this profile? | ¿Eliminar este perfil? |
| `profiles.delete.default` | {{name}} will become your default | {{name}} pasará a ser tu predeterminado |
| `profiles.scope.banner` | Add a postal code or choose a supermarket to see prices | Añade un código postal o elige un supermercado para ver precios |

## 7. Accessibility and input

- The selector is a button with `aria-haspopup="listbox"` opening a listbox; the
  accessible name is the full profile name even when the visible one is truncated (R1).
- Plus and trash are 44px targets, separately labelled ("New profile", "Delete
  {{name}}"), and not adjacent to each other: plus sits by the selector, trash at the
  row's far end.
- Chain rows toggle with the row as the target, 44px, and the excluded state is the
  word, the strikethrough and the dimming together, never colour alone.
- A postal code chip's remove is its own labelled target; adding submits on enter.
- The uncovered postal code flag (`0049` section 5) is text under the chip, announced
  when it lands.
- Deleting is confirmed in a sheet; nothing on this page destroys on one tap.

## 8. Acceptance criteria

- The account page shows the Shopping profiles row and it navigates to the page.
- A first visit shows one profile already existing, named by the localized default,
  with the trash absent.
- Plus creates and selects a new profile and focuses its name; the selector switches
  between profiles and everything below follows.
- A 64 character name never wraps or pushes the plus and trash off the row, anywhere it
  is rendered.
- Editing name, address, postal codes, chains and the threshold saves per control,
  survives a failed save with the failed treatment, and reaches a second device.
- Excluding a chain leaves it visible and struck through; un-excluding restores it.
- An uncovered postal code is kept, flagged, and explained in words.
- Deleting an ordinary profile asks once; deleting the default names its successor; the
  last profile offers no trash at all.
- Arriving via the catalog's scope error shows the banner, and filling either field
  clears the path back.

## 9. Out of scope

- **Editing generation sources here.** The profile stores them (`0049` section 1) and
  the generation sheet prechecks from them (`0045` section 4.1); a dedicated editor on
  this page can come later if prechecking proves not to be enough.
- **Reordering profiles.** `position` exists; a drag handle is not worth its weight at
  two or three profiles.
- **Prices, coverage maps, anything drawn from the catalog beyond the chain list.**
