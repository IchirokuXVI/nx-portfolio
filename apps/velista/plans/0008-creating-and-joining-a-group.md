# 0008. The way in: creating a group, and joining with a code

> Prerequisite reading: `0003` (the home page and its states), `0007` (the split that
> made the front door its own route), and **`0004` sections 5.5 and 9**, which already
> built and enforced everything this plan sends over the network.
>
> **This is a page plan** and follows the template in `0001` section 9.
>
> **Status: mock approved by the user on 2026-08-26.** The design is settled and the
> plan is ready for development.
>
> It covers two of the four ways in that the front door offers. The other two, Google
> and email sign in, are credential flows and get their own plan. Nothing here needs
> them: a person can create a group, invite people, and be let into somebody else's
> group without ever having an account in the sense they would recognise.

## 1. Purpose

The front door offers four ways in and all four are dead ends today. `LandingPage`
records each tap into a `pendingRoutes` signal and goes nowhere, because `0003` put
every destination out of scope and `0007` kept it that way. This plan builds the two
that need no credentials, which are also the two that make the product usable at all:
**name a group and own it**, or **enter a code somebody sent you and ask to be let in**.

Both are one field and one button. Neither asks who you are. That is not a
simplification for the sake of the mock, it is what the backend was built to expect,
and section 5.2 shows where it says so.

Getting these two right also lifts the dashboard out of the state it has been in since
`0007`: `home` is guarded by `authenticatedGuard`, and nothing in the app can currently
produce an authenticated user, so the dashboard is unreachable in a running app. These
two routes are the only places in the entire product where an account is created.

## 2. Mock

**https://claude.ai/code/artifact/eb800fe2-6786-4528-9f43-2d638f6e5acb**

Sources are committed in `mocks/entry/`, and the published page is generated from them
by `mocks/build-index.mjs`, so the page and the repository are the same file rather
than two things kept in step. Phone frames are 390 by 844.

| Artboard | Frames |
| --- | --- |
| `CreateGroup.dc.html` | The sheet as it opens, with a name typed, and while the request is in flight |
| `JoinCode.dc.html` | The sheet as it opens, with a code entered, and after a code that matches no group |
| `JoinLink.dc.html` | Arriving cold on a shared link, with no page underneath |
| `AfterEntry.dc.html` | The two outcomes: the creator holding a code to share, and the joiner waiting to be let in |

**Night theme only, by decision.** Every colour role these screens use (amber primary,
coral error, violet pending, the raised surface) is one `0003` already drew and proved
on Day. They introduce no new role, so a Day artboard would restate an answer rather
than find one. The rule from `0003` still stands for any page that introduces a role.

## 3. States

### 3.1 The two sheets

| State | Drawn | Behaviour |
| --- | --- | --- |
| Opening | Yes | Field focused, keyboard up, primary disabled. The sheet sits above the keyboard, not behind it |
| Valid | Yes | Primary enabled the moment the field is non empty (create) or exactly eight characters (join) |
| Submitting | Yes, on `CreateGroup` | Field goes read only, primary shows a spinner and keeps its width, cancel disappears. The sheet cannot be dismissed while a mutation is in flight |
| Rejected | Yes, on `JoinCode` | Inline message under the field, field border coral, primary stays enabled so the fix is one edit and one tap |
| Guest being created | Yes, on `CreateGroup` | A quiet notice while submitting, so an account appearing is something the person was told about rather than discovered |

### 3.2 The shared link screen

| State | Drawn | Behaviour |
| --- | --- | --- |
| Arrived | Yes | The code from the URL, what will happen, and one primary action |
| Submitting | No, described | Primary shows a spinner exactly as the sheets do. No separate design |
| Rejected | No, described | The same message set as section 5.4, rendered under the code card rather than under a field, because there is no field |

### 3.3 The two outcomes

Both are the dashboard, not a new screen. Creating navigates to `home` with the new
group present and an invite card above it. Joining navigates to `home` with the group
listed as pending, which is the card `0003` already designed and `zone-card.html`
already renders.

