# 0264: a Carrefour unit price label names its basis, and a wash names none

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. Carrefour states the unit of its comparison price in the
> field `measure_unit` and never prints a label. The adapter builds the label as
> `€/${measure_unit}`. `unitBasisOf` knows no label that starts with `€/`, so it answers null
> for every Carrefour price. The committed Carrefour fixtures print `measure_unit` `l` 92
> times, `kg` 24 times and `ud` 2 times. The share of Carrefour offers with a null basis was
> not re-measured on 2026-11-11, Docker was down. The code says it is all of them.
>
> The owner answered the decisions of this plan on 2026-11-11. Two answers widen the plan:
> **a wash is not a unit of measure for this app** (D2), and **the value `WASH` leaves the
> contract in this plan, not in a later one** (D4). A wash count is the brand's own claim.
> Nobody can measure it, and it is a bad basis to compare prices on. The plan thus removes the
> two wash keys of the label table and then the value `WASH` from every place it lives
> (section 2).
>
> Prerequisite reading: plan `0157` (the label table), plan `0189` (a label that is true of its
> figure), plan `0245` (a comparable price says what it compares in), plan `0249` (the size
> check and its own label table), `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts`
> (`unitBasisOf`, `UNIT_BASIS_BY_LABEL`), `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`
> (`UNIT_BASES`), `libs/luna-shopper/carrefour/src/lib/price.ts` (`unitPriceLabel`),
> `libs/luna-shopper/carrefour/src/lib/listing.ts` (`MEASURE_BASE`, `readCard`),
> `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`readUnitPriceLabel`, `washedLabel`),
> `apps/luna-shopper-backend/harvester/src/app/harvest/size-check.ts` (`labelKey`), and the
> OpenAPI regeneration rules of `CLAUDE.md`.

## Brief for the agent

### Objective

Make `unitBasisOf` name a basis for the three labels Carrefour builds, `€/kg`, `€/l` and
`€/ud`, so that a Carrefour offer carries a `unitBasis`. Remove the keys `lv` and `lavado`
from `UNIT_BASIS_BY_LABEL`, so that no label names the basis `WASH`. Then remove the value
`WASH` from the contract and from every reader that section 2 lists, and regenerate the two
generated files. Change no stored value.

### Context

- `unitBasisOf` (`unit-basis.ts`, near lines 47 to 60) trims and lowercases a label and looks
  it up exactly in `UNIT_BASIS_BY_LABEL` (near lines 29 to 45). The table has no key with `€/`.
- **The wash keys.** The table maps `lv` and `lavado` to `'WASH'` (near lines 43 and 44). It
  does not map the plural `lavados`, which thus answers null today. The comment of the table
  (near lines 17 to 20) says that `lv` on liquid detergent sits on a price per litre.
- `'WASH'` is the last value of `UNIT_BASES` (`catalog.messages.ts`, near lines 1149 to 1157),
  and the type `UnitBasis` is read from that array. Section 2 lists every place that holds it.
- **A basis is never stored.** Every reader derives it on read from the verbatim label:
  `catalog.mappers.ts` (near lines 409, 453 and 478), `item.service.ts` (near line 4434) and
  `price-history.service.ts` (near line 131) in catalog, and `harvest.mappers.ts` (near line
  346) in the harvester. No entity, migration, Postgres enum type or check constraint names a
  unit basis or `WASH`. The stored labels `lv`, `lavado`, `lavados` and `€/lavado` stay
  verbatim, as plan `0157` requires.
- `unitPriceLabel` (`carrefour/src/lib/price.ts`, near line 54) answers `€/${unit}` for a
  card that states a `measure_unit`. `readCard` (`listing.ts`, near line 455) calls it.
  `MEASURE_BASE` (`listing.ts`, near lines 156 to 161) knows `l`, `kg`, `ud` and `m`.
- `labelKey` in `size-check.ts` (near lines 83 to 91) already removes a leading `€/` for its
  own table. Its comment near lines 42 to 44 says that a shared table would live in the
  contracts units module.
- What a null basis costs today:
  - velista draws no unit price line on a `PACK` offer with no basis
    (`libs/velista/ui/src/lib/catalog/product-row-view.ts`, near lines 311 to 322).
  - The back office prints the raw label, for example "1.23 / €/kg", because `unitPriceUnit`
    (`libs/luna-shopper-admin/models/src/lib/resource/money.ts`, near line 142) falls back
    to the label.
  - Ranking is not affected. Plan `0245` ranks on `comparablePrice`, which
    `catalog/src/app/catalog/comparable-price.sql.ts` computes from price and size and not
    from the label.
- `100gr` (El Jamón) stays null on purpose, by plan `0189`. `m` stays null by plan `0157`.
- The fixtures prove the figure is per `measure_unit` on the cards checked for this plan:
  - `Leche fermentada ... pack 6 unidades 100 g.`, 3,99 €, 6,65 € per `kg` (3.99 / 0.6).
  - `Aperitivo de patata ... Pringles 185 g.`, 2,95 €, 15,95 € per `kg`.
  - `Atún claro ... pack de 8 latas de 52 g.`, 6,59 €, 15,84 € per `kg` (6.59 / 0.416).
  - `Café cápsulas ... 10 ud.`, 4,15 €, 0,42 € per `ud`.
- **Who prints a wash label.** Production on 2026-11-05 held 1,645 priced rows with the label
  `lavados` or `lv` (plan `0245`, Context). Plan `0249` counted 227 Carrefour rows with
  `€/lavado`. The DIA leaflet prompt names `€/lavado` too
  (`libs/luna-shopper/tools/leaflet/chains/src/dia/prompt.txt`, near line 89).
- **Mercadona is mostly not affected.** Plan `0189` rule 3 (`washedLabel`, `normalize.ts` near
  lines 384 to 395 and 433) writes `L` or `kg` in place of `lv` when the figures prove that the
  stored figure is per litre or per kilo. A Mercadona row keeps `lv` only when both of its
  figures are the price of one wash, for example a pack of tablets (rule 1 of the same
  comment). Those rows lose their basis.
- **Old clients.** velista reads the basis with `oneOfOrNull(bestOffer['unitBasis'],
  PRICE_UNIT_BASES)` (`libs/velista/data-access/src/lib/mapping/catalog-browse-mappers.ts`,
  near line 74, and `mappers.ts`, near line 744). A value it does not know, and no value, read
  as null. The back office reads the basis as `unknown` and falls back to the label. No
  request body carries a basis. Section 3 states what this means for an installed client.

### Target state

1. `unitBasisOf('€/kg')` is `KILOGRAM`, `unitBasisOf('€/l')` is `LITER`,
   `unitBasisOf('€/ud')` is `UNIT`, and `unitBasisOf('€/m')` is null.
2. `unitBasisOf('lv')`, `unitBasisOf('lavado')` and `unitBasisOf('€/lavado')` are null. No
   label answers a wash.
3. Every other label answers what it answers today.
4. `UNIT_BASES` is `['KILOGRAM', 'LITER', 'UNIT', 'DOZEN']`. No file of the workspace that
   section 2 lists names the value `WASH`.
5. `openapi.json` and `wire-types.ts` are regenerated, and their six enums no longer list
   `WASH`.
6. No stored row changes. No migration and no release task is added.

### Scope

Every file of section 2 marked "change", the specs beside them, the fixture proof spec in
`libs/luna-shopper/carrefour`, and the two generated files, written only by their generators.
Nothing in the Carrefour adapter (D1). Not in scope: the Mercadona normalizer, the size words
of section 2.3 (D5), the leaflet tool's own `wash` token, and any stored label.

### Constraints

- The table names a basis only for a label whose figure is per that unit. Before you change
  the table, prove it with every `kg`, `l` and `ud` card of the Carrefour fixtures: price
  divided by the size the name prints must equal `price_per_unit` within one cent. If one
  fixture disagrees, stop and report it.
- `bulk_price`, `unitPrice` and `unitPriceLabel` stay verbatim. The fix is on read only.
- The reader removes a leading `€/` (with optional spaces around the slash) and nothing more.
  A label it does not know after that still answers null, never a guess.
- A wash is not a unit of measure (D2). No label maps to a basis for a wash, and no new wash key
  is added in any spelling.
- `unitBasisOf` stays browser reachable. It names no `process`.
- Never edit `openapi.json` or `wire-types.ts` by hand. Write them with
  `npx nx run luna-shopper-backend-gateway:openapi` and then
  `npx nx run luna-shopper-admin/models:wire-types`, and commit both. The only change the
  regeneration may make is the removal of `WASH` from the six enums of section 2.1. If it
  writes any other diff, stop and report it.
- Build in the order of section 4, so that no commit leaves the workspace red.
- Never edit an old migration. The comment in migration `1756100000000` stays as it is.

### Action boundaries

- Stop and ask before you change a stored label, add a migration or add a release task.
  Section 3 says why none is needed.
- Stop and ask before you change the Carrefour adapter or the Mercadona normalizer.
- Stop and ask before you change a size word of section 2.3 (D5).
- If a search of the branch finds a reader of `WASH` that section 2 does not name, add it to
  the PR's list. If its removal changes what a shopper sees, a stored row or an installed
  client, stop and report it.

### Progress evidence

The fixture proof of Constraints as a table in the PR, the list of section 2 with the lines on
the branch, the spec output, the diff of the two regenerations (six enum lines in each file and
nothing else), and one Carrefour product read through the catalog search on a Luna slot whose
catalog holds Carrefour rows, with its `unitBasis` quoted.

## 1. The change to the label table

1. In `unitBasisOf`, after trim and lowercase, remove a leading `€/`, then look the key up.
   The three Carrefour keys then reach `kg`, `l` and `ud`, which the table already maps. `€/m`
   reaches `m`, which stays null. No new key is added to `UNIT_BASIS_BY_LABEL`.
2. Remove the keys `lv` and `lavado` from `UNIT_BASIS_BY_LABEL`. Rewrite the comment of the
   table: it says that `lv` sits on a price per litre, and after this plan it says that a wash
   is no basis, with the reason of D2.

The effect of step 2:

- An offer whose label is `lv`, `lavado` or `€/lavado` gets no basis.
- velista draws no unit price line for such an offer, by the rule of Context. Today it draws
  "/ wash" or "/ lavado" there.
- The back office prints the raw label beside the figure, by the fallback of Context.
- Ranking is not affected, because plan `0245` compares by size and not by label.
- Mercadona is mostly not affected, because `washedLabel` already turns `lv` into `L` or `kg`
  when the figures prove it. Only rows whose figures are both per wash lose their basis.

## 2. Every place `WASH` lives

Found by a search of `origin/dev` on 2026-11-11 for `WASH`, `wash`, `lavado` and `lv`. "Change"
means this plan changes the place. "Stays" means it names a wash but not the value `WASH`, and
the reason is given.

### 2.1 The value and the wire

- Change: `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`, `UNIT_BASES`,
  near lines 1149 to 1157. Remove `'WASH'` and its comment (near lines 1154 and 1155). The type
  `UnitBasis` (near line 1157) follows. The four views that carry `unitBasis: UnitBasis | null`
  (near lines 1183, 1266, 1666 and 1804) and `harvest.messages.ts` (near line 1165) need no
  edit.
- Change: `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts`, the keys `lv` and
  `lavado`, near lines 43 and 44, and the comment near lines 17 to 20 (section 1).
- Follows by itself: `libs/luna-shopper/contracts/src/schemas/messages/catalog.schemas.ts`,
  `nullableUnitBasis` near lines 412 and 413, spreads `UNIT_BASES` into the enum used near lines
  563, 604, 880 and 975. `harvest.schemas.ts` spreads it near line 753. No edit.
- Change: `libs/luna-shopper/contracts/src/lib/units/comparable-price.ts`, the comment near line
  9 names "`DOZEN` and `WASH`". After this plan it names `DOZEN` only.
- Regenerated: `apps/luna-shopper-backend/gateway/docs/openapi.json` lists `WASH` in six enums,
  near lines 38711, 39462, 39744, 39839, 42204 and 46570. They are the `unitBasis` of
  `catalog.AdminSupermarketItemView`, `catalog.ItemOfferView`, `catalog.ItemPricePointView`,
  `catalog.ItemPriceView`, `catalog.SupermarketItemView` and `harvest.SourceEntryPriceView`.
- Regenerated: `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, six `unitBasis`
  unions near lines 2688, 2905, 2986, 3010, 3733 and 5283.
