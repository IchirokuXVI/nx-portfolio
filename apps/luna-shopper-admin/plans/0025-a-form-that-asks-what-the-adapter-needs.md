> **PR:** [#316](https://github.com/IchirokuXVI/nx-portfolio/pull/316)

# 0025 A form that asks what the adapter needs

Two forms in the back office decide whether to ask for a price scope, and both decide it from a
hardcoded chain name. Backend plan `0103` replaces that guess with a table the backend publishes, and
widens a file to hold several scopes. This plan is the front end half: the two forms read the table,
and the upload form reads what the document actually says.

Depends on backend plan `0103` for `ADAPTER_CAPABILITIES`, for `hints.adapter_key` and for document
version 2. Nothing here can be built before the contract lands, because every rule below is read from
the wire types generated out of it.

## 1. What is wrong today

**`runs-page.ts` names one adapter.**

```ts
const SCOPED_ADAPTER = 'mercadona-api';

readonly needsScope = computed(
  () => this.mode() === 'CATALOG_DISCOVERY' && this.adapterKey() === SCOPED_ADAPTER
);
```

The backend requires a scope for `mercadona-api` **and** `carrefour-web`. So the form does not offer
the picker for a Carrefour walk, sends an empty scope (`runs-page.ts:697`), and the spawn refuses the
run with a message about a field the operator was never shown. That is a live defect, and it is the
predictable cost of stating a capability twice.

**`import-upload-page.ts` always demands a scope.** Line 904 makes the submit button wait for one, and
the hint preselects it. That is right for every leaflet, and wrong for a document that already names a
scope on every price, which is what a LIDL export becomes under `0103`.

## 2. The capability comes from the wire types

`ADAPTER_CAPABILITIES` is generated into `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`
with the rest of the document's `components.schemas`, so the back office reads the same table the
spawn enforces. `SCOPED_ADAPTER` is deleted.

```ts
readonly needsScope = computed(() => {
  const capabilities = ADAPTER_CAPABILITIES[this.adapterKey()];
  return (
    this.mode() === 'CATALOG_DISCOVERY' &&
    capabilities?.writesPrices === true &&
    capabilities.scopesItsOwn === false
  );
});
```

Two more rules on the same form stop naming adapters and read the table instead:

- The postal code and radius fields hide when `listsItsOwnStores`, which is what a store discovery
  for a chain that publishes its own shops ignores.
- The EAN backfill switch shows only when `hasProductPages`.

**An adapter the table does not know answers no to everything.** A back office one release behind a
backend that added an adapter shows a plain form rather than a broken one, and the spawn is still the
thing that refuses a bad request.

## 3. The upload form asks what the document needs

The document states its producer's adapter in `hints.adapter_key`, and it states its scopes. The form
reads both, in this order:

1. **The document carries a price that names no scope.** Ask for the default scope, exactly as today.
   This is every leaflet.
2. **Every price names a scope.** Do not ask. Show instead what the file declares: the count of
   scopes and their names, so the operator sees that the file prices 59 regions before importing it.
3. **The document carries no price at all.** Do not ask. A file with nothing to price needs no scope,
   which is the same rule the runs form applies to `deza-web`.

`hints.adapter_key` preselects the chain and labels the preview with what produced the file. **It
never decides rule 1.** The decision is read from the products, because the hint is what a producer
claims and the products are what the file holds, and a mislabelled file must still import correctly.

A version 1 document is read as it always was: no scopes, one price per product, rule 1 every time.

## 4. The preview shows the scopes

`import-upload-page.ts` already previews a large file in pages. It gains one block above the product
list:

| Shown              | From                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| Scope count        | `document.scopes.length`                                                     |
| Scope names        | `scopes[].name`, truncated after the first few, with the rest behind a count |
| Adapter            | `hints.adapter_key`, or "not stated"                                         |
| Prices per product | the largest `prices.length` in the document                                  |

The block is absent for a document with no scopes, so nothing changes for a leaflet upload.

## 5. What changes

| File                                            | Change                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `models/src/lib/wire/wire-types.ts`             | regenerated, gains the capability table                          |
| `feature-harvest/src/lib/runs-page.ts`          | `SCOPED_ADAPTER` deleted, three rules read the table             |
| `feature-harvest/src/lib/import-upload-page.ts` | the three rules of section 3, the preview block of 4             |
| `models/src/lib/harvest/harvest-run.ts`         | reads `scopes` and `prices[]` off a document                     |
| the two specs                                   | one case per rule, including the Carrefour case that fails today |

## 6. Testing

- A spec per adapter row, asserting whether the scope picker is rendered. The `carrefour-web` case is
  the regression test for the defect in section 1, so write it before the fix.
- An unknown adapter key renders the plain form and does not throw.
- Three upload specs, one per rule of section 3, against a document fixture each.
- A version 1 fixture still asks for a scope and still imports.

## 7. What this plan does not do

- It does not change the queues, the run page or the sources form. The sources form picks an adapter
  from `ADAPTER_KEYS` and that list is unchanged.
- It does not let the back office create a price scope. A scope is created by a run or by the catalog
  screens, and an upload that needs one still picks an existing scope.
