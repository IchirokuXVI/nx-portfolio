# 0221: a reworded deza name is proposed as the same product

> DEZA prints no product id, so the harvester keys each DEZA product on its printed name and size.
> When DEZA rewords a name ("reducido de sal" becomes "reducido en sal", or two words swap places),
> the walk makes a new `UNRESOLVED` row and the old `ACTIVE` row stops being seen. Nothing proposes
> that the two rows are one product, and a person has to find the product again by hand. This plan
> gives rung 4 of the ladder a second key: the words of the name in any order, without "de" and
> "en", with the same size. A new row whose second key finds exactly one bound product is queued as
> a `CANDIDATE` for that product. Only a person's accept binds it (plan 0081). A waiting row is asked
> again on each walk, so the renames already in the queue are proposed on the first walk after the
> deploy. The plan tested a first design (pair the keys a walk did not see with the new keys it did
> see, in the sections it finished, with equal shop sets) against the code and against a real walk.
> That design drops 13 of 14 real renames, and section 2 says why.
>
> Prerequisite reading: plans `0081` section 2.1 (a printed name is never bound by a match),
> `0085` section 6 (the identity is the description), `0086` decisions D2 and D8 and section 4 (the
> one ladder), `0155` (rung 4 keys on the unit size too), `0182` (two rows of one product, newest
> claims win), and the sibling plan `0220` (a product a chain stopped listing). Code:
> `harvest/matching.ts`, `harvest/source-ingest.ts` (`create`, `touch`), `harvest/deza-catalog.runner.ts`,
> `harvest/source-entry.service.ts` (`accept`), `harvest/source-entry-availability.ts`, and the
> admin queue in `libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts`.

## Brief for the agent

### Objective

Add an order insensitive second key to rung 4 of the source ingest ladder, for rows whose identity
is their printed name. A new or waiting row whose second key finds exactly one bound product of its
chain becomes a `CANDIDATE` for that product with `matchedBy: NAME_WORDS_SIZE`. Add that enum value,
count the proposals in the run report, and correct the comment in `matching.ts` that claims rung 4
already does this. Sections 3 to 10 are the design.

### Context

- `normalizeName` lowercases, strips accents and turns each run of other characters into one space
  (`apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts:44`). `entryNameKey` is the
  normalized name, a pipe, the normalized size text (:64). `entryKey` is its SHA1 and is the
  `externalId` of a product with no id of its own (:78). `siblingKey` adds the unit size (:198).
- `SiblingEntryIndex` holds every row of the chain under `siblingKey` (:225). `match` drops
  `REJECTED` rows, proposes the item when the `ACTIVE` rows of the bucket name exactly one item,
  proposes nothing when they name two or more, and proposes a lone sibling with no item through
  `entryId` (:255 to :281).
- `SourceIngest.create` runs rung 2 and 3 (`ItemMatchIndex.match`) and then rung 4 (`source-ingest.ts:1228`
  to :1243). Rung 4 writes `status: CANDIDATE`, `matchedBy: NAME_SIZE`, `confidence: FUZZY_CONFIDENCE`
  (0.6), and `itemId` or `candidateEntryId`.
- `SourceIngest.touch` (:1123) re-derives nothing for a waiting row except the EAN rung
  (`bindWaitingByEan`, :1590). `undecided` (:1552) is `decidedAt IS NULL` and status `UNRESOLVED` or
  `CANDIDATE`.
- `SourceIngestSession` loads every row of the chain once and builds the sibling index from them
  (:1712). Rows the run creates are added to it.
- The DEZA runner keys each product with `entryKey(row.name, row.sizeFormat)`
  (`deza-catalog.runner.ts:398`). El Jamón keys on its article code (`eljamon-catalog.runner.ts:147`).
  A file import keys on `external_id`, or on `entryKey` when the file gives none
  (`file-import.runner.ts:218`).
- `source_catalog_entries` is unique on (`supermarketId`, `externalId`)
  (`entities/source-catalog-entry.entity.ts:40`). A decision never rewrites the source's fields (D8,
  :28 to :32). `source_aliases` no longer exists (:18). It became this table in plan 0086.
- `SourceEntryService.accept` binds a row to a product and writes its prices and claims
  (`source-entry.service.ts:488`). It touches no other row.
