# 0252: the LIDL probe reads a grocery product

> Found on 2026-11-06 when the LIDL row was switched on for a scheduled walk on Luna slot 4
> (locked with `--keep-data`). The probe of plan `0219` (`4eeef81f-ddf0-40bc-9bcb-c4450bfe9da1`)
> ended `SHAPE_CHANGED`: "product: the product carried no region price". The walk that followed
> (`d5caf56a-2579-4079-b951-7c43e0fff307`) completed: 166 grocery products, 132 priced, 7,113 prices
> in 55 regions. Nothing had changed. The probe read a sewing machine. With plan `0247` merged, a
> probe that is not `PASSED` skips the slot, so every scheduled LIDL walk would be skipped while
> the week's window starts with non food, and the owner would get the skipped slot alert.
>
> Prerequisite reading: plan `0089` (LIDL, the week's window, regions), plan `0219` (the probe),
> plan `0247` (the gate), `libs/luna-shopper/lidl/src/lib/probe.ts`, `categories.ts`
> (`isGroceryCategory`), `normalize.ts` (`normalizeListPage`), `photo.ts` (`PHOTO_HOSTS`) and
> `apps/luna-shopper-backend/harvester/src/app/harvest/lidl-catalog.runner.ts`.

## Brief for the agent

### Objective

Make the LIDL probe choose its product the way the walk does: the first priced row of the listing
that `isGroceryCategory` accepts. Decide, with the owner, whether a photo on another LIDL
country host is kept.

### Context

- `probeLidl` (`probe.ts`, near line 94) takes `page.rows.find(row => path && listPrice !== null)`,
  else any row with a path. The listing of `q=` at offset 0 is the whole week's window, non food
  first that day (`Máquina de coser »M3205«`, product `100412024`, `ean` 7393033170554, 0 region
  prices). A non food product in the window carries no region price; a grocery one does.
- The walk filters with `isGroceryCategory(row.siteCategory)` (`lidl-catalog.runner.ts`, line 72)
  and read 166 of 419 listed rows that day.
- The probe's listing step asks for 100 rows (`fetchsize=100`) and saw 60 with a total of 662. A
  window can, in principle, hold no grocery row in its first page.
- One walk warning that day: product `11509939` printed its photo at
  `https://www.lidl.fr/assets/gcpa9376ebc0aa94214b9b33a105abed76a.png`; `PHOTO_HOSTS` is
  `['www.lidl.es']`, so the row states no photo. One of 166.

### Target state

The probe spec and the live spec pass, and a probe against the live site on the day of the build
is `PASSED` with a grocery product in its sample.

### Scope

`libs/luna-shopper/lidl/src/lib/probe.ts`, `probe.spec.ts`, and `photo.ts` with its spec only if
D1 picks (a). Fixtures through the library's `capture-fixtures` target.

### Constraints

- The probe makes at most four requests: the listing, at most one more listing page, the
  product, the shops. Plan `0219` allows two to five per chain.
- A listing page with no grocery row is not a shape change: the probe asks for the next page once
  (one more request), and with none there either it skips the product step, still runs the shop
  step, and ends `PASSED` when those pass, naming in its step that no grocery product was read.
  Today `if (!row) return` ends the probe before the shop step; that line changes.

### Action boundaries

Stop and ask before changing the verdict rules of plan `0219` or going past four requests.

### Progress evidence

`npx nx test luna-shopper/lidl`, and the probe's `steps` from one live probe on an ephemeral slot,
quoted in the PR.

## 1. The rule

1. The product row is the first row with a path, a list price and `isGroceryCategory` true.
2. Else the first row with a path and `isGroceryCategory` true.
3. Else the next listing page, once, with the same two choices.
4. Else no product step, as section "Constraints" says.

## Tests

- A fixture listing whose first priced row is non food and a later one is grocery: the probe reads
  the grocery one.
- A listing with no grocery row on page 1 and one on page 2: one more request.
- A listing with no grocery row on two pages: `PASSED`, no product step, the step note says so.

## Acceptance criteria

- [ ] The probe never reads a row `isGroceryCategory` refuses.
- [ ] The existing probe cases keep their verdicts.
- [ ] A live probe is `PASSED`.

## Verification

Switch LIDL on in an ephemeral slot and read the newest `source_probes` row and its `steps`.

## Decisions

- **D1 (owner): a photo on another LIDL host.** (a) add `www.lidl.fr` and the other LIDL country
  hosts the walk meets to `PHOTO_HOSTS`, because it is the same chain's asset store; (b) keep
  `www.lidl.es` only. Recommended: (b) until more than a handful of rows lose a photo: one of 166
  that week, and plan `0198`'s rule is the chain's own host.