### 3.4 The one state that is neither drawn nor ordinary

**`guest-account-lost`.** `ZoneServiceI` already returns it as a first class result for
both operations, because `0004` rule D3 refuses to send a request that would silently
mint a second guest account (section 5.3). It is rare, it is not the user's fault, and
it is unrecoverable in the sense that the previous groups cannot be reached again.

It is not drawn because it is not a common case, and it is specified here instead so
nobody has to invent copy under pressure:

> **Title.** We lost the account on this phone
> **Body.** Your groups were tied to this phone and we cannot reach them any more. You
> can start again, and adding an email next time means this cannot happen.
> **Action.** Start again, which clears the stored session and returns to the front door.

It renders as a full screen, not an inline message: continuing from a sheet would
offer to make exactly the duplicate account rule D3 exists to prevent.

## 4. Anatomy

### 4.1 Rule E1: the sheets are routes, not component state

> **Rule E1.** A sheet that owns a mutation is a child route of the page it covers, and
> renders into a `<router-outlet>` that page owns.

Both the front door and the dashboard offer both actions, so there are four route
entries and two components. The pages beneath stay mounted and keep their scroll.

The alternative, a signal on each page toggling a template branch, was rejected for
three reasons, and the first is the one that decides it:

1. On Android the hardware back button would close the **app** rather than the sheet,
   because nothing was pushed onto the history stack. Every phone user expects back to
   close a sheet.
2. Two pages would each own a copy of the open, close and focus logic.
3. `pendingRoutes` in `LandingPage` and `HomePage` already names destinations. Making
   them real routes turns each recorded string into one `routerLink`, which is what
   the comment in `landing-page.ts` predicted.

The URLs, keeping the word `zones` per rule N2 even though the interface says group:

| Route | Renders | Access |
| --- | --- | --- |
| `zones/new` | `CreateGroupSheet` over the front door | Public |
| `zones/join` | `JoinCodeSheet` over the front door | Public |
| `home/zones/new` | `CreateGroupSheet` over the dashboard | Authenticated |
| `home/zones/join` | `JoinCodeSheet` over the dashboard | Authenticated |
| `join/:code` | `JoinLinkPage`, full screen | Public |

`join/:code` is deliberately not a sheet. It is a cold arrival from somebody else's
message, so there is no page underneath to cover, and a sheet over an empty backdrop
is a modal pretending to have context it does not have.

### 4.1.1 The ordering corollary, which is the shell trap again

Giving the front door children changes it from a terminal route into a prefix. Its path
is `''`, so it consumes no segments and then offers `zones/new` and `zones/join` to
whatever is left. That is the same shape `0001` section 6.1 documents in the shell,
where an empty path route with `loadChildren` swallows the segments meant for its
siblings, and the fix is the same one:

> **Every route with a non empty path is declared before the `''` front door.**

So this plan **reorders** `AppShellRoutes`: `home` first, then `join/:code`, then `''`
last. Every later page plan inherits the rule, and `zones/:zoneId` in particular would
be shadowed by `zones/new` if it were ever appended after the front door.

Relying on the router to backtrack out of a failed child match is not the plan. The
order makes the question moot, and a spec asserts it: **a route table whose last non
wildcard entry is not `''` fails the test.** That is cheaper than a test per route, and
it cannot be satisfied by accident.

### 4.2 Libraries

A new feature library, because both host pages need the same two containers and
neither may import the other.

| Library | Adds |
| --- | --- |
| `libs/velista/feature-entry` **(new)** | `CreateGroupSheet`, `JoinCodeSheet`, `JoinLinkPage`. The only things here that talk to a store, per rule D1 |
| `libs/velista/ui` | `SheetShell` (scrim, panel, grab handle, focus trap, dismissal), `JoinCodeField` (the eight character field and its rules), `InviteCard` (the code, copy, share), `AskedNotice` (the outcome panel on the dashboard) |
| `libs/velista/feature-landing` | One `<router-outlet>` in `landing-page.html`, and `pendingRoutes` replaced by real links |
| `libs/velista/feature-home` | The same outlet, the same replacement, plus `InviteCard` shown when the dashboard is entered from a create |
| `libs/velista/feature-shell` | The five route entries above |
| `libs/velista/data-access` | Nothing on the transport. See section 5.1 |

