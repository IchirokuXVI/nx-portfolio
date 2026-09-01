# 0050: specs for the basket, and an e2e that shops

> Velista `0044` shipped six components and two data access classes with no tests of their own.
> `JoinPage`, `BasketPage`, `BasketLineRow`, `SettleSheet`, `PeopleSheet` and `ShareSheet` have
> no rendering specs at all; `BasketApi` and `BasketSessionStore` have none either. What was
> tested was the pure functions (`basket-labels`, 21 specs), the store (`basket-store`, 18),
> the route table and the settle redaction, which is a sensible place to stop under time
> pressure and is not where this feature's risk lives.
>
> The risk lives in **credentials and in what a guest can see**, and neither is covered by a
> pure function test. `BasketApi` decides whether a request goes out with a guest's secret on
> `x-participant-secret` or with an account bearer token, which is the one piece of logic in
> that file and the one whose failure mode is either a guest locked out or a guest
> authenticated as somebody else. Six components decide what a guest is shown.

## 1. Why this is its own plan

Because the alternative is that it never happens. Coverage work attached to a feature plan is
the part that gets cut when the feature is running late, which is precisely what happened here:
`0044` was stacked three deep and, as it turns out, never ran CI at all before it merged.

It is also the plan where the repo's accumulated testing traps are worth writing down in one
place, because every one of them cost somebody an afternoon and all of them are about to be hit
again by whoever writes these six spec files.

## 2. The traps, stated once

These are established facts about this workspace, not advice.

- **`whenStable` hangs under fake timers** in zoneless specs. Drain microtasks instead.
- **jsdom has no `PointerEvent` and no `scrollIntoView`.** The basket's rows and sheets use
  both. They are stubbed, per the existing pattern.
- **The testing translator does not interpolate.** Any string with `{{ }}` in it must be
  asserted on the **component input**, never on rendered text. The basket is full of
  interpolated copy ("Marc got 2", "N of M finished"), so this applies to most of what these
  specs want to assert.
- **A Cypress e2e project does not compile as scaffolded.** Two tsconfig and `commands.ts`
  fixes are needed; they are recorded and are not rediscovered here.
- **A velista e2e run needs every remote served, not just shell and velista.** Serving only
  the two makes the shell render an empty body and every test fail for a reason that looks
  nothing like the cause.
- **Serving anything happens through the slot scripts.** `ng-slot.sh --list` before claiming,
  `--up` to take the lowest free slot, and a backend that is already listening rather than a
  new Luna slot, unless the work needs one.

## 3. The component specs

Six files, and for each the thing worth asserting is what it shows to whom rather than that it
renders.

- **`JoinPage`.** The preview discloses no line, no list, no zone and no member (`0051`'s exit
  criterion, and the one where a regression is a privacy incident rather than a bug). Naming
  yourself is optional; skipping it yields a stable "Guest N" that survives a reload; somebody
  already signed in never sees the screen.
- **`BasketPage`.** A guest sees lines, quantities and outstanding amounts, and never a zone, a
  list name, a settlement history or the allocation sheet. A registered participant sees those
  while holding `WRITE` and loses them on the next request when that stops being true. This is
  one spec file with two casts, and it is the most valuable in the plan.
- **`BasketLineRow`.** The picked product is named; anyone, guests included, can swap it;
  attribution says who touched it last and marks a guest as a guest without the word
  "anonymous".
- **`SettleSheet`.** A whole settle, a partial submit, and the allocation sheet write the same
  settlement. A partial shows what was submitted and what is outstanding, and a second settle
  finishes it. Neither of the first two mentions a list.
- **`PeopleSheet`.** Guests and registered people listed together, no sentence, no guest
  learning another's device.
- **`ShareSheet`.** Revoking stops new joins and leaves people already shopping working; the
  cascade is a separate, explicit choice; the live link is copyable at any time and there is at
  most one.

## 4. `BasketApi` and `BasketSessionStore`

`BasketApi` gets specs for the credential decision specifically:

- A guest's call carries the participant secret and **no** bearer token.
- A registered participant's call carries the bearer token.
- A participant credential never travels on an account scoped request. (`0048` adds the
  matching assertion for the socket token; this is the HTTP half of the same rule.)

`BasketSessionStore` gets specs for persistence across a reload, for holding one session per
basket rather than one globally, and for what happens when a stored secret is refused: the
session is dropped rather than retried into a loop.

## 5. The backend half that `0044` also left untested

Recorded here rather than in a backend plan, because it is the same body of work from the same
branch and splitting it would lose that:

- **`GeneratedListBasketService`** has no spec, covering `getBasket` and `setPick`. `setPick`
  is the write any guest may make, so its access check is worth a test.
- **The gateway's product and `sourceNames` composition** has none. That composition is what
  lets a guest read names with no account, so its failure mode is either names missing or a
  catalog read happening without the redaction the basket route applies.

The settle redaction **is** specced, and stays as it is.

## 6. The e2e

One spec, following one trip end to end, because the value here is the seam between the owner's
account session and a guest's participant session and no unit test crosses it.

1. An owner generates a basket and copies its link.
2. A second browser context, signed in to nothing, opens the link, skips the name, and lands in
   the basket as "Guest 1".
3. The guest settles a line partially. The owner's basket shows the outstanding remainder.
4. The guest swaps a line's picked product. The owner sees the swap and the attribution.
5. The owner revokes the link. The guest's next action is refused, on screen, without the
   screen closing.

Step 3 and step 4 are the assertions that only exist here: two sessions, two credentials, one
basket. Once `0048` lands they run without the reload the current implementation needs, and the
spec is written so that the reload is not what it is asserting.

## 7. Acceptance criteria

- Six component spec files exist, and each asserts what its screen shows to a guest as well as
  to a privileged reader.
- `BasketApi` is specced for the credential decision, including the negative case.
- `BasketSessionStore` is specced for persistence, per basket scoping and a refused secret.
- `GeneratedListBasketService` and the gateway's name composition have specs.
- One e2e follows an owner and a guest through a shared basket, including a revoke.
- Every interpolated string is asserted on a component input rather than on rendered text.
- The suite runs against a slot claimed through `ng-slot.sh`, with every remote served.

## 8. Out of scope

- **Backfilling specs for anything outside `0044`'s surface.** `0043`'s two screens are
  `0047` section 7; this plan does not reach further.
- **A visual regression suite.** Different problem, different tooling, not proposed here.
- **Load or concurrency testing of the basket.** Three people on one basket is the e2e's
  cast; contention is not what these specs are for.
