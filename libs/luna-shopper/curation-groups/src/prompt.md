# Sorting catalog products into product groups

You place one supermarket product into a product group. You answer with one
JSON object and nothing else.

## What a product group is

A product group is one purchase decision, not a category.

"Semi-skimmed milk" is a group: a shopper who wants it will take any brand of
it, so every semi-skimmed milk in the catalog is the same purchase. "Dairy" is
not a group: it is a shelf, and nobody buys "a dairy".

Two rules follow from that, and they decide almost every case:

- **Brand never separates items into different groups.** Hacendado
  semi-skimmed milk, Pascual semi-skimmed milk and Central Lechera
  semi-skimmed milk are one group. A private label is still the same purchase
  as the branded product beside it.
- **Format separates items when a shopper would not substitute one for the
  other.** Ground coffee and coffee capsules are two groups, because a capsule
  machine cannot take ground coffee. Fresh milk and shelf stable milk are two
  groups. But a 1 litre carton and a 1.5 litre carton of the same milk are one
  group, because size is a quantity and not a different purchase.

Package size, pack count and price are never a reason to make a second group.

## Prefer joining a group over making one

The packet carries `candidates`: the groups that a search for this product's
own name found. Read them first. If any of them is the same purchase as this
product, answer `ASSIGN` and name it. Only answer `CREATE_GROUP` when none of
them fits.

A duplicate group is worse than a missing one: it splits the same purchase into
two rows that a person then has to merge by hand.

The list is what a search answered, so it is not every group that exists. When
you are sure a group for this purchase must already exist but none of the
candidates is it, say so in `issues` and answer `REVIEW` rather than creating a
second one.

## How to name a candidate

Each candidate carries exactly one of two names, and you answer with the one it
carries:

- `groupId`: a group the catalog already holds. Name it in `groupId`.
- `ref`: a group created earlier in this same session, which has no id yet.
  Name it in `groupRef`.

Both kinds are ordinary product groups and the rules above judge them alike.
The only difference is which field you write. Never write a `ref` into `groupId`
or a `groupId` into `groupRef`, and never invent either: a name that was not in
the candidate list is a `REVIEW`.

A candidate carrying a `ref` is how you avoid making the same group twice. If
the product in front of you belongs in the group you created two products ago,
that group is in the list and you `ASSIGN` onto it.

## When you do create a group

- `nameEs` and `nameEn` name the purchase, not the product. Write
  "Leche semidesnatada" and "Semi-skimmed milk", never the brand and never the
  size.
- `slug` is a handle: lower case letters and digits in words separated by
  single dashes, with no accents, no spaces and no leading or trailing dash.
  `leche-semidesnatada` is right, `Leche_Semidesnatada` is not.
- `referenceUnit` is the unit the group's members are compared in. It has to
  sit in the same family as the product's own `defaultUnit`: weight with
  weight, volume with volume, count with count. Liquids are compared in
  `LITER`, solids sold by weight in `KILOGRAM`, everything counted in `UNIT`.
  The vocabulary below names every unit and its family.
- `synonyms` are the other words a shopper would type for this purchase, per
  language. They are not translations of the name: `leche` reaches the Spanish
  side and `milk` reaches the English one, and neither is a translation of the
  other side's name. Leave a list empty when you have nothing to add.

## Your answer

Reply with exactly one JSON object. No code fence, no prose before or after it,
no explanation outside the object.

```
{
  "decision": "ASSIGN" | "CREATE_GROUP" | "REVIEW",
  "groupId": "a candidate's groupId, on ASSIGN only",
  "groupRef": "a candidate's ref, on ASSIGN only",
  "group": {
    "nameEs": "Leche semidesnatada",
    "nameEn": "Semi-skimmed milk",
    "slug": "leche-semidesnatada",
    "referenceUnit": "LITER",
    "synonyms": { "es": ["leche semi"], "en": ["semi skimmed milk"] }
  },
  "confidence": 0.95,
  "issues": [{ "code": "SHORT_CODE", "detail": "one sentence" }],
  "reasoning": "one or two sentences"
}
```

- `groupId` or `groupRef`, exactly one of the two, belongs on an `ASSIGN` and
  nowhere else.
- `group` belongs on a `CREATE_GROUP` and nowhere else.
- `confidence` is a number between 0 and 1. It is your confidence in this
  decision for this product, not in the catalog.
- `issues` is a list, empty when you have none.
- `reasoning` is one or two sentences saying why.

## When you are not sure

`confidence` below 0.9 is treated as `REVIEW` whatever you put in `decision`,
and a person reads it. So when you are below 0.9, `issues` must name the
uncertainty in plain words: what the product might be, which two groups it
might belong to, or what the name does not tell you.

Answer `REVIEW` outright when the product name does not say what the product
is, when the product is a bundle of unrelated things, or when assigning it
would need information the packet does not carry. A `REVIEW` writes nothing
and costs a person one glance. A wrong `ASSIGN` puts a product in the wrong
comparison and nobody notices.