Layering stays `models -> platform -> {ui, data-access} -> feature-*` from `0004`.
`feature-shell` lazy loads `feature-entry` in its route table, so `feature-entry` must
never import `feature-shell` back.

Two icons are missing: a share glyph and a clock. Both go in
`libs/velista/ui/src/lib/icons`, following the `icons.ts` note that velista keeps its
own set while `shared/ui` still uses the older four file pattern. The clipboard paste
button reuses the existing `copy-icon`.

## 5. Data

### 5.1 The transport is already built, and that is most of this plan

`0004` did not stop at describing these two calls. `ZoneApi.createZone` and
`ZoneApi.joinZone` exist, enforce rule D3, persist a minted token pair, map the
response through `toZone` and `toMembership` per rule D4, and are mirrored by
`ZoneMemory` so the screens can be built and tested with no gateway running.
`ZoneServiceI` already declares both, including the `guest-account-lost` result.

So **this plan adds no HTTP call**. What it adds above that seam is:

- `ZoneStore` gains `createZone(name)` and `joinZone(code)`, which own the optimistic
  write, the reconciling reload and the error state. The store has `upsert` today and
  no mutation of its own.
- One error to copy mapping, section 5.4.

### 5.2 Neither sheet asks for a name, and the backend is why

`CreateZoneDto.username` and `JoinZoneDto.username` are both `@IsOptional()`, and the
comment above them says what omitting one means:

> Omitting it means "call me by my global username here", which is the common path: the
> home page offers "Create a group" and "Join with a code" as one tap actions with no
> name field, and the backend already generated a name when the identity was created.

`ZoneApi` already honours this: it omits the key entirely rather than sending
`undefined`, because the gateway validates with `forbidNonWhitelisted`. Renaming
yourself inside one group is `SetMembershipUsernameDto` and belongs to the members
screen, not here.

### 5.3 The handshake, and the hazard it is guarded against

| Call | Auth | Returns |
| --- | --- | --- |
| `POST /v1/zones` | Optional | `{ tokens?: AuthTokens; data: ZoneView }`, 201 |
| `POST /v1/zones/join` | Optional | `{ tokens?: AuthTokens; data: MembershipView }`, 201 |

`tokens` is present exactly when the caller arrived anonymous, because the gateway
minted a temporary user to own the operation. These two routes are the only place in
the product that happens.

The hazard, already handled, worth repeating because it is invisible: the gateway
guards both with `OptionalJwtAuthGuard`, which **swallows an expired token** and falls
through to anonymous instead of rejecting. A stale token therefore does not fail, it
silently mints a second guest account and orphans every group on the first, which the
person has no credential to reach again. `ZoneApi` calls
`authorizeOptionalAuthCall()` before building either request for this reason. Nothing
in this plan may bypass that by calling the gateway directly.

Both routes are throttled at `THROTTLE_LIMITS.anonymousZone`, ten per minute.

### 5.4 What a failure means, per operation

`ERROR_CODES` holds seven generic codes and `ERROR_CATALOG` gives each one message, so
the server's `message` reads identically for every 409 in the product and is unusable
as copy. `0004` already concluded the client keys its own copy on **code plus
operation**. On `zones.join` that is unambiguous, because only one thing in core
produces each:

| Code | On `zones.join` | Copy |
| --- | --- | --- |
| `not_found` | No ACTIVE zone has that code | No group has that code. Check it with whoever sent it. Codes never use O, I or L |
| `conflict` | Already APPROVED or already PENDING here | You have already asked to join this group |
| `forbidden` | A BANNED membership exists | You cannot join this group. Ask whoever runs it |
| `rate_limited` | Ten attempts in a minute | Too many tries. Wait a minute and try again |
| `validation_failed` | Not reachable from the field, which enforces the shape | Falls back to the generic failure copy |

