> **PR:** [#215](https://github.com/IchirokuXVI/nx-portfolio/pull/215)

# 0079 A name in one language

`LocalizedText` is `{ en: string; es: string }` in
`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`, lines 21 to 24. Both halves
are mandatory, on the type, in the Ajv schema and on the gateway. Every product, group, chain and
scope label in the catalog carries both.

Two sources cannot honour that. A supermarket leaflet is printed in Spanish only. Mercadona's API
answers `en` for most products and falls back to the Spanish string for the rest (plan `0038`
section 2.3). The leaflet import that follows this plan creates products from the first source,
and the harvester already creates them from the second.

**The decision, made by the owner: a name carries the languages it has, and a reader shows the
one they read or else the other.** A reader in English sees English first and Spanish when there
is none. A reader in Spanish sees Spanish first and English when there is none. One language is
always present.

**A language a name does not have is absent from the object, not null.** `{ es: "Leche" }` is a
Spanish only name. `{ en: null, es: "Leche" }` is refused. The first draft of this plan chose
the null, and the reasons the owner reversed it are worth keeping, because the two shapes look
interchangeable and are not:

- **A new language costs the old rows nothing.** The catalog serves two languages today and will
  serve more. With a required nullable key, adding `fr` makes every existing row invalid until a
  migration writes `"fr": null` into every localized column on items, groups, chains, scopes and
  locations. With an absent key, a new language is one entry in the locale union, one property in
  the schema and one entry in the admin's `CONTENT_LOCALES`. Every row already stored is already
  valid.
- **Postgres cannot tell the two apart.** `name ->> 'en'` answers NULL for a missing key and for a
  JSON null. Every expression in section 3, the search vector triggers and the trigram indexes
  behave the same either way, and no catalog query uses the `?` key operator.
- **The read side already speaks absence.** The admin models a localized text as
  `Readonly<Record<string, string>>` and drops anything that is not a string. Velista reads each
  half with a fallback. Only the contract and the producers said null, which is two
  vocabularies for one fact.
- **There is no third state.** A name is replaced whole on update (`row.name = req.name` in all
  three services), and `JSON.stringify` drops an undefined key, so nothing can store undefined as
  a value. Absent on the wire is absent in the row.

This plan is small on the type and wide on what reads the type. The sweep that sized it covered
all seven backend services, the gateway, the admin and velista. Five of those areas need nothing.
Four need real work, and one of the four is a silent data loss bug the widening introduces on its
own. That bug is the reason this is a plan and not a line in the leaflet plan.

## 1. The contract

```ts
/** The languages the catalog writes its names in. A reader falls through them in this order. */
export const CONTENT_LOCALES = ['en', 'es'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * A name in at least one of the languages the catalog serves.
 *
 * A language the name does not have is absent, never null, so a third language is a new key
 * and not a migration over every row.
 */
export type LocalizedText = Partial<Record<ContentLocale, string>>;
```

**At least one key is present, and every present value is a non blank string.** That is a rule of
the value. The type's doc comment states it, and the one write gate in section 2 enforces it. `{}`
is not a name and is refused everywhere a name is written. So is `{ en: null }`: null is not a
word in this vocabulary, and "no English name" is spelled by leaving `en` out.

The Ajv schema in `libs/luna-shopper/contracts/src/schemas/messages/catalog.schemas.ts`, lines 166
to 170, is today `object(id, { en: nonEmptyString(), es: nonEmptyString() }, ['en', 'es'])`. It
keeps both properties and `additionalProperties: false`, requires neither, and adds
`minProperties: 1`. A misspelled locale or a language the catalog cannot serve is still refused, an
absent one passes, and a null one fails the string branch. `nullableLocalized()` at lines 161 to
164 stays what it is: the whole object nullable, for `label`.

The cross domain reference in `generated-list-sharing.schemas.ts` is `supermarketName`, at lines
478 and 483. It follows the widened definition through its `$ref` and needs no edit of its own.

Sixteen TypeScript fields in `catalog.messages.ts` carry the type and change with it. Two
generated documents follow:

```sh
npx nx run luna-shopper-backend-gateway:openapi      # catalog.LocalizedText and LocalizedTextDto
npx nx run luna-shopper-admin/models:wire-types      # CatalogLocalizedText, wire-types.ts lines 1288 to 1291
```

`openapi-schema.spec.ts` line 234 proves a published schema still rejects a bad document by
deleting `required[0]` from a copy, and skips a schema whose `required` is empty. `localizedText`
now has none, so it drops out of that loop. The contract tests in section 7 cover it directly.

## 2. The one write gate

Ajv is not on the request path. `validateSchema` and `assertValid` in `contracts/src/schemas/validator.ts`
run in tests and in the document generator. What refuses a bad name on the wire is
`LocalizedTextDto` in `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts`, lines
61 to 74:

```ts
@ApiProperty({ maxLength: 200 })
@IsString()
@MinLength(1)
@MaxLength(200)
en!: string;
```

Each half becomes `@ValidateIf((_, value) => value !== undefined)` before
`@IsString() @MinLength(1) @MaxLength(200)`, typed `en?: string`, with `@ApiPropertyOptional`.
The condition is on undefined and not on null, so a null half reaches `@IsString()` and is
refused: the DTO does not translate a null into an absence, it rejects it, which keeps the wire
and the row saying the same thing. A class level validator, `AtLeastOneLocale`, refuses an object
with no non blank string in any content locale. That validator is the whole enforcement of section
1's rule, and it is the only thing that stops an empty name reaching catalog. It is unit tested on
its own.

Ten DTOs embed `LocalizedTextDto` (lines 101, 130, 171, 233, 298, 387, 406, 776, 806 and the
location label). None changes.

## 3. Three paginators that lose rows

This is the bug the widening introduces, and it is silent.

Three admin listings page by keyset on the English name. They order by `name ->> 'en'` and seek
with a row comparison:

| Service | Order and seek | Cursor value |
| --- | --- | --- |
| `catalog/src/app/catalog/item.service.ts` | lines 834 to 841, `(i.name ->> 'en', i.id) > (:cv, :cid)` | line 851, `row.name.en` |
| `catalog/src/app/catalog/product-group.service.ts` | lines 156 to 163 | line 173, `last.name.en` |
| `catalog/src/app/catalog/supermarket.service.ts` | lines 212 to 219 | line 229, `row.name.en` |

In Postgres, a row comparison with a NULL member yields NULL, and a NULL predicate drops the row.
`ORDER BY ... ASC` puts NULLs last. So a product with no English name sorts to the end of the
listing, and every page after the first excludes it from the seek. It appears on no page. Nothing
errors. The count is wrong by exactly the number of Spanish only products, which after the
leaflet import is most of the new ones.

The three `cursorValue` methods are typed `string` and read `.en`, so the type change makes them
fail to compile. That is the only reason anybody notices.

**The fix is one expression, used in three places each.** A helper in `catalog.mappers.ts`:

```ts
/** The sort key for a localized name: English, else Spanish, never null. */
export const displayNameSql = (alias: string) =>
  `coalesce(${alias}.name ->> 'en', ${alias}.name ->> 'es', '')`;
```

It replaces `name ->> 'en'` in the `ORDER BY`, in the seek predicate and in the cursor value, in
all three services. The three must agree. A seek on one expression and an order on another skips
rows in a different way. The cursor value is computed in TypeScript with the same rule,
`displayName(row.name)`, which is `name.en ?? name.es ?? ''` and lives beside the SQL so the two
are read together.

The expression is not indexed, and does not need to be. These are admin listings of a catalog of
a few thousand rows.

**The integration test that catches it.** `catalog/src/app/catalog/localized-name-paging.integration.spec.ts`,
run under `npx nx run luna-shopper-backend-catalog:test-integration` with `LUNA_INTEGRATION` set
against a slot. Seed seven items, three with no `en`. Page through the item listing ordered by
name with a limit of two. Assert that every seeded id appears exactly once across the pages.
Repeat for groups and for chains. This test fails on the code as it is today, with the type
widened and nothing else changed, and that is its purpose.

**What does not break in the database.** `NOT NULL` on `items.name`, `supermarkets.name` and
`product_groups.name` constrains the jsonb object, not its keys. `{"es": "Leche"}` is legal
today. There is no `CHECK` on any localized column. The search vector triggers in
`1756200000000-CatalogSearchAndProductGroups.ts`, lines 145 to 180, read every half through
`coalesce(... , '')`. The trigram indexes at lines 236 to 251 are expression indexes on
`name ->> 'en'` and `name ->> 'es'` and tolerate a missing key. **No migration.**

The similarity and equality arms compare one half and yield NULL for a missing half. They sit in
`item.service.ts` (lines 385 to 428 and 666 to 716), `product-group.service.ts` (lines 272 to
286) and `supermarket.service.ts` (lines 177 to 178). The arm never matches, and the other half's
arm still does. Search narrows correctly with no change.

## 4. The harvester, and plan `0038` section 11 reversed

`apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts`, line 64, builds the name index
with `nameKey(item.name.es, item.brand, item.unitSize)`, and `normalizeName` at lines 38 to 45
calls `.toLowerCase()` on it. A missing Spanish name is a `TypeError` at run time. It becomes
`nameKey(item.name.es ?? item.name.en ?? '', ...)`. The match index is built from the Spanish
name because the discovery snapshot is Spanish (plan `0038` section 6.2). An English only item
lands in a bucket a Spanish snapshot rarely hits. That is correct: it is a candidate at best, and
the ladder already treats a name match as a candidate.

**Plan `0038` section 11 chose the opposite fallback, and this plan reverses it.** That section
recommends: "Falls back to Spanish, so an English speaking user sees Spanish. Refusing to import
is worse. Recommendation: fall back and flag for curation." The code did the first half.
`source-entry.service.ts`, lines 140 to 143, creates an item with
`name: { es: entry.name, en: englishName ?? entry.name }`. The flag never landed.

From this plan on it writes `en` only when Mercadona answered one, and leaves the key out for a
product it does not translate. The reason is what the copy hides. A copied string and a
translated string are indistinguishable in the row. Nothing can list the products whose English
name is a Spanish string, so the curation the section asked for cannot be queued. A missing key is
a visible gap. The admin lists it by `missingLocales`, section 5. A reader sees the Spanish name
through the fallback, which is what the copy gave them anyway. The two paths, Mercadona and
leaflet, then write the same shape for the same fact.

Two other producers stay as they are, on purpose:

- `discovered-place.service.ts`, line 231, writes `{ en: name, es: name }` for a chain created
  from a discovered store. A chain's name is a proper noun. It is the same in both languages.
  Leaving one out asks somebody to translate "Mercadona".
- The reference seed, `catalog/src/app/db/reference/*`, fills both halves by hand. Unchanged.

`fetchEnglishName` at lines 192 to 202 keeps fetching `['es', 'en']` once per created item. A
product Mercadona answers in Spanish for `en` is detected there: `product.name.en` is undefined,
and the library already answers null.

## 5. The admin

The back office is nearly built for this already. It stores localized text as
`Readonly<Record<string, string>>` and not as the contract's pair
(`libs/luna-shopper-admin/models/src/lib/resource/localized-text.ts`). `toLocalizedText` (lines
29 to 42) keeps string entries and drops everything else, so a missing half stays missing.
`localizedTextValue` (lines 51 to 66) falls through `CONTENT_LOCALES`, which is `['en', 'es']` at
line 26, and then takes any non blank value. That is the owner's display rule, English first,
then Spanish. Every row title and list cell already does it: `items.ts` 42, `locations.ts` 60,
`price-scopes.ts` 56, `product-groups.ts` 42, `supermarkets.ts` 46, `resource-view.ts` 81.

Two behaviours in `models/src/lib/resource/resource-draft.ts` are wrong for the new rule:

- **`validateField`, the `localized-text` arm.** A field with `required: true` emits
  `resource.error.missingLocale` for every blank locale. A Spanish only product is unsavable
  from the form. `required` comes to mean "at least one locale", one message
  `resource.error.missingAnyLocale`, and the per locale messages go.
- **`toSubmitValue`, the `localized-text` arm.** Submit runs `toLocalizedText(value)`, and the
  draft seeds `''` per locale (`emptyDraftValue`, and `toDraftValue` fills every locale). The
  form can only ever send `''`, and `''` is refused by `@MinLength(1)`. Submit drops a blank
  locale, so the form says "no English name" in the only vocabulary the wire accepts: by not
  saying it.

`localized-text-control.ts` reads `this.value()[locale] ?? ''` and is unaffected. The list cell
shows the fallback and marks it. `missingLocales` (lines 125 to 130) already answers which halves
are absent. A `missing en` tag on the cell (`ResourceCell.missing`, drawn by the table beside the
text) is the flag plan `0038` section 11 asked for and never got.

`wire-types.ts` is regenerated, and `wire-types.spec.ts` fails until it is.

## 6. Velista

Nothing. Rule D4 did the work in advance. `libs/velista/data-access/src/lib/mapping/mappers.ts`,
lines 998 to 1004, maps the wire pair through `strOr(raw['en'], '')`. Its comment at lines 990
to 997 says neither half is required and a missing half is a curation gap. `inLocale` in
`libs/velista/models/src/lib/shopping-profile.ts`, lines 53 to 56, picks the reader's language
and falls back to the other for an empty one. Twenty one call sites across ten files bind the
resolved string and never the pair. A missing key off the wire renders correctly today.

## 7. Tests

- `contracts/src/schemas/schemas.spec.ts`: `{ es: 'Leche' }` passes, `{ en: 'Milk' }` passes,
  `{}` fails, `{ en: null, es: 'Leche' }` fails, `{ en: '', es: 'Leche' }` fails,
  `{ fr: 'Lait' }` fails.
- Gateway: `LocalizedTextDto` unit tests for the same cases, through the validation pipe.
- Catalog: the paginator integration test of section 3, for items, groups and chains.
- Harvester: `matching.spec.ts` indexes an item with no `es` without throwing, and
  `source-entry.service.spec.ts` asserts the created name has no `en` key for an entry Mercadona
  does not translate, and has one when it does.
- Admin: `resource-draft.spec.ts` saves a draft with one locale blank and omits it, and refuses a
  draft with both blank.
- `libs/luna-shopper/test-fixtures` factories accept a partial override, so
  `makeItem({ name: { es: 'Leche' } })` builds without a second builder.

## 8. Exit criteria

- `LocalizedText` allows either key to be absent, never both, and never null, on the type, in the
  schema and at the gateway.
- A product with no `en` appears exactly once across the pages of the admin item listing. The
  same holds for groups and chains. An integration test proves it and fails without the coalesce.
- `source-entry.service.ts` leaves `en` out for a Mercadona product with no English string, and
  the admin lists it as missing English.
- A Spanish only product is creatable and editable from the back office.
- Velista renders a one language name with no code change, which is asserted by leaving its
  mapper tests untouched and green.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test` is green.