- A claim is sent only for a row that is `ACTIVE` with an item (`BOUND`,
  `source-entry-availability.ts:143`). Over two rows bound to one product, only the newest run that
  spoke about the product at a shop counts (:62 to :75).
- The admin queue renders a row with an `itemId` as an item proposal (`proposalOf`,
  `libs/luna-shopper-admin/feature-harvest/src/lib/entry-view.ts:188`). It shows a reason chip only
  for a `matchedBy` its own enum knows (`libs/luna-shopper-admin/models/src/lib/harvest/source-enums.ts:102`
  and :121). `SHARED_EAN` is not in that enum today, so such rows already render with no chip.
- `ItemSourceMatch` is in `libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts:203`. Its
  Postgres type is `item_source_match`. `1757600000000-SharedEan.ts` is the last migration that added
  a value. The latest harvester migration is `1759400000000-HarvestSchedules.ts`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and
`wire-types.ts` are regenerated.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts`, `source-ingest.ts`,
    `run-report.sink.ts`, `run-executor.service.ts` (the report key only), and their specs.
  - `apps/luna-shopper-backend/harvester/src/app/db/migrations/` (one new migration and `index.ts`).
  - `libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts` (one enum value).
  - The two generated files, through their generators.
- Do NOT touch: the DEZA library, the DEZA runner's crawl, `entryKey`, `entryNameKey`, `siblingKey`,
  `source-entry.service.ts`, `source-entry-availability.ts`, the gateway code, and
  `apps/luna-shopper-admin` or `libs/luna-shopper-admin` (section 9 names the admin follow up).

### Constraints

- `entryKey`, `entryNameKey` and `siblingKey` keep their output byte for byte. They are row
  identities and keys in production.
- The new key is used only when **both** rows are keyed on their own text (section 3.2).
- A proposal by the new key never makes a row `ACTIVE`, never writes a price, and never sends a claim.
- The exact key is asked first. The new key is asked only when the exact key proposes nothing.
- The stop words are exactly `de` and `en`. Repeated words are kept (section 3.1).
- The migration is additive and its `down` restores the type without the value, as
  `1757600000000-SharedEan.ts` does. Take the next free harvester migration timestamp on `dev`
  at build time. Plans `0215` to `0220` each add one, so do not assume that `1759500000000` is
  free.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you add a stop word, drop the repeated word rule, or widen the new key to rows
  that carry a product id.
- Stop and ask before you change what `accept` or `reject` does.
- Stop and ask if plan 0217 has changed `SourceIngestCounters` on `dev` in a way that leaves no clear
  place for the new count.
- Do not run the migration anywhere but a throwaway slot.

### Progress evidence

Report after each of these, with the spec output:

1. `wordOrderKey`, `isNameKeyed` and the second map of `SiblingEntryIndex`, with their specs.
2. The ladder in `create` and the second ask in `touch`, with the `source-ingest.spec.ts` cases.
3. The enum value, the migration and its integration spec on real Postgres.
4. The report count, and both generators run.

## 1. What happens today

A DEZA row has no product id, no EAN, no image and no product URL. Its `externalId` is
`entryKey(name, sizeFormat)` (`deza-catalog.runner.ts:398`), so its printed name is its identity.
A reworded name is a new key, a new row, and a new `UNRESOLVED` entry in the queue. The old row
stays `ACTIVE`, bound to its product, and no walk sees it again.

Rung 4 is the rung that proposes a sibling row of the same chain, and it keys on the exact
normalized name (`siblingKey`, `matching.ts:198`). A reworded name is a different key, so rung 4
proposes nothing. Two comments say otherwise and are wrong: `matching.ts:72` to :76 ("which rung 4
then proposes a match for") and plan 0085 section 6 ("the fuzzy rung proposes the match").

**Measured on a real walk.** The slot 1 backup of 2026-10-16
(`D:/Projects/luna-slot1-backups-20261016/after-deza/harvester.dump`) holds DEZA run `e8c1c92b`, a
`CATALOG_DISCOVERY` that saw 14,357 products and created 578 rows. Of the chain's `OFFICIAL_WEB`
rows, 521 are `ACTIVE` and were not seen by that run. Fourteen of them have a new row from that run
whose words are the same in another order, after "de" and "en" are dropped, with the same size:

| Old row (`ACTIVE`, not seen)                                      | New row (`UNRESOLVED`)                                            | Size  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----- |
| Jamón cocido lonchas finas ELPOZO bienstar reducido **de** sal     | Jamón cocido lonchas finas ELPOZO bienstar reducido **en** sal     | 65 g  |
| Queso mezcla SAN VICENTE semicurado kg                            | Queso mezcla semicurado SAN VICENTE kg                            |       |
| Chorizo ibérico de bellota ESENCIA ÚNICA Covap                    | Chorizo de bellota ibérico ESENCIA ÚNICA Covap                    | 60 g  |
| Torreznos de Soria MORENO SAEZ dados                              | Torreznos de Soria en dados MORENO SAEZ                           | 200 g |
| Queso fundido lonchas EL CASERIO 8 ud                             | Queso fundido en lonchas EL CASERIO 8 ud                          | 150 g |
| Queso bola Edam ROYAL CROWN tierno cuña                           | Queso bola Edam tierno ROYAL CROWN cuña                           | 310 g |
| Chorizo ibérico de bellota ESENCIA ÚNICA Covap pieza 600 g aprox/ | Chorizo de bellota ibérico ESENCIA ÚNICA Covap pieza 600 g aprox  |       |

The other seven are the same shapes (four more Covap cured meats, one ELPOZO turkey, one Covap
ham, one Covap morcón). The trailing `/` in the last row is punctuation, which `normalizeName`
already drops. The note of 2026-10-16 counted 23 pairs by eye. The near pairs left over in the
backup change a word ("con" for "en", "semi" for "semicurado", "pastilla" added) or the size text,
and this plan does not propose them (section 3.1).

**With the fixtures.** The first row of `libs/luna-shopper/deza/src/lib/__fixtures__/landing-page.html`
is "Vino blanco DON SIMON brik 1 L", which the adapter splits into the name
"Vino blanco DON SIMON brik", the size "1 L" and the unit size 1 (`size.spec.ts:10` and :113). Its
`entryNameKey` is `vino blanco don simon brik|1 l`. If DEZA printed "Vino DON SIMON blanco brik 1 L",
the walk would write a second row under another key. Both names give the word order key of
section 3.1, `blanco brik don simon vino|1 l|1`.

## 2. The first design, tested

The first design paired, at the end of a walk, the `ACTIVE` keys of the chain the walk did **not**
see with the new `UNRESOLVED` keys it **did** see. It required four things to agree: the section,
the printed size, the shop set, and the words of the name after order and stop words are ignored.
It limited pairing to the sections the walk finished, read from `harvest_runs.report`.

Each condition, tested against the code and the walk of section 1:

1. **"Finished sections" covers almost none of the renames.** `incompleteSections` names each
   section in which any query came back at the 300 row ceiling (`deza-catalog.runner.ts:236` pushes
   to `capped`, and `finish` at :357 records the section when `capped` is not empty). A capped query
   stays in `capped` after the narrowing covers it, so a big section is always named, even when the
   narrowing finished it. Run `e8c1c92b` names 30 sections. "Charcuteria envasada" is one of them,
   and 13 of the 14 renames are in it. A gate on finished sections keeps 1 of 14.
2. **"Not seen" is weak evidence, and the pair does not need it.** 429 of the 521 unseen `ACTIVE`
   rows are in a section the report names, so most of them were missed by the ceiling and not
   renamed. But a pair whose words agree is one product whether or not the old row was seen. If both
   rows are still listed, DEZA lists one product twice, and the right answer is the same: bind both
   rows to the product. Plan 0182 already reads two bound rows of one product correctly
   (`source-entry-availability.ts:62` to :75).
3. **Equal shop sets drop real renames.** The old row's newest claims are from the walk of
   2026-10-06. Twelve of the 14 pairs have equal shop sets. The other two differ by one shop that
   started carrying the product in those ten days. A gate on equal shop sets keeps 12 of 14.
4. **The words carry the evidence.** Over all 14,357 rows the walk saw, the word order key of
   section 3.1 puts two rows in one bucket once, and never two rows that a person bound to different
   products. Section 3.1 shows the keys that do collide.

So the design keeps condition 4 and the size, drops the other three as gates, and moves the match
from the end of the walk into the ladder, where rung 4 already proposes siblings. The ladder needs
no completeness, no second pass and no new table, and it also serves a DEZA leaflet row that prints
the words of a web row in another order.

## 3. Rung 4 gets a second key

### 3.1 The key

```text
wordOrderKey(name, sizeFormat, unitSize) =
  words(normalizeName(name)) without "de" and "en", sorted, joined by one space
  + "|" + normalizeName(sizeFormat ?? "")
  + "|" + the unit size as siblingKey writes it