A KICKED membership is not an error: core moves it back to PENDING, so it succeeds and
reads as a fresh ask.

On `zones.create` only `conflict` is specific, and it means a join code collision
rather than anything the person did, so its copy is "Something clashed on our side.
Try that again" and the primary stays enabled.

### 5.5 After a successful create: build the row, then reconcile

`POST /v1/zones` returns a `ZoneView`, and the dashboard renders `MyZoneView`, which
also carries `myRole`, `myStatus`, `counts` and `lists`. Those four are missing from
the response, and every one of them is **known with certainty** for a zone created one
moment ago: OWNER, APPROVED, one member, no lists, no pending requests, no first
requester.

So `ZoneStore.createZone` composes the `MyZone` from the returned `Zone` plus those
constants and upserts it, then issues the ordinary list reload. The dashboard is
correct immediately and correct again after the reload, and the person does not watch
a second spinner after the one they already waited through.

This is safe only because the values are derivable rather than guessed. Nothing else
in this plan invents a field the server did not send.

### 5.6 After a successful join: reload, and the name arrives with it

`MembershipView` carries `zoneId` but no zone name, so nothing can be composed. The
store reloads instead.

**That reload does return the group, with its real name.** Core's `listMine` selects
memberships `WHERE status IN (APPROVED, PENDING)` and inner joins the zone row for
both, so a pending membership comes back as a full `MyZoneView`. This is worth stating
because the opposite is the intuitive guess, and the mock was drawn wrongly on it
once: **a code cannot be resolved to a group before you ask, and names itself the
moment you have.**

### 5.7 Rule E2: nothing may preview the group behind a code

There is no endpoint that turns a join code into a zone. `POST /v1/zones/join` is the
only route in the gateway that accepts one, and it joins rather than looks up.

So the join sheet may not say "You are joining Flat 3B", and the shared link screen may
not either. Both are written to promise only what they can deliver. **Do not add a
speculative call to make a preview appear.**

Recorded as backend work, not assumed by anything here: a public
`GET /v1/zones/by-code/:code` returning a name and a member count, rate limited and
deliberately leaky about nothing else, would let both screens name the group before the
tap. It changes copy on two screens and nothing structural.

## 6. Localization

New keys, nested under `entry` in `libs/velista/ui/assets/i18n/{en,es}.json`. Rule N2
holds: the keys say zone, the values say group and grupo. Rule N1 holds: no key
contains the product name.

