# Priorities and fix plans for the velista e2e report of 2026-10-16

This note ranks every finding of `2026-10-16-velista-e2e-slot1.md` and names the plan that
fixes it. Each plan was written against `dev` at `d73a36b8` after reading the code, so where
the report's cause and the code disagree, the plan says so. The ranking is mine. The owner
decides what is built and in which order.

## The scale

| priority | meaning |
| --- | --- |
| P1 | fix before anything else: data reaches the wrong person, or a whole group of people cannot use the app |
| P2 | next: a purchase is lost or misattributed, money is wrong, or a person is left with no way forward |
| P3 | soon: the screen draws the wrong state, loses data on reload, or a control does not do what it says |
| P4 | later: copy, polish, accessibility, performance |
| P5 | not planned: needs the owner's decision, or the cost is out of proportion |

Two findings in the report's top ten moved. Browser back from a cold deep link (F7.2) is
P5, because the current behaviour is the designed safe error of `AppHistory` (CLAUDE.md,
"to count too few entries is the safe error") and trapping the browser's own back button is
a product decision. The raw gone key (F4.3) stays P3 by impact, but it is a one line
regression and rides in the first list plan.

## The plans, in build order

| order | plan | fixes | why here |
| --- | --- | --- | --- |
| 1 | backend `0212` a private list speaks only to its readers | F4.1, plus a second leak the report missed (`list.myAccessChanged` to the zone room) | P1, privacy |
| 2 | rokutranslator `0006` a browser with no supported language gets the default | F7.1, F7.5, F1.1 | P1, every French, German, Portuguese or Italian phone is locked out |
| 3 | velista `0151` a tap never undoes another person's buy | F6.1, F6.2, F5.5 | P2, a purchase lost with no word |
| 4 | velista `0155` a basket event reaches the open page, over one socket | F5.1, F5.11 | P2, cheap, and it makes several other tabs honest |
| 5 | velista `0154` the share link page and the basket page answer every reader | F6.5, F6.4, F5.4, F6.6, F6.7, F6.8, F6.9, F4.7, the Google button | P2, dead ends on the entry path of a guest |
| 6 | velista `0158` the list page draws what the server holds | F3.2, F3.3, F2.2, F4.9, F3.5; stage 2 F3.4 | P3, and `0152` needs its first item |
| 7 | velista `0152` what a switch or a link gave can be taken back | F4.2, F6.3 (copy), F4.10 | P2 for F4.2; after `0158` |
| 8 | velista `0153` a chosen shop prices only what it sells | F5.2; stage 2 F5.3, S17 | P2, wrong money under a shop's name |
| 9 | backend `0213` the basket names every chain of the profile | F5.3, S17 | needed by `0153` stage 2 |
| 10 | backend `0214` a product add merges by product, a line carries its comment count | F3.1, F3.4; optional `hasLists` for F2.2 | P3, both majors |
| 11 | velista `0156` a list or line you cannot read says one thing | F4.3, F7.6, F4.4, S12, F4.5, F7.7, F7.8 | P3 |
| 12 | velista `0157` a group URL answers when the group is not readable or not yet loaded | F2.6, F4.6, F2.7, F2.8 | P3 |
| 13 | velista `0159` a write that the network dropped is reported, not forgotten | F7.3, F7.9 | P3, needs a small design (a ledger, no outbox) |
| 14 | velista `0160` a form says what is wrong before the request | F2.1, F1.5, S3, F7.4 | P3 for F2.1, the rest P4 |

Plans 1 and 2 are independent of everything. Plans 3, 4 and 5 are independent of each other.
Plan 7 needs plan 6's first item. Plan 8's second stage needs plan 9. Plan 6's second stage
needs plan 10. Plans 11 and 12 both touch `zone-guards.ts` in different functions and merge
in either order.

## Every scenario finding

