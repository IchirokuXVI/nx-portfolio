# 0065: the line says who put each product there

> **Depends on backend `0070`**, which is where the subscription, the provenance and the cap rule
> live. Nothing on this page can be drawn before `LineView` carries `productGroupId` and
> `groupItemIds`, and the adoption gesture has nothing to call.
>
> Prerequisite reading: `0047` section 1.2 and section 2, which built the products section on the
> line page and set the rule that a control is either offered or it is not; `0043`, which built
> the line detail sheet that this plan deliberately leaves alone (section 7); and backend `0048`
> section 1.1 **as revised by `0070`**, because the sentence it used to end with, that a line
> references no group afterwards, is the thing that stops being true.

A line's products used to have one story: a person put them there. After `0070` there are two, the
catalog will quietly add and remove some of them, and the screen currently has no way to say which
is which. This plan gives it one, adds the gesture that moves a product from the catalog's side to
the person's, and makes the 100 product cap something you can see coming instead of something you
discover as "Something went wrong".

## 1. What is being built

Three changes, all in the products section of the line page
(`libs/velista/feature-lists/src/lib/line-page`):

1. The products are drawn as **two labelled clusters** instead of one flat run of chips.
2. A product the catalog put there can be **adopted**, in one tap, and it moves.
3. The heading carries **the count against the cap**, and an add that would break the cap is
   refused before it is sent, with a sentence saying why.

## 2. Two clusters, not a badge on every chip

The obvious design is a small mark on each catalog added chip. It fails on the most common case in
the product. Immediately after somebody picks **Milk**, all eleven products are catalog added, so
all eleven chips carry the same mark, the mark distinguishes nothing, and the line has gained
eleven pieces of decoration that say "yes, still the same". **A mark that is on everything is not a
mark.**

So the set is drawn as two labelled clusters:

| Cluster        | What is in it                                                   |
| -------------- | --------------------------------------------------------------- |
| `From Milk`    | `groupItemIds`: what the catalog put there and keeps up to date |
| `Added by you` | everything else: added by hand, or adopted (section 4)          |

When a line is entirely one or the other, there is one cluster and one heading, which reads as a
statement about the line rather than a distinction drawn for its own sake. When it is mixed, the
split is legible at a glance with no per chip decoration at all.

**A line with no group binding draws no headings**, just the flat run of chips that ships today.
That is every line `0048` ever created, so nothing regresses for any of them, and the headings
appear exactly when there is something for them to tell apart.

### 2.1 Naming the group

`LineView.productGroupId` is an id, and the heading wants a name. `GET
/v1/catalog/product-groups/:id` exists, returns a `ProductGroupView` with a localized name, and is
**not** admin gated: `ProductGroupService.get` performs no `requireAdmin`, unlike `create`,
`update` and `delete` beside it.

So data-access gains `group-names.ts` next to `item-names.ts`, with the same shape: an `ensure(ids)`
that fetches what it does not hold, a cache, and an `anyFailed` for the failure line. Deliberately
the same shape rather than a general purpose cache abstraction over both, because `item-names.ts`
already made every one of these decisions once and a second resolver that answered differently
would only reveal itself in the failure case, which is the case nobody exercises.

When the name cannot be fetched, the heading falls back to `From a group` and never to `From ` with
an empty name. That is the rule `productsPhrase` already applies to a product it cannot name: the
reader is owed the same sentence whether the lookup failed or the record is gone.

## 3. The counter, and the add that is refused

### 3.1 The counter

The section heading becomes `Products 98/100`.

- **Always drawn when the line has products**, never only once it is close to full. A counter that
  appears at 90 teaches somebody that a limit exists at the exact moment the news is bad, which is
  the worst moment to introduce it.
- **Over the cap it reads `104/100`, and neither number is clamped.** `0070` section 7.2 makes that
  a legitimate state: the sync ignores the cap so that a subscription does not silently stop
  working at a number nobody can see. Clamping it to `100/100` would claim the line is exactly full
  when it is not, and would leave the refused add in section 3.2 with no visible explanation.