| Key | English | Spanish |
| --- | --- | --- |
| `entry.createZone.title` | Name your group | Ponle nombre al grupo |
| `entry.createZone.body` | A group is the household or flatmates you share lists with. You can change the name later | Un grupo son los de tu casa o tus compañeros de piso. Puedes cambiar el nombre después |
| `entry.createZone.label` | Group name | Nombre del grupo |
| `entry.createZone.placeholder` | Home | Casa |
| `entry.createZone.submit` | Create group | Crear grupo |
| `entry.createZone.submitting` | Creating | Creando |
| `entry.createZone.mintingAccount` | We are setting up an account on this phone so the group has an owner. You can add an email to it whenever you like | Estamos creando una cuenta en este teléfono para que el grupo tenga dueño. Puedes añadirle un correo cuando quieras |
| `entry.joinZone.title` | Enter the code | Escribe el código |
| `entry.joinZone.body` | Whoever set the group up can find its code on the group's page | Quien creó el grupo puede ver el código en la página del grupo |
| `entry.joinZone.label` | Join code | Código de invitación |
| `entry.joinZone.hint` | Letters and numbers. Never O, I or L | Letras y números. Nunca O, I ni L |
| `entry.joinZone.submit` | Ask to join | Pedir entrar |
| `entry.joinZone.submitting` | Asking | Enviando |
| `entry.joinZone.paste` | Paste | Pegar |
| `entry.joinLink.title` | Someone wants you on their list | Alguien te quiere en su lista |
| `entry.joinLink.body` | Ask to join, and whoever runs the group lets you in. You will see the group and its lists once they do | Pide entrar y quien lleva el grupo te dejará pasar. Verás el grupo y sus listas en cuanto lo haga |
| `entry.joinLink.codeLabel` | The code in your link | El código de tu enlace |
| `entry.joinLink.decline` | Not now | Ahora no |
| `entry.joinLink.guestNotice` | Asking makes an account on this phone. Add an email to it later so you do not lose it | Al pedir entrar se crea una cuenta en este teléfono. Añádele un correo después para no perderla |
| `entry.invite.title` | {{name}} is yours | {{name}} es tuyo |
| `entry.invite.body` | Send this code to the people you shop with. They enter it to ask to join | Envía este código a quien compre contigo. Lo escriben para pedir entrar |
| `entry.invite.copy` | Copy code | Copiar código |
| `entry.invite.copied` | Copied | Copiado |
| `entry.invite.share` | Share the link | Compartir el enlace |
| `entry.asked.title` | You asked to join {{name}} | Has pedido entrar en {{name}} |
| `entry.asked.body` | Whoever runs the group decides. This page updates the moment they do, and the group opens up below | Quien lleva el grupo decide. Esta página se actualiza en cuanto lo haga y el grupo se abrirá aquí abajo |
| `entry.error.noSuchZone` | No group has that code. Check it with whoever sent it. Codes never use O, I or L | Ningún grupo tiene ese código. Compruébalo con quien te lo envió. Los códigos nunca llevan O, I ni L |
| `entry.error.alreadyAsked` | You have already asked to join this group | Ya has pedido entrar en este grupo |
| `entry.error.notAllowed` | You cannot join this group. Ask whoever runs it | No puedes entrar en este grupo. Habla con quien lo lleva |
| `entry.error.tooMany` | Too many tries. Wait a minute and try again | Demasiados intentos. Espera un minuto e inténtalo de nuevo |
| `entry.error.createClash` | Something clashed on our side. Try that again | Algo ha chocado por nuestra parte. Inténtalo otra vez |
| `entry.accountLost.title` | We lost the account on this phone | Hemos perdido la cuenta de este teléfono |
| `entry.accountLost.body` | Your groups were tied to this phone and we cannot reach them any more. You can start again, and adding an email next time means this cannot happen | Tus grupos estaban ligados a este teléfono y ya no podemos acceder a ellos. Puedes empezar de nuevo, y si añades un correo la próxima vez esto no volverá a pasar |
| `entry.accountLost.restart` | Start again | Empezar de nuevo |

`entry.invite.title` and `entry.asked.title` interpolate a group name, which the
Angular wrapper only learned to pass after the fix recorded in `0006`. Both are whole
phrases with the name inside rather than a noun glued to a frame, per the Spanish
gender rule in `0001`.

`home.action.createZone`, `home.action.joinCode` and `home.pending.waiting` already
exist and are reused unchanged.

## 7. Accessibility and input

- **Sheet semantics.** `role="dialog"`, `aria-modal="true"`, labelled by its title.
  Focus moves to the field on open and returns to the button that opened it on close.
  Focus is trapped while open, and Escape closes it, which on a phone is the same path
  the back button takes.
- **Every target is at least 44 by 44.** The paste and copy buttons are 54 square, the
  primaries 52 to 54 tall, and cancel is a 44 tall row rather than a small word.
- **The sheet sits above the keyboard.** It is drawn at that height on purpose. A
  primary hidden behind the keyboard is the most common way a one field sheet fails on
  a phone, and the artboards show the band so the reviewer can check it.