- The gateway: no file under `apps/luna-shopper-backend/gateway/src` names `WASH`. The
  gateway answers the contract views, so the enums reach the document through the contract
  schemas. The description of `unitPriceLabel` in `catalog.dto.ts` (near line 1160) says that
  `lv` means washing machine loads. That stays: it describes the label, and the label stays.

### 2.2 The clients

- Change: velista, `libs/velista/models/src/lib/catalog-browse.ts`. `PriceUnitBasis` (near line
  96) and `PRICE_UNIT_BASES` (near lines 98 to 104) lose `'WASH'`. The comment of
  `ComparableBasis` (near line 108) names "`DOZEN` or `WASH`" and names `DOZEN` only after
  this plan.
- Change: velista, the key `catalog.per.WASH` in `libs/velista/ui/assets/i18n/en.json` ("/
  wash", near line 486) and `es.json` ("/ lavado", near line 486). These two are the only
  locale files of `libs/velista/ui/assets/i18n`. `product-row-view.ts` builds the key as
  `catalog.per.${basis}` (near line 321), so no other code names it.
- Follows by itself: the velista mappers (`catalog-browse-mappers.ts` near line 74,
  `mappers.ts` near line 744) read through `PRICE_UNIT_BASES`. No edit.
- Change: the back office, `WASH: 'wash'` in `UNIT_BASIS_WORDS`
  (`libs/luna-shopper-admin/models/src/lib/resource/money.ts`, near line 126). The back office
  has no other wash string. Its many `wash` hits are the CSS colour token `--wash`, which is
  not this value.

### 2.3 Places that name a wash and stay

- `size-check.ts` of plan `0249`. It does not read the basis: its own table `LABEL_AMOUNTS` has
  no wash key, and `lv` and `€/lavado` answer no check there (comment near line 34).
- `washedLabel` of plan `0189` (`mercadona/src/lib/normalize.ts`, near lines 347 to 449). It
  does not read the basis: it writes the label `L` or `kg` in place of `lv` on the way in. The
  fixture `product-detergent-per-wash.json` holds the label `lv` verbatim.
- The leaflet tool. `build-document.mjs` (`libs/luna-shopper/tools/leaflet/cli/src`, near line
  68) reads a printed `LAVADO` into its own token `wash`, and `to-harvest-document.mjs` (near
  line 111) writes that token as the label when the tile printed no other text. It is a label,
  not the value `WASH`, and `unitBasisOf('wash')` already answers null. The prompts of DIA,
  DEZA and LIDL name `€/lavado` or `por lavado` as printed text.
- The harvest document schemas (`harvest-document.ts` near line 39,
  `harvest-document-2.schema.ts` near line 94) name `por lavado` as an example of label text.
- Comments on the label in `supermarket-item.entity.ts` (near line 74) and in migration
  `1756100000000-PriceScopesAndSourceProvenance.ts` (near line 155). They describe the label.
- **The size words.** A wash count is read as a count of units when it is a size:
  `lavado` and `lavados` map to `UNIT` in `PRINTED_SIZE_UNITS`
  (`libs/luna-shopper/contracts/src/lib/units/source-size.ts`, near lines 84 and 85), and to a
  unit in the size readers of Carrefour (`listing.ts`, near lines 77 and 78), DIA (`size.ts`,
  near line 76), El Jamón (`size.ts`, near line 70) and DEZA (`size.ts`, near lines 74 and 75).
  This is a size and not a unit basis, so this plan does not change it. D5 asks the owner.
- The curation tool. `rules.mjs` has its own `UNIT_BASES` (near line 284), a table of size units
  with no wash. No fixture and no seed of the workspace names the value `WASH`.

## 3. Stored data and installed clients

**No stored row holds a basis.** Section 2.1 and Context show that a basis is derived on read.
No Postgres enum type and no check constraint holds `WASH`, so no migration is needed. No row
that a harvest wrote changes, so the `CLAUDE.md` rule on rows that a person or a harvest wrote
(a release task, not a migration) does not apply. If a builder finds a stored basis that this
search did not, the rule applies in full: no row is deleted, the stored `WASH` becomes null,
and an update of rows that a harvest wrote goes in a release task, because it changes data and
not the schema. Stop and report it first.

**An installed client does not break.** After this plan the server never sends `WASH`. It
sends null where it sent `WASH` before. An installed velista, the web build or the Android app
at any version, maps null to "no unit price line" today. It also maps a value it does not know
to null (`oneOfOrNull`, Context). No request of any client carries a basis. `minClientVersion`
thus does not move.

**The NATS replies.** The contracts validator validates payloads in tests and, optionally, at
runtime in development (`libs/luna-shopper/contracts/src/schemas/validator.ts`, near lines 11
to 13). The clusters do not validate replies at runtime. During a rollout, an old catalog pod
can still send `WASH` to a new gateway for a short time. The gateway passes it through, and
every client reads it as it reads any value it does not know.

**The release title.** `CONTRIBUTING.md` (section "Breaking changes") asks for `!` when "a
deployed thing that used to work stops working". Nothing does: the response enum loses a value
that the server stops sending, every reader tolerates its absence, and no request accepts it.
The PR thus takes no `!`. Suggested title:
`fix(catalog): a Carrefour unit price names its basis, and a wash names none (plan 0264)`.
Check it with `node tools/release/release-notes.mjs --check` before you open the PR.

## 4. Build order

One PR, in commits in this order. Each commit is green on its own.

1. The label table (section 1) and `unit-basis.spec.ts`. The type still holds `WASH`, and
   nothing produces it.
2. The readers: velista's `PriceUnitBasis`, `PRICE_UNIT_BASES` and the two `catalog.per.WASH`
   keys, the back office's `UNIT_BASIS_WORDS`, and the two comments (`comparable-price.ts`,
   `catalog-browse.ts`). Each reader already tolerates a basis it does not know.
