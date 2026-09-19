# 0098: the setup a new account walks through

> Backend half: `apps/luna-shopper-backend/plans/0145`, which must be merged first.
> Mock: `mocks/onboarding/`, published at https://claude.ai/artifact/Y3K3PZNGLnEjNUHjfWBDBF.
> The bar: `0097`, whose route data this plan uses to hide itself.
>
> A new account lands on an empty home with no name it chose, no postal code and no
> opinion about supermarkets, and every one of those is a screen somewhere in the
> account section that nobody new will find. This plan asks the three questions once,
> in order, in about thirty seconds, and then hands over to the tour. Every question can
> be skipped, every skip is a complete answer, and each answer is written the moment it
> is given.
>
> Prerequisite reading: `0009` (registering, and what the client does not send), `0015`
> (the account page), `0046` and `0049` (shopping profiles, postal codes, chains),
> `0059` (the screen that picks the shops), backend `0145` in full, and
> `libs/velista/feature-account/src/lib/location-sheet/`.

## Brief for the agent

### Objective

Build the four step setup of the mock as its own routed flow, guard a fresh account
into it, write each answer as it is given, and mark the account set up when it ends by
any route.

### Context

- Backend `0145` serves `appState.setupCompletedAt` on `GET /v1/account/me`,
  `PATCH /v1/account/app-state` and `GET /v1/account/username-suggestions`.
- **The name already exists.** Registration generates one from a per locale pool and
  the client never sends a display name (`0009`, section 5.1), so the account is
  already "Brave Anchor" before this flow opens. `PATCH /v1/account/me` renames, and it
  is throttled.
- Every user has a shopping profile: `GET /v1/account/shopping-profiles` creates the
  default one lazily, so there is never a create-your-first wall.
- The place step's four states already exist, in
  `feature-account/src/lib/location-sheet/`: resolved, refused, unplaceable, failed.
  `POST /v1/account/postal-code-lookups` turns a point into a code and keeps no point.
  Read that component before writing this one.
- `GET /v1/catalog/shops/summary` answers the chains near a set of postal codes, each
  with a shop count. `GET /v1/catalog/supermarkets` answers every chain, unscoped.
- A profile's chains are written with `PATCH /v1/account/shopping-profiles/:id`,
  `supermarkets: [{ supermarketId, excluded }]`.

### Target state

An account that has never been set up opens the app and is walked through the welcome,
the name, the place and the shops, then offered the tour. An account that has been set
up, or dismissed it, never sees it again on any device.

### Scope

Work only in:

- `libs/velista/feature-setup/` (a new library, the whole flow)
- `libs/velista/ui/src/lib/setup/` (its presentational parts)
- `libs/velista/data-access/src/lib/account/` (the three reads and writes)
- `libs/velista/feature-shell/src/lib/routes.ts`, its guards and its spec
- `libs/velista/models/` (only for the types the flow needs)

Do not touch: the account page, the profiles page, the supermarkets page, the location
sheet. They keep working exactly as they are.

### Constraints

- Follow the `nx-portfolio-angular-developer` skill for the library and every file.
- Follow the `design-taste-frontend` skill for the screens.
- Every string is a translation key. The English and Spanish in section 8 are the
  approved copy and must not be rewritten.
- **Rule O6 governs every word.** Short sentences, ordinary words, the reason before
  the request, no feature lists, and no warning about a choice that costs nothing.
- No `@angular/core/rxjs-interop` anywhere.

### Action boundaries

Stop and ask before: changing anything under `feature-account`, adding a route that is
not in section 2, sending a display name on registration, or adding a dependency.

### Progress evidence

After each step output: the files changed and the spec you ran.

## 1. What is being built

Four screens, one guard, one store, and three writes to routes that already exist.

## 2. The routes

Under the locale, beside `home`:

| Path | Screen |
| --- | --- |
| `setup` | The welcome |
| `setup/name` | Step 1 of 3 |
| `setup/place` | Step 2 of 3 |
| `setup/shops` | Step 3 of 3 |
| `setup/done` | The finish, and the tour's offer |

Every one of them carries `data.chrome: 'none'` (`0097`, section 4). The bar is a way
out of a screen, and these five are one task with one way out.

They are pages and not sheets. A sheet covers a page that is still there, and there is
nothing behind this.

## 3. Who is sent here, and when

`setupGuard`, on the app's own routes below the locale:

- The session is anonymous or a guest: never. A guest already gives a name on the join
  page, beside the basket they were invited to, and the other two questions are about
  shopping they are not doing.
- `appState.setupCompletedAt` is not null: never.
- Otherwise, on the **first navigation of the document only**, redirect to `setup`.

The last clause is what stops the flow from fighting the person who skipped it and then
pressed Home. `setupCompletedAt` is written on the way out through any exit
(section 7), so the case only arises when a write failed, and re-asking once per cold
start is a nuisance rather than a trap.

The guard reads the profile that `ProfileStore` already holds. It must not issue a
request of its own: `0071`'s startup gate has already waited for the backend once, and
a second wait in a guard is a white screen nobody can explain.

## 4. The welcome

The mark, a title, one sentence, the three questions as numbered rows, **Start**, and
**Not now**.

**Not now is final.** It writes `setupCompleted` and goes home, exactly as finishing
does. The screen does not say so: a warning about a permanent choice makes somebody
weigh a press that costs them nothing, and nothing is lost by pressing it. The three
answers keep their own screens in the account section, which is where they were always
going to be.

## 5. The three steps

Each step is: a back chevron, **Skip**, a three segment progress rail, the step's
number, a title, one short paragraph, the control, and one primary button at the
bottom.

**Step 1, the name.** The field is empty, with the generated name named beside it in a
card: "We already picked one for you", the name, and "Leave the field blank and it
stays yours". **Pick another one** asks
`GET /v1/account/username-suggestions` and swaps the name in the card in place. The
primary button says what it will do: `Keep Brave Anchor` while the field is empty and
`Continue as Daniel` once something is typed. A typed name is written with
`PATCH /v1/account/me` on Continue; a blank one writes nothing at all.

**Step 2, the place.** A full width **Use my location**, an "or type it" rule, and a
postal code field. Continue is disabled until one of them has produced a code.

- Pressing the button reuses the four states of the location sheet, with the same copy
  and the same rule: the point becomes a code on the server and nothing keeps the
  point. Say that before the press, not after.
- A resolved code shows the code and the country, and nothing else. The lookup answers
  `{ country, postalCode }` and no town name, so the screen cannot print one.
- **Include the codes around it** is ticked by default here, and unticked on the
  account page's own add control. Somebody who has just handed over their location has
  asked to be found.
- Under it, what the code reaches, from `GET /v1/catalog/shops/summary`: "5 supermarket
  chains and 23 shops".
- Skip says what it costs, once: without a postal code the catalog works and shows no
  prices. It offers **Skip anyway** and **Back**, with Back as the primary.
- Continue writes with `POST /v1/account/shopping-profiles/:id/postal-codes`, source
  `DEVICE` or `TYPED`, `expandNearby` from the tick.

**Step 3, the shops.** The chains near the code, each with its shop count, every one
switched on, with **Turn all off** above them.

- With no code from step 2, the same screen lists every chain from
  `GET /v1/catalog/supermarkets`, without counts and without the "Near 14013" heading.
- A chain switched off stays on the list, struck through and marked, exactly as the
  profiles page draws an excluded chain. It is a decision, not a deletion.
- All of them off is allowed, and the screen says what it means: nothing has a price.
  Never block it.
- **Done** writes `PATCH /v1/account/shopping-profiles/:id` with one entry per chain
  the person changed, and moves to `setup/done`.

## 6. The finish

A tick, "That is everything", the three answers in a small table, and the tour's offer:

> **Would you like a quick tour?**
> We will show you around the app, one screen at a time, so that nothing is hard to
> find. It is short, and you can stop it whenever you like.

**Show me around** starts the tour (`0099`) and **No, thank you** goes home. Both write
`setupCompleted` first (section 7).

The offer names no feature. Stops will be added and dropped, and a list of them ages
into a lie on a screen nobody thinks to revisit.

## 7. Writing that it is over

`PATCH /v1/account/app-state` with `setupCompleted: true`, on every exit: Not now, No
thank you, Show me around, and the back chevron out of `setup`.

- Fire and forget, then navigate. The person is finished with this flow whatever the
  network thinks, and the guard in section 3 re-asks at most once per cold start if the
  write was lost.
- The store updates `ProfileStore`'s copy of `appState` immediately, so the guard does
  not re-fire during this document's lifetime.

**Each step's own answer is written by that step**, when its button is pressed, and not
here. So closing the app halfway keeps the name and the code, there is no review
screen, and a failed write belongs to the step that made it and is retried there.