- It counts the **whole** set, both clusters, because the cap is on the whole set.

### 3.2 The refusal happens before the request

`addProduct()` today unions the chosen products into the set and sends it with no length check
(`line-page.ts:492`). It gains the guard, using the same expression the server enforces:

```
next.length <= max(LINE_ITEM_SET_MAX, current.length)
```

imported from `@portfolio/luna-shopper/contracts` rather than written as a literal `100`, so the
two halves cannot drift apart. When it fails, **nothing is sent**, nothing on the line changes, and
the sentence in 3.3 is shown.

This is the posture `list-error-copy.ts` already documents for every other write on this screen,
"caught in the field before the request in every other case, so reaching here on a write is the
belt on top of the braces". Today that comment is not true of the product set, because no field
owns it; this is what makes it true. The server's own refusal stays exactly as it is and keeps the
generic sentence, because reaching it now means a second client or a stale set rather than the
ordinary path.

### 3.3 The sentence has to explain all or nothing

"98 of 100" and "adds 10" together read like two of them should fit. They do not, and `0070`
section 7.1 is why: a partial fill would be the server choosing which 2 of Milk's 10 products land
on somebody's shopping list. So the copy says the whole thing, and says what to do about it:

> This line holds **98 of 100** products, and Milk adds **10**. Remove a few products first.

Two keys, because one product and a group are different sentences in every language and the group
one carries a count the other does not have.

### 3.4 What can actually reach this today, stated plainly

