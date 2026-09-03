# 0064: what 0050 still owes

> `0050` is the plan that exists so that coverage work does not get cut, and it was cut. It has
> been on `dev` since the basket landed, its number is spent, and none of the seven things in its
> acceptance criteria are done.
>
> This plan is the second attempt, written from an audit of what is actually in the tree rather
> than from what `0050` predicted would be there.
>
> Prerequisite reading: `0050` in full, which owns the reasoning for every spec named here and is
> not restated. `0044` section 3 (the join screen), `0048` sections 2.2 and 4 (the live basket and
> the socket credential) and backend `0051` sections 3 and 4 (what a participant is, and what a
> guest may be shown).

## 1. Why 0050 looks done and is not

Five of the six component spec files `0050` asked for exist. That is why nothing has chased this:
`basket-page.spec.ts`, `settle-sheet.spec.ts`, `people-sheet.spec.ts`, `share-sheet.spec.ts` and
`basket-line-row.spec.ts` are all on `dev`, and between them they hold 122 tests.

**Not one of them cites `0050`.** Every one was written later, by a feature plan that happened to
touch the same component and specced its own surface on the way past:

| File                      | Tests | Written for                                                   |
| ------------------------- | ----- | ------------------------------------------------------------- |
| `basket-page.spec.ts`     | 40    | `0038`, `0048` (the header, the face row), `0052`, `0054`     |
| `settle-sheet.spec.ts`    | 45    | `0049`, `0052`, `0054`                                        |
| `basket-line-row.spec.ts` | 28    | `0052`, `0054`                                                |
| `people-sheet.spec.ts`    | 5     | `0049` section 6 (two facts, and the copy for their absences) |
| `share-sheet.spec.ts`     | 4     | `0052` section 4 (the revoke confirm and a double tap)        |

This is coverage of the basket, and it is worth having. It is not the coverage `0050` asked for,
because `0050` asked for one thing that a feature plan never has a reason to write: **what a guest
is shown, and what a guest is not.** A feature plan specs the feature. Nobody's feature is the
absence of a zone name on a stranger's screen.

So the risk `0050` named in its own opening paragraph is still uncovered, and is now covered
less visibly than before, because the file that would hold the assertion exists and is green.

## 2. What is missing, exactly

Measured against `0050` section 7, on `dev` at the time of writing:

| `0050` asked for                                     | State                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Six component specs, each asserting guest disclosure | Five files, none asserting it; `JoinPage` has no file at all |
| `BasketApi` specced for the credential decision      | Partial. See section 6                                       |
| `BasketSessionStore` specced                         | No file                                                      |
| `GeneratedListBasketService` specced                 | No file                                                      |
| The gateway's name composition specced               | No file, and it is no longer in the gateway                  |
| One e2e following an owner and a guest               | No file. `velista-e2e` holds `landing` and `mount`           |
| Interpolated strings asserted on inputs              | Holds in what exists, and continues to                       |
| The suite run through a claimed slot                 | Holds, and section 8 does not change it                      |

Sections 3 to 8 are that table in order.

## 3. `JoinPage`

`join-page.ts` ships with no spec, and it is the file in this plan where a regression is a privacy
incident rather than a bug. Its class comment already states the claims; they simply have nothing
checking them.

- **The preview discloses four things and no more:** the list's name, the head count, and whether
  it still accepts people. No line, no zone, no list name, no member (backend `0051` section 4).
  Assert on absence, from a preview stuffed with fields the component is not supposed to draw.
- **`dead` is one state for four causes.** A revoked link, an expired one, a finished basket and a
  code that never existed must render the same sentence, and the spec asserts they are
  indistinguishable rather than asserting each. That indistinguishability is the security property,
  so the test is written to fail if somebody later adds a helpful "this link has expired".
- **The name is optional and an empty string is absence.** Skipping the field calls `join` with no
  display name, not with `''`, because the server reads absence as "give them a number".
- **Somebody already signed in never sees the screen.** With `SessionStore.isAuthenticated()` true,
  `_check` joins and navigates without ever leaving `checking`.
- **A dead link short circuits before any join is attempted**, and an empty secret never reaches
  the service at all.
- **`failed` keeps the offer on screen.** A link that dies between the preview and the tap leaves
  the primary action tappable, because the person is standing in a shop.

## 4. `BasketPage`, the cast that is missing

`basket-page.spec.ts` stays as it is and grows one `describe`. `0050` called this the most
valuable spec in the plan and it is still the one worth writing.

Two casts over the same component:

- **A guest** sees lines, quantities and outstanding amounts. Never a zone, never a list name,
  never the settlement history, never the allocation sheet.
- **A registered participant holding `WRITE`** sees those, and **loses them on the next request**
  when that stops being true. The losing half is the assertion: permission is re-read per request
  (backend `0051` section 3.3), so a screen that cached the privileged view at load is the defect,
  and it is invisible to a spec that only ever renders one cast.

Assert on rendered structure for presence and absence, and on component inputs for anything
interpolated, which is most of the basket's copy.

## 5. `ShareSheet`, what revoking actually does

Four tests exist and all four are about a double tap. `0050`'s claims about the link itself are
unwritten:

- Revoking stops new joins and **leaves people already shopping working**. These are separate
  outcomes of one action and the second is the one nobody would think to check.
- The cascade, which does remove people already shopping, is a **separate and explicit** choice.
- The live link is copyable at any time, and there is **at most one**.

## 6. `BasketApi` and `BasketSessionStore`

### 6.1 What `participant-token-never-travels.spec.ts` already covers

That file is `0048` section 2.2: the short lived **socket token** reaches the socket and nothing
else. Five tests, and one of them ("does not travel on a guest's next request either") does assert
that a guest's HTTP call carries no `Authorization` header.