## 8. Copy

The mock's words are the approved words. The table below is the whole of it; nothing
here is a paraphrase to be improved.

| Key | English | Spanish |
| --- | --- | --- |
| `setup.welcome.title` | Three questions and you are shopping | Tres preguntas y a comprar |
| `setup.welcome.body` | You do not have to answer any of them. If you skip a question, we choose for you, and you can change it later. | No hace falta responder a ninguna. Si te saltas una, elegimos por ti y puedes cambiarlo luego. |
| `setup.welcome.one` | What we call you | Cómo te llamamos |
| `setup.welcome.oneBody` | The name everyone in your groups sees. | El nombre que ve todo tu grupo. |
| `setup.welcome.two` | Where you shop | Dónde compras |
| `setup.welcome.twoBody` | A postal code. Without one we cannot show a price. | Un código postal. Sin él no podemos mostrar precios. |
| `setup.welcome.three` | Which supermarkets | Qué supermercados |
| `setup.welcome.threeBody` | All of them, until you say otherwise. | Todos, hasta que digas lo contrario. |
| `setup.welcome.start` | Start | Empezar |
| `setup.welcome.later` | Not now | Ahora no |
| `setup.step` | Step {{n}} of {{total}} | Paso {{n}} de {{total}} |
| `setup.skip` | Skip | Saltar |
| `setup.name.title` | What do we call you? | ¿Cómo te llamamos? |
| `setup.name.body` | Everyone in your groups sees this name. It is not your email address, and it does not have to be your real name. | Este nombre lo ve todo tu grupo. No es tu correo y no tiene que ser tu nombre real. |
| `setup.name.label` | Your name | Tu nombre |
| `setup.name.placeholder` | Leave it blank | Déjalo en blanco |
| `setup.name.picked` | We already picked one for you. | Ya hemos elegido uno por ti. |
| `setup.name.keeps` | Leave the field blank and it stays yours. | Déjalo en blanco y se queda contigo. |
| `setup.name.another` | Pick another one | Elegir otro |
| `setup.name.keep` | Keep {{name}} | Quedarme con {{name}} |
| `setup.name.continue` | Continue as {{name}} | Seguir como {{name}} |
| `setup.name.note` | You can change it later on your account screen. Names are not unique, so somebody else can be {{name}} too. | Puedes cambiarlo luego en tu cuenta. Los nombres no son únicos, así que otra persona también puede llamarse {{name}}. |
| `setup.place.title` | Where do you shop? | ¿Dónde compras? |
| `setup.place.body` | The same product costs different amounts in different towns, so we cannot show you a price until we know which shops are near you. A postal code is as close as we ever need. | El mismo producto cuesta distinto en cada pueblo, así que no podemos darte un precio hasta saber qué tiendas tienes cerca. Con el código postal nos basta. |
| `setup.place.useLocation` | Use my location | Usar mi ubicación |
| `setup.place.or` | or type it | o escríbelo |
| `setup.place.privacy` | If you press the button, your position is turned into a postal code and the position is thrown away. We store the code and nothing finer. | Si pulsas el botón, tu posición se convierte en un código postal y la posición se descarta. Guardamos el código y nada más preciso. |
| `setup.place.placed` | We placed you in | Estás en |
| `setup.place.nearby` | Include the codes around it | Incluir los códigos de alrededor |
| `setup.place.nearbyBody` | A shop one street over is often in the next code. Ticked because you just told us where you are. | Una tienda a una calle suele estar en el código siguiente. Marcado porque acabas de decirnos dónde estás. |
| `setup.place.reaches` | {{chains}} supermarket chains and {{shops}} shops | {{chains}} cadenas y {{shops}} tiendas |
| `setup.place.reachesBody` | You choose between them on the next screen. | Eliges entre ellas en la pantalla siguiente. |
| `setup.place.skipTitle` | Without a postal code the catalog still works and shows no prices. | Sin código postal el catálogo funciona y no muestra precios. |
| `setup.place.skipBody` | Lists, groups and the assistant are unaffected. Add a code whenever you like, on your shopping profile. | Las listas, los grupos y el asistente no cambian. Añade un código cuando quieras, en tu perfil de compra. |
| `setup.place.skipAnyway` | Skip anyway | Saltar igualmente |
| `setup.place.back` | Back | Volver |
| `setup.shops.title` | Which supermarkets? | ¿Qué supermercados? |
| `setup.shops.body` | All of them are on. Turn off a chain you will never walk into, and its prices stop counting anywhere in the app. | Están todos activos. Desactiva una cadena a la que no vayas nunca y sus precios dejan de contar en toda la app. |
| `setup.shops.near` | Near {{code}} | Cerca de {{code}} |
| `setup.shops.all` | Every chain we hold | Todas las cadenas que tenemos |
| `setup.shops.turnAllOff` | Turn all off | Desactivar todas |
| `setup.shops.count` | {{count}} shops | {{count}} tiendas |
| `setup.shops.off` | OFF | NO |
| `setup.shops.note` | A chain means every shop it has here. Refuse one shop on its own later, on your shopping profile. | Una cadena son todas sus tiendas de aquí. Rechaza una tienda concreta más tarde, en tu perfil de compra. |
| `setup.shops.noneTitle` | With every chain off, nothing has a price. | Sin ninguna cadena activa, nada tiene precio. |
| `setup.shops.noneBody` | The catalog, your lists and the assistant all keep working. Turn one back on whenever you like. | El catálogo, tus listas y el asistente siguen funcionando. Vuelve a activar una cuando quieras. |
| `setup.shops.done` | Done | Listo |
| `setup.done.title` | That is everything | Ya está todo |
| `setup.done.body` | Each answer is already saved. Change any of them from your account screen. | Cada respuesta ya está guardada. Cámbialas cuando quieras desde tu cuenta. |
| `setup.done.name` | Name | Nombre |
| `setup.done.where` | Where | Dónde |
| `setup.done.shops` | Shops | Tiendas |
| `setup.done.tourTitle` | Would you like a quick tour? | ¿Quieres una visita rápida? |
| `setup.done.tourBody` | We will show you around the app, one screen at a time, so that nothing is hard to find. It is short, and you can stop it whenever you like. | Te enseñamos la app pantalla a pantalla para que no te cueste encontrar nada. Es corta y puedes pararla cuando quieras. |
| `setup.done.tourStart` | Show me around | Enséñamela |
| `setup.done.tourNo` | No, thank you | No, gracias |

