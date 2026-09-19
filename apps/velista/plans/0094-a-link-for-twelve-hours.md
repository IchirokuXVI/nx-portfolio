# 0094: a link for twelve hours

> Backend half: `apps/luna-shopper-backend/plans/0140`, which must be on `dev` first, as
> must velista `0090`. Mock: none exists. The screens here are existing sheets with new
> sentences and one new control, described in words in sections 3 to 7.
>
> A basket's link used to work until the basket was finished or the owner revoked it, and
> a signed in person who opened it was on the basket for good. Both rules are gone
> (backend `0130`, sections 2.1 and 11 point 6). A link accepts joins for twelve hours from
> the moment it was made. Whoever comes in by it, guest or account, is on the basket for
> twelve hours from their own join. Staying longer takes the owner adding them by name,
> which lasts until revoked. This plan is every screen that has to say so: the share
> sheet, the join page, the basket while a visit is running out and after it ended, and
> the people sheet, where the owner keeps somebody. It also gives the basket that is
> always there (velista `0091`) the same two sheets, and takes the presence faces off it.
>
> Prerequisite reading: backend `0130` (sections 3, 5, 7 and 11 point 6), backend `0140` in
> full, velista `0090` and `0091`, velista `0044` (the share sheet and the people sheet),
> `0064` section 3 (the join page's security property, which this plan keeps), `0085`
> sections 4 and 7, `0086` section 1, the memory notes on velista product rules (rule C2)
> and on a 401 about a resource, and `libs/velista/feature-shopping-lists/src/lib/share-sheet/`,
> `people-sheet/` and `join-page/`.

## Brief for the agent

### Objective

Make the share sheet, the join page, the basket page and the people sheet tell the truth
about twelve hour links and twelve hour visits, add "Keep on this list" for the owner, and
draw presence on `GENERATED` baskets only, following sections 2 to 8.

### Context

- `ShareSheet` (`share-sheet.ts`) **ensures** a link when it opens: its constructor calls
  `_ensure()` (line 233), which calls `BasketStore.share()`. Its comment reads "Pressing
  share is what gives a basket a link at all, so the sheet opening is the gesture: it
  ensures rather than reads". The link's `createdAt` and `expiresAt` are mapped into
  `BasketShareLink` (`models/src/lib/basket-view.ts`) and nothing draws `expiresAt`.
- The people section of that sheet ticks "the basket's live registered participants, so a
  person who joined by link shows ticked" (velista `0085` section 4), and warns through
  `share.people.linkJoined` that unticking one is for good.
- `JoinPage._check()` (`join-page.ts` lines 123 to 146) previews the link, shows one
  `dead` state for every cause, and joins a signed in opener at once with no screen.
  `BasketApi.join` sends `operation('basket.join')` so the bearer travels (velista `0086`
  section 1).
- `BasketStore` has the states `revoked` and `needsJoin`. The basket page draws
  `basket.revoked.title` and `basket.revoked.body` ("Whoever shared it has taken it
  back. If you still have the link, you can join again.") for both a removal and, after
  this series, an ended visit, which is a different thing to be told.
- `PeopleSheet` (`people-sheet.ts`) lists participants with how each arrived
  (`basket.people.viaLink`, `viaOwner`, `viaInvite`), lets the owner remove one and lets a
  registered member leave, with the question "Leave “{{name}}”? You can come back with
  the link if you have it."
- The basket header draws presence faces from `BasketStore.present` on every basket
  (`basket-page.html` lines 43 to 76, `faces()` in `basket-page.ts`).
- Backend `0140`: `generated_list_share_links.expiresAt` is required and is twelve hours
  after `createdAt`. A participant gains `expiresAt`, null for the owner and for a named
  person, and twelve hours after `joinedAt` for a link visitor. `PUT …/share-link` on a
  basket whose link ended revokes it and mints a new one. `POST …/participants` on a
  person who is already a link visitor makes them a named person. A core sweep ends a
  visit and evicts its socket.

### Target state

Sections 2 to 8 hold at a phone viewport in both themes, the join page's preview still
cannot tell a stranger why a link is dead, and
`npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/` (the participant's and the session's
  expiry, the ended reason), `libs/velista/data-access/src/lib/` (mappers, `BasketStore`,
  the socket's revoked path, the memory twin), `libs/velista/ui/src/lib/` (one notice
  component if none fits), `libs/velista/feature-shopping-lists/src/lib/share-sheet/`,
  `people-sheet/`, `join-page/`, `basket-page/`, `basket-error-copy.ts`,
  `libs/velista/feature-shell/src/lib/routes.ts` (the two sheets under the live basket's
  route), and the two translation files.
- Do NOT touch: any backend project, the zone list, the changes sheet of velista `0093`,
  the row gestures of velista `0092`, `apps/velista-luna-e2e` (velista `0096` owns the
  specs, and `member.spec.ts` step 2 changes meaning because of this plan).

### Constraints

- Load the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill
  for the expiry line, the notice and the "Keep" control.
- **The server decides who is on a basket.** Every comparison of `expiresAt` with the
  device clock in this plan chooses a sentence. None of them grants or refuses anything.
- **Rule C2: a guest is never shown register.** No sentence this plan adds invites
  anybody to make an account. "Ask NAME to add you" is said to an account holder only.
- The join preview keeps one `dead` state for a revoked link, an ended link, a finished
  basket and a secret that never existed (velista `0064` section 3). No "this link has
  expired" on that page.
- Rule D4: `expiresAt` and the ended reason are mapped from `unknown`, with a fallback
  reason. Rule D1: only pages and sheets inject stores.
- Dates and times through `Intl`, never `DatePipe`. Tokens only. Amber is not attention.
  `svh`, not `dvh`.
- Zoneless components. Nothing a service provides imports `@angular/core/rxjs-interop`.
- Route providers are never destroyed: the one timer this plan adds (section 5) is owned
  and cleared by `BasketPage`.
- The memory gateway learns link expiry, visit expiry and the promotion in the same
  commit as the real client.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits and specs, and a front end slot against a backend with
  `0140`.
- Stop and ask if backend `0140` is not on `dev`, if the participant view carries no
  `expiresAt`, if an ended visit is not told apart from a removal by a code or a reason on
  the refusal (section 5 needs it and must not guess from a clock), or if
  `POST …/participants` refuses a link visitor who is not one of the owner's contacts
  (section 6: the owner has to be able to keep anybody who is already shopping with them).

### Progress evidence

Report after the models and mappers, after the share sheet, after the join page and the
notice, after the people sheet, and after presence, each with its spec run.

## 1. What is being built

| Piece                                              | Where                                               |
| -------------------------------------------------- | --------------------------------------------------- |
| `expiresAt` on a participant and on `me`           | `models`, the participant mapper                    |
| `BasketAccessEnded` reason                         | `models`, `BasketStore`, the socket's refusal path  |
| The share sheet reads, and mints on a press        | `share-sheet.*`                                     |
| The link's end time, and the ended link            | `share-sheet.*`                                     |
| The twelve hour sentence for a visitor             | `join-page.*`, `basket-page.*`                      |
| The "your visit is ending" warning                 | `basket-page.*`                                     |
| The ended state, with its own sentence             | `basket-page.*`                                     |
| Link visitors in the people sheet, and "Keep"      | `people-sheet.*`                                    |
| The people picker after the promotion rule         | `share-sheet.*`                                     |
| Presence on `GENERATED` only                       | `basket-page.*`                                     |
| The two sheets under the live basket               | `routes.ts`                                         |
| Copy                                               | `en.json`, `es.json`                                |

## 2. Models

```ts
export interface BasketParticipant {
  // …what velista 0090 leaves, plus:
  /** When this person's visit ends. Null for the owner and for a named person. */
  readonly expiresAt: Date | null;
}

export const BASKET_ACCESS_ENDED_REASONS = ['REMOVED', 'EXPIRED', 'UNKNOWN'] as const;
export type BasketAccessEnded = (typeof BASKET_ACCESS_ENDED_REASONS)[number];
export const BASKET_ACCESS_ENDED_FALLBACK: BasketAccessEnded = 'UNKNOWN';
```

- A **named person** is a participant with `expiresAt === null` who is not the owner. A
  **link visitor** is one with a date. The words are backend `0130` section 3's and the
  client derives them from that one field through two functions in `models`,
  `isNamedPerson(participant)` and `isLinkVisitor(participant)`. No component tests
  `expiresAt` by hand.
- `BasketStore` gains `accessEnded: Signal<BasketAccessEnded | null>`, set when a basket
  call or the socket is refused. The reason is read from the refusal (the error code of
  the 401, or the reason on the eviction event), mapped through the fallback. `UNKNOWN`
  draws the sentence `REMOVED` draws today.
- `BasketShareLink.expiresAt` becomes `Date`, not `Date | null`. A link with no date is
  refused by the mapper as malformed, because the server no longer makes one.

## 3. The share sheet

**It reads, and a press mints.** Today the sheet opening ensures a link, and its comment
says "Pressing share is what gives a basket a link at all, so the sheet opening is the
gesture: it ensures rather than reads". That was right while a link was cheap and a
basket lived for a trip. A link is now a twelve hour invitation, the sheet is also where
the owner ticks people, and one of the two baskets never ends, so opening the sheet to
tick somebody must not mint an invitation nobody asked for. The constructor calls
`BasketStore.loadShareLink()` and the sheet has three link states:

| State             | When                                                            | What is drawn                                                                 |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| none              | no link                                                         | `basket.share.none` and the primary button "Make a link"                      |
| working           | a link whose `expiresAt` is after the device's now              | the URL, Copy, Send, "`n` people joined with it", the end time, Revoke        |
| ended             | a link whose `expiresAt` is not after the device's now          | `basket.share.ended`, the primary button "Make a new link", no URL, no Revoke |

- "Make a link" and "Make a new link" both call `BasketStore.share()`, which is
  `PUT …/share-link`. The server revokes the ended one and mints (backend `0140`), so the
  client never revokes first.
- **The end time** is one line under the URL: `basket.share.worksUntil`, "Works until
  18:40", or `basket.share.worksUntilDay`, "Works until tomorrow, 07:15", when the end is
  on another calendar day of the device. `Intl.DateTimeFormat` with `timeStyle: 'short'`,
  and `Intl.RelativeTimeFormat` for "tomorrow".
- **Why the device clock is allowed here.** Whether the link works is the server's
  answer, given on every join. The sheet only chooses between showing a URL and showing
  "make a new one". A phone whose clock is wrong shows the wrong one of two honest
  screens, and the next press corrects it. Nothing is granted by the comparison.
- `basket.share.note` is rewritten. The old text, "This is the list’s one link. Copy it
  again whenever you need it, for as many people as you like. It stops working when the
  list is done or when you revoke it.", is false twice over.
- The revoke pane keeps its cascade. Its body loses "the list will have no link until you
  share it again" in favour of the shorter truth in section 8's table.

**The people picker.** Velista `0085` section 4 says "The ticked people are the basket's
live registered participants, so a person who joined by link shows ticked", and its hint
`share.people.linkJoined` says "Joined with the link. Removing them also stops the link
working for them." Both are reversed:

- **Ticked means named.** `_members` keeps only participants for whom
  `isNamedPerson()` holds. A contact who is on the basket as a link visitor shows
  **unticked**, with the hint `share.people.visiting`, "Here with the link until 18:40".
- **Ticking a visitor keeps them.** The same `BasketStore.addParticipant(userId)` call,
  which the server answers by promoting the row they already have. The hint goes and the
  box is ticked.
- **Unticking** removes a named person with the existing call. A removed person cannot
  come back by the link (backend `0114` section 7, unchanged), and the hint that said so
  only for link joiners becomes the picker's one constant footnote,
  `share.people.removeNote`.

## 4. The join page

Velista `0064` section 3 stays whole, and two of its bullets are worth quoting because
this plan touches the ground next to them: "`dead` is one state for four causes", and
"Somebody already signed in never sees the screen." Both still hold. What changes is what
each reader is **told**:

- **A stranger, on the offer screen.** Under the invitation and above the name field, one
  muted line: `basket.join.forHours`, "You can shop this list for 12 hours." No mention of
  an account, a name to ask, or registering. The sign in buttons the page already has
  stay exactly as they are.
- **A signed in opener** is still attached with no screen, as velista `0086` section 1
  built it: "A signed in person's bearer travels, `OptionalJwtAuthGuard` resolves them,
  and core attaches the account as a `REGISTERED` participant". What that row **means**
  changed: it ends in twelve hours unless the owner keeps them. They never saw the offer
  screen, so the basket tells them (section 5).
- The `12` is not a literal in a template. It comes from the participant's own
  `expiresAt` once joined, and on the offer screen from a constant
  `LINK_VISIT_HOURS = 12` in `models`, beside a comment naming backend `0130` section 11
  point 6, so the day the number changes it changes in one place per side.

## 5. The basket while a visit runs, and after it ends

**Told once, on arrival.** When `me` is a link visitor, `BasketPage` draws one dismissible
notice under the header, above the `.stale` line:

- With an account: `basket.visit.account`, "You are on this list until 18:40. Ask Marta
  to add you to keep it." The name is the owner's, from the participant whose `kind` is
  `OWNER`, and the nameless form `basket.visit.accountNameless` is used when the owner
  has no name to print.
- As a guest: `basket.visit.guest`, "You are on this list until 18:40." Nothing about
  keeping it, because keeping it takes an account and rule C2 forbids the invitation.
- Dismissing it is remembered for that basket in `sessionStorage` through
  `BrowserFacade`, under a key added to `storage-keys.ts`. A convenience, never a rule.

**The warning.** When `me.expiresAt` is under `VISIT_WARNING_MINUTES = 30` away, the
notice comes back, not dismissible, as `basket.visit.ending`, "Your time on this list
ends at 18:40." plus the same "Ask Marta" half for an account holder. `BasketPage` sets
one `setTimeout` for the moment the threshold is crossed, recomputed on every basket
read, and clears it in its own teardown. `role="status"`, announced once.

**After it ended.** The server refuses the next call and the socket is evicted.
`BasketStore.accessEnded()` is `EXPIRED`, and both places that draw the revoked state
(`basket-page.html` lines 129 to 133 and 210 to 215) choose their sentence from it:

| Reason               | Title                              | Body                                                                                          |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `REMOVED`, `UNKNOWN` | You are no longer on this list     | Whoever shared it took it back.                                                               |
| `EXPIRED`, account   | Your time on this list has ended   | A link lasts 12 hours. Ask Marta for a new one, or to add you so you stay.                    |
| `EXPIRED`, guest     | Your time on this list has ended   | A link lasts 12 hours. Ask whoever sent it for a new one.                                     |

What is on screen stays readable, as today. The old body's second sentence, "If you still
have the link, you can join again.", goes from the `REMOVED` case, because it was never
true for a removed person, and the `basket.revoked.rejoin` key goes with it if nothing
else reads it (check before deleting).

## 6. The people sheet

- A link visitor's row gains a second line: `basket.people.until`, "with the link, until
  18:40". A named person keeps `basket.people.viaInvite`, and the owner `viaOwner`.
- **"Keep on this list"**, owner only, on the detail pane of a link visitor **who has an
  account** (`userId !== null`). It calls `BasketStore.addParticipant(userId)`. On success
  the row becomes a named person through the store's ordinary answer and the button is
  gone. On failure it says `basket.people.keepFailed` under the button and stays.
- A guest has no "Keep". The pane says `basket.people.guestCannotStay`, "A guest is here
  until the time above. To stay longer they need to be added from your groups.", to the
  owner only.
- The leave question, velista `0085` section 7, "Leave “{{name}}”? You can come back with
  the link if you have it.", becomes two. A named person reads `basket.people.leaveNamed`.
  A visitor reads `basket.people.leaveVisitor`. Section 8 has both.
- Times are `Intl.DateTimeFormat` with `timeStyle: 'short'`, with the day added when it is
  not today, formatted into the view model.

## 7. Presence, and the basket that is always there

- `faces()` and the fallback person icon are drawn only when `basket.kind === 'GENERATED'`
  (backend `0130` section 7: "A `LIVE` basket has a room and no presence room"). On a
  `LIVE` basket the header holds the people button alone, which still opens the people
  sheet, because a `LIVE` basket can be shared and can have named people.
- The home card's `presentCount` is drawn for `GENERATED` baskets only.
- `sheet('share', …)` and `sheet('people', …)` are declared under the live basket's route
  exactly as under `shopping-lists/:generatedListId`. Both sheets find their basket
  through the helper velista `0091` provides for the two routes, never by reading a
  `generatedListId` param that the live route does not have.
- On a `LIVE` basket the share sheet's body says `basket.share.bodyLive` in place of
  `basket.share.body`, because what is being shared is every list the owner can write,
  now and later, and the owner is owed that sentence before they send a link.

## 8. Copy

| Key                               | English                                                                                      | Spanish                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `basket.share.none`               | This list has no link right now.                                                             | Esta lista no tiene enlace ahora mismo.                                                          |
| `basket.share.make`               | Make a link                                                                                  | Crear un enlace                                                                                  |
| `basket.share.makeNew`            | Make a new link                                                                              | Crear un enlace nuevo                                                                            |
| `basket.share.ended`              | The last link has ended. Links last 12 hours.                                                | El último enlace ha caducado. Los enlaces duran 12 horas.                                        |
| `basket.share.worksUntil`         | Works until {{time}}                                                                         | Funciona hasta las {{time}}                                                                      |
| `basket.share.worksUntilDay`      | Works until {{day}}, {{time}}                                                                | Funciona hasta {{day}}, {{time}}                                                                 |
| `basket.share.note`               | Anyone who opens it can shop this list for 12 hours. Add people from your groups to keep them on it. | Quien lo abra puede comprar esta lista durante 12 horas. Añade a gente de tus grupos para que se quede. |
| `basket.share.bodyLive`           | Anyone with the link can shop everything on your lists, no account needed. They see the lines, never your groups. | Quien tenga el enlace puede comprar todo lo de tus listas, sin cuenta. Ve las líneas, nunca tus grupos. |
| `basket.revoke.body_one`          | Nobody new will be able to join. The {{count}} person already shopping keeps working until their time ends. | Nadie más podrá entrar. La {{count}} persona que ya está comprando sigue hasta que acabe su tiempo. |
| `basket.revoke.body_other`        | Nobody new will be able to join. The {{count}} people already shopping keep working until their time ends. | Nadie más podrá entrar. Las {{count}} personas que ya están comprando siguen hasta que acabe su tiempo. |
| `basket.revoke.bodyNone`          | Nobody new will be able to join.                                                             | Nadie más podrá entrar.                                                                          |
| `share.people.visiting`           | Here with the link until {{time}}                                                            | Aquí con el enlace hasta las {{time}}                                                            |
| `share.people.removeNote`         | Somebody you remove cannot come back with a link.                                            | Quien quites no podrá volver con un enlace.                                                      |
| `basket.join.forHours`            | You can shop this list for {{hours}} hours.                                                  | Puedes comprar esta lista durante {{hours}} horas.                                               |
| `basket.visit.account`            | You are on this list until {{time}}. Ask {{name}} to add you to keep it.                     | Estás en esta lista hasta las {{time}}. Pide a {{name}} que te añada para quedarte.              |
| `basket.visit.accountNameless`    | You are on this list until {{time}}. Ask whoever shared it to add you to keep it.            | Estás en esta lista hasta las {{time}}. Pide a quien la compartió que te añada para quedarte.    |
| `basket.visit.guest`              | You are on this list until {{time}}.                                                         | Estás en esta lista hasta las {{time}}.                                                          |
| `basket.visit.ending`             | Your time on this list ends at {{time}}.                                                     | Tu tiempo en esta lista acaba a las {{time}}.                                                    |
| `basket.visit.dismiss`            | Got it                                                                                       | Entendido                                                                                        |
| `basket.revoked.body`             | Whoever shared it took it back.                                                              | Quien la compartió la ha retirado.                                                               |
| `basket.ended.title`              | Your time on this list has ended                                                             | Tu tiempo en esta lista ha acabado                                                               |
| `basket.ended.bodyAccount`        | A link lasts 12 hours. Ask {{name}} for a new one, or to add you so you stay.                | Un enlace dura 12 horas. Pide a {{name}} uno nuevo, o que te añada para quedarte.                |
| `basket.ended.bodyAccountNameless` | A link lasts 12 hours. Ask for a new one, or to be added so you stay.                       | Un enlace dura 12 horas. Pide uno nuevo, o que te añadan para quedarte.                          |
| `basket.ended.bodyGuest`          | A link lasts 12 hours. Ask whoever sent it for a new one.                                    | Un enlace dura 12 horas. Pide uno nuevo a quien te lo envió.                                     |
| `basket.people.until`             | with the link, until {{time}}                                                                | con el enlace, hasta las {{time}}                                                                |
| `basket.people.keep`              | Keep on this list                                                                            | Mantener en esta lista                                                                           |
| `basket.people.keepFailed`        | That did not go through. Try again.                                                          | No se ha podido. Inténtalo de nuevo.                                                             |
| `basket.people.guestCannotStay`   | A guest is here until the time above. To stay longer they need to be added from your groups. | Un invitado está hasta la hora de arriba. Para quedarse hay que añadirlo desde tus grupos.       |
| `basket.people.leaveNamed`        | Leave “{{name}}”? Only whoever made it can add you again.                                    | ¿Salir de «{{name}}»? Solo quien la creó puede volver a añadirte.                                |
| `basket.people.leaveVisitor`      | Leave “{{name}}”? You can come back while its link still works.                              | ¿Salir de «{{name}}»? Puedes volver mientras su enlace funcione.                                 |

Deleted keys: `share.people.linkJoined`, `basket.people.leaveQuestion`,
`basket.revoked.rejoin` (after checking nothing reads it), and the `{{count}}` free
sentence about "no link until you share it again" inside the three `basket.revoke.body*`
keys, which are rewritten above. The `12` inside sentences is `{{hours}}` wherever the
sentence is built by code that holds `LINK_VISIT_HOURS`. The table shows it spelled out
for reading.

## 9. Accessibility

- The visit notice and the warning are `role="status"`. The ended state keeps the
  `role="alert"` the revoked notice has.
- "Make a link", "Make a new link" and "Keep on this list" are real buttons that set
  `aria-busy` while their call is out and never `disabled` alone, the house pattern.
- The end time is text next to the URL, not a tooltip. A time is always printed with its
  day when the day is not today, so "07:15" is never ambiguous to a screen reader user
  who cannot glance at a clock.
- The picker's hint for a visitor is tied to its checkbox with `aria-describedby`, as
  `share.people.linkJoined` was.

## 10. Realtime

- The socket's refusal and the eviction event feed `accessEnded` (section 2). Nothing
  else about the socket changes.
- `generatedList.participantJoined` and `participantLeft` still refresh the participants.
  A promotion arrives as whatever backend `0140` emits for it, and the store answers it
  with the same debounced participant refresh, so the people sheet and the picker move
  on every device.
- Presence events for a `LIVE` basket never arrive. The store's `present` stays empty and
  nothing draws it.

## 11. Not in this plan

- The backend's sweep, the expiry rule and the promotion: backend `0140`.
- Extending a visit without naming the person.
- A countdown. The screen says a time, not a timer.
- The sign in buttons on the join page, including the one labelled "Continue with Google"
  that navigates to `auth/register` (`join-page.html` line 92). It predates this plan, the
  reader there holds no temporary account, and whether rule C2 reaches it is a question
  for the product owner. This plan adds no new path to it.
- The specs of `apps/velista-luna-e2e`: velista `0096`.

## 12. Tests

1. The participant mapper maps `expiresAt` to a `Date` or null and refuses a malformed
   one. `isNamedPerson` and `isLinkVisitor` answer for the owner, a named person, a guest
   and a registered visitor.
2. The link mapper refuses a link with no `expiresAt`.
3. The share sheet opens **without** calling `share()`. With no link it offers "Make a
   link". With a working link it draws the URL and the end time, today and tomorrow forms.
   With an ended link it draws no URL and no Revoke, and "Make a new link" calls
   `share()` once.
4. The picker ticks named people only. A visiting contact is unticked with the visiting
   hint. Ticking them calls `addParticipant` and the hint goes. A failed tick puts the box
   back.
5. The join page: the offer screen draws the twelve hour line and the string "register"
   appears nowhere in what this plan adds. A signed in opener still never leaves
   `checking`. A dead preview still draws the one sentence for all four causes, asserted
   with four previews.
6. The basket page draws the account notice with the owner's name, the nameless form, and
   the guest form with no "ask" half. Dismissal is remembered per basket. Under thirty
   minutes the warning is drawn and cannot be dismissed. The timer is cleared on teardown
   (assert with fake timers, and no `whenStable`).
7. `accessEnded` of `EXPIRED` draws the ended sentences for an account and for a guest.
   `REMOVED` and `UNKNOWN` draw the taken back sentence. An unknown code maps to
   `UNKNOWN`.
8. The people sheet draws "until" for a visitor, "Keep" for the owner on a visitor with
   an account only, the guest sentence for the owner on a guest, and the two leave
   questions.
9. Faces are drawn on a `GENERATED` basket and not on a `LIVE` one. The home card draws
   no present count for a `LIVE` basket.
10. `routes.spec.ts` sees `share` and `people` under the sheet marker on both basket
    routes. `no-unguarded-history-back.spec.ts` and `token-hygiene.spec.ts` stay green.

## 13. Acceptance criteria

- [ ] Opening the share sheet never makes a link. A press does.
- [ ] A working link says when it stops working, and an ended one offers a new one.
- [ ] A stranger is told they have twelve hours, and is never invited to register.
- [ ] A signed in visitor is told when their visit ends and whom to ask, without ever
      seeing the offer screen.
- [ ] Half an hour before the end the basket says so, and after the end it says why,
      in words that differ from being removed.
- [ ] The owner can keep a visitor who has an account, from the people sheet and from the
      picker, and both show the result on every device.
- [ ] The join page still cannot tell a stranger why a link is dead.
- [ ] Presence faces appear on generated baskets only, and the basket that is always
      there has the same share and people sheets.

## 14. Verification

```sh
npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps velista
```

On the slot, with two accounts and one private window: make a link, open it as a guest
and as the second account, check the three notices, keep the second account from the
people sheet, and check the picker on a second device. To see an ended visit without
waiting twelve hours, point the front end at a backend slot started with the visit
lifetime backend `0140` reads from its configuration set to a minute. Give the slots
back.
