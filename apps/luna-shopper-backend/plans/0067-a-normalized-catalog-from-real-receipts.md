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
   after a deploy, get a catalog with real products and real prices in it rather
   than the two item demo world.
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

160 groups came out of it. Two that the obvious taxonomy demanded turned out to
have no members and were deleted rather than kept: there is no plain `custard`,
because the only natillas anyone bought is the +Proteínas one, and no `nougat`,
because both times a receipt says `TURRÓN` it is turrón **ice cream**. A group
with no members describes a catalog nothing here holds, and the spec fails on
one.

## 3. What lands: the receipts, and only the receipts

**239 products.** 116 Mercadona, 16 El Jamón, 107 SuperCash — one per distinct
receipt line, minus the two anchovy grades that are one product bought twice.

That number is the design. The alternative was Mercadona's whole assortment, and
it is the wrong answer twice over: a developer does not need 4,196 products to
click through, and getting them would mean either an eighteen minute harvest per
database or a three megabyte dump living in the repository. The products actually
bought are a better fixture than the assortment, because a basket built from them
is a basket somebody really filled.

**Every one carries its receipt price**, as `USER_RECEIPT`, with the date it was
observed. That is the only price these products have in a database that has never
run a discovery, which is most of them.

## 4. Mercadona works two ways, decided per product by EAN

Mercadona is the one chain a harvest run also produces, so its 117 entries have
to behave sensibly whether or not one has happened. The seed decides per product,
by looking the barcode up:

- **Nothing has this EAN.** The entry becomes the product: created with its
  normalized name and priced from the receipt. This is a fresh database, and it
  gets a small, real Mercadona catalog.
- **A harvested row already has it.** That row _is_ the product, so only its
  `productGroupId` is set. Its `OFFICIAL_WEB` price stands: it is newer than an
  August receipt, and `supermarket_items` holds exactly one row per item per
  scope, so writing the receipt price over it would destroy the better number
  rather than add to it.

**Keyed on EAN, never on the item's uuid.** The uuids belong to whichever
database ran the discovery, so a mapping written against one developer's catalog
matches nothing in another's. The barcode is what the entity itself calls "the
only identifier that joins a product across chains", and it survives a
re-harvest.

`uq_items_ean` is UNIQUE where not null, which is what makes this a lookup rather
than an insert — and what fixes an ordering: **a catalog dump is restored before
this seed, never after.** Restoring one on top would try to insert a second row
for a barcode the seed already owns.

Eight Mercadona products have no EAN here, because no harvest carries them at
all. Five are a variant the snapshot holds under another flavour, which is
ordinary staleness. `CABALLA ESTORNINO` is the other kind: the website sells four
tinned mackerels and no fresh one, because the fish counter is not something a
website sells.

How the 109 barcodes were matched, since the file cannot show it: each till
abbreviation was scored against all 4,196 harvested names by token overlap, and
the receipt's own price had to agree before a match was accepted. 100 of 109
agree to the cent. The nine that do not are weighed products, where the receipt's
figure is per kilogram and the catalog's `price` is for one fish; they agree
against `unitPrice`. That is what resolved the fish counter, where the names are
useless and the €/kg is exact: `TRUCHA ARCO IRIS` at 7,95 is _Trucha abierta en
libro con cabeza_ at 7,95.

## 5. El Jamón and SuperCash

Neither chain has a storefront a harvester can read, so every one of their
products is authored and every price came off a receipt. Both get one `STORE`
scope with one location, which is exactly the case the scope entity describes for
"a chain with no obtainable data".

The normalization is the point: `GARBANZA FRASC` becomes Chickpeas in a Jar,
`BOCADIT.CODAN` becomes Filled Mini Buns. A spec asserts no item kept the till's
own shouty string as its name.

**Four receipt lines are deliberately absent.** El Jamón prints `CARNICERIA`,
`CHARCUTERIA` and `PANADERIA`, and SuperCash prints `Fruteria CASH2`: the counter
rang the sale up and what was bought is recorded nowhere on the ticket. A catalog
is a list of things you can buy again, and "whatever the butcher handed over on
the 28th" is not one of them.

## 6. Ids are derived, not written

160 groups, 239 products, three chains and their scopes and locations is far past
the size where hand-written uuid constants are checkable. Every id is
`uuidv5(kind + slug, fixed namespace)`, which makes the seed idempotent by
primary key with no lookup table: `groupId('milk')` is the same uuid in every
database, this week and next.

The namespace is fixed forever. Changing it renames every row, and any shopping
line pointing at an old id would point at nothing.

## 7. Running it

The seeder never deletes. That is the one way it differs from the demo world
seeder, which owns its whole graph and clears it: this one lives in a database
that may also hold a full harvest and every list built on top of it.

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

In the dev stack a failure is reported and does not stop `up`. A database that
came up and migrated is usable without the seed, and refusing to finish over it
would be the tail wagging the dog.

## 8. Seeding production, once

Production's flag is off, and that is deliberate rather than an oversight: a
`pre-upgrade` hook fires on **every** deploy, and a job that rewrites the
reference catalog each time a micro-frontend ships is not something to inherit
without deciding. Seeding it is therefore an explicit, ordered operation.

1. **Decide whether the full Mercadona assortment is going too.** If it is,
   restore the catalog dump first — `k8s/catalog-seed/README.md` has the
   procedure. Order matters and is not negotiable: the dump must land before this
   seed, because both write products keyed on the same barcodes and
   `uq_items_ean` will refuse the second one. If it is not, skip this step and
   production gets the 239 receipt products, which is a complete and honest
   catalog on its own.
2. **Staging first, always.** Set `referenceSeed.enabled: true` in
   `values.staging.yaml` (it already is), deploy, and read the Job's log. It
   prints what it created, adopted and left alone.
3. **Turn it on for production**: `referenceSeed.enabled: true` in
   `values.production.yaml`, then deploy a release as usual. The Job runs once,
   on the `pre-upgrade` hook, before any new pod takes traffic.
4. **Check it landed**, in the catalog database:

   ```sh
   kubectl exec -n nx-portfolio luna-shopper-backend-catalog-db-0 \
     -- psql -U luna_catalog -d luna_catalog \
     -c 'select count(*) from product_groups' \
     -c 'select count(*) from items where "productGroupId" is not null'
   ```

5. **Turn it back off** and leave it off. Nothing is lost by doing so: the rows
   are already there, and the seed is idempotent if it is ever needed again.

Steps 3 and 5 are two deploys. That is the cost of not having a job that rewrites
catalog rows on every release, and it is worth paying once.

## 9. What this is not

- **Not a receipt reader.** Backlog 0008 is that. Everything here was transcribed
  once, by hand, and checked against the totals. Nothing in the app parses a
  ticket.
- **Not the Mercadona assortment.** 116 products, not 4,196. The assortment
  travels as a dump when it is wanted, by a separate and already documented
  procedure.
- **Not `ItemPrice`.** Still one price per item per scope, one source winning by
  overwriting, no history. The provenance columns are what make the multi-source
  model possible later, not a piece of it.
- **Not automatic classification.** Every group assignment here is curation. The
  matching ladder that would let a harvest run classify what it finds is backlog
  0001 section 6.2 and needs the review queue that comes with it.
