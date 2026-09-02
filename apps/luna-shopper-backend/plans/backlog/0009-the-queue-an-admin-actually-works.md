# 0009 (backlog) The queue an admin actually works

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: parked, and the only plan in this directory that gates a shipped feature's value.**
> `apps/velista/plans/0058` draws a screen of the supermarkets near you. `0062` fills a review
> queue with candidates. **Nothing imports them**, so that screen renders "we don't have
> supermarkets for that postal code yet" until a person acts, and there is no surface for a person
> to act on. This plan is that surface. It is parked because the feature ships coherently without
> it and because section 3 is a question that should be answered with real numbers rather than
> designed around now.

## 1. What already exists, and what does not

**The backend is complete.** `DiscoveredPlaceService` lists with a status filter, `import()`
creates the catalog location and the chain on demand, `reject()` marks a place refused, and
`DiscoveredPlaceStatus` records the outcome so a re run never resurrects a decision:

> `status` is the owner's, and a run does not get to overwrite a decision.

**Nothing consumes any of it.** There is no admin UI anywhere in this workspace. No route, no page,
no app. Every import that has ever happened happened through the API by hand.

So this plan is not backend work. It is the first administrative surface in the product, and that
is most of why it is bigger than it sounds.

## 2. Where it would live

Three options, none obviously right, which is another reason to park rather than guess.

- **Inside velista, behind an admin check.** Cheapest by far: the app, the auth, the layout, the
  design system and the deployment all exist, and `PlatformAdminService.requireAdmin` already gates
  the endpoints. The cost is that a consumer shopping app grows an operations console inside it,
  and every user downloads the bundle for a screen three people can open.
- **A remote of its own in the portfolio.** Matches how this workspace already separates concerns,
  and adds a sixth micro frontend, a Dockerfile, a values entry, an `HTTPRoute` and a build to CI
  for a screen with one job.
- **No UI at all: a CLI or a script.** Honest about the audience, which is one person. Ugly, and
  the reviewing task is visual (a name, an address, a map pin, a brand guess) in a way a terminal
  serves badly.

## 3. The question to answer before designing anything

**How many decisions is a postal code, really?**

`0038` measured 75 places in one city radius, of which 35 had no brand tag at all. If that is
representative, every new postal code is a few dozen judgement calls, most of them about
independent corner shops with no price source and therefore little value on the screen they would
appear on.

That is manageable for one city and unbounded for a country, and the difference decides whether
this is a queue somebody works through or a rule that runs itself. It is measurable today, against
the discovered places a dev slot already holds, and it should be measured before a screen is drawn.

## 4. The design this probably wants instead

If section 3's number is large, a queue is the wrong shape and the right one is a **rule with a
queue for the remainder**:

- **A place whose `brandKey` matches a `Supermarket` already in the catalog is imported
  automatically.** A new Mercadona is not a judgement call. The chain exists, the scope machinery
  exists, and a human confirming it adds nothing but delay.
- **A place with a brand we do not carry** queues, because importing it creates a chain, and
  `import()`'s own doc explains why that is deliberately not automatic: one run returns 17 brands
  and creating a `Supermarket` for each would clutter the catalog with chains nobody shops.
- **A place with no brand at all** queues, or is deferred indefinitely. This is the OTHER bucket in
  `apps/velista/plans/0058`, it is roughly half the volume, and it is the half with the least value
  per row and the most work per row.

That cuts the human queue to new chains only, which is a handful per city rather than dozens per
postal code, and it makes the common case (a city where we already carry the chains) instant.

**It is also a real reversal of `0038`'s "the run creates nothing in catalog", narrowed to the case
that decision was not really about.** The objection there was filling the catalog with corner
shops, and this rule imports none of them. Whoever picks this up writes that reversal down
explicitly, in the runner's own doc, rather than letting the code and the comment disagree.

## 5. What the queue needs to show, whatever its shape

- The place: name, brand, address, city, coordinates, opening hours, and its OSM link. Reviewing is
  a visual act and a map pin is worth more than any of the fields.
- **Which postal code it is in**, which is only reliably answerable after `0060` gives the same
  nearest centroid treatment to `DiscoveredPlace` that it gives to `SupermarketLocation`. The OSM
  tag alone is a third populated.
- **How many profiles are waiting on that postal code**, which is the only real prioritisation
  signal and lives in core rather than the harvester. Approximate is fine; a cross service exact
  count is not worth a round trip per row.
- The failed rows from `0062`'s queue, separately. A postal code Nominatim cannot geocode usually
  means the user typed a code that does not exist, and that is worth seeing.

## 6. Why it is parked and not scheduled

The feature it unblocks ships without it, degraded but coherent and honest: a user adds a postal
code, the screen says we have no supermarkets there yet, and that sentence is true. Nothing is
broken and nothing lies.

Meanwhile the two things that would change this plan's design are both cheap and both not done:
the measurement in section 3, and whether section 4's rule removes enough work to make a queue
unnecessary. Building a review console before either would be building the wrong one carefully.
