# Turning leaflet offers into catalog products

You read supermarket leaflet offers and decide what products they are. Deza, El
Jamón and Mercadona all sell the same kinds of thing. So the same product
often appears in two leaflets, under two printed names. Your job is to decide when two
printed names are one product, and to write each product down once.

You are creating **products**. You are not assigning product groups. Grouping
happens later, after every product is registered.

## The rules

### 1. Same brand and same format merges. Nothing else does.

Two offers are the same product when the brand agrees and the format agrees.
The format is the size or the pack count: 200 ml, 950 ml, 5 kg, pack of 12.

If the brand agrees and the format does not, they are two products. A Dove
deodorant spray of 200 ml and a Dove roll on of 50 ml are two products.

If the format agrees and the brand does not, they are two products.

A range name printed on one side only does not block a merge. Deza prints
`Desodorante DOVE ADVANCED CARE 200 ml` and El Jamón prints `Desodorante Dove,
200 ml.`. Same brand, same format, one product.

### 2. A name never carries its brand.

The brand has its own column, and catalog search reads that column. The brand
sits in the search vector at weight B, just under the name. So `Champú CROWE
400 ml` becomes the name `Champú`, with the brand `Crowe`. A shopper who types
`champu crowe` still finds it.

### 3. A name never carries its size.

The size goes in `unitSize` and `defaultUnit`. `Loción corporal INSTITUTO
ESPAÑOL rosa mosqueta 950 ml` becomes the name `Loción corporal de rosa
mosqueta`, with `defaultUnit: "MILLILITER"` and `unitSize: 950`.

### 4. A range name stays in the name when two products need telling apart.

`Intensive`, `Advance`, `Flex`, `Classic`, `Total`, `Dream Long` are ranges, not
brands. When the leaflet names more than one range, keep the range in the name.
Keep it also when the name without it points at no particular pack. Drop the
maker's name always.

### 5. The brand is the line, not the maker.

The leaflet files `Champú Elvive` under `L'Oréal`. Record the brand as `Elvive`,
because Elvive is what the bottle prints largest and what a shopper types. The
same holds for `Fructis` over `Garnier`.

`apply` enforces a weaker version of this: the brand you record must appear
somewhere in the offer, either as the printed brand or inside the printed name.
It will not let you invent a brand nobody printed.

## An offer is not a product

A leaflet prices a shelf. One offer often names two or three products at one
price, and each one is a separate product:

- `Champú o Acondicionador Revlon Flex, 650 ml.` is a shampoo and a conditioner.
- `Mascarilla facial BEAUUGREEN colágeno, aloe o ginseng` is three masks.
- `Dentífrico SIGNAL 100 ml bicarbonato o anticaries` is two toothpastes.
- A `variants` array with three entries is three products.

Write every one of them, each with its own slug and its own name, and give each
the same source offer. The tool expects this: an offer can appear on many
products.

A flavour, a scent and a range each make a new product. A pack size makes a new
product too. Absorbency makes a new product: night, regular and super sanitary
towels are three products.

## A private label does not cross a chain

`Hacendado`, `Bosque Verde`, `Deliplus` and `Delikuit` are Mercadona's own
labels. `Alteza` is Deza's. `Ifa Eliges`, `Ifa Sabe` and `Ifa Unnia` are El
Jamón's. A product carrying one of them cannot be on another chain's shelf, so
it never merges across chains, however well the names agree.

This matters more than it sounds. Four pairs in the receipt catalog have
**identical** names across two chains and are four different products, and one
of those pairs agrees on price to the cent. Name matching alone merges all
four, and that destroys the price comparison the catalog exists for.

`next` marks a candidate `blocked` when it crosses a label. Treat that as a
strong signal and not a law. The list is observed from the leaflets in hand. If
you merge over it, say why in a `note`.

## How to work

Take one batch, decide every offer in it, apply it, then take the next. Do not
hold two batches open at once. `next` computes candidates from the products
already applied, so a batch you did not apply is invisible to the next one.

```sh
# 1. Ask for work. Filter by section. When the leaflet has no sections, filter by page.
node tools/catalog/merge-products.mjs next \
  --catalog tmp/catalog/products.json \
  --offers tmp/leaflet/deza-leaflet.import.json \
  --section perfumeria --limit 40 > packet.json

# 2. Read packet.json, write decisions.json, then hand it back.
node tools/catalog/merge-products.mjs apply \
  --catalog tmp/catalog/products.json \
  --offers tmp/leaflet/deza-leaflet.import.json \
  --decisions decisions.json

# 3. At any time
node tools/catalog/merge-products.mjs check --catalog tmp/catalog/products.json --offers <files...>
node tools/catalog/merge-products.mjs stats --catalog tmp/catalog/products.json
```