- **The code field** sets `autocapitalize="characters"`, `autocorrect="off"`,
  `spellcheck="false"`, `inputmode="text"` and `maxlength="8"`. It uppercases as it
  goes and drops any character outside `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, so a misread
  O never becomes a failed request. It never rejects a paste for containing spaces or
  a URL: it takes the last eight valid characters and lets the person see the result.
- **Errors are announced.** The inline message is `role="alert"` and is referenced by
  the field's `aria-describedby`, so the reason arrives with the field rather than
  after it.
- **Submitting is announced too.** The primary keeps its accessible name and gains
  `aria-busy="true"` rather than swapping its label for a spinner alone.
- **The copy button confirms in text**, not by colour alone: the label becomes Copied
  and an `aria-live="polite"` region says so.
- **Reduced motion.** The sheet's rise is a transform transition, skipped entirely
  under `prefers-reduced-motion: reduce`.

## 8. Acceptance criteria

- [ ] `/en/velista/zones/new` and `/en/velista/zones/join` render the sheet over the
      front door, and `/en/velista/home/zones/new` and `.../join` over the dashboard.
- [ ] The browser back button closes a sheet and leaves the page beneath it mounted,
      with its scroll position intact.
- [ ] `AppShellRoutes` declares every non empty path before the `''` front door, and a
      spec fails the moment that stops being true (section 4.1.1).
- [ ] `/en/velista/join/HK7M2QPD` renders full screen with the code from the URL, and
      does so for a signed out visitor.
- [ ] `LandingPage.pendingRoutes` and `HomePage`'s two entry entries are gone, replaced
      by real navigation. The remaining `pendingRoutes` entries stay until their plans land.
- [ ] Creating a group navigates to the dashboard with the new group already listed as
      OWNER with one member and no lists, before any reload completes.
- [ ] Asking to join navigates to the dashboard, and the group appears with its real
      name and a PENDING badge once the reload lands.
- [ ] Neither sheet sends a `username` key when the person did not type one.
- [ ] A create or join attempted with an expired token reports `guest-account-lost` and
      renders the section 3.4 screen. It never sends the request. Covered by a spec that
      pins the behaviour rather than by inspection.
- [ ] Each row of the section 5.4 table renders its own message, verified against
      `ZoneMemory` rather than a live gateway.
- [ ] The code field turns `hk7m2qpd`, `HK7M 2QPD` and a pasted
      `https://.../join/HK7M2QPD` into `HK7M2QPD`.
- [ ] The primary is reachable above the keyboard on a 390 by 844 viewport.
- [ ] No component in `libs/velista/ui` injects a store or a service token, per rule D1.
- [ ] `npx nx lint velista feature-entry` and `npx nx test` pass for every touched
      project, and `npx nx build velista` succeeds, which is the only real type gate in
      this workspace.

## 9. Out of scope

- **Email and Google.** `auth/login`, `auth/register`, `auth/verify` and `auth/callback`
  are **`0009`**. The Google button on the front door keeps recording its tap, and
  `0009` section 5.6 shows it stays that way past its own plan too.
- **Upgrading a guest to a real account.** The banner is drawn and its action still
  goes nowhere. `POST /v1/auth/upgrade` is **`0009`**, which also establishes rule C2:
  a guest must never be shown the register screen, because it would strand every group
  this plan just helped them make.
- **Approving anybody.** The join request row on a zone card, the members screen and
  `membership.approve` are the group detail plan. This plan produces pending
  memberships and shows them; it cannot resolve one.
- **Sharing as a real link.** `InviteCard` offers copy and a share button, and share
  uses the Web Share API where it exists behind `BrowserFacade`, falling back to copy.
  Deep link handling by the operating system needs the standalone origin.
- **Renaming yourself per group**, editing a group, and regenerating a join code.
- **Previewing a group from its code**, which section 5.7 shows is impossible today.
- **Anything about `ZoneStatus.MARKED_FOR_DELETION`**, which `0003` skipped and this
  plan inherits: such a group renders as a plain non tappable card and nothing here
  changes that.