It asserts nothing about `x-participant-secret`. The two credentials are different objects and the
file is scoped to the wrong one, so `0050` section 4's positive case is open.

### 6.2 What `BasketApi` still needs

The credential decision in `_participant()` is one ternary and three outcomes:

- A guest's call carries `PARTICIPANT_SECRET_HEADER` with the secret for **that** basket, and no
  bearer token.
- A registered participant's and the owner's call carries the bearer token and **no** secret header.
- A guest holding a session for basket A makes a request about basket B and sends **neither** A's
  secret nor anything else of A's. The store is keyed per basket precisely so this cannot happen,
  and the test is what keeps that true.
- `previewLink` and `join` go out with `anonymous()`, so a stale account token cannot ride along.

### 6.3 What `BasketSessionStore` still needs

No spec file at all. Four claims, all of which its class comment already makes:

- **It survives a reload.** A guest's secret is returned once and stored hashed on the server, so
  a browser that forgets it makes that person a different participant with a new `Guest N` and
  none of their settlements attributed. This is the failure the store exists to prevent.
- **One session per basket, not one per person.** Writing a session for basket A does not disturb
  basket B, and reading B returns null while A is held.
- **A refused secret is dropped, not retried.** `forget` on a 401, and the reader lands on the
  join screen rather than in a basket that refuses every action.
- **Unparseable storage reads as absent.** Half written or from an older version of the app, it
  returns null rather than throwing, and `_revive` rejects an object missing `participantId` or
  `socketToken`. A `secret` of null is a real value (the owner and registered participants hold
  none), so it must not be treated as a broken record.

## 7. The backend half, and a correction to 0050

`0050` section 5 named two backend gaps. One has moved since it was written, and this plan
restates it rather than leaving the stale pointer:

- **`GeneratedListBasketService`** still has no spec. `getBasket` and `setPick`, and `setPick`
  above all, because it is the write any guest may make and its access check is the whole of what
  stands between a link holder and somebody else's basket. `generated-list-basket-add.spec.ts`
  exists and covers adding, not these.
- **The name composition is in core now, not the gateway.** `sourceNames` lives in
  `generated-list.mappers.ts` and `generated-list-basket.service.ts`. It is what lets a guest read
  product names with no account, so its failure mode is either names missing from a stranger's
  basket or a catalog read happening without the redaction the basket route applies. Spec it where
  it is.

The settle redaction is specced and stays as it is.

## 8. The e2e, and the stack it needs

One spec, the five steps in `0050` section 6, unchanged. They are not repeated here.

Two things `0050` did not have to say and this plan does.

**The reload is gone.** `0050` was written before `0048` and hedged that steps 3 and 4 would need
a reload until it landed. `0048` is on `dev`, so the guest's settle and the owner's view of it
cross over the socket, and the spec asserts the propagation rather than working around its
absence.

**There is no stack that runs this today, and that is the real cost of this section.** The two CI
gates are disjoint: `e2e-frontend` brings up `k8s/e2e/portfolio-frontend/compose.yml`, which is
images and a reverse proxy and no backend at all, and `e2e-luna` brings up the Luna compose pair
with `E2E_SEED=1` and drives `luna-shopper-backend-e2e`, which never opens a browser. This spec is
the first in the repo that needs both at once, because the thing under test is the seam between an
account session and a participant session and neither half can hold it alone.

Locally that is already solved and needs no new tooling: an app slot through `ng-slot.sh --up`
with every remote served (serving only shell and velista makes the shell render an empty body and
every test fail for a reason that looks nothing like the cause), pointed at a Luna slot with
`--backend-slot`, and `BASE_URL` set to the slot's shell so `playwright.config.ts` suppresses its
own `webServer`.

CI is an open decision and this plan does not pick for it:

- **Extend `e2e-frontend`** to bring up the Luna compose pair beside the frontend compose, so one
  gate owns everything a browser touches.
- **A third gate** that composes both, leaving the existing two alone.

Whichever it is, the spec needs an owner account to sign in as, which means the seeded fixtures
(`E2E_SEED=1`, backend `0013`) rather than registering through Mailpit inside the test.

## 9. Acceptance criteria

- `join-page.spec.ts` exists and asserts the preview's four fields, the four causes collapsing to
  one `dead` state, absence rather than an empty name, and the signed in shortcut.
- `basket-page.spec.ts` holds a guest cast and a privileged cast, and the privileged one loses its
  view on the next request rather than at reload.
- `share-sheet.spec.ts` asserts that revoking stops new joins and leaves current shoppers working,
  that the cascade is separate, and that there is one live link.
- `BasketApi` is specced for all three credential outcomes, including a guest's secret not reaching
  another basket.
- `basket-session-store.spec.ts` exists and covers persistence, per basket scoping, a refused
  secret and unparseable storage.
- `GeneratedListBasketService` and the `sourceNames` composition have specs, in core.
- One e2e follows an owner and a guest through a shared basket, including the revoke, with no
  reload standing in for the socket.
- The e2e runs in CI against a stack holding both halves, by whichever of section 8's two options
  is chosen.
- Every interpolated string is asserted on a component input, never on rendered text.

## 10. Out of scope

- **Rewriting the 122 tests that exist.** They cover their own plans correctly. This plan adds and
  does not touch them, except to grow `basket-page.spec.ts` and `share-sheet.spec.ts` by a
  `describe` each.
- **`0058`.** It is the other thing missing from velista and it is a feature, not coverage. It gets
  its own branch.
- **A visual regression suite**, and **load or concurrency testing of the basket.** Both were out
  of scope in `0050` and are still.
- **Backfilling specs for anything outside `0044`'s surface**, which remains `0047` section 7's
  business.