3. The value: `'WASH'` leaves `UNIT_BASES`. The schemas follow.
4. The regenerations: `npx nx run luna-shopper-backend-gateway:openapi`, then
   `npx nx run luna-shopper-admin/models:wire-types`. Commit both outputs.
5. `npx nx affected -t lint test`, and `npx nx build velista` and `npx nx build
   luna-shopper-admin`, because the PR checks build neither app.

## Tests

- `unit-basis.spec.ts`: a second table for the Carrefour labels, `€/kg`, `€/l`, `€/ud`,
  `€/m`, `€ / kg` and `€/KG`, each with its basis.
- `unit-basis.spec.ts`: the row `['lv', 72, 'WASH']` of the first table (near line 20) becomes
  `['lv', 72, null]`, and the row `['lavado', 'WASH']` of the second table (near line 36) moves
  to a test of labels that answer null. `lv` leaves the list of `only ever answers a basis the
  contract names` (near line 56). A new test: `lv`, `lavado`, `lavados`, `€/lavado` and `LV`
  all answer null.
- A label `€/` alone answers null.
- The Carrefour fixture proof as a spec in `libs/luna-shopper/carrefour`, so that a later
  capture that breaks it fails a test.
- A contracts spec: `UNIT_BASES` equals `['KILOGRAM', 'LITER', 'UNIT', 'DOZEN']`.
- velista: a mapper spec reads `unitBasis: 'WASH'` as null, so a reply from an old pod during a
  rollout draws no line.
