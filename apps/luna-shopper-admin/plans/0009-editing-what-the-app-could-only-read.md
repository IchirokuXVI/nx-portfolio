> **PR:** [#208](https://github.com/IchirokuXVI/nx-portfolio/pull/208)

# 0009 Editing what the app could only read

`0007` built the people screens as listings, detail reads and seven named actions, and said so in
its own first sentence: it "deliberately does less than the rest of the app". `0005` and `0006`
built the catalog and the harvester as full editors.

The result is a back office that is two different tools. An operator who can rename a supermarket
cannot rename a household, and nothing on the screen explains the difference.

This plan closes that. Users, zones, memberships, shopping lists and list lines become editable,
through the routes `apps/luna-shopper-backend/plans/0077` adds. Baskets and admins do not, and the
screens say why in place rather than looking unfinished.

Depends on `0077`, which must be merged before any of this can be built. It is the whole of the
backend work, and none of it is here.

## 1. The machinery already carries this

The useful finding, stated first because it decides the size of the plan: **no new descriptor
machinery is needed.** Everything below is descriptor configuration plus translation keys.

Four things `0005` and `0007` already added are exactly what this plan needs.

- **`ResourceActions.create`, `edit` and `delete`** are booleans on the descriptor, and the generic
  form is already the editor. Turning them on is one line each.
- **`ResourceSource.collectionPath` and `pathParams`** address a collection that hangs off another
  resource. `0005` added them for a chain's shops at `/supermarkets/{id}/locations`. Memberships at
  `/zones/{id}/members` and lines at `/lists/{id}/lines` are the same shape.
- **`ResourceDescriptor.requires`** names the filters a list cannot be read without, and renders a
  third state beside empty and no match. A membership list with no zone chosen says which filter is
  missing, rather than asking the gateway for a URL with a hole in it.
- **`FieldDescriptor.help`** renders on a **locked** field as well as an editable one.
  `resource-form.ts` draws it outside the `@if (editable(field))` branch. That is what section 5
  needs, and it costs nothing.

`FieldDescriptor.editable` already accepts `'create'` for a field that is settable once. Nothing in
this plan uses it, and nothing needs adding beside it.

## 2. Users

`USERS` gains `edit: true` and nothing else. No create, because an operator does not make accounts,
and no delete, because deleting one runs `account-deletion.service` and stays the named action
`0007` gave it, whose confirmation says whose account it is and what goes with it.

Two of the six fields become editable.

| Field             | State                 | What the field says                                   |
| ----------------- | --------------------- | ----------------------------------------------------- |
| `username`        | editable              | it is the global handle and changes in every zone too |
| `displayName`     | editable              | it is what a provider supplied, section 6             |
| `userId`          | locked                | it is the id                                          |
| `email`           | locked, with a reason | `0077` section 6.1                                    |
| `emailVerifiedAt` | locked, with a reason | `0077` section 6.1                                    |
| `kind`            | locked, with a reason | `0077` section 6.2                                    |

`displayName` is still not a column on the list, for `0007`'s reason: it is a real full name for a
Google sign in, and a listing is the thing somebody screenshots. It is a field on the form, which
is the detail screen, and that is where an operator has a reason to look.

The `username` field carries a help key saying the rename reaches every zone the person is in. That
is what the backend does, and an operator changing a handle should know it is not a private label.

## 3. Zones, and their membership

### 3.1 The zone

`ZONES` gains `edit: true`. `name` and `config` become editable and the other four fields stay
locked with a reason each, matching `0077` section 4.1: the join code is regenerated rather than
typed, ownership is transferred rather than assigned, and the two deletion columns are a pair.

The two deletion actions from `0077` section 4.2 join the five `ZONES` already has. "Mark for
deletion" is confirmed and names the zone. "Restore" is not confirmed, because it is the undo.

An ownerless zone stays an ordinary state on this screen, as `0007` made it. It is the zone the
transfer action exists to rescue.

### 3.2 Memberships become a resource

Today a zone's membership is an array on the zone detail read, rendered by `ZoneDetailPage` with
four action buttons on each row. That screen **stays**, unchanged, because seeing the whole
membership at once is what a zone detail is for.

Beside it, a `MEMBERSHIPS` descriptor gives one membership a form:

- `requires: ['zoneId']`, so the list is only reachable with a zone chosen and says so otherwise.
- `collectionPath` builds `/v1/admin/zones/{zoneId}/members`, with `zoneId` in `pathParams` so it is
  not also sent as a query parameter. `0005` records why that matters: the validation pipe refuses a
  property the DTO does not declare, so sending it twice turns every write into a 400.
- `edit: true`. `role` and `username` are the editable fields.
- `status` is **locked**, and its help key says the four actions are how it moves. `0077` section
  4.4 is the reason: approve, reject, kick and ban each do more than write the enum, and a select
  that dispatched to four services by inspecting its value is a switch statement whose branches
  drift.
- The four status actions are the resource's named actions, so a row opened from the membership list
  reaches the same four the zone detail page offers.

`role` is an enum field with `OWNER` **absent from its options**. The backend refuses it and the
picker does not offer it. Transfer is the action that assigns an owner.

The zone detail page gains one control per member row: open this membership. That is the only change
to it.

## 4. Lists, and their lines

### 4.1 The list

`LISTS` gains `edit: true` and `delete: true`. Three fields become editable: `name`,
`autoApproveLines` and `sharedWithZone`.

`sharedWithZone` carries the most important help key in this plan, because the control is symmetric
and the behaviour is not. Turning it on grants read, write and decide to every currently approved
non staff member. Turning it **off revokes nobody**. An operator who toggles it off to close a list
has not closed it, and the field says so above the toggle rather than in a document.

`zoneId`, `createdByUserId` and `lineCount` stay locked. Moving a list between zones is not a thing
the backend does, and `0077` does not add it.

### 4.2 Lines

A `LIST_LINES` descriptor, shaped like memberships: `requires: ['listId']`, `collectionPath` over
`/v1/admin/lists/{listId}/lines`, and `listId` in `pathParams`.

- `content` and `quantity` are editable.
- `approvalStatus` is **locked**, with the approval action beside it. It is one route and one
  service call, and an action can be confirmed while a select cannot.
- `createdByUserId` is locked. It is who wrote the line, and an operator did not.
- `delete: true`. No `create`: `0077` section 6.4 refuses it, because `createdByUserId` is not
  nullable and an operator is not a user. The list screen says so where the create control would be.

The product set behind a line is not a field on this form. It is a set of catalog items with its own
bounds, an operator has no reason to curate it, and `0077` exposes the route without this plan
needing a control for it. Section 10 records it.

`ListDetailPage` keeps its read only line rendering and gains one control per row: open this line.

## 5. A locked field says why, in place

This is the rule that makes the screens honest, and it applies to every field in the tables above
marked "with a reason".

**Every field an operator cannot change, on a resource they otherwise can, carries a `help` key
naming the reason.** Not "read only", which says nothing. The sentence says what does change it, or
why nothing does.

The reason is the same one `0007` gave the admin table its `note` for. An operator looking for a
missing control finds an answer instead of concluding the screen is short of a feature, files no
bug, and does not go looking for the row in SQL.

The form already renders `help` on a locked field, so this is translation keys and nothing else.

## 6. What stays read only

### 6.1 Baskets

`BASKETS` gains nothing. A basket is generated output with origins, claims and settlements against
its lines, and `0077` section 6.4 refuses every write to it. The screen carries a `note` saying a
basket is a record of what somebody took to the shop, and that correcting the list it came from is
the thing an operator can do.

### 6.2 Admins

`ADMINS` gains nothing, permanently. `0007` section 2 already implements the visible half of
`0071`'s rule and the screen already carries the `note` naming the server command. Nothing here
changes, and this plan is one more place recording that it is a decision.

## 7. An edit is seen by whoever is holding the app

Every write in sections 3 and 4 broadcasts to the zone, exactly as a member's own edit does
(`0077` section 7). Somebody with velista open watches a line change under their thumb.

The back office says so before it does it. Not a confirmation dialog on every edit, which becomes a
click people stop reading, but a sentence on the form for these four resources: **changes here appear
immediately for everyone in the zone.**

Delete is confirmed, as it already is everywhere in the app.

## 8. Tests

- Each of the five resources renders an edit control, and baskets and admins render none.
- Every locked field on an editable resource has a `help` key, asserted over the descriptors rather
  than screen by screen, so a field added later without one fails.
- The membership list with no zone renders the blocked state and names the missing filter, and the
  same for lines with no list.
- The `role` picker does not offer `OWNER`.
- `status` and `approvalStatus` are not editable and their actions are present.
- A user form submits no `email`, `emailVerifiedAt` or `kind`, asserted on the request body.
- The list form's `sharedWithZone` renders its help key.
- The lines list offers no create control.
- Assert on component inputs rather than rendered text wherever a string interpolates, since the
  testing translator does not interpolate.

## 9. Exit criteria

- A user's username and display name, a zone's name and config, a membership's role and per zone
  name, a list's name and its two flags, and a line's content and quantity can all be changed from a
  phone and a desktop.
- Memberships and lines are addressable one row at a time, from their parent's detail screen.
- Every field an operator cannot change explains itself on the screen it is on.
- No screen offers a control the backend refuses.

## 10. Out of scope

- Everything `0077` section 12 leaves out, since a screen cannot exist for a route that does not.
- A control for a line's product set.
- The per member list access grant set.
- Any viewer over the audit tables `0077` adds. `0075` section 5 applies unchanged.
- Reordering lines.