Run one chain's section, apply it, then run the other chain's matching section.
The merges appear on the second pass, because that is when the first chain's
products are in the catalog to be found.

### Reading a packet

Each offer arrives with a `candidates` list, best first. Each candidate says:

- `brandMatch`: `exact`, `fuzzy` or absent.
- `formatMatch`: `exact`, `differs`, or `unknown` when one side printed none.
- `mergeable`: true only when both are `exact`. This is rule 1, precomputed.
- `blocked`: set when the candidate is an own label of another chain.

A `mergeable` candidate is usually the answer. Read the two names before you
take it. The tool compares a brand and a number. It cannot tell a shampoo from
a conditioner.

### Writing decisions

```json
{
  "batch": { "source": "...", "keys": ["deza/p26-o01", "deza/p26-o02"] },
  "products": [
    {
      "slug": "champu-crowe",
      "name": { "en": "Shampoo", "es": "Champú" },
      "brand": "Crowe",
      "category": "PERSONAL_CARE",
      "defaultUnit": "MILLILITER",
      "unitSize": 400,
      "note": "optional, for a decision a reader will question",
      "offers": [
        {
          "chain": "deza",
          "id": "p26-o03",
          "printedName": "Champú CROWE 400 ml",
          "price": 1.4
        }
      ]
    },
    {
      "slug": "locion-corporal-rosa-mosqueta",
      "mergeInto": "locion-corporal-rosa-mosqueta",
      "note": "Same brand, same 950 ml bottle.",
      "offers": [
        {
          "chain": "el-jamon",
          "id": "p36-o08",
          "printedName": "Loción Rosa Mosqueta Instituto Español, 950 ml.",
          "price": 4.89
        }
      ]
    }
  ]
}
```

A merge row carries `mergeInto`, its offers and nothing else. Restating the name
and the category makes a second copy to keep in step.

`batch.keys` lists every offer you were given. If one of them got no decision,
`apply` refuses the file. Nothing is silently dropped.

To merge over a refusal, add `"force": true` and `"forceWhy": "..."`. Use it
rarely, and never to get past a format that genuinely differs.

### The vocabulary

`category` is one of `PRODUCE`, `DAIRY`, `BAKERY`, `MEAT`, `SEAFOOD`, `FROZEN`,
`PANTRY`, `BEVERAGES`, `SNACKS`, `HOUSEHOLD`, `PERSONAL_CARE`, `OTHER`.

`defaultUnit` is one of `UNIT`, `GRAM`, `KILOGRAM`, `MILLILITER`, `LITER`,
`PACK`. When the leaflet sells a pack, use `PACK` with `unitSize` as the count.

Every product needs both `name.en` and `name.es`. Search builds one vector per
language. It joins the words of a query with `AND` inside a single vector. So a
product with one language filled is unfindable in the other.

## What apply refuses

Each of these is a mistake somebody already made:

- A name that still carries its own brand.
- A name that still carries its own size.
- A category or a unit outside the two lists above.
- An empty `name.en` or `name.es`.
- A slug that is not kebab-case, or that repeats.
- A merge onto a product whose format differs.
- A brand that appears nowhere in the offer.
- An offer that was in the batch and got no decision.

A rejected file writes nothing. Fix it and run `apply` again.

## Worked examples

**A merge.** Deza `p27-o01` `Loción corporal INSTITUTO ESPAÑOL rosa mosqueta 950
ml` at 4.45 EUR, and El Jamón `p36-o08` `Loción Rosa Mosqueta Instituto Español,
950 ml.` at 4.89 EUR. Same brand, same 950 ml. One product named `Loción
corporal de rosa mosqueta`, with two offers.

**Not a merge, on format.** El Jamón `p37-o05` `Desodorante Roll-On Dove, 50 ml.`
against the Dove spray of 200 ml already in the catalog. `brandMatch` is exact
and `formatMatch` is `differs`, so it is a new product.

**Not a merge, on label.** El Jamón sells `Fuet` under `Eliges` and Mercadona
sells `Fuet` under `Hacendado`. The names are identical. Two own labels, two
products.

**A split.** Deza `p27-o06` `Mascarilla facial BEAUUGREEN colágeno, aloe o
ginseng ud` at 0.85 EUR becomes three products, each 1 unit, each naming its own
active ingredient, all three carrying that one offer.
