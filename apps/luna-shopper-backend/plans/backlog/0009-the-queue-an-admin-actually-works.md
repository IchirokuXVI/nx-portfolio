# 0009 (backlog) The queue an admin actually works

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: parked, and most of what it was written for has been built by other plans.**
> What is left is one rule and the measurement that rule waits on. This file was originally the
> whole first administrative surface in the product, and section 1 records what took that over.

## 1. What was built by other plans, and what is left

This plan was written when there was no admin UI anywhere in this workspace. Since then:

- **The surface exists.** `luna-shopper-admin` is a deployed app with its own auth, layout and
  design system. The three options this plan weighed for where a review console should live were
  answered by `apps/luna-shopper-admin/plans/0001`, and the answer was none of them: an app of its
  own, outside the portfolio's module federation host.
- **The place review queue exists.** `places-queue-page.ts` lists discovered places, imports one
  with `import()` and refuses one with `reject()`, exactly as the backend always supported. Admin
  plan `0014` unified it with the other queues and `0020` gives it a list view and bulk decisions.
- **Three of the four bullets in "what the queue needs to show" moved out**, into
  `plans/0097` and `apps/luna-shopper-admin/plans/0021`: the postal code a place sits in, the count
  of profiles waiting on a code, and the failed rows of `0063` shown as their own screen.

**Two things are left, and they are the two this plan is actually about**: the rule in section 3,
and the measurement in section 2 that the rule waits on.

## 2. The question to answer before designing anything

**How many decisions is a postal code, really?**

`0038` measured 75 places in one city radius, of which 35 had no brand tag at all. If that is
representative, every new postal code is a few dozen judgement calls, most of them about
independent corner shops with no price source and therefore little value on the screen they would
appear on.

That is manageable for one city and unbounded for a country, and the difference decides whether
this is a queue somebody works through or a rule that runs itself.

**`plans/0097` is what produces the number.** Places found and places accepted, per postal code, on
one screen, is this measurement taken against real data rather than estimated from one run. So the
order is: ship that screen, read it for a while, then come back here.

## 3. The design this probably wants instead

If section 2's number is large, a queue is the wrong shape and the right one is a **rule with a
queue for the remainder**:

- **A place whose `brandKey` matches a `Supermarket` already in the catalog is imported
  automatically.** A new Mercadona is not a judgement call. The chain exists, the scope machinery
  exists, and a human confirming it adds nothing but delay.
- **A place with a brand we do not carry** queues, because importing it creates a chain, and
  `import()`'s own doc explains why that is deliberately not automatic: one run returns 17 brands
  and creating a `Supermarket` for each would clutter the catalog with chains nobody shops.
- **A place with no brand at all** queues, or is deferred indefinitely. This is the OTHER bucket in
  `apps/velista/plans/0059`, it is roughly half the volume, and it is the half with the least value
  per row and the most work per row.

That cuts the human queue to new chains only, which is a handful per city rather than dozens per
postal code, and it makes the common case (a city where we already carry the chains) instant.

**It is also a real reversal of `0038`'s "the run creates nothing in catalog", narrowed to the case
that decision was not really about.** The objection there was filling the catalog with corner
shops, and this rule imports none of them. Whoever picks this up writes that reversal down
explicitly, in the runner's own doc, rather than letting the code and the comment disagree.

## 4. What the queue still needs to show

The place's own fields are drawn already: name, brand, address, city, coordinates, opening hours and
its OSM link, in `place-view.ts`, with near duplicates beside them from admin plan `0011`.

One item from the original list is neither built nor moved:

- **A map pin.** Reviewing is a visual act and a map is worth more than any of the fields. The
  coordinates have always been on the row and nothing draws them. It is left here rather than in
  `0097` because it is a component decision for the admin app, not a backend one.

## 5. Why it is still parked

The rule in section 3 is a real behaviour change in the catalog, made on the strength of a number
nobody has measured yet. Building it before reading `0097`'s screen for a month would be building
the wrong rule carefully, which is what this plan said the first time and is still the reason.

Meanwhile the consequence it was parked against has softened: the review queue is worked through a
real screen now, so the places a run finds do get imported, and velista's "no supermarkets yet"
sentence stops being permanent for any code somebody looks at.