| id | severity in the report | priority | plan | note |
| --- | --- | --- | --- | --- |
| F4.1 | blocker | P1 | backend 0212 | verified; the presence room is the fix, and velista changes nothing |
| F7.1 | blocker | P1 | rokutranslator 0006 | the real abort is a swallowed throw in namespace registration, one step after the report's line |
| F6.1 | major | P2 | velista 0151 | the row knows who acted last; another person's buy is undone from the sheet only |
| F4.2 | major | P2 | velista 0152 | the bulk revoke route already exists; no backend change |
| F5.2 | major | P2 | velista 0153 | verified |
| F6.3 | major | P2 | velista 0152 | the cascade is documented backend intent (plan 0114); the copy is wrong, not the behaviour |
| F7.3 | major | P3 | velista 0159 | no outbox by decision D6; a ledger and a "send it again" |
| F6.5 | major | P2 | velista 0154 | verified, one missing try/catch |
| F7.2 | major | P5 | none | the designed safe error; trapping browser back is the owner's call |
| F4.3 | major | P3 | velista 0156 | a regression of plan 0083; a spec asserts the raw key |
| F2.1 | major | P3 | velista 0160 | the client mirrors the server rule and marks the field |
| F2.2 | major | P3 | velista 0158 | staff fixed on the client; a plain member needs `hasLists` from backend 0214 |
| F3.1 | major | P3 | backend 0214 | the merge key leads with the folded name even for unnamed product lines |
| F3.2 | major | P3 | velista 0158 | verified, one constructor copy |
| F3.3 | major | P3 | velista 0158 | a read with no version check overwrites the PATCH answer |
| F3.4 | major | P3 | backend 0214, velista 0158 stage 2 | one batched count on the lines read |
| F5.1 | major | P2 | velista 0155 | verified, the event payload is not the view |
| F5.3 | major | P2 | backend 0213, velista 0153 stage 2 | the gateway names only the scopes that quote the basket |
| F5.4 | major | P2 | velista 0154 | the store knows only "held a secret or not" |
| F6.2 | major | P2 | velista 0151 | the copy exists; the error is cleared by a quiet read and the count is not passed |
| F6.4 | major | P2 | velista 0154 | every error is drawn as a network hiccup |
| F1.1 | minor | P3 | rokutranslator 0006 | the guard does not re-run on a child param change |
| F1.2 | minor | P4 | none | copy of the place step; say "in 14013" or count the nearby codes |
| F1.3 | minor | P4 | none | setup place after browser back; read the saved code |
| F1.4 | minor | P4 | none | the done step reads an in memory signal |
| F1.5 | minor | P4 | velista 0160 | `novalidate` on five forms |
| F1.6 | minor | P4 | none | `me` read twice on every cold load; a performance plan of its own, about 200 ms per load on a slot |
| F1.7 | cosmetic | P4 | none | a warning on a code the app added |
| F2.3 | minor | P4 | none | a member who reuses the invite; needs a backend code for "already a member" |
| F2.4 | minor | P4 | none | `refusedZones` is never cleared on approval; small plan with F2.5 |
| F2.5 | minor | P4 | none | with F2.4 |
| F2.6 | minor | P3 | velista 0157 | one block with two texts |
| F2.7 | minor | P3 | velista 0157 | the guard reads only the cache |
| F2.8 | minor | P3 | velista 0157 | same guard |
| F2.9 | minor | P4 | none | the copy link fallback is unreachable without Web Share; one condition |
| F2.10 | minor | P4 | none | a turned down person can ask again at once; a backend cooldown |
| F2.11 | minor | P4 | none | setup swallows the join confirmation |
| F2.12 | cosmetic | P4 | none | nested `main` landmarks; likely one layout change |
| F2.13 | cosmetic | P5 | none | register `displayName` ignored; intent unknown |
| F3.5 | minor | P4 | velista 0158 | one key |
| F3.6 | minor | P4 | none | the known search ranking issue |
| F3.7 | cosmetic | P4 | none | the "already on your list" card names the line in the adder's language; goes away with backend 0214 for new lines |
| F3.8 | minor | P5 | none | a member cannot give a product to his own free text line; looks deliberate, owner's call |
| F4.4 | minor | P3 | velista 0156 | the outlets are unconditional |
| F4.5 | minor | P3 | velista 0156 | the line page knows no `gone` |
| F4.6 | minor | P3 | velista 0157 | with F2.6 |
| F4.7 | minor | P3 | velista 0154 | `returnUrl` from the auth guard |
| F4.8 | minor | P4 | none | the composer suggests on a 300 character string; cap the query length client side |
| F4.9 | minor | P3 | velista 0158 | the live row drops its counts |
| F4.10 | cosmetic | P4 | velista 0152 | one key |
| F5.5 | minor | P3 | velista 0151 | the copy exists |
| F5.6 | minor | P5 | none | freezing a finished trip's amounts needs recorded prices on the row view and a product decision on "left" |
| F5.7 | minor | P4 | none | the filter sheet reads the whole basket; performance |
| F5.8 | cosmetic | P4 | none | sheets span 1440 px on desktop; one max width |
| F5.9 | cosmetic | P4 | none | banners with no gutter |
| F5.10 | minor | P4 | none | a deleted line stays crossed in the live basket; plan 0209 decided the finished case, the live case needs a rule |
| F5.11 | minor | P2 | velista 0155 | three sockets from one provider spread twice |
| F6.6 | minor | P3 | velista 0154 | `returnUrl` |
| F6.7 | minor | P3 | velista 0154 | hide the visit notice outside `ready` |
| F6.8 | minor | P3 | velista 0154 | an ended marker survives the reload |
| F6.9 | minor | P3 | velista 0154 | one action on the dead page |
| F6.10 | minor | P4 | none | Escape after "Create a link"; focus falls to body when the button is replaced |
| F7.4 | minor | P4 | velista 0160 | `maxlength` cuts before the normalizer |
| F7.5 | minor | P3 | rokutranslator 0006 | `documentElement.lang` in the locale store |
| F7.6 | minor | P3 | velista 0156 | a canonical lower case redirect |
| F7.7 | minor | P3 | velista 0156 | the zone 404 is ignored when the lines answer |
| F7.8 | minor | P3 | velista 0156 | neutral copy; a redirect needs a backend read |
| F7.9 | minor | P4 | velista 0159 | dev only, production precaches every chunk |
| F7.10 | minor | P4 | none | a long name is never readable in full; a detail sheet title or a wrap |