- The back office: `unitPriceUnit('WASH', 'lv')` answers `lv`, the label.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass on the regenerated files.

## Acceptance criteria

- [ ] The three Carrefour labels name a basis, and `€/m` names none.
- [ ] No label answers a wash, and `UNIT_BASES` holds four values.
- [ ] Every other label of the existing table answers what it answered before.
- [ ] No file that section 2 marks "change" names `WASH`, and the PR lists section 2 with the
      lines on the branch.
- [ ] `openapi.json` and `wire-types.ts` are regenerated, and their only change is `WASH` out
      of six enums each.
- [ ] No stored row changes, and no migration or release task is added.
- [ ] The fixture proof passes for every `kg`, `l` and `ud` card.
- [ ] `npx nx build velista` and `npx nx build luna-shopper-admin` build.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-catalog -t "unitBasisOf"
npx nx test luna-shopper/carrefour
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-backend-gateway -t "openapi"
npx nx test luna-shopper-admin/models
npx nx build velista
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

Then one Carrefour product on a Luna slot, as Progress evidence says.

## Decisions

**D1 (owner, answered 2026-11-11):** the reader removes a leading `€/` (option a). Nothing
stored changes, and the adapter keeps writing `€/kg`, `€/l` and `€/ud`.

**D2 (owner, answered 2026-11-11):** `lavados` does not join the table. Further, a wash is not a
unit of measure for this app. A wash count is the brand's own claim, nobody can measure it, and
it is a bad basis to compare prices on. This plan thus also removes the existing keys `lv` and
`lavado` from `UNIT_BASIS_BY_LABEL`.

**D3 (owner, answered 2026-11-11):** later. One label table for `unit-basis.ts` and
`size-check.ts` is a plan of its own. The two tables answer different questions (a basis, and
an amount the figure is per), so only the key rule is shared.

**D4 (owner, answered 2026-11-11):** the value `WASH` is removed in this plan, not in a later
one, for the reasons of D2. Section 2 lists every place it lives, and section 4 orders the
work.

**D5. A wash count as a size. Open.** Section 2.3 shows that `lavado` and `lavados` are read as
a count of units when a chain prints them as a size, in the contracts and in the size readers
of Carrefour, DIA, El Jamón and DEZA. A detergent of "40 lavados" thus has 40 units, and its
`comparablePrice` (plan `0245`) is a price per wash under the word "per unit". That is the
comparison D2 calls a bad basis. A change there writes new sizes on the next harvest of each
chain, and it touches the size check of plan `0249` and the four framework free libraries.

- (a) A later plan decides whether a wash count is a size, and what a detergent compares in.
- (b) This plan stops reading `lavado` and `lavados` as a size.

Recommended: (a). It is a question about sizes and the comparable price, not about the unit
basis. It changes what a harvest writes in four libraries, each with its own fixtures, and it
deserves its own review. This plan leaves the size words as they are.
