> **PR:** [#195](https://github.com/IchirokuXVI/nx-portfolio/pull/195)

# 0005 The catalog screens

The seven catalog resources, as descriptors on `0004`'s machinery, plus the one screen that cannot
be a descriptor.

Depends on `0004`, and on `apps/luna-shopper-backend/plans/0073` for the admin catalog routes and
the unscoped admin reads.

## 1. The resources

| Resource       | Entity                    | Notes                                                                  |
| -------------- | ------------------------- | ---------------------------------------------------------------------- |
| Supermarkets   | `Supermarket`             | Localized name, logo, website, `externalBrandKey`, default price scope |
| Locations      | `SupermarketLocation`     | Per chain, with address, geo, postal code                              |
| Price scopes   | `PriceScope`              | Per chain, `kind` and `externalKey`                                    |
| Items          | `Item`                    | The product. Localized name, brand, EAN, unit size, category, group    |
| Product groups | `ProductGroup`            | What makes two products comparable                                     |
| Prices         | `SupermarketItem`         | Section 4. Not a plain descriptor.                                     |
| Location items | `SupermarketLocationItem` | Aisle position, and the per store availability override                |

Six of the seven are descriptors and nothing more. The seventh is section 4.

## 2. A price belongs to a scope, and the UI has to say so

This is the single most confusing thing in the domain and the place where a well meaning admin
screen creates wrong data.

A price is **not** attached to a shop. `SupermarketItem` is keyed on `(itemId, priceScopeId)`,
because Mercadona publishes one price per warehouse and twelve stores in Córdoba share it. So
"set the price of milk at this Mercadona" is really "set it for warehouse 4661", which changes it
for every store that warehouse serves.

An interface that hides this is not simpler, it is wrong: an operator correcting a price they saw
in one shop would silently change it for eleven others without being told.

So wherever a price is edited, the screen names the scope, states its kind, and says how many
locations it covers. The scope picker on the price form is not a dropdown of shop names.

A chain with no automated source gets one `STORE` scope per location, which makes hand entered
prices work with no special case. The screen therefore does not need a "manual supermarket" mode;
it needs to render scopes honestly and the data model already handles the rest.

## 3. Locations, and the postal code that was guessed

`SupermarketLocation.postalCodeSource` says where the postal code came from, and `DERIVED` means it
was inferred from the nearest centroid rather than known. Its own comment calls it "the review flag
the class doc used to promise and nothing implemented ... what an eventual admin queue sorts on".

There is no queue in this plan. There is a **filter**, which is most of the value for almost none of
the work: the location list can show only `DERIVED` rows, and the column is visible so an operator
can see which addresses are guesses.

A null postal code with a null source is a deliberate state and not an error to flag: a store whose
nearest centroid was beyond the bound keeps both null, because a wrong postcode is worse than none.
The list distinguishes the three states rather than collapsing null and derived into "missing".

**Editing a location's postal code does not touch its price scope.** That is stated in the entity
and it is a real trap: an operator correcting an address might reasonably expect the pricing to
follow, and it does not. The form says so where the field is edited.

## 4. The price screen, which is not a descriptor

Prices need a bespoke screen for one reason: **a manually typed price is permanent and invisible**,
and the generic form would let an operator create that state without knowing.

The rule is already implemented in the backend: an automated fetch never overwrites a price whose
`priceSourceKind` is `ADMIN` (plan `0038`, section 6.5). The confirmation queue that was supposed
to surface the resulting disagreement does not exist and is deliberately deferred. So today, typing
a price pins it against the harvester forever, with nothing anywhere saying it happened.

Three requirements follow, and they are cheap because the columns already exist:

- **`priceSourceKind` is a visible column and a filter.** An operator can list every price they
  have pinned, which is the question "what have I overridden" and is currently unanswerable.
- **`priceObservedAt` is visible**, so a stale price is recognisable as stale.
- **"Revert to harvested" is an action.** It clears the `ADMIN` pin so the next run may write the
  row again. Without it, a typo is permanent and the only repair is SQL.

Plus the rule from `0004` section 5, restated because this is the screen it exists for:
**`unitPrice` is typed in, never derived.** `unit_price / unit_size` disagrees with the source on
110 of 4,232 products. `unitPriceLabel` is free text (`100 ml`, `lv` for washing machine loads) and
is not an enum, so it is a text field and not a picker.

`available` on `SupermarketItem` is scope wide, and `available` on `SupermarketLocationItem` is a
nullable per store override where null means "use the scope's". Two columns making two different
claims. The screens label them so, rather than showing two checkboxes both called "available".

## 5. Admin reads are unscoped

Every list here uses the admin reads from `0073` section 4, not the open catalog reads velista
uses. Those are scoped to the caller's shopping profile and postal codes, which for an operator is
both meaningless and actively misleading: an admin editing a product sold nowhere near them would
see no price and conclude it had none.

The admin reads are unscoped, sorted for administration, and filterable on the things that matter
here: `priceSourceKind`, missing `productGroupId`, `postalCodeSource`, `available`.

## 6. Tests

- The price form names the scope and its location count, and cannot submit against a location.
- Reverting a pinned price clears `priceSourceKind` and the row becomes writable by a run.
- The price list filters to `ADMIN` prices.
- `unitPrice` is never populated by the form from other fields.
- The location list distinguishes known, derived and unknown postal codes.
- Localized names submit an object with every locale, including untouched ones.

## 7. Exit criteria

- All seven resources can be listed, created, edited and deleted from a phone and a desktop.
- Every pinned price is findable, and every pin is reversible from the UI.
- No screen presents a price as belonging to a location.

## 8. Out of scope

- The price disagreement queue, which needs a schema decision first
  (`apps/luna-shopper-backend/plans/0074`, section 6).
- A derived postal code work queue, as opposed to the filter here.
- Harvester screens: `0006`.
