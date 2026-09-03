# 0004 One list and one form for everything

Roughly fifteen entities need a list, a detail view and an edit form, and each has to work on a
phone. Written one screen at a time that is a month of nearly identical components, and the fifth
one will disagree with the first about how a validation error looks.

So there is **one list component and one form component**, driven by a per entity **descriptor**,
and an entity screen is a configuration file plus whatever is genuinely peculiar to it.

Depends on `0003` (a session that survives filling in a form) and on
`apps/luna-shopper-backend/plans/0073`, which must be merged before the types in section 2 can be
generated.

## 1. The descriptor

A descriptor states what a resource is, and the list and form are read from it:

- **Identity**: the resource name, its route segment, its keyed labels singular and plural.
- **Fields**: each with a type (text, number, money, boolean, enum, uuid reference, localized text,
  date), a keyed label, whether it is required, whether it is editable, and validation.
- **List presentation**: which fields are columns, and **which of those survive to a phone**. This
  is the one piece of per entity judgment the generic component cannot make, and it is a field on
  the descriptor rather than a CSS breakpoint guess.
- **Filters**: which fields are filterable and how.
- **Actions**: create, edit, delete, plus any named actions the resource has.
- **Data access**: the four functions that list, read, create and update it.

The point of the descriptor is that responsiveness, validation display, loading and error states,
empty states, pagination and focus management are solved **once**, correctly, and every entity
inherits the fix.

## 2. Types come from the OpenAPI document, and this is a deliberate exception

Rule D4 says never trust or pass through a backend DTO: own the models and the enums, map from
`unknown`. This app does not follow it, and the deviation is recorded here rather than discovered
later as sloppiness.

D4 exists to protect velista from a backend whose release cadence it does not control, where a
silently changed DTO becomes a runtime crash in a user's hands. **None of those conditions hold
here.** This app ships from the same repository at the same commit as the gateway, the OpenAPI
document is committed, and `openapi-document.spec.ts` already turns a stale document into a red
test. The protection D4 buys is present by other means.

Against that, hand mapping roughly sixty routes for a tool with one operator is weeks of work whose
only output is a second description of a contract that is already described.

So: **wire types are generated from `apps/luna-shopper-backend/gateway/docs/openapi.json`** and used
as the view models. Generation is an Nx target, its output is committed, and it runs after any
gateway change.

Three things still get hand written mapping, because display genuinely needs a different shape:

- **`LocalizedText`** is `jsonb` with EN and ES minimum, not a string. Every name and label on
  supermarkets, items, locations and price scopes is one. The form renders **one input per locale**,
  and this is the single most annoying thing to retrofit, so it is in the generic form from the
  start rather than added when the first Spanish name is needed.
- **Money.** `price` is `numeric(12,2)` and `unitPrice` is `numeric(12,4)`, both arriving as strings.
  They are formatted for display and parsed for submission, and never round tripped through a float.
- **Dates.** Formatted with `Intl` in the selector, with the resulting string on the view model.
  Never `DatePipe`.

## 3. The list

**A table on a wide screen, cards on a narrow one, from one descriptor.** Not a table that scrolls
sideways: a fifteen column table on a phone is unusable however it scrolls, which is why the
descriptor names the fields that survive.

It provides, once:

- Loading, empty, and error states, including the difference between "no rows" and "no rows match
  your filter", which are different messages and the second one needs a way to clear the filter.
- Filtering from the descriptor's filterable fields.
- Sorting where the backend supports it.
- Pagination, section 4.
- Row actions, and a create control.

## 4. Pagination

Cursor pagination has a known defect in this backend: cursor timestamps lose microseconds, so a row
can repeat across a page boundary. It is not fixed in this plan and does not need to be, but the
list must not make it worse:

- **Deduplicate by id when appending a page.** A repeated row then costs nothing visible.
- Never assume a page is full because it has the requested count, or empty because it is short.

## 5. The form

Create and edit are the same component with the same descriptor. It provides:

- Field rendering per type, including the per locale inputs for localized text.
- Validation from the descriptor, shown per field, plus server side errors mapped back onto the
  fields that caused them rather than dumped in a banner.
- A dirty state, and a confirmation before discarding it.
- Disabled and pending states during submission, so a double submit is impossible.

**It never derives one field from another.** This is a general rule with a specific reason:
`unitPrice` is stored verbatim and must never be recomputed, because the obvious derivation
disagrees with the source on 110 of 4,232 products, in the field whose only purpose is comparison. A
form that helpfully fills it in would be quietly wrong once in forty times.

## 6. Reference fields

Many fields are a uuid pointing at another resource: `supermarketId`, `priceScopeId`,
`productGroupId`, `itemId`. A raw uuid input is unusable.

The descriptor's reference type names the target resource, and the control is a searching picker
that shows the target's display name and submits its id. It must also handle **null** where the
column is nullable, and mean it: `productGroupId` being null is the ordinary state of a freshly
harvested product, not a missing value to be nagged about.

## 7. Chrome

The app shell around the screens: navigation between resources, the identity and sign out from
`0003`, and the environment colour and name from `0001` section 6, which are visible on every
screen and not only at login. Navigation collapses on a phone.

## 8. Tests

- The list renders as a table above the breakpoint and as cards below it, from one descriptor.
- Only descriptor-named fields appear in the card layout.
- Empty, no-match, loading and error states each render, and no-match offers a way to clear.
- A repeated row across a page boundary appears once.
- Localized text renders one input per locale and submits the object.
- Server field errors land on their fields.
- The form derives nothing.
- Assert on component inputs rather than rendered text wherever a string is interpolated, since the
  testing translator does not interpolate.

## 9. Exit criteria

- One entity (supermarkets, the simplest) is fully working end to end through the generic
  machinery, as the proof that the descriptor is sufficient.
- Adding a second entity requires no change to the list or form components.
- Types are generated from the committed OpenAPI document by an Nx target.

## 10. Out of scope

- The entity descriptors themselves: `0005`, `0006`, `0007`.
- Anything bespoke: the price editor, the harvest run monitor and the import queues are named in
  their own plans precisely because they do not fit here.
