# 0069 A catalog you can always read, priced or not

Two plans already describe behaviour the system does not have, and they describe the same behaviour:

`0064`, section 3:

> **The catalog does not shrink.** An excluded chain or store removes prices from consideration,
> never items from the catalog. A user who excludes everything sees every product and no prices,
> which is the same state as a user with no postal code, and the client already renders it.

`apps/velista/plans/0059`, section 2:

> **It does not filter the catalog.** Excluding every shop leaves every product visible and every
> price absent, which is the same state as a profile with no postal code and is already what the
> client renders.

Neither is true today, and the second half of each sentence is not true either: a user with no
postal code does not see a catalog, they see an error. This plan makes both sentences true, and it
is the decision behind them rather than a correction to their wording: **saying nothing about where
you shop, and refusing everywhere you could shop, are the same state, and that state is the whole
catalog with no prices on it.**

Depends on `0049` (the rule it supersedes) and on `0064`, without which `coverage` is computed
after the caller's refusals and section 3's table cannot tell its second row from its third. Backend
only, with a velista half named in section 8.

## 1. The three states, and what each one answers today

`resolvedToNothing` in `item.service` is the whole of the current rule:

```ts
Array.isArray(priceScopeIds) && priceScopeIds.length === 0;
```

**Absent** is the unscoped read: it ranks the catalog, quotes no price, and its own doc notes it "is
not reachable through the gateway any more". **Empty** short circuits to `EMPTY_ITEM_PAGE` before
touching the database.

| The profile                                  | Today                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| No postal code, no chain                     | `CATALOG_SCOPE_REQUIRED`, a 400 the client draws as a banner |
| Codes, but every chain or every shop refused | zero scopes, so searching finds **nothing**                  |
| Codes, some chains                           | prices, and coverage flags for the codes nobody serves       |

The middle row is the one that reads as a broken product. Somebody switches off the four shops they
do not like, types "milk", and the catalog is empty. Nothing tells them the two things are
connected, and the honest reading of the screen is that we have no milk.

The top row is defensible and was argued for in `0049` section 3: answering everything to somebody
who has said nothing was thought to answer a question they did not ask. In practice it makes the
catalog unreachable until a profile is filled in, and it makes "I just want to see what exists" an
error condition.

## 2. The decision

**Empty and absent become the same answer**, and it is the answer `getMany` has always given:

> Absent and empty scopes are the same answer here, unlike `search`: a lookup by id returns the same
> items either way, so the only question is whether a price is attached.

That sentence is now true of every catalog read. The catalog is a list of things that exist; a scope
is how a price gets attached to one. Having no scope is a statement about prices and never about
products.

So:

- `resolvedToNothing` goes, and with it both short circuits. An empty scope set runs the same
  unscoped read as an absent one: ranked, paged, every price field null.
- The gateway stops raising `CATALOG_SCOPE_REQUIRED` for a profile that has said nothing. It
  resolves to no scopes and the read proceeds.

## 3. How a client still tells the three apart

Removing the error removes the signal that a profile is empty, and that signal was doing real work:
velista's profiles page draws its banner from `?scope=required`, and a user who never fills a postal
code in never sees a price. Losing the prompt would be a worse product than the empty page this plan
is fixing.

**Nothing new is needed, because `CatalogScopeView` already carries the answer.** `coverage` says
which of the caller's codes anybody serves, and `0064` fixed it to be computed **before** the
caller's refusals, so it describes our data rather than their preferences:

| `priceScopeIds` | `coverage`                | What the client says                             |
| --------------- | ------------------------- | ------------------------------------------------ |
| empty           | empty                     | you have not told us where you shop              |
| empty           | rows, all `served: false` | we do not know your area yet                     |
| empty           | rows, some `served: true` | you have refused everywhere you could shop       |
| non empty       | anything                  | prices, `approximate` if the ladder fell through |

Three different sentences from one read, none of them an error, and the third is the one no error
code could ever have expressed. That is the argument for the change stated as a property rather than
as a preference: the failure mode being removed was never a failure, and encoding it as one cost the
client the ability to say which of three things happened.

## 4. What happens to `CATALOG_SCOPE_REQUIRED`

It is raised in exactly one place, `ScopeResolutionService`, and this plan removes that raise. **The
code is then deleted rather than kept as an unreachable branch**: an error code nothing throws is a
promise the API is not keeping, and `0038` section 6.5 already set the precedent that a rule which
stops being true is deleted and not extended.

