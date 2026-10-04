> **PR:** [#615](https://github.com/IchirokuXVI/nx-portfolio/pull/615)

# 0178: a printed brand is a reading, not a verdict

> Found by the curation of the October 2026 harvest on local slot 1. The evidence is in the
> git ignored handoff `.curation-runs/2026-10-deza-staging/README.md` on the developer's
> machine, sections "Problems for a person to settle" and "Tool defects found".
>
> Prerequisite reading: backend plans `0115` and `0124` (the brand registry and its links),
> curation suggestions plans `0004` and `0005`, `decision.mjs` (`BRAND_DIFFERS_FROM_SOURCE`,
> `BRAND_IS_LINKED`), `libs/luna-shopper/deza/src/lib/brand.ts` (`extractBrand`), and
> `libs/luna-shopper/contracts` (`brand-key`).

The curation gate trusts the brand a chain prints. When the printed text is a registered
brand, a CREATE must write that brand, or the gate refuses it with
`BRAND_DIFFERS_FROM_SOURCE`. Two kinds of printed text break that trust. Some words are not
brands at all, and some names belong to more than one brand.

## Brief for the agent

### Objective

Stop chain adapters from reading appellation and season words as brands, and let one
printed brand name answer more than one registered brand, so the curator chooses between
them from the product.

### Context

- **Words that are not brands.** Deza's `extractBrand` takes the longest run of capitalised
  words, and the first run wins a tie. In "Vino tinto D.O Toro PRIMA crianza" the runs
  "D.O" and "PRIMA" tie, so the brand is "D.O". 92 Deza wines carry "D.O" or "D.O." as
  their brand. "D.O." means Denominación de Origen, a protected wine region, and the real
  brand is the other capitalised word. A brand "D.O." was registered on staging on
  2026-09-26. Since then, every one of those wines must be created under "D.O." or it is
  refused. LIDL sends "HALLOWEEN" in its brand field for seasonal products. El Jamón sends
  "QUESO DE VALDEÓN", a protected cheese name.
- **One name, two brands.** The registry key is unique, so one printed key names one
  brand. But some names belong to two businesses. El Jamón prints "Poseidón" on salmon
  loins. The fish brand is Poseidon Food (poseidon-food.com). The registered "Poseidon" is
  a cologne brand. The owner decided on 2026-10-03:
  - Poseidon Food is registered as its own brand. The curator chooses Poseidon or
    Poseidon Food from the product.
  - "Royal" (desserts and smoked fish) and "Noel" (Spanish charcuterie and Colombian
    biscuits) are the same case. They stay as they are for now.

### Target state

- `libs/luna-shopper/contracts` exports a closed list of printed words that are never a
  brand: `D.O.`, `D.O`, `DO`, `D.O.P.`, `DOP`, `D.O.Ca.`, `DOCa`, `I.G.P.`, `IGP`, `V.T.`,
  `VINO DE LA TIERRA`, `HALLOWEEN`, `NAVIDAD`. The builder can extend it only from
  evidence in a fixture.
- Deza's `extractBrand` skips a run made only of listed words, so the wine above reads
  "PRIMA". LIDL's and El Jamón's normalizers write null for a brand that is a listed word.
- A registry table `brand_homonyms (printedKey, brandId)`. It says that a printed key also
  names that brand. The key's own brand stays the first answer.
- The queue entry view and the curation packet carry `brandMatches`, every brand the
  printed key names, in place of the single `brandMatch`.
- `BRAND_DIFFERS_FROM_SOURCE` accepts a CREATE that writes any brand in `brandMatches`.
- Admin API: `POST /v1/admin/catalog/brands/:id/homonyms` with `{ printedKey }`, and the
  matching `DELETE`. The admin screen for it is a later admin plan, not this one.
- The curation prompt says that `brandMatches` can hold several brands, and that the
  curator chooses by the product's type.

### Scope

Work only in the chain libraries' brand readers (Deza, LIDL, El Jamón),
`libs/luna-shopper/contracts`, catalog's brand entity, service, migration and routes, the
harvester's entry view, `libs/luna-shopper/tools/curation/suggestions`, the gateway DTOs,
and the regenerated `openapi.json` and `wire-types.ts`.

Do NOT touch: brand keys, brand links (`canonicalBrandId`), the admin app, existing items'
brands.

### Constraints

- A brand key stays unique. A homonym is an extra pointer, not a second key.
- Never delete or rename a registered brand in a migration. "D.O." is a registry row that
  a person removes, not code.
- Only make changes directly requested.

### Acceptance criteria

- [ ] A Deza spec reads "Vino tinto D.O Toro PRIMA crianza" as brand "PRIMA".
- [ ] A spec reads LIDL's "HALLOWEEN" brand as null.
- [ ] A curation spec accepts a CREATE under Poseidon Food for a row printed "Poseidón"
      when the homonym is registered, and refuses it when it is not.
- [ ] A catalog spec refuses a homonym whose key equals the brand's own key.
- [ ] `openapi.json` and the wire types are regenerated.

### Action boundaries

Proceed with in-scope edits and tests. Stop and ask before changing how a brand key is
computed.

### Progress evidence

Report each reader and the gate change only with spec output.

## The data a person settles after this lands

- Remove the "D.O." brand with `DELETE /v1/admin/catalog/brands/:id`, then let the 92 Deza
  wines be decided again. The owner decided on 2026-10-04 to add this route.
  - If nothing points at the brand, the route deletes it. Its homonyms go with it.
  - If a product holds the brand, or a spelling is linked to it, the route writes nothing.
    It answers 409 `brand_in_use`. The counts `itemCount` and `linkCount` are in `details`.
  - The route never changes a product's brand. So first give each product that holds
    "D.O." its real brand. Then unlink or delete each spelling linked to it.
- Register Poseidon Food's homonym for "poseidon", then decide El Jamón's salmon again.
