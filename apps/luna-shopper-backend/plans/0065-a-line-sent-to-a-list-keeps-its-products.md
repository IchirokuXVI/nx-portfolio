# 0065 A line sent to a list keeps its products

> Backend only. Nothing in velista changes: the basket composer already sends what this plan
> stops throwing away, and the list page's line detail already draws the products a line names.
>
> Depends on `0055` (a participant adds a line, which is where the options come from) and `0058`
> (binding an added line to a list, which is one of the two callers fixed here).

Somebody in an aisle types "milk", taps the group in the dropdown, and the basket line is created
knowing all eleven products that count as milk. They buy it, send the line to the flat's list, and
the flat's list gets a line that says "milk" and names **no product at all**. The line detail on
that list reads `Not linked to a product`, which is the sentence the client draws when a line has
an empty item set.

The information was there. One function dropped it.

## 1. Where it is dropped

`GeneratedListLineService.promote` is the only path from a basket line to a zone line, and both
callers reach it:

| Caller                               | When                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| `GeneratedListBasketService.addLine` | the owner adds with a `defaultTargetListId` set (`0055`)      |
| `GeneratedListBindService`           | anybody sends an added line to a list they may write (`0058`) |

It composes the new zone line like this:

```ts
itemIds: line.itemId ? [line.itemId] : [],
```

`line.itemId` is the **pick**, a single product. A basket line's product identity is two fields,
not one: the pick, and the `GeneratedListLineOption` rows behind it. The pick is what somebody
means to buy today; the options are what the line is _about_. This copies the first and discards
the second, and in the case that matters it has nothing to copy at all.

### 1.1 The case that matters is the common one

`0055` section 3 sets the pick only when the composer attached exactly one product, which is an
**item** suggestion. A **group** suggestion attaches its whole member set as options and leaves the
pick null, deliberately, so the row can ask "which one did you get?" at the shelf.

The dropdown leads with groups. So the ordinary gesture, typing a word and tapping the thing that
word means, produces a line whose `itemId` is null and whose options are complete, and that is
exactly the line `promote` turns into free text.

| The basket line                        | The zone line it creates today | What it should be |
| -------------------------------------- | ------------------------------ | ----------------- |
| item suggestion: pick set, one option  | that one product               | that one product  |
| group suggestion: pick null, N options | **nothing**                    | all N options     |
| free text: no pick, no options         | nothing                        | nothing           |

Only the middle row is wrong, and it is most of the traffic.

## 2. What the fix is

A zone line's `itemIds` is a **set of candidates**, which is the same concept as a basket line's
options under a different name in a different service. `0007` gave a list line a set rather than a
product for precisely this reason: a household wants milk, not a SKU. So the two map onto each
other exactly, and the promotion should carry the set.

`promote` reads the line's options and sends them, with the pick first where there is one:

- **No pick, options present**: send the options, in their stored `position` order. The household
  line now names the eleven milks, which is what the person who added it meant.
- **A pick, options present**: send the options with the pick moved to the front. Ordering is not
  decorative here. `GeneratedListService.resolvePick` takes `options[0]` when a later run composes
  a basket from this list, so putting the pick first is what makes the next trip default to the
  product this trip actually bought.
- **A pick and no options**: send the pick alone. This is the shape a line promoted before this
  plan has, and it keeps working unchanged.
- **Neither**: send nothing, which is a free text line and stays one.

### 2.1 The caps already agree

A basket line carries at most `GENERATED_LIST_LIMITS.maxOptions`, which is 50. A zone line accepts
at most `LINE_ITEM_SET_MAX`, which is 100. The larger set always fits inside the smaller cap, so
there is no truncation branch to write and none should be invented: a silent truncation here would
drop products from a household's list with nothing to say about it.

### 2.2 It is one read, not one per line

`promote` runs once per gesture and the options repository is already injected into that service,
so this is a single `find` by `generatedListLineId` ordered by `position`. It is not on the basket
read path and adds nothing to the screen that is refetched every time anybody settles anything.

## 3. What deliberately does not change

- **The pick is not invented.** A group line still promotes with a null pick on the basket side and
  a set on the list side. Choosing a product because a line was sent somewhere would answer "which
  one did you get?" on the shopper's behalf, and `0055` section 3 is explicit that a group means a
  kind of thing rather than one of them.
- **The write back rule is untouched.** This changes what the promoted line carries, never who may
  promote or when. `0050` section 5 still owns that, and `0058` still puts a list picker in front
  of the gesture.
- **Nothing is backfilled.** Lines already promoted stay as they are. A migration that guessed item
  sets for existing free text lines would be writing products into households' lists on the
  strength of a string match, which is the thing backlog `0004` section 1.2 refuses to do even
  when it is the whole feature.
- **The content is still the content.** The zone line's text is the basket line's text as before.
  Attaching products renames nothing.

## 4. Tests

In `generated-list-line.service.spec.ts`, and beside the bind service's own suite:

1. A basket line with three options and no pick promotes to a zone line naming all three, in
   position order.
2. A basket line with three options and a pick promotes with the pick first and the other two
   after it.
3. A basket line with a pick and no options promotes naming that one product. This is the
   regression guard for lines created before `0055`.
4. A free text basket line promotes with an empty item set, unchanged.
5. The `addLine` path with a `defaultTargetListId` reaches the same result as the bind path, since
   both go through the one function and neither should grow its own copy of the rule.

One integration assertion is worth its cost: bind a group added line through the gateway and read
the target list's line back, asserting `itemIds` is not empty. The unit tests above prove the
function; this proves that nothing between it and the wire drops the set again.

## 5. Regenerate the OpenAPI document

No route, request or response shape changes here, so `openapi.json` should come back byte
identical. Run the generator anyway before opening the PR, because "it cannot have changed" is
exactly the belief that makes the gateway's own suite fail on somebody else's branch:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```
