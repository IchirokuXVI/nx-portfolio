# 0057: the device says where you shop

> Server halves: `apps/luna-shopper-backend/plans/0059` (the centroid table and the lookup this
> screen calls) and `0061` (the source of a postal code, and the neighbours it brings).
>
> A shopping profile's postal codes decide whether the app can show a price at all, and today the
> only way to get one onto a profile is to know it and type it. Above that field sits a free text
> address that looks like it does something and does nothing whatsoever.
>
> This plan deletes the field that lies, and adds the one gesture that replaces it: let the device
> say where you are, and take the postal code from that.
>
> Prerequisite reading: `0046` (the profiles page and the postal code list this modifies) and
> backend `0059` section 6, which is the whole reason step 3 asks for confirmation.

## 1. What is being built

| Piece                                       | Where                           |
| ------------------------------------------- | ------------------------------- |
| The address field, removed                  | `profiles-page`                 |
| "Use my location", and what it does         | `postal-code-list`, a new sheet |
| A postal code that says where it came from  | `postal-code-list`              |
| "Also add nearby codes", on the add control | `postal-code-list`              |
| A geolocation reader behind a token         | `libs/velista/platform`         |

No new route. Everything is on `account/profiles`, and the one new screen is a sheet under it by
rule E1, addressed `account/profiles/sheet/location` per the sheet convention. Use `sheet()` from
`feature-shell/routes.ts`; never write the marker segment by hand.

## 2. The address field goes

`ShoppingProfile.addressText` is documented in core as display and context only, with **nothing
geocoded**, and nothing anywhere reads it. It is a text box that asks somebody for their street
address and then ignores it, next to a postal code field that is the one doing the work. That is
worse than an absent field, because it invites people to believe the app knows where they live.

Remove it from the page and from the view model. **The column stays**, and this plan does not
migrate it away: it costs nothing where it is, dropping user entered text is not reversible, and
core has no other opinion about it.

What takes its place on the screen is the postal code list itself, which already carries
`ProfilePostalCode.label` ("home", "the office"). That is the field `addressText` was pretending to
be, and it already exists.

## 3. Asking the device

### 3.1 Never on load

The browser's permission prompt is fired by `getCurrentPosition`, and firing it because a page
rendered is the pattern every browser now penalises and every user now refuses. It happens on a
press, on a control that says what it is going to do, and the sheet in this plan exists so that
"what it is going to do" has somewhere to be said before the browser's own dialog appears.

### 3.2 What the sheet says, in order

1. **Before**: what we will do with it. One short paragraph: your device tells us the coordinates,
   we turn them into a postal code, we keep the postal code and not the coordinates. That sentence
   is true because of section 3.3, and it must not be written until it is.
2. **The press**, which raises the browser prompt.
3. **After**: the resolved postal code, and a confirm. **Not adopted silently.** Backend `0059`
   section 6 is explicit that the lookup is nearest centroid rather than a boundary test, and that
   somebody at the edge of a large rural code can be resolved into the neighbouring one. Showing
   the answer and asking is the difference between an approximation and a wrong fact about a user.
4. **The nearby option**, the same checkbox as section 5, defaulted on here. A person who just
   granted a location permission has asked to be located, and neighbours are the point.

### 3.3 The coordinates do not become data

The point goes to the server in one request and comes back as a postal code. It is **not** stored,
not on the profile, not in a log line, not in an analytics event. Only the postal code is written,
with `source: DEVICE`.

This is what makes the sentence in step 1 honest, and it is also why backend `0059` ships a dataset
instead of calling Nominatim: with the lookup local, the coordinates never leave our own process
either.

### 3.4 The three permission states, and denial in particular

`granted` and `prompt` both lead to step 2. **`denied` is the state worth designing**, because it
is sticky, the browser will not re prompt, and there is nothing this app can do to change it.

The sheet says so plainly and hands over to manual entry, which is unchanged and remains a
complete path: type a code, tick the nearby box, get the same result with one more step. A user who
refuses the permission is not a second class user of this feature; they are a user who typed four
characters.

### 3.5 The reader is behind a token

`navigator.geolocation` is reached through an interface bound to an injection token, the way
`NOTIFICATION_TONE` and `SILENCE_DETECTOR` already are, and for the reason that doc gives: a spec
that wants to know what the screen does when permission is denied should be able to answer without
a browser and without a real position. jsdom has no geolocation, so every one of these specs is
otherwise unwritable.

## 4. A postal code that says where it came from

`PostalCodeList` renders `source` from backend `0061`.

| Source   | Reads as                                         | May be removed | May be added       |
| -------- | ------------------------------------------------ | -------------- | ------------------ |
| `TYPED`  | the user's                                       | yes            | yes                |
| `DEVICE` | the user's                                       | yes            | yes, via the sheet |
| `NEARBY` | ours, added because it is close to one of theirs | yes            | **no**             |

A derived code is visibly not something the user did, and removing one is an ordinary swipe or
button. The server turns that into a suppression rather than a delete, which is `0061` section 3.1
and is invisible here: the row goes away and stays away.

**The label falls back to the postal code.** `label` is nullable, and a row with none shows the
code itself rather than a blank or a placeholder. The code is what the user recognises anyway.

**Nothing offers to add a derived code**, because it is not a sentence the user says. Typing one
that happens to be derived is an ordinary add and the server promotes it, so there is no error
state here to design.

## 5. Also add nearby

A checkbox on the add control, off by default for a typed code and on by default in the location
sheet. It maps to `expandNearby` on the row, and the asymmetry is deliberate: somebody typing one
specific code has usually named the place they mean, and somebody who just handed over their
location has asked to be found.

What comes back may be several codes at once. They appear as `NEARBY` rows, and the screen says
how many were added rather than leaving the list to grow silently under the user's finger.

**No progress, no waiting, no notification.** The expansion is a local query on the server and
returns with the write. Discovery of stores in those codes is a background matter the user is
never told about, per backend `0062`, and the store screen's empty state is where the absence
eventually shows up.

## 6. What this screen still does not promise

Adding a postal code does not mean supermarkets appear in it. Catalog may hold none, a discovery
run may not have happened, and an import certainly has not. `apps/velista/plans/0058` owns that
empty state, and this screen must not imply otherwise: no "you can now see supermarkets", no
count, no tick.

The coverage flags this list already renders (`uncovered`, `failed`) are a different statement,
about price scopes rather than stores, and they stay exactly as `0046` built them.

## 7. Accessibility

The permission control is a button with a label that names the outcome, not an icon alone. The
resolved postal code in step 3 is announced, because a screen reader user pressing confirm needs to
know what they are confirming. Removal of a derived row carries the same confirmation weight as
removal of a typed one: identical affordance, no quiet destructive difference between two rows
that look alike.

## 8. Acceptance criteria

- The address field is gone from the page and from the view model, and the core column is
  untouched.
- The permission prompt never fires on load, proven by a spec that renders the page and asserts the
  reader was not called.
- A denied permission shows the manual path and does not re prompt.
- A resolved code is shown and confirmed before it is written, and cancelling writes nothing.
- The coordinates appear in exactly one request and in no stored field, asserted by a spec over the
  written payload.
- `NEARBY` rows are removable and not addable; a label-less row shows its postal code.
- The nearby checkbox defaults off when typing and on in the location sheet.
- Every geolocation spec runs in jsdom with no browser API, through the token.
- Specs assert on component inputs rather than rendered text for any interpolated string, per the
  testing translator's behaviour.
- `npx nx run-many -t lint test -p velista,velista-feature-account,velista-data-access` passes.