The line page **filters group rows out of its own suggestion list** on purpose ("a line already
holds a set of products, so a group row on this screen reads as a group being added to a group").
So the gesture that adds ten at once is not currently offered here, and `addProduct` keeps its
group branch defensively, which is the branch this rule governs.

The rule is still needed on this screen for one product at a time, and **the counter is needed
whether or not anybody ever adds a group here**, because `0070`'s sync can carry a line past 100
with no gesture at all and the person is owed an explanation for the number they are looking at.

Subscribing an **existing** line to a group is the gesture that would make the ten into ninety
eight case ordinary. It is out of scope (section 10), and `0070` binds a group only at creation.

## 4. Adoption

On a chip in the `From Milk` cluster only, a second control beside the `×`: **Keep**.

- **Text, not an icon.** There is no pin, lock or check icon in `libs/shared/ui`, adoption is a
  rare and genuinely unobvious action, and an unlabelled glyph for it would need a visible label
  anyway. If it ever becomes an icon it goes in `libs/shared/ui` as a component like every other
  one, never as inline `<svg>` here.
- It calls `line.update` with `adoptItemIds: [itemId]` and nothing else (`0070` section 9).
- **The feedback is the chip moving.** On success it leaves `From Milk` and appears under `Added by
you`. No toast and no confirmation: the result of the gesture is the whole point of the gesture,
  and it is already on screen.
- Offered only where `canEdit`, and inert while `busy`, like every other control in this section.
- **There is no un-adopt.** `0070` section 3 makes provenance one way, and a control that hands a
  product back to the catalog is a control for a state nobody wants to be in.

## 5. Removing a catalog added product is unchanged

The `×` is the same gesture with the same copy. What changes is only what the server does with it,
which is write a tombstone so the sync cannot put it back (`0070` section 4). The person is told
nothing extra, because nothing extra happened from where they are standing: they removed a product
and it is gone. A sentence promising it will not come back would be explaining the absence of a
bug they have never seen.

## 6. The models and the mapper

`Line` gains two fields:

```ts
  /** The product group this line follows, or null for a hand made set. */
  productGroupId: string | null;
  /** The subset of `itemIds` the catalog put there and nobody has adopted. */
  groupItemIds: string[];
```

Read from `unknown` in `mappers.ts` with `nullableStr` and a checked string array, never spread off
the response (rule D4). **A missing `groupItemIds` maps to `[]`**, which is the correct reading both
for a server that predates `0070` and for every line that follows no group, so the two cases need
no distinction.

`select-line-page.ts` does the splitting, not the template. The view model gains:

- `products` entries carrying `source: 'group' | 'user'`, derived from
  `groupItemIds.includes(itemId)`.
- the two clusters as two arrays, each with its heading key and arguments.
- `counter: { count, cap, overCap }`, as numbers with the copy interpolating them, following the
  rule that this app formats in the selector and puts finished values on the view model.

The template receives two arrays and a heading each, and decides nothing.

## 7. The line detail sheet is not changed

`line-detail-sheet` draws `productsPhrase` ("3 products", "3 products, last bought Pascual") and
its chips are the **settle choices**, the answer to "which one did you get?". It does not edit the
set.

So it gets neither the counter nor the clusters. A cap counter on a screen with no gesture behind
it is a number with nothing to do, and a provenance mark on a settle choice answers a question
nobody is asking at the shelf, where the only question is which carton is in your hand.

## 8. Copy

| Key                            | en                                                                                                        | es                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `list.page.productsCount`      | `{{count}}/{{cap}}`                                                                                       | `{{count}}/{{cap}}`                                                                                           |
| `list.page.fromGroup`          | `From {{name}}`                                                                                           | `De {{name}}`                                                                                                 |
| `list.page.fromGroupUnnamed`   | `From a group`                                                                                            | `De un grupo`                                                                                                 |
| `list.page.addedByYou`         | `Added by you`                                                                                            | `Añadidos por ti`                                                                                             |
| `list.page.keepProduct`        | `Keep`                                                                                                    | `Conservar`                                                                                                   |
| `list.page.keepProductLabel`   | `Keep {{name}} on this line`                                                                              | `Conservar {{name}} en esta línea`                                                                            |
| `list.page.productsFull.one`   | `This line holds {{count}} of {{cap}} products. Remove one first.`                                        | `Esta línea tiene {{count}} de {{cap}} productos. Quita alguno primero.`                                      |
| `list.page.productsFull.group` | `This line holds {{count}} of {{cap}} products, and {{name}} adds {{adds}}. Remove a few products first.` | `Esta línea tiene {{count}} de {{cap}} productos y {{name}} añade {{adds}}. Quita algunos productos primero.` |

## 9. Tests

In `select-line-page.spec.ts`:

1. A line with no `productGroupId` produces one flat product array and no cluster headings.
2. A line whose every product is in `groupItemIds` produces one cluster, headed by the group name.
3. A mixed line splits into the two clusters, and a product is in exactly one of them.
4. `counter` reads `{ count: 98, cap: 100, overCap: false }`, and a set of 104 reads
   `{ count: 104, cap: 100, overCap: true }` with neither number clamped.
5. A group whose name failed to resolve produces the unnamed heading key, never a named key with an
   empty name.

In `line-page.spec.ts`:

6. At 98, choosing a group of 10 sends **no** request, leaves the set at 98, and shows the group
   sentence with all three numbers.
7. At 100, choosing one product sends no request and shows the single product sentence.
8. At 104, removing one product **does** send, because the guard allows a write that does not grow
   an over cap set.
9. `Keep` sends `adoptItemIds: [itemId]` and no other field, and the chip is in the other cluster
   afterwards.
10. `Keep` is absent on a chip in `Added by you`, and absent everywhere when `canEdit` is false.

Assertions on any sentence carrying `{{interpolation}}` go on the component inputs or the view
model, never on rendered text: the testing translator does not interpolate.

## 10. Out of scope

- **Subscribing an existing line to a group.** `0070` binds at creation, the line page still
  filters group rows out of its suggestions, and adding that gesture is a plan of its own.
- **Any announcement that a sync happened.** Products will appear and disappear on an open list
  during an ordinary redraw, and the clusters are the whole of the explanation offered. `0070`
  section 12 takes the same position on the server side.
- **Un-adopting**, per section 4.
- **The line detail sheet**, per section 7.
- **The basket.** A basket is a snapshot and a sync cannot reach it (`0070` section 8), so no
  screen under `feature-shopping-lists` changes.
- **An admin surface for groups.** There is none, and this does not add one.