That means, in the same change: the exception class, the entry in `ERROR_CODES`, its row in the
error catalog and its status mapping, and the `scopeRequired` flag on `ApiProblemResponses` that
puts it in five routes' documented responses.

Two consumers are affected and neither breaks:

- **The basket read for a shared list** already catches it and proceeds unpriced, because "a basket
  in an aisle is worth more than a price". After this it never has to: the read it wraps answers
  unpriced by itself, and the `catch` stays for the other four reasons it lists.
- **velista** draws the banner from `?scope=required` and has a comment in
  `shopping-profile-store` explaining that the catalog refuses to answer for an empty profile. Both
  become false. That is a velista plan and not this one, and section 8 says what it owes.

## 5. The reads this changes

Every read that resolves scopes through the gateway, which since `0049` is all of them:

- `GET /v1/catalog/items`, ranked products
- `GET /v1/catalog/items/offers`, ranked groups, which is the composer's bare word query
- the group members read, which resolves scopes the same way
- the composer's suggestion endpoint, which is the one route that fans out to two subjects
- `GET /v1/catalog/scope`, which stops being able to fail

`getMany` is untouched: it already treats the two the same, and this plan is that rule spreading
rather than a new one.

**`searchOffers` needs no work of its own.** Its doc already says a group with no priced member comes
back with `bestOffer` and `offer` null, and calls that "the case, not an edge case", because the
harvester is off outside development. The unpriced answer is the one it was built to give.

## 6. What it costs

An unscoped ranked search over the whole catalog, for every caller with an empty or exhausted
profile. That is the same query the owner's admin surface has always run, over a catalog of some
four thousand products, ranked and paged at a hundred. The cost is a real one and it is small, and
it buys the state in section 3's third row, which is a user seeing their own decision reflected
instead of an empty shelf.

Worth stating so it is not rediscovered: **an empty resolution is still not cached.** The reasoning
survives the change unaltered. The next thing a user with an empty profile does is fill it in, and
the read after that must not be answered from a minute old "you have said nothing".

## 7. The docs that have to stop being wrong

Unlike `0064`, most of the prose here is already right and the code is what disagrees. What has to
change:

- **`0049` section 3** is the decision this supersedes. It is a historical record and is not edited;
  it gains a pointer here, the way it gained one to `0064`.
- **`resolvedToNothing`'s doc block** goes with the function.
- **`ResolvePriceScopesRequest`'s doc** says "a request with nothing positive in it resolves to
  nothing, which the gateway never sends". The gateway sends it now, on purpose.
- **`ProfileScopeSelector.empty`** says section 3 answers an empty profile "with
  `CATALOG_SCOPE_REQUIRED` rather than with everything or with nothing". The field stays, because a
  client still wants to know, but it stops being the reason a read fails.
- **`0064` section 3 and velista `0059` section 2** become true, and `ScopeResolverService`'s class
  doc, which records the divergence today, loses that paragraph.

## 8. What velista owes, in its own plan

Not this plan's work, and named so it is not forgotten: the profiles page banner has no error to
trigger it, and the three sentences in section 3 are the replacement. The prompt to add a postal
code should come from a priceless catalog rather than from a failed request, which is a better
moment for it anyway: the user is looking at products they cannot see prices for, rather than at a
screen that refused to load.

## 9. Migrations

None. Nothing is stored about any of this; it is a resolution rule and a branch in a read.

## 10. Exit criteria

- A profile with no postal code and no chain gets a ranked page of products with every price field
  null, and `coverage` empty, with a test.
- A profile whose codes are served but whose shops are all refused gets the same page, with
  `coverage` rows saying `served: true`, with a test. The two states are distinguishable from the
  response alone.
- The same holds for the group search and the suggestion endpoint.
- `GET /v1/catalog/scope` answers for an empty profile rather than failing.
- No route documents `catalog_scope_required`, and the code, its exception, its catalog row, its
  status mapping and the `scopeRequired` decorator flag are all gone.
- The shared basket read still answers unpriced, through the ordinary path rather than through its
  `catch`.
- An empty resolution is still not written to Redis, with a test.
- `0049` carries a pointer here; `ScopeResolverService` no longer records the divergence.
- `openapi.json` regenerated and committed; `npx nx run-many -t build test lint -p
luna-shopper-backend-catalog,luna-shopper-backend-gateway,luna-shopper-platform,luna-shopper-contracts`
  passes.
