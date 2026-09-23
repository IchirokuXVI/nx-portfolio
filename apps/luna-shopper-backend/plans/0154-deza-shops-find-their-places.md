# 0154: DEZA shops find their places

> Found by `0150` (report finding 12). Prerequisite reading: `0084` section 6, `0085` (the
> DEZA walk and why it writes availability), `0038` section 11, and in the code
> `source-location.service.ts` and `matching.ts` in the harvester. Plan `0153` decides the
> chain that DEZA's shops belong to. Read its context on SuperCash before you start.

A DEZA catalog walk found 13,919 products and wrote no availability, because all 11 shops
the site names came back unmapped. Nothing links a discovered DEZA place to the site's shop
code. The operator mapped one shop, T4, by hand through
`PUT /v1/admin/harvest/shops/{id}/location`. Separately, OpenStreetMap has no brand key for
DEZA, so the places queue groups its 8 shops under "Alsara" with every other unbranded place.

## Brief for the agent

### Objective

Make the DEZA shop queue propose the right catalog location for each site shop, so an
operator maps all 11 with one confirmation each, and make the places queue group unbranded
places by their printed brand instead of under one arbitrary name.

### Context

- The auto match for a site shop (`harvester/src/app/harvest/source-location.service.ts:104-112`,
  `matching.ts:249-288`) needs an exact normalized name match against a location's label or
  address.
- OpenStreetMap imports get `label: null` (`discovered-place.service.ts:507`, because the
  locale is null), and the address "Isla de Fuerteventura 48" does not equal the printed name
  "Isla Fuerteventura". So exact equality never fires.
- Mapping by hand works: `harvest.controller.ts:598-609` in the gateway calls
  `SourceLocationService.map` (`source-location.service.ts:172-189`). The `0150` evidence is
  `responses/04-p1-step5/deza-map-T4.json` in the report folder.
- `groups()` in `discovered-place.service.ts:416-423` buckets places on `brandKey` only.
  `brandKey` comes only from `brand:wikidata`
  (`libs/luna-shopper/osm-places/src/lib/normalize.ts:117`). The null bucket's `brandName` is
  the first place with any brand, in name order (`:430`). That is why DEZA reads "Alsara".
- `0085`: a DEZA walk writes availability, positive and negative, per mapped shop. It never
  writes a price.

### Target state

- For each unmapped site shop, the shop queue lists up to three candidate locations of the
  same chain, ranked by token overlap between the printed name and the location's label,
  address and postal code. A candidate with every printed token present is marked `strong`.
- Nothing is mapped without a person. Mapping stays `PUT .../shops/{id}/location`.
- After mapping, the next walk writes availability for that shop with no other step.
- The places queue groups a place with no `brandKey` by its normalized `brandName`, then by
  its normalized name, and labels places with neither as "no brand".

### Scope

Work only in:

- `apps/luna-shopper-backend/harvester/src/app/harvest/source-location.service.ts`,
  `matching.ts`, `discovered-place.service.ts` (`groups` only) and their specs
- `apps/luna-shopper-backend/gateway/src/app/harvest/` for the candidates field on the shop
  queue answer
- `libs/luna-shopper/contracts` for that field, plus the regenerated `openapi.json` and
  `wire-types.ts`

Do not touch: the DEZA adapter library (`@portfolio/luna-shopper/deza`), the walk's section
splitting, the availability writer, or the admin app (admin plan `0034` shows the
candidates).

### Constraints

- **No automated match maps a shop.** Candidates are a suggestion. This is the same rule
  `0081` states for printed names.
- The token rule is pure and deterministic, with its own fixture table built from the 11
  real DEZA shop names and the Córdoba locations in the `0150` report (`part1/places.md`).
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing how a walk writes availability, or adding an OpenStreetMap
brand key for DEZA to any data file.

### Progress evidence

- A fixture spec for the token rule: each of the 11 DEZA site shops ranks its real location
  first, where one exists.
- A spec: `groups()` puts DEZA places together and never labels them "Alsara".
- A gateway spec for the candidates field.
- Tests pass for harvester and gateway, and the OpenAPI and wire types are regenerated.

## 1. The token rule

Normalize both sides with `normalizeName`. Drop the stop words "de", "del", "la", "el", "c",
"calle", "avda", "avenida" and street numbers. The score is the share of the printed name's
tokens found in the location's label, address or postal code. Keep candidates with a score of
at least 0.5, best first, at most three.

## 2. Incomplete sections

`0150` saw 28 of 63 sections end incomplete. That is the 300 row cap and the 25 query budget
from `0085`, working as designed, and `harvest_runs.report` names them. This plan does not
change the budget, and it does not start a DEZA walk to check itself: the specs are the
evidence. If a walk runs for another reason, record in the PR how many sections it left
incomplete.