```

The size half is exactly the size half of `siblingKey` (`matching.ts:203` to :207), so the new key
is never looser on size than the exact key.

**Repeated words are kept.** A key that treats the name as a set joins "Refresco zero COCA COLA"
and "Refresco zero zero COCA COLA". DEZA lists both, in seven sizes, and a person bound each to a
different product, because "zero zero" is the caffeine free drink. With repeats kept, the seven
pairs stay apart.

**The stop words are "de" and "en" and no more.** Adding "con" joins "Yogur griego ALTEZA fresa" and
"Yogur griego ALTEZA con fresa", which a person bound to two products, and the same for a REINA
yogurt. Measured over the walk of section 1:

| Key                                    | Renames proposed | Live rows of two bound products in one bucket |
| -------------------------------------- | ---------------- | --------------------------------------------- |
| any order, without "de", "en"          | 14               | 0                                             |
| any order, as a set, without "de", "en" | 15              | 9 (seven Coca Cola sizes, an ALTEZA cola, an artificial rose) |
| any order, without "de", "en", "con"   | 16               | 2 (the two yogurts)                           |

### 3.2 Only between rows that are keyed on their own text

`isNameKeyed(row)` is true when `row.externalId === entryKey(row.name, row.sizeFormat)`. A chain
id never equals a SHA1 of a name, so the test is exact. The new key is asked only when the new row
is name keyed **and** the sibling is name keyed. The session builds the second map of the index from
name keyed rows only.

The reason is El Jamón. Its names carry no brand, and its rows are keyed on an article code. In the
same backup, the new key would join 20 pairs of El Jamón rows that the exact key keeps apart, and in
17 of them a person bound the two rows to **different** products ("chorizo pavo" and "chorizo de
pavo", "atún en aceite girasol" and "atún aceite girasol"). Those are two brands of one kind of food,
not one product. A chain with an id does not need the key anyway: a reworded name keeps its id, and
rung 1 finds the row. Mercadona and LIDL show no pair the new key adds.

So the rule covers the DEZA walk and every file import row that has no `external_id`, of any chain,
when it meets another such row of its chain.

### 3.3 The rule of a bucket

`SiblingEntryIndex.matchAnyOrder(name, sizeFormat, unitSize, self)` reads the bucket of the second
map, drops `REJECTED` rows and the row `self` (the row being asked, on a touch), and answers:

| The `ACTIVE` rows of the bucket name | Answer                     |
| ------------------------------------ | -------------------------- |
| exactly one product                  | that product               |
| two or more products                 | nothing                    |
| no product                           | nothing                    |

This is the rule of the exact key (`matching.ts:267` to :277) with one difference: the new key never
proposes a lone sibling with no item through `candidateEntryId`. Two waiting rows whose words agree
are almost always the listing repeating one product inside one walk, and a sibling proposal there
would send the person in a circle between two rows nobody has decided.

### 3.4 The place in the ladder

In `create`, after rungs 2 and 3 answer nothing:

1. The exact key of rung 4, as today.
2. When it answers nothing, and the new row is name keyed, the new key.

The new row then holds `status: CANDIDATE`, `itemId` (the proposed product), `candidateEntryId:
null`, `matchedBy: NAME_WORDS_SIZE`, `confidence: FUZZY_CONFIDENCE`, and `decidedAt: null`. The
outcome reports rung 4.

### 3.5 A waiting row is asked again

In `touch`, after `bindWaitingByEan` answers false, a row is asked the new key when all of these
hold: `undecided(row)`, `status` is `UNRESOLVED`, `itemId` and `candidateEntryId` are null, and the
row is name keyed. A hit writes the fields of section 3.4 onto the row.

This is what reaches the renames already in the queue: the rows of the walks of 2026-10-06 and
2026-10-16, and every row that waited while its old twin was still `UNRESOLVED` and was accepted
later. It needs no backfill route and no script: the first walk after the deploy asks each of them.

A `CANDIDATE` row is not asked again. It already proposes something, and a person may be reading
that proposal. The exact key is not asked again on a touch either. That would change a rule this
plan has no evidence about.

A row that moves from `UNRESOLVED` to `CANDIDATE` during a walk can meet a bulk decision made on the
old status. The bulk route refuses it with its existing message
(`source-entry-batch.service.ts:495`), as it does today for a row the EAN rung binds during a walk.

### 3.6 What a proposal writes

Nothing that a shopper reads. The row is `CANDIDATE`, so it holds no price that reaches catalog and
no claim is sent (`BOUND`, `source-entry-availability.ts:143`). Its claims wait in
`source_entry_availability` as "waiting for a binding", as every waiting row's do, and are sent when
a person accepts the row.

## 4. A person accepts the proposal

The existing `accept` route does the whole job, and this plan changes nothing in it.

- The new row becomes `ACTIVE` on the proposed product. Its `name` stays what DEZA printed (D8).
- **The old row is left as it is**, `ACTIVE` on the same product. It is the second key of the
  product. If DEZA reverts the wording, the next walk finds the old row through rung 1 and nothing is
  queued.
- No key is rebound. `externalId` is the hash of the printed text and the unique index
  (`supermarketId`, `externalId`) forbids two rows under one key. Rewriting the old row's key to the
  new text would collide with the new row and would break D8.
- The new row's stored claims are sent at once (`writeForEntries`). Over the two rows, the claims of
  the newest run win at each shop (`source-entry-availability.ts:70` to :75), so the old row's last
  claims stop counting the moment the new row's claims exist.
- DEZA states no price, so no price is written and plan 0191 has nothing to withhold.

A person who rejects the proposal uses the existing `reject`. The new row becomes `REJECTED` and
the old row is untouched. That is a statement that the new text is not a product the owner tracks,
which is what a reject means for every row.

A person who decides the new row is a different product uses the existing `createItem`, which binds
the row to a new product. The old row is untouched.

## 5. Ambiguous pairs

| Case                                                            | What happens                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| One old row, two new rows with the same words in two orders      | Both new rows propose the old row's product. A person accepts both, or rejects one. Two bound rows of one product are fine (plan 0182). |
| Two old rows on one product, one new row                        | One product in the bucket. The new row proposes it.                                                                       |
| Two old rows on two products, one new row                       | Two products in the bucket. Nothing is proposed. The row waits as `UNRESOLVED`.                                            |
| The old row is `REJECTED`                                       | It is dropped from the bucket. Nothing is proposed, because a run does not reopen a decision (`matching.ts:221` to :223). |
| The old row is still `UNRESOLVED` or `CANDIDATE`                | No product in the bucket. Nothing is proposed. When a person accepts the old row, the next walk asks the new row again (section 3.5). |
| The old row is still listed                                     | The same as a rename. Both rows end on one product.                                                                        |

## 6. Completeness is not read

This plan reads neither `incompleteSections` nor which keys a walk did not see. Section 2 gives the
measurements. A proposal is a question for a person, and the words of the two names are the
evidence for it. The ceiling decides only whether a row was seen, and a seen row and an unseen row
get the same answer.

## 7. Plan 0220, a product a chain stopped listing

Plan 0220 marks a product as gone when whole walks of a chain stop listing it. A rename looks
exactly like that from the old row: it is not seen again. Plan 0220 section 10 settles the
conflict: it counts nothing for `deza-web` and nothing for a file import, the only sources whose
rows this plan's key reaches (section 3.2). No name keyed row is ever gone under plan 0220, so the
two plans share no code and either can be built first.

This plan does not read `delistedAt` or `source_entry_scope_presence`. If a later plan makes a name
keyed source countable for plan 0220, that plan states how a rename and a `CANDIDATE` proposal hold
the product back from being gone. Plan 0220 already judges gone per product at a scope: a second
`ACTIVE` row of the product that the walk listed keeps it sold (plan 0220 section 6.2).

## 8. Other sources without an EAN

| Source                             | Identity                       | Helped by this plan                                                         |
| ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| DEZA walk                          | `entryKey` of the printed text | Yes. This is the case it is for.                                            |
| A file import with no `external_id` | `entryKey` of the printed text | Yes, between two name keyed rows of one chain, such as a DEZA leaflet and the DEZA web row. |
| El Jamón walk                      | its article code               | No. A rename keeps the code. Section 3.2 shows why the key must not reach it. |
| Mercadona, LIDL, DIA, Carrefour    | the chain's product id          | No. A rename keeps the id.                                                  |

## 9. The admin queue

**No new screen is needed for the backend to be useful.** The queue renders a row with an `itemId`
as an item proposal and shows the proposed product, with its accept action
(`entry-view.ts:188`, `entries-queue-page.ts:343` to :371). A `NAME_WORDS_SIZE` row renders that way
on the day this plan ships.

Two gaps stay, and both are the admin app's:

- The reason chip is drawn only for a `matchedBy` that `SourceEntryMatch` lists
  (`source-enums.ts:102`). A new value reads as `null` and the chip is left out, as it is for
  `SHARED_EAN` today. The product page's source list reads an unknown value as "no match"
  (`libs/luna-shopper-admin/feature-catalog/src/lib/item-source-entries.ts:80` to :85).
- The queue does not show the old printed name beside the proposal. A person sees "this row is
  product X" and not "this row is the reworded 'Y'".

Follow up, an admin plan: add `NAME_WORDS_SIZE` and `SHARED_EAN` to `SourceEntryMatch` with a reason
string each. That is a value and two strings in an existing chip, and the owner decides whether it
needs a mock. Showing the old printed name is a new element on the proposal panel and needs a mock
first.

## 10. The enum, the migration and the report

- `ItemSourceMatch.NAME_WORDS_SIZE`, documented as "the words of the name in any order, without 'de'
  and 'en', and the size. Produces a CANDIDATE, never an ACTIVE."
- A migration adds the value to `item_source_match` with `ALTER TYPE ... ADD VALUE`. The migration
  does not use the value, so no second step is needed. Its `down` follows
  `1757600000000-SharedEan.ts`: it moves any row with the value back to `NAME_SIZE`, and rebuilds the
  type without the value.
- The run report gains `wordOrderProposals`: how many rows this run proposed by the new key, on
  create and on touch together. It is counted by the session and written beside the other ingest
  keys of the report (`run-executor.service.ts:715` to :750). An owner who reads one DEZA run then
  sees how many renames waited for him.
- `openapi.json` and `wire-types.ts` change only by the new enum value. Regenerate both.

## 11. The comments that are wrong today

The builder corrects `matching.ts:72` to :76 to say that rung 4 proposes a reworded name only when
its words agree in another order (this plan), and that any other rewording waits for a person. Plan
0085 section 6 is a plan file, and the builder does not edit it.

## 12. What this plan does not do

- **No rename that changes a word.** "en" for "con", "semi" for "semicurado", a word added or
  dropped. The walk of section 1 holds several of those. A looser match needs a measure of its
  false proposals first, and plan 0081's rule stays: nothing is bound without a person.
- **No rename that changes the size text.** A size is part of every key on purpose (plan 0155).
- **No automatic decision of any kind.** Not an accept, not a reject of a rename of a rejected row.
- **No change to the old row.** It is not marked, retired or deleted after an accept.
- **No change to the DEZA crawl** and no change to what `incompleteSections` means.
- **No admin screen.** Section 9 names the follow up.
- **No gone marking.** That is plan 0220. Section 7 says why the two plans do not meet.

## Tests

- **`matching.spec.ts`**:
  - `wordOrderKey` gives one key for the pairs of section 1, including the "de" for "en" pair and
    the trailing `/` pair.
  - It keeps "zero" and "zero zero" apart, keeps "fresa" and "con fresa" apart, and keeps two sizes
    of one name apart.
  - `isNameKeyed` is true for a row keyed by `entryKey` and false for a row keyed by an article code.
  - `matchAnyOrder` proposes the one product of a bucket, proposes nothing for two products, drops a
    `REJECTED` row, drops `self`, ignores rows that are not name keyed, and never answers an
    `entryId`.
  - The Don Simon row of `landing-page.html`, read through the DEZA parser, and the same name with
    two words swapped give one word order key and two different `entryKey` values.
- **`source-ingest.spec.ts`**:
  - A new name keyed row whose words match one `ACTIVE` row becomes `CANDIDATE` with that item,
    `matchedBy: NAME_WORDS_SIZE`, confidence 0.6, and no price reaches catalog.
  - The exact key wins when both keys could answer.
  - A new row keyed by an article code is not asked the new key.
  - A touched `UNRESOLVED` row with no proposal is asked the new key and is proposed. A touched
    `CANDIDATE` row and a `REJECTED` row are not changed.
  - Two new rows of one walk with the same words both propose the old product.
  - `wordOrderProposals` counts creates and touches.
- **Integration, on real Postgres**: the migration adds the value, a row can be saved with it, and
  `down` moves it back to `NAME_SIZE` and removes the value.
- **Gateway**: `openapi-document.spec.ts` passes after regeneration. `wire-types.spec.ts` passes after
  regeneration.

## Acceptance criteria

- [ ] A name keyed row whose words, in any order and without "de" and "en", and size match exactly
      one bound product of its chain is queued as `CANDIDATE` for that product.
- [ ] Such a row is never `ACTIVE` until a person accepts it, and no claim or price of it reaches
      catalog before that.
- [ ] A row keyed by a chain id or an article code is never matched by the new key, as either side.
- [ ] Two bound products under one new key propose nothing.
- [ ] The exact key of rung 4 is asked first and answers as before.
- [ ] An `UNRESOLVED` row with no proposal is asked the new key each time a walk touches it.
- [ ] `entryKey`, `entryNameKey` and `siblingKey` answer the same as before for every input.
- [ ] Accepting a proposal leaves the old row `ACTIVE` on the same product.
- [ ] `ItemSourceMatch.NAME_WORDS_SIZE` exists in the contract and in `item_source_match`.
- [ ] The run report carries `wordOrderProposals`.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-backend-gateway
npx nx test luna-shopper-admin/models
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line does. The integration target needs a throwaway
ephemeral slot (`luna-slot.sh --ephemeral --up <n>`) and `LUNA_INTEGRATION` set.

**A walk on a slot.** On a slot that holds a DEZA catalog with renames in the queue, such as a copy
of the 2026-10-16 backup, run one DEZA `CATALOG_DISCOVERY`. Then:

```sql
SELECT count(*) FROM source_catalog_entries
 WHERE "matchedBy" = 'NAME_WORDS_SIZE' AND status = 'CANDIDATE';