## The scoring pass findings

| ids | theme | priority | plan |
| --- | --- | --- | --- |
| S12 | blank sheets over a forbidden list | P3 | velista 0156 |
| S17 | the shop count changes between opens | P3 | backend 0213 |
| S3 | the short password rule after a round trip | P4 | velista 0160 |
| S31 | the unstyled 404 with no way back | P3 | after plan 0150 (PR #741), which replaces the component and adds no link on purpose |
| S2, S6, S7, S8, S21 | focus rings, contrast of destructive and disabled buttons | P4 | one "buttons and focus" polish plan |
| S5, S41 | Carrefour listed with no shop nearby; Deza missing from the catalog supermarket page | P4 | none; both read a chain list that is not the shop list |
| S9, S23, S25, S37, S40 | counts and bars that disagree with the rows | P4 | one "counts agree" plan |
| S11 | chain logos hot linked from four external hosts | P4 | own plan; also a privacy and reliability point, every page load calls four third party hosts |
| S14, S15, S16, S34 | basket row layout on long names, the reel over a chip, a sticky button over a row | P4 | one basket layout plan |
| S20, S24, S28, S30 | shared basket state for a member or a guest | P4 | after velista 0154 |
| S26 | the raw User Agent as a device name | P4 | small |
| S32 | a seven character join link drops the code | P4 | with the join flow minors |
| S1, S4, S10, S13, S19, S22, S27, S29, S33, S35, S36, S38, S39 | cosmetic | P4 | polish, in any related PR |

## Decisions for the owner

- **F7.2.** Should velista push a home entry under a cold deep link so that browser back
  stays in the app? It is what many installed apps do and it changes the meaning of the
  browser's own button. No plan until decided.
- **F6.3.** Plan `0152` changes the copy to "people" and keeps the backend rule of plan
  `0114` (a leaked link takes registered joiners too). If the rule should be guests only,
  that is a backend plan.
- **F5.6.** Freeze a finished trip's amounts from the recorded `pricePaidCents`, and decide
  what "left" means on a finished trip.
- **Backend `0214`.** Should an unnamed product add land on a line somebody named with the
  same product? The plan says no.
- **Velista `0151`.** A mixed row (two people bought units) still reverts the newest units
  whoever bought them. An exact answer scopes the revert to the caller's settlements in
  the backend.
- **Velista `0160`.** Emoji in names stay refused, mirrored on the client. Allowing them is a
  backend rule change.

## Not planned, on purpose

The performance items (F1.6, F5.7, the live basket chain, the serial `me` before route data)
are one plan of their own and not in this batch: none of them loses data or blocks a task,
and the report's numbers are dev build numbers on a slot. The polish items listed under the
scoring pass ride in related PRs or in a later batch.
