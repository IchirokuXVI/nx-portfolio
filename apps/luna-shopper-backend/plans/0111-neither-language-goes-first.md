# 0111 Neither language goes first

Plan `0079` decided that a name carries the languages it has, that a language a name does not
have is absent from the object rather than null, and that a reader sees the language they read
or else the other one. The contract says so, the gateway validator says so
(`AtLeastOneLocale`, `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts` line 146) and the admin form says so (`resource-draft.ts` line 284, "required means in at least one
language").

Three places in the backend still privilege one particular language, and they privilege
different ones. A read prefers English. A write requires Spanish. Two producers claim a
translation exists when it does not. This plan removes all three privileges. It does not add a
language and it does not change what a name is.

## 1. What is true today

**A read collapses a name English first, unconditionally.**
`apps/luna-shopper-backend/catalog/src/app/catalog/catalog.mappers.ts` holds the rule twice, in
SQL and in TypeScript:

```ts
// line 38
export const displayNameSql = (alias: string): string => `coalesce(${alias}.name ->> 'en', ${alias}.name ->> 'es', '')`;

// line 42
export function displayName(name: LocalizedText): string {
  return name.en ?? name.es ?? '';
}
```

The three admin listings that page by name order by it, seek on it and cut their cursor with
it: items (`item.service.ts` lines 1030, 1032 and 1047), product groups
(`product-group.service.ts` lines 164, 168 and 181) and chains (`supermarket.service.ts` lines
214, 216 and 231). A reader of Spanish therefore gets a page of Spanish names sorted by the
English half of whichever rows happen to have one. The comment above `displayNameSql` already
records what the coalesce is for, which is that seeking on `name ->> 'en'` alone dropped every
Spanish only product from every page. It fixed the disappearance and kept the preference.

**A write requires Spanish.** Accepting one queued row into the catalog builds the name like
this (`apps/luna-shopper-backend/harvester/src/app/harvest/source-entry.service.ts` lines 232
to 249):

```ts
const spanish = req.name?.es?.trim() || entry.name;
if (!spanish) {
  throw new ValidationException('A product needs a name in at least one language.', {
    details: { name: 'give at least one of es or en' },
  });
}
const english = req.name?.en?.trim() || (await this.fetchEnglishName(entry));
// ...
name: english ? { es: spanish, en: english } : { es: spanish },
```

Two things are wrong there and only one of them is visible. The refusal message offers a choice
the code does not honour: an operator who fills English and leaves Spanish blank satisfies
nothing, because `spanish` is what is checked. And when the row does carry a printed name, an
English only submit does not fail at all. It stores the chain's printed Spanish string as `es`
beside the typed English, so the operator wrote one name and the catalog holds two. The batch
route repeats the same shape in `itemFrom` (`source-entry-batch.service.ts` lines 371 to 377),
without the fetch.

**Two producers copy one string into both keys**, which is exactly what plan `0079` reversed
for product names:

```ts
name: { en: name, es: name }; // discovered-place.service.ts:452
declaration.name ? { es: declaration.name, en: declaration.name } : null; // price-scope-resolver.ts:90
```

A copy is indistinguishable from a translation in the row, so nothing can list the shops and
the scopes still waiting for one, and `missingLocales` in the back office reports a gap that is
covered and a coverage that is a duplicate.

**One adapter type makes Spanish structural.** `libs/luna-shopper/mercadona/src/lib/types.ts`
line 22 is `name: { es: string; en?: string }`, so a product with no Spanish name cannot be
expressed. The consequence is in the same library: an unavailable product is built with
`name: { es: '' }` (`normalize.ts` line 176), a blank string in the one key that is required,
which is the shape both the gateway and plan `0079` refuse.

## 2. The decision

**No language is required and no language is preferred. A name needs one language, and which
one it is does not matter.**

Two halves follow from it, one per direction:

- **A read answers in the caller's language.** The order a name is collapsed in is the caller's
  locale first and the remaining content locales after it, so a reader of Spanish sorts by
  Spanish and still sees an English only row rather than a blank.
- **A write stores the languages it was given.** Nothing is copied, nothing is substituted, and
  the printed string a chain published belongs to the language that chain prints in rather than
  to a constant.

## 3. The caller's language already arrives

Nothing has to be threaded for the read half. `resolveLocale`
(`libs/luna-shopper/platform/src/lib/localization/locale.ts` line 67) settles the request
locale at the edge, `correlation.middleware.ts` line 45 puts it in the request context, and
`rpc-correlation.interceptor.ts` line 48 reads the `x-locale` header the gateway propagated and
runs every NATS handler inside the same context. Catalog can therefore ask for the caller's
locale in any service method, the way the exception filter already does
(`global-exception.filter.ts` line 110), and the answer is a `SupportedLocale` and never a
string a caller chose.

That is worth stating because it decides the shape: the locale is **not** a new field on every
catalog request message. Adding one gives two answers to the same question, and the
request context is the one the error messages already use.

## 4. A read collapses in the caller's order

Both halves of the rule take the order rather than assuming it:

```ts
/** The content locales, the caller's first. */
export function readingOrder(locale: SupportedLocale): readonly ContentLocale[];

export const displayNameSql = (alias: string, locale: SupportedLocale): string =>
  `coalesce(${readingOrder(locale)
    .map((l) => `${alias}.name ->> '${l}'`)
    .join(', ')}, '')`;

export function displayName(name: LocalizedText, locale: SupportedLocale): string;
```

The interpolation is safe and must stay auditable: the locale comes from the closed
`SUPPORTED_LOCALES` union after `toSupportedLocale` has narrowed it, never from a request
string. A locale that reached this function unnarrowed is SQL injection, so
`readingOrder` takes the narrowed type and the three call sites pass what the request context
holds.

The three listings then order, seek and cut with the same order, which is the invariant the
existing comment insists on: the `ORDER BY`, the keyset predicate and the cursor value must
agree, because a row comparison with a NULL member yields NULL and a NULL predicate drops the
row silently.

## 5. The cursor carries the order it was cut under

This is the one part that is easy to get wrong, and the mechanism to get it right is already
there. `encodeCursor` exists to hold "the sort key values and the chosen order", and
`decodeCursor` treats a malformed token as "start from the beginning" rather than an error
(`libs/luna-shopper/platform/src/lib/pagination/cursor.ts` lines 28 to 44).

So the cursor payload gains the locale it was cut under, and a page requested under a different
locale starts over instead of seeking with a key from the other order. Without that, an
operator who switches language halfway down a list pages with a Spanish predicate against an
English cursor value and gets rows repeated or skipped, with nothing on screen to say so. This
is the same class of defect as a timestamp cursor that loses precision, and it is invisible in
exactly the same way.

## 6. Accepting a row writes the languages the operator gave

The accept builds the name from the request, and the printed string fills in only when the
request named no language at all:

```ts
const given = presentLocalizedText(req.name); // non blank keys only
const printed = entry.name?.trim();
const name = Object.keys(given).length > 0 ? given : printedName(entry, printed);
```

`printedName` needs to know what language the chain prints in, and section 7 says where that
comes from. When the request names nothing and there is no printed name either, the refusal
stands, and its message becomes true: a product needs a name in at least one language, and
either of them will do.

`fetchEnglishName` stays and narrows. It is the source's own translation, so it fills a
language the operator left blank and must never replace one they typed. Today it runs whenever
`req.name?.en` is blank, which is already that rule. What changes is that its result is added
to whatever `given` holds rather than merged into a shape that assumed `es`.

The batch route gets the same function. `itemFrom` and the one at a time path have drifted once
already, in the way section 1 describes, and the difference between them is meant to be the
English fetch alone (`source-entry-batch.service.ts` lines 357 to 365 say so).

## 7. What language a source prints in is a fact about the adapter

`ADAPTER_CAPABILITIES` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts` line 214) is the table plan `0103` created for exactly this kind of question: one entry per adapter,
each field "a fact about the storefront rather than a switch somebody sets", read by the spawn
and by the back office so the two cannot disagree. The language a storefront publishes in is
that kind of fact, so it goes there:

```ts
/** The language this source's own text is written in, or null when nothing is known. */
readonly printedLocale: ContentLocale | null;
```

Every adapter this build knows prints Spanish. `manual` and `osm-places` print nothing, so both
answer null, and so does the fallback in `adapterCapabilities`, which must keep answering "I
know nothing" for an adapter added after the reader shipped. A null means the printed string
belongs to no known language, so the accept requires the operator to name one rather than
guessing.

Two consequences worth writing down. There is no migration, because this is not a column. And
the prose above `AdapterCapabilities` says "the same four booleans" in two places, so it is
updated with the field rather than after it.

## 8. A proper noun is written once

`discovered-place.service.ts` line 452 and `price-scope-resolver.ts` line 90 write the source's
own string under the adapter's `printedLocale` and under nothing else. A shop called "Mercadona
Alicante" is not English and not Spanish, and a reader of either language sees it through the
fallback, which is what the copy was giving them anyway. The difference is that the row now
says truthfully which language it holds, so the back office badge means something and a future
translation has somewhere to land.

## 9. The adapter type stops requiring Spanish

`MercadonaProduct.name` becomes `LocalizedText`, and the unavailable product carries `{}`
rather than `{ es: '' }`. The library is framework free by hard constraint, so it imports the
type from the contracts library or restates it locally, whichever the existing import graph
already allows, and its fixtures are refreshed with `capture-fixtures` rather than by hand.

An empty object is not a name, and the caller of `unavailableProduct` must not treat it as one.
That row exists to carry availability and never a price (plan 0038 section 2.6), and this is
the change that makes the type say so.

## 10. What this plan does not change

- **The languages the catalog serves.** Still English and Spanish, still `CONTENT_LOCALES`,
  still absent rather than null.
- **`LocalizedSynonymsDto`**, which requires both `en` and `es` arrays (`catalog.dto.ts` line
  164). An empty array is a meaningful "this group has no Spanish synonyms", so nothing is
  broken, and the per locale search vectors read both keys. It is a second vocabulary for one
  fact and it is worth aligning later, not here.
- **Search.** `item.search` and `searchOffers` already query both locales' `tsvector` columns
  and rank across them (`item.service.ts` lines 810 and 824), so no language goes first there
  today.
- **Velista.** Every read on the shopper side already falls through both halves, and the
  request already carries `Accept-Language` (`gateway-interceptor.ts` line 285).

## 11. The seam with admin plan 0026

This plan makes the backend answer in the caller's language. It does not give anybody a way to
choose one: the back office sends no `Accept-Language` at all today, so it will keep receiving
English until `apps/luna-shopper-admin/plans/0026` adds the header and the picker. The two are
independent and can be built in either order, and neither is broken by the other:

- 0111 alone changes nothing observable in the back office, because the locale it now honours
  resolves to English for a request with no header.
- 0026 alone fixes the names on screen and the server messages, and leaves the listing order
  English first until this plan lands.

## 12. Tests

- `readingOrder` and both halves of `displayName` under each supported locale, including a row
  that has only the other language and a row that has neither.
- One listing paged end to end under Spanish, asserting the order and that no row repeats or
  disappears, plus a page whose cursor was cut under English and is resent under Spanish, which
  must answer the first page rather than a mismatched seek.
- The accept, four ways: Spanish only, English only, both, and neither with a printed name
  present. The English only case is the regression this plan exists for, and it must assert
  that no `es` key is written.
- The accept with neither a request name nor a printed name, asserting the refusal and its
  message.
- The batch accept over the same four cases, so the two routes cannot drift again.
- `adapterCapabilities` answering null `printedLocale` for an adapter it does not know.
- The gateway's OpenAPI document is regenerated and committed, along with the admin wire types
  read from it, because `AdapterCapabilities` is a contract schema:

  ```sh
  npx nx run luna-shopper-backend-gateway:openapi
  npx nx run luna-shopper-admin/models:wire-types
  ```