## 9. Accessibility

- Each step's title is the page's `h1` and the document title.
- The progress rail is decorative. `setup.step` carries the position as text.
- The resolved code is announced through a polite region, because somebody who cannot
  see it needs to know what they are confirming before they press.
- The refused and unplaceable states are announced the same way, and each hands over to
  typing rather than offering a retry the browser will not honour.
- Focus moves to the step's heading on each navigation.

## 10. Not in this plan

- The tour itself (`0099`).
- Changing how registration generates a name.
- A second profile. The setup writes to the default one, and the profiles page is where
  somebody makes another.
- Any per device state. The flag is the account's, wherever it signs in.

## 11. Tests

- `setup-guard.spec.ts`: anonymous no, guest no, set up already no, fresh yes, and only
  once per document.
- `name-step.spec.ts`: blank writes nothing and keeps the generated name; typed writes
  once; the button's label follows the field; the suggestion swaps the card and does
  not write.
- `place-step.spec.ts`: each of the four location states; Continue disabled until a
  code exists; the nearby tick defaults to true after a lookup and is sent;
  skip writes nothing.
- `shops-step.spec.ts`: scoped list with counts, unscoped list without them, one off,
  all off allowed, and only the changed chains are sent.
- `setup-completion.spec.ts`: all four exits patch the flag exactly once.
- `routes.spec.ts`: all five setup routes carry `data.chrome: 'none'`.

## 12. Acceptance criteria

- [ ] A fresh account is walked into the welcome on its first navigation.
- [ ] Each step writes its own answer, and closing the app halfway keeps what was
      answered.
- [ ] Every step is skippable, and skipping never blocks the next one.
- [ ] Not now, No thank you and Show me around all mark the account set up.
- [ ] The tour offer names no feature.
- [ ] A set up account never sees the flow again, on this device or another.
- [ ] `npx nx lint velista && npx nx test velista` pass, with every library touched.

## 13. Verification

```sh
npx nx test velista-feature-setup
npx nx test velista-feature-shell
npx nx test velista-data-access
npx nx lint velista
npx nx build velista
```

Then, on a slot: register a new account, walk the whole flow, register a second and
skip every step, and confirm neither is asked again after a reload.
