# 0067 — A normalized catalog, built from real receipts

## 1. What this is for

Three things at once, from one dataset:

1. **Normalization.** Fourteen till receipts from three Córdoba supermarkets name
   244 distinct products, and none of them name them usefully. `GARBANZA FRASC`,
   `+PROT NATILLA VAINI` and `Atún claro aceite de oliva ALTEZA v` are a till's
   abbreviation, a brand's marketing and a truncation respectively; none is a
   thing you can put on a shopping list or search for. This plan gives every one
   of them a friendly name and a group.
2. **Test data that is always there.** A developer starting a stack, and staging
   after a deploy, get a catalog with real products in it rather than the two
   item demo world.
3. **The start of the production catalog.** The same rows, behind a switch that
   is off until someone turns it on.

The receipts are four Mercadona invoices (PDF, with a text layer), four El Jamón
tickets and six SuperCash tickets (photographs). Every one of the fourteen was
transcribed and then **reconciled against the total the till printed**, which is
not ceremony: it caught a line read as `1 × 0,78` that was `4 × 0,78`, and the
€2,34 that went missing was the only sign.

## 2. The shape: a group is a thing you would write on a list

The schema already has the concept this needs. `ProductGroup` is "Milk as a thing
you can buy" — the statement that every brand of it is the same purchase. So the
friendly name is a group, and the normalization is the assignment of products to
groups.

The grain is the whole design decision, and it is stated in `groups.ts`: a group
is what you would write on a shopping list. Coarser stops being a purchase —
"dairy" is an aisle and nobody writes it down. Finer makes every product its own
group, which is the un-normalized catalog with better spelling. `Chorizo` and
`Salchichón` are two groups because you would say which you meant; every brand
and size of chorizo is one.

162 groups came out of it. Two that the obvious taxonomy demanded turned out to
have no members and were deleted rather than kept: there is no plain `custard`,
because the only natillas anyone bought is the +Proteínas one, and no `nougat`,
because both times a receipt says `TURRÓN` it is turrón **ice cream**. A group
with no members describes a catalog nothing here holds, and the spec fails on
one.

## 3. Mercadona: assignment, not creation

109 of the 117 Mercadona products already exist, because a discovery run
harvested 4,196 of them. The seed does not create these and does not price them.
It sets `productGroupId`, which is the one thing a harvest cannot work out for
itself.

**Keyed on EAN, never on the item's uuid.** The uuids belong to whichever
database ran the discovery, so a mapping written against one developer's catalog
matches nothing in another's and nothing at all in staging. The barcode is what
the entity itself calls "the only identifier that joins a product across chains",
all 109 have one, and it survives a re-harvest. Proved against a copy of a real
harvest: 108 assignments, 108 matched, none missed.

**The prices are deliberately not written.** A harvested row already carries an
`OFFICIAL_WEB` price fresher than an August receipt, and `supermarket_items`
holds exactly one row per item per scope. Writing the receipt price would not add
an observation, it would destroy the better one. This is the schema deciding, not
a preference: there is nowhere to put a second price, so the better one stays.

How the matching was done, since the file cannot show it: each till abbreviation
was scored against all 4,196 harvested names by token overlap, and the receipt's
own price had to agree before a match was accepted. 100 of 109 agree to the cent.
The nine that do not are weighed products, where the receipt's figure is per
kilogram and the catalog's `price` is for one fish; they agree against
`unitPrice`. That is what resolved the fish counter, where the names are useless
and the €/kg is exact: `TRUCHA ARCO IRIS` at 7,95 is _Trucha abierta en libro con
cabeza_ at 7,95.

Eight Mercadona products matched nothing and are authored instead. Five are a
variant the snapshot holds under another flavour, which is ordinary staleness.
`CABALLA ESTORNINO` is the other kind: the website sells four tinned mackerels
and no fresh one, because the fish counter is not something a website sells.

## 4. El Jamón and SuperCash: creation, with names

Neither chain has a storefront a harvester can read, so every product is authored
and every price came off a receipt as `USER_RECEIPT`. Both get one `STORE` scope
with one location, which is exactly the case the scope entity describes for "a
chain with no obtainable data".

135 items in total (8 + 19 + 108). The normalization is the point: `GARBANZA
FRASC` becomes Chickpeas in a Jar, `BOCADIT.CODAN` becomes Filled Mini Buns. A
spec asserts no item kept the till's own shouty string as its name.

**Four lines are not products, and are kept anyway.** El Jamón prints
`CARNICERIA`, `CHARCUTERIA` and `PANADERIA`, and SuperCash prints `Fruteria
CASH2`: the counter rang the sale up and what was bought is recorded nowhere on
the ticket. They get a group that says so. Inventing a cut of meat would store a
guess as a fact, and dropping them would make a basket silently short of €5,97.

## 5. Ids are derived, not written

139 groups, 135 items, two chains and their scopes and locations is far past the
size where hand-written uuid constants are checkable. Every id is `uuidv5(kind +
slug, fixed namespace)`, which makes the seed idempotent by primary key with no
lookup table: `groupId('milk')` is the same uuid in every database, this week and
next.

The namespace is fixed forever. Changing it renames every row, which to a
database is 274 deletions and 274 insertions, and any shopping line pointing at
an old id would point at nothing.

## 6. Running it

The seeder never deletes. That is the one way it differs from the demo world
seeder, which owns its whole graph and clears it: this one lives in a database
that may also hold 4,196 harvested products and every list built on them.

It degrades in three independent pieces. Groups always land. El Jamón and
SuperCash always land. The Mercadona assignment matches whatever is there and
reports what is not, so a developer who has never run a discovery still gets the
groups and both receipt chains.

**It refuses to overwrite a price whose source is `ADMIN`.** Plan 0038 section
6.5 is the rule, and it bites harder here than anywhere: this runs on every boot,
so without the check one hand correction would survive exactly until the next
restart.

| Where      | How                                                         |
| ---------- | ----------------------------------------------------------- |
| By hand    | `nx run luna-shopper-backend-catalog:seed:reference`        |
| Dev stack  | `stack.sh up`, after the migrations, so `luna-slot.sh --up` |
| Staging    | Helm hook Job, `referenceSeed.enabled: true`                |
| Production | the same Job, off until someone turns it on                 |

The staging and production difference is deliberate. A `pre-upgrade` hook runs on
every deploy, and a job that rewrites 274 rows each time a micro-frontend ships is
not something to inherit without deciding. Seeding production is: set the flag,
deploy, confirm, set it back.

In the dev stack a failure is reported and does not stop `up`. A database that
came up and migrated is usable without the seed, and refusing to finish over it
would be the tail wagging the dog.

## 7. What staging actually gets

Worth being explicit, because the harvester is off there and that decides it. No
harvest means no Mercadona products, so the EAN assignment matches nothing and
says so. What lands is 162 groups and two chains with 135 products: a complete
catalog for El Jamón and SuperCash, an empty one for Mercadona. That is the
honest consequence of not running discovery in staging, not a fault in the seed.

## 8. What this is not

- **Not a receipt reader.** Backlog 0008 is that. Everything here was transcribed
  once, by hand, and checked against the totals. Nothing in the app parses a
  ticket.
- **Not `ItemPrice`.** Still one price per item per scope, one source winning by
  overwriting, no history. The provenance columns are what make the multi-source
  model possible later, not a piece of it.
- **Not automatic classification.** Every group assignment here is curation. The
  matching ladder that would let a harvest run classify what it finds is backlog
  0001 section 6.2 and needs the review queue that comes with it.
