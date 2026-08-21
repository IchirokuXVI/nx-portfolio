# Odontogram — Case Study

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed.

## The project

**Q: What is the odontogram and why did you build it (real dental use case / who's it for)?**
A: I built this odontogram for Clinica Dental Gallardo, a dental clinic that works in
Cordoba and Malaga. I created it around 2024 while I was working at Umitel Soluciones
Informaticas, and the original is still in use today.

It was, I would say, my first real frontend challenge. I had to find a lot of
workarounds to fill the tooth images with color in the specific positions that make
sense for each tooth, and I ended up learning quite a bit of geometry because of how
the zones are positioned.

## Domain model

**Q: How is the dental domain modeled (teeth numbering, tooth zones, treatment types, tooth-treatment status)? What was tricky to get right?**
A: The important thing about the data model is that teeth are not stored anywhere.
What gets saved are the treatments, together with the teeth they are applied to, and a
single treatment can affect more than one tooth. Treatments are also linked to an
odontogram, so a patient builds up a history of the treatments they have gone through.
When you create a new odontogram for a patient, you can see the history of each tooth
from the previous ones.

Each tooth is divided into zones. The crown view has five zones (top, right, bottom,
left and middle) and the front view has two (the crown seen from the front, and the
root). The only treatments possible on a root are an implant or an extraction. Every
treatment also carries a status, either pending or completed, and that status is what
drives the two colors shown on the chart.

**More on the data model.**

- Primary teeth: the model supports children. The original odontogram (the one I built
  at work, which is not exactly the same as this one) has a checkbox to toggle showing
  the deciduous teeth. That toggle is not ported to this version yet, but most of the
  work is done and it should be quick to add.
- General treatments: these are treatments that affect everything, or simply notes.
  They are not really supported here. They existed in the original, but I removed them
  from the UI because I could not find a good place to put a form for a general
  treatment. Like the deciduous teeth, they will be added later.
- Grouped vs individual teeth (`groupTeeth`): this one is tricky, and the client asked
  for it because it makes their work easier. By default a treatment is grouped. If a
  grouped treatment covers more than one tooth, the same treatment is shown on every
  affected tooth, and editing it on one tooth updates it on all of them, because it is a
  single shared treatment. If instead you mark it as individual, one separate treatment
  is created per tooth, so editing one no longer affects the others, even though they
  all started with the same information.
- The treatment catalog (`Treatment`): yes, it is a catalog where treatments are saved,
  but it is not required to use the odontogram. You can just type whatever you want as
  the treatment name and it will be saved. Think of `Treatment` as a template that
  prefills the name, description and affected zones when a treatment is added to a tooth.

> Note (Claude): The four points above resolve the earlier open questions. Two of them
> (the deciduous-teeth toggle and general treatments) are modeled but not yet exposed
> in this version's UI, so the write-up should present them as planned or partial. One
> minor naming detail worth stating: the front-crown zone is named `LATERAL` in the
> `ToothZones` enum. Teeth numbering uses FDI two-digit notation.

## The interactive chart

**Q: How is the tooth chart rendered and made interactive (SVG? per-zone hit areas? how a click maps to a tooth zone)?**
A: The chart is not SVG. Each tooth is built from image assets plus some CSS geometry.

Every tooth uses two visible images, one for the crown (top) view and one for the
front view. Each image is a PNG that comes with a matching mask image, so a background
color only fills the part of the tooth that should be colored.

The front view is the easy one. Only the front crown is colored, and since it is a
single zone I just fill the image with a background color. The root is not transparent,
so the background only shows through the correct part. The root itself can only ever
have an implant or an extraction, which I mark with bars drawn over it, so it needs no
background trick.

The crown is the complex one, with five zones that all have to be clearly
distinguishable. I create a square that is much bigger than the tooth, center it, and
rotate it with some maths so that each of the four outer zones becomes a triangle
pointing in the right direction, with a circle in the middle for the fifth zone. When a
zone has a treatment, a CSS class adds the background color to that specific zone. To
make the boundaries between zones clear I add borders, and because a border is only
wanted where two colored zones meet, I wrote SCSS mixins that work out whether a zone
is next to another colored zone and which borders it needs. It is a bit complex, but it
works wonders. Each tooth is fully independent.

> Note (Claude): Verified in `single-tooth-image.ts` / `.scss` and enriched.
> (1) There are actually four image files per tooth: `_crown.png`, `_root.png`,
> `_crown_mask.png`, `_root_mask.png`, loaded via dynamic `import()` in
> `ToothImageLoader`.
> (2) The geometry: the square is sized `sqrt(2) * 50%`, rotated 45deg plus 90deg per
> position; with `overflow: hidden` only half the diamond (a triangle) shows; the 5th
> zone is a centered circle. This is the geometry you mentioned learning.
> (3) The adjacency borders use CSS `:has()` selectors with modulo sibling math, so a
> dashed border only appears between two treated neighboring zones.
> (4) Upper vs lower teeth (quadrants 1 to 2 vs 3 to 4) are mirrored via
> `flex-direction: column-reverse` and a flipped cross/implant offset.
> (5) Caching: `ToothImageLoader` memoizes each tooth's image bundle in a `loadedImages`
> Map (the service is `providedIn: 'root'`), so a repeat load of the same tooth replays
> the resolved `shareReplay(1)` observable instead of re-running the four dynamic
> `import()`s. This was previously dead code (the Map was read but never written); it was
> fixed on dev (`5b84a32`), so the in-service cache is now real for the whole app session.

**Q: How do treatments get visualized on a tooth (colors/states per zone)?**
A: Treatments are shown in two colors, one for completed treatments and one for
pending ones, so you can tell at a glance what has already been done and what is still
outstanding. On the crown, the relevant zone is filled with the color. On the root, an
implant or an extraction is drawn with bars over the root rather than as a fill.

> Note (Claude): Small refinements from the code. An extraction is drawn as an X (a
> cross of two rotated bars) and an implant as two parallel bars, so the two are
> visually distinct, not the same mark. Also, a zone's color follows a precedence
> rule (`getToothZoneStatus`): if any treatment in that zone is pending the whole zone
> shows pending, and it only shows completed when every treatment there is completed.
> Untreated zones are white.

## Data access

**Q: There's both an in-memory service and an API service (`odontogram-memory.ts` vs `odontogram-api.ts`) behind a shared interface, tested with `*.shared-spec.ts`. Why build both, and how do you switch?**
A: The memory implementation does double duty. It backs the tests, and it lets me deploy
the app without a backend so I can share it as soon as the design is done. I have not had
time to build a backend yet, so the memory services work great in the meanwhile. The
switch between memory and API is meant to happen based on the environment, but for now
everything runs in memory mode.

> Note (Claude): Verified, with one gap to flag. Both implementations sit behind
> `OdontogramServiceI`, and the root token `ODONTOGRAM_SERVICE` defaults to
> `OdontogramMemory` via `() => inject(OdontogramMemory)` (`service-token.ts` +
> `odontogram-service.ts`). Both consumers (`feature-full-odontogram-crud.ts`,
> `tooth-treatments-modal.ts`) now inject the token typed as the interface, not the
> concrete class, so the app depends on the contract; and one
> `odontogram-service.shared-spec.ts` holds both impls to the same behavior. The gap: the
> environment-driven switch is intent, not code yet. Nothing reads `environment` to pick
> an implementation today, the token has a single hardcoded default, and no
> `provideService(ODONTOGRAM_SERVICE, OdontogramApi)` override exists anywhere. The wiring
> supports the switch (flip the default, add a `provideService` at a route/remote
> injector, or gate it on the environment), but that selection logic is still to be written.

**Q: Does the deployed app talk to a real backend (`BACK_API_*` env) or run fully in-memory as a demo? Why?**
A: **The portfolio should have a backend.** Maybe not every service will be implemented on
the backend, but most of them should be. It is not connected yet simply because I have not
started on it.

**The plan.** My idea is a microservices backend built with NestJS, Java and .NET,
deliberately using different technologies so I can learn each one. For databases I want to
try a bunch too. I have already used MySQL, PostgreSQL, MongoDB and the usual ones, so I
will reach for Cassandra and other databases that are powerful but rarely used in small
projects.

> Note (Claude): The deployed odontogram currently runs fully in memory (seeded from the
> static `ODONTOGRAMS` data), matching the Q1 answer. No backend exists in this repo yet,
> so the roadmap above is intent, not code. The consuming side is already in place though:
> `OdontogramApi` extends `ApiConsumer` and resolves its URL through `OwnApiUrlResolver`
> from the `BACK_API_DOMAIN`/`BACK_API_PATH`/`BACK_API_PORT` env values
> (`libs/shared/environments` + `libs/shared/data-access`). When a backend appears, wiring
> it up is the environment switch from Q1 plus pointing those env values at it. The
> multi-stack microservices plan (NestJS/Java/.NET, Cassandra and friends) is not
> represented in the code today.

## CRUD feature

**Q: The full CRUD feature: how is edit state managed and persisted, and what was the hardest part of the UX?**
A: **The form.** When you click a tooth you get a form that does not reuse the tooth image.
It is easier to work with plain squares because they are easier to click, so the form shows
five squares arranged in a circle for the five crown zones, plus a few more squares below
them for the front view. The form also includes a history, so you can check the status of
that tooth at any earlier point for which an odontogram exists.

**Save button instead of auto save.** Auto save caused a huge number of requests, between
500 and 1000, while the dedicated Save button generates about 10 requests per minute. I
measured this while the app was in use by two dental clinics, around 20 users in each. On
top of that, the old auto save was wired to a websocket, and clients did not notice when
someone else edited their treatments, which was a problem. A Save button makes concurrency
easier to control, because the backend can return an error if someone edited the same data,
and it gives the user more control, for example to reset the form. I do not think I will
bring auto save back.

**History is read-only.** The history is read-only for clarity. If you need to edit
something from another odontogram, you have to go into that odontogram. Otherwise you might
forget that you are looking at the history and edit the wrong data. The form has had the
restoration system since it was first implemented, so users have never lost edits.

**The hardest part.** The CRUD itself was not too difficult; the hardest part was the
history. It needs special handling, because selecting a past odontogram swaps the
treatments to the ones from that odontogram and also has to display the tooth as if it
belonged to that different odontogram.

> Note (Claude): The mechanics check out against the code. Edit state lives in the modal's
> `treatments` ObservableMap, keyed by each dynamically created `ToothTreatmentDetailedForm`
> component ref and updated as each form emits `toothTreatmentChange`. `disableForms` (a
> computed) makes the forms read-only whenever the selected tooth's odontogram is not the
> one the modal opened, and `tempTreatments` stashes the in-progress forms when you browse
> into history and restores them on return (this is the restoration system). Saving is a two
> step flow: `saveTooth()` emits `toothConfirmedChanges` with the final treatment set, and
> the parent's `onToothSelected` diffs it against the loaded treatments to fire `create`,
> `update` and `delete` through the service, batched with `forkJoin`. The auto save pipeline
> (`combineLatest` of the form outputs plus `debounceTime(250)`) is still in the code but
> gated behind `enableAutoSave = false`. One context note: the request counts, the websocket
> and the concurrency story describe the original app running at the clinic; this portfolio
> version has no backend or websocket yet (it runs in memory), so those are lessons carried
> over, not behavior of the deployed demo.

> Note (Claude): Confirmed bug in the update branch of `onToothSelected`
> (`feature-full-odontogram-crud.ts`, the `else if (foundTreatment && toothTreatment.id)`
> case). The intended "on update success, splice the updated value into `currentTreatments`"
> logic is wrapped in `req.subscribe(...)` called from inside that same `req`'s own `tap`,
> so every update re-subscribes to itself and runs the update again, recursively. With the
> memory service it is a redundant re-run; against a real backend it would send duplicate
> and potentially unbounded update requests. Fix: run the splice directly inside
> `tap((updated) => ...)` using `updated`, and drop the inner `req.subscribe`.