```

The count equals `wordOrderProposals` in the run report, and it is at least 14 on that backup.

## Decisions

Chosen in this plan, and open to the owner's correction:

- **The match lives in rung 4 of the ladder, not in a pass at the end of the walk** (section 2).
  It proposes the same pairs with no completeness rule, and it also serves leaflets.
- **No gate on finished sections, on "not seen", or on equal shop sets** (section 2). Measured, they
  keep 1, 14 and 12 of 14 real renames, and the words alone gave no wrong pair.
- **The stop words are "de" and "en", and repeated words count** (section 3.1). Both rules are what
  the walk of 2026-10-16 supports.
- **Both rows must be keyed on their own text** (section 3.2), because of the El Jamón evidence.
- **No sibling proposal through `candidateEntryId` on the new key** (section 3.3).
- **A waiting row is asked again, and only an `UNRESOLVED` one with no proposal** (section 3.5).
- **The old row stays `ACTIVE` after an accept**, as the product's second key (section 4).
- **A new `matchedBy` value**, not `NAME_SIZE` again, so the queue and the report can tell the two
  apart and a later admin label can name it.

**Owner**, to ask and not to choose:

1. Does the reason chip for the new value (and for `SHARED_EAN`) need a mock before its admin plan,
   or is a new string in the existing chip enough?
2. Is the old printed name beside the proposal wanted? It is a new element on the proposal panel and
   needs a mock.
3. A reworded name of a product the owner **rejected** arrives as a new `UNRESOLVED` row and is
   proposed nothing. Is that right, or should the queue point at the rejection? Rejecting it
   automatically is not offered, because a run does not make decisions.
4. The rest of the 23 renames of 2026-10-16 change a word or the size, and this plan leaves them
   to a person. Is a looser match wanted later, with its false proposals measured first?
