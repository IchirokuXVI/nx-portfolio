# 0038 A map is reviewed, and its order checked

> Back office half of backend `0168`. Needs `0037` (sections and pins have screens) and
> `libs/luna-shopper/shop-map/editor/plans/0001` (the viewer). Prerequisite reading: backend
> `0168` sections 3 and 4 (acceptance and the preview), the editor plan's section 1 (the
> mount API and the Angular adapter rule), admin `0035` (queues with a review step), and
> the `admin-app` notes on `QueueFrame`.

A map a shopper submitted is shown to nobody until an operator has looked at it. Looking at
it means seeing the drawing, seeing what accepting it will do to the shop's section order
and pins, and then accepting or rejecting with a note. This plan is that screen, plus the
map on the location screen once it is current.

## Brief for the agent

### Objective

Add a shop maps queue with a stylized viewer and the acceptance preview, accept and reject
actions, and a "Map" tab on the location screen showing the current map, its versions and
the derived order. Use the `nx-portfolio-angular-developer` skill and `design-taste-frontend`
for the review layout.

### Context

- **The queue pattern**: `QueueFrame` owns selection and a row template, and a page keeps its
  `queue` in a signal (`admin-app` notes). `0035` added review steps before writes.
- **The viewer**: `mountShopMap(host, { mode: 'view', ... })` from
  `@portfolio/luna-shopper/shop-map/editor`, framework free. The admin wraps it in a
  component of its own. The rule in that plan says an Angular adapter library is created
  only if the wrapper grows beyond mounting, destroying and forwarding, or a second host
  needs the same glue. Velista `0121` is the other host, and this plan and that one each
  write their own wrapper first and say in their "decisions taken" section whether the
  rule was hit.
- **The wire** (backend `0168` section 4): `ShopMapView`, `ShopMapAcceptancePreview`,
  the queue route, accept and reject, `locations/:id/maps` for an operator's own document,
  and the outline read.
- **The location screen** already has the sections panel of `0037`, which says when the
  list was written by a map.

### Target state

1. **Queue**, `/catalog/shop-maps`: pending maps with shop, chain, submitter, date, and
   the count of anchors. Opening one shows the viewer with the route highlighted, the
   acceptance preview beside it (sections in walk order with "will create" marks, pins with
   unresolved barcodes marked, whether the walk ends at a checkout), the problems if any,
   and Accept and Reject. Reject asks for a note. A map with problems has Accept disabled.
2. **Location screen, Map tab**: the current map in the viewer, its version and date, the
   history of versions with their status and note, and the derived section order beside
   the sections panel of `0037`, which now reads "written by map v3" and warns that a hand
   edit is overwritten by the next acceptance.
3. **Operator's own map**: the Map tab accepts a JSON file exported from velista's editor
   and posts it to `locations/:id/maps`, which accepts it in the same call. There is no
   editor in the back office. A map is drawn on a phone, in the shop.
4. **Twins and specs**: the in memory gateway holds one pending map and one current map on
   the seed shop. Screen specs cover the queue, an acceptance, a rejection and the tab.

### Scope

Work only in `libs/luna-shopper-admin/feature-catalog` (a `shop-maps` queue page, a
`ShopMapViewer` wrapper component, the location Map tab), `data-access` and its twins,
`ui/assets/i18n/en.json`, `apps/luna-shopper-admin/src/app/sections.ts`, the specs, and the
generated wire types only by running the generator.

Do not touch: the backend, the editor library, velista, the sections panel of `0037` beyond
the sentence it shows.

### Constraints

- The viewer is the shared library. The admin draws no map of its own and stores no image.
- Every accept shows the preview first. Nothing is accepted from the list row.
- `no-literal-resource-path.spec.ts` still passes.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: an editor in the back office, accepting a map with problems, creating
the Angular adapter library, or a bulk accept.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched libraries, `npx nx build luna-shopper-admin`, and a walk over HTTP against a
slot serving backend `0168`: submit the supermarket fixture from velista or by file, open it
in the queue, read the preview, accept, and see the location's sections panel in walk order.

## 1. Not in this plan

- Moderation beyond accept and reject: backlog `0017`.
- Editing a map in the back office.
- A diff between two versions.
