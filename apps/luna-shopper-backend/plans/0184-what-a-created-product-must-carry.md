> **PR:** [#614](https://github.com/IchirokuXVI/nx-portfolio/pull/614)

# 0184: what a created product must carry

> Found by the audit of the first catalog on local slot 1, 2026-10-03.
>
> Prerequisite reading: plan `0079` (a name in one language), plan `0100` of the curation
> tools (the bulk routes), `harvester/src/app/harvest/source-entry-name.ts` (`acceptedName`),
> `source-entry.service.ts` (`fetchEnglishName`), `source-entry-batch.service.ts` (`itemFrom`,
> `checkEans`), `source-entry-write.ts` (`bindFields`), `source-ingest.ts` and `matching.ts`
> (how an EAN match is stamped), `catalog/src/app/catalog/search-term.ts`
> (`BARCODE_LENGTHS`), and `libs/luna-shopper/tools/curation/suggestions/src/{decision.mjs,gateway.mjs,prompt.md}`.

The bulk decisions route created 19,791 products in a day. Three things it let through are
wrong on a product, and one thing it wrote on the queue row is wrong.

## Brief for the agent

### Objective

Make a product created from the queue carry a name in both languages and a real barcode
or none, and make a bound row say truthfully how it was matched.

### Context

Read from slot 1 on 2026-10-03:

- **100 products have no English name.** `name` is `{"es": "…"}` with no `en` key. The one
  row route fetches an English name (`fetchEnglishName`). The bulk route does not
  (`itemFrom`, lines 529 to 568). The curation tool sends `{ es }` alone when the model
  answered `nameEn: null`, and its prompt allows null. 79 of the 100 came from one batch.
- **211 in-store codes are stored as a product's EAN.** They start with 2 and belong to
  one shop's scales. 6 of them are stubs such as `2204500000000` that fail the check
  digit. 5 more EANs have 11 or 12 digits. Nothing validates an EAN on any write path: the
  gateway checks a string of at most 32 characters. The six merges of October collided on
  these codes (`uq_items_ean`).
- **Every one of the 21,751 bound rows says `matchedBy: MANUAL`**, although the report says
  that rows whose EAN matched resolved by themselves. `bindFields` stamps `MANUAL` on every
  decision. The match index is built once per run, so a row harvested before its product
  existed is never matched by the ingest, and the curator's link is what binds it.
- **103 product names end in "pack"** and most multipacks do not. The size and the pack
  count already say it.

### Target state

1. **An English name on every create.** The bulk route gives a product an English name
   when the request has none, the same way the one row route does. If that call cannot
   run inside a batch (cost, or the all or nothing rule), the route refuses the operation
   with a named code and the curation tool must send both. Choose after reading
   `fetchEnglishName`, and say which in the PR.
2. **The curation tool always sends both names.** `checkDecisionShape` requires `nameEn`
   on a CREATE, `validateDecision` refuses a missing one with a new code `NAME_EN_MISSING`,
   and `prompt.md` says that `item.nameEn` is always written. A brand name, a range word
   and a foreign product name stay as printed in both languages.
3. **One EAN helper in `libs/luna-shopper/contracts`**, `readGtin(text)`:
   - digits only, after a trim,
   - 8, 12, 13 or 14 digits with a valid check digit,
   - an 11 digit code is refused, and a 12 digit code is kept as it is,
   - a 13 digit code that starts with 2 is an in-store code: `{ kind: 'IN_STORE' }`.
4. **A queue row keeps what the chain printed.** `source_catalog_entries.ean` does not
   change, because the matcher and the approximate weight work both read it.
5. **A product holds a real barcode or none.** Creating a product from a row writes its
   EAN only when `readGtin` answers a real one. An in-store code or an invalid code
   creates the product with a null EAN. The gateway's item create and update refuse an
   invalid EAN with a named error code. The catalog's own message contract does the same.
6. **The ingest does not match on an in-store code.** `ItemMatchIndex` leaves in-store
   codes out of its EAN map.
7. **`matchedBy` says what matched.** A decision that binds a row to a product whose EAN
   equals the row's real EAN is stamped `EAN`. Every other decision stays `MANUAL`.
8. **A name never says "pack".** `validateDecision` refuses a CREATE whose Spanish name
   ends in the word `pack` with the existing code for a size in the name, and `prompt.md`
   says that the pack count carries it.
9. Regenerated `openapi.json` and `wire-types.ts`.

### Scope

Work only in `libs/luna-shopper/contracts`, the harvester (`source-entry-write.ts`, the two
decision services, `matching.ts`, `source-entry-name.ts`), the gateway DTOs for item create
and update, catalog's item service where it accepts an EAN, and
`libs/luna-shopper/tools/curation/suggestions`.

Do NOT touch: `source_catalog_entries.ean`, the alias key, existing products' data, the
unique index, velista.

### Constraints

- Existing products with an in-store or invalid EAN must still load and update. The new
  check runs on a write that sets or changes the EAN, never on a read, and an update that
  does not name `ean` is not refused.
- New error codes follow `libs/luna-shopper/platform/src/lib/errors/error-codes.ts`.
- Three specs pin wording in `prompt.md`. Keep them passing.
- Only make the changes this plan names.

### Acceptance criteria

- [x] A contracts spec for `readGtin`: a valid EAN-13, a valid EAN-8, a bad check digit,
      `2204500000000`, an 11 digit code, a code with spaces.
- [x] A harvester spec on the bulk route: a create with only `es` ends with both names, or
      is refused with the named code, as chosen. Chosen: refused, with `NAME_EN_MISSING`.
- [x] A harvester spec: a create from a row whose EAN starts with 2 writes a product with a
      null EAN, and the row keeps its code.
- [x] A harvester spec: accepting a row onto a product with the same real EAN stamps
      `EAN`. Accepting onto a product with no EAN stamps `MANUAL`.
- [x] A gateway spec: item create with an 11 digit EAN answers 400 with the named code.
      The code is `item_ean_invalid`.
- [x] Two curation specs: `NAME_EN_MISSING`, and a name that ends in "pack".
- [x] `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

### Action boundaries

Proceed with code and specs. Stop and ask before changing how the single row route fetches
English, and before adding a model call to the bulk route.

### Progress evidence

Report each criterion with its spec output.
