# 0002 (backlog) velista runs without a backend

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-11-03. The owner asked whether velista can be served for UI and UX work with
> no Luna Shopper services running. Today it cannot. The owner asked for this plan in the
> backlog in case the answer should become yes, and answered its open questions the same day
> (section "Owner decisions").

`npx nx serve velista --configuration=memory` serves the real app on 4205 against the in memory
fakes of `libs/velista/data-access`. No gateway, no realtime service, no database and no slot
are needed. **The memory build sends no request to any host but the dev server that serves its
own bundle.** The fakes already exist and already enforce permissions the way the gateway does.
What is missing is the switch that binds them, the startup path that assumes a server, fakes
for the two services that have none, and a guarantee that nothing can reach the network.

## Owner decisions

These are settled. Do not reopen them.

- **D1. A seeded account, not an automatic sign in.** The developer signs in through the real
  sign in screen with a documented account of the memory fake. The auth screens thus stay
  reachable and are exercised like any other screen.
- **D2. Fake data does not survive a reload.** Every fake starts again from its seed on each
  page load. Nothing is written to `sessionStorage`, `localStorage` or IndexedDB to keep it.
- **D3. A "memory" watermark that does not affect the UI at all.** A small fixed mark on the
  screen. It takes no pointer events, takes no space in any layout, is absent from the
  accessibility tree, and never covers a control in a way that changes what a click hits.
- **D4. No request leaves the app, ever.** The memory build is completely local. A service with
  no memory implementation must not be able to send a request even when a person tries to
  trigger one: its call fails inside the app. This is enforced by the build, not by the care of
  whoever writes the next service.

## Brief for the agent

Load `nx-portfolio-angular-developer` before you write code.

### Objective

Add a `memory` build and serve configuration to `velista` that binds every data token to its
in memory implementation and makes any network request impossible, so a developer can work on
screens with no backend, and keep the default and production builds exactly as they are today.

### Context

- `apps/velista/src/app/app-providers.ts` binds each data token to its HTTP class with
  `provideService(TOKEN, XxxApi)`, about twenty five lines after
  `provideHttpClient(withFetch(), withInterceptors([gatewayInterceptor]))`. `REALTIME_CLIENT` is
  bound to `RealtimeSocket` there too. Nothing chooses between transports today: the app always
  talks to a gateway.
- `libs/velista/data-access` ships a `*Memory` class beside almost every `*Api` class
  (27 files, for example `ListMemory`, `ZoneMemory`, `AuthMemory`, `CatalogMemory`,
  `ShopMapMemory`, `RealtimeMemory`). `VELISTA_DATA_ACCESS_PROVIDERS` already installs them
  in the app injector, and its doc comment says they are there "for the specs and
  backend-less runs that ask for them by name". The seed data lives in files such as
  `zones/static-zone-data.ts` and `zones/static-group-data.ts`.
- **Two services have no fake.** `TRIP_SERVICE` (`trips/`) and `DUE_LINE_SERVICE`
  (`due-lines/`) default to `TripApi` and `DueLineApi` in their own token factories.
- **Four classes call `HttpClient` directly, outside any token.** They are `StartupProbe`
  (`GET /health/ready`, which gates `AppLayout` behind the startup screen), `ConnectionRecovery`,
  `TokenStore` (the refresh `POST`) and `ImpersonationSession`. `SessionValidation` starts
  from an environment initializer as well. Each one assumes a server answers.
- **Two request paths bypass `HttpClient`.** `realtime/socket-factory.ts` opens a socket.io
  connection with `io(url)`, and the browser itself loads `<img>` and `Audio` sources (product
  pictures, comment recordings) from URLs that the data names.
- `TokenStore` keeps the session pair in `localStorage`, under keys that the development build
  on the same origin (`localhost:4205`) also uses.
- `environment.ts` reads `LUNA_GATEWAY_URL` and `LUNA_REALTIME_URL` through the `DefinePlugin`
  in `webpack.config.ts`. The memory mode must build with both unset.
- `AuthMemory` keeps its accounts in a map and issues tokens itself. `taken@example.com`
  with `password123` is the one seeded account today, and it is not the seed zone owner.

### Target state

1. **One switch, chosen at build time.** A `memory` configuration on the `build` and `serve`
   targets of `apps/velista/project.json`, built from `development`, adds a `fileReplacements`
   entry that swaps one app file, for example `src/app/transport-providers.ts` for
   `src/app/transport-providers.memory.ts`. The real file holds the `provideHttpClient` line,
   the `provideService(TOKEN, XxxApi)` lines and `REALTIME_CLIENT`, moved out of
   `app-providers.ts` unchanged. The memory file binds the same tokens to the `*Memory` classes.
   `app-providers.ts` spreads whichever one the build picked. No runtime flag, no query
   parameter, and no fake or memory only code reaches a production bundle.
2. **No request can leave the app (D4).** Three layers, each one enough on its own for what it
   covers:
   - **`HttpClient` has no transport.** The memory file provides `HttpClient` with an
     `HttpBackend` of its own, `NoNetworkBackend`, in place of the fetch backend. Each request
     fails at once with an `HttpErrorResponse` of status 0 and a message that names the method
     and URL and says that the memory build sends no requests, and logs one `console.error`
     with the same text. Nothing is passed to `fetch` or `XMLHttpRequest`. So a service with no
     fake, a forgotten direct `HttpClient` call or a new service added later fails loudly and
     locally, and never reaches a host.
   - **No socket.** `REALTIME_CLIENT` is `RealtimeMemory`, so `socket-factory.ts` is never
     called. The memory file also binds the socket factory to one that throws, so a direct
     use fails like an HTTP call does.
   - **The browser refuses the rest.** The memory configuration swaps `index.html` for one
     with a Content Security Policy meta tag: `default-src 'self'; connect-src 'self';
     img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:;
     script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'`. `'self'` keeps the
     dev server's own chunks, assets and live reload socket working. A picture or a recording
     whose URL names another host is blocked by the browser and draws its existing empty
     state. Adjust the directives only as far as the dev server needs, and say why in a
     comment beside each one.
3. **The startup path does not wait for a server.** In the memory file, `StartupProbe` is
   replaced by a provider that marks `BackendReadiness` ready at once, and the
   `ConnectionRecovery` and `SessionValidation` initializers are left out. `TokenStore` gets
   its refresh call through an injectable seam that the memory file binds to `AuthMemory`, so a
   refresh is answered locally and never reaches `NoNetworkBackend`. `ImpersonationSession`
   is reachable only from the back office; in the memory build its calls fail through
   `NoNetworkBackend`, which is acceptable.
4. **Fakes for trips and due lines.** `TripMemory` and `DueLineMemory`, written like the
   existing fakes: seeded from the static data files, permission checks through `ListMemory`
   where the gateway checks them, refusals as `GatewayError` in the gateway's shape. Add each
   to `VELISTA_DATA_ACCESS_PROVIDERS` beside its siblings.
5. **A seeded account (D1).** `AuthMemory` gains one account whose user id is `SEED_USER_ID`,
   so a sign in lands on the seeded zones and lists. Pick an address on a reserved domain (for
   example `dev@velista.test`) and a fixed password, export both as named constants from the
   memory file, and print them in the `CLAUDE.md` paragraph. They are fake values of a fake
   service and never reach a server.
6. **State resets on reload (D2), and the session behaves accordingly.** The fakes hold their
   state in memory only. The memory build gives `TokenStore` a storage key prefix of its own,
   so it can never read or overwrite a real session of the development build on the same
   origin. At startup a stored pair is kept only when it names an account that exists in the
   seed (the D1 account), so a live reload during work keeps the developer signed in, while a
   pair for an account registered in an earlier load is cleared and the app lands on sign in.
7. **The watermark (D3).** The memory file adds an environment initializer that appends one
   element to `document.body` with the text `memory`. Its styles are inline on the element:
   `position: fixed`, a corner of the screen clear of the safe area insets, small type, low
   opacity, `pointer-events: none`, `user-select: none`, a `z-index` above the app, and
   `aria-hidden="true"`. It is outside the app root, so it takes part in no layout and no focus
   order. No component, template or style of the app changes for it.
8. **The service worker stays off** on the memory build, as on `development`.
9. **Docs.** One short paragraph in `CLAUDE.md` under "Serving from a worktree: dev slots": to
   work on velista screens with no backend, run `npx nx serve velista --configuration=memory`,
   which needs no slot, sends no request, and signs in with the D1 account.

### Scope

In: `apps/velista/project.json`, `apps/velista/src/` (the provider split, its memory twin, the
memory `index.html`), `libs/velista/data-access` (the two new fakes, the refresh seam, the
storage prefix, `NoNetworkBackend`, the seeded account), `CLAUDE.md`, specs for each.

Out: the backend, `luna-shopper-admin` (it has its own `app-providers.ts` and its own
question), e2e suites, any change to how the production or development builds behave.

### Constraints

- The default `development` and `production` bundles must be unchanged in what they bind. An
  `app-providers.spec.ts` assertion proves the default build still binds each token to its
  `*Api` class, `REALTIME_CLIENT` to `RealtimeSocket` and `HttpBackend` to the fetch backend.
- A spec over the memory file proves every token the real file binds is also bound by the
  memory file, so a new service cannot be added to one and forgotten in the other.
- A spec proves D4 for `HttpClient`: with the memory providers, a `get` and a `post` to an
  absolute URL and to a relative URL each fail with status 0, and a spy on `globalThis.fetch`
  and on `XMLHttpRequest.prototype.open` records no call.
- A spec proves the watermark element has `pointer-events: none` and `aria-hidden="true"` and
  sits outside the app root.
- Rule D4 of the app (frontend models only) still holds: the fakes speak in the frontend
  models, never in backend DTOs.
- Do not make any `*Memory` the default of its token. The token defaults stay as they are.

### Action boundaries

Do not add a runtime toggle, a `localStorage` flag or an environment variable read in the
browser. Do not persist fake state (D2). Do not touch `ng-slot.sh`. Do not build plans other
than this one.

### Progress evidence

- `npx nx build velista --configuration=memory` succeeds with `LUNA_GATEWAY_URL` unset.
- `npx nx serve velista --configuration=memory` on a machine with no Luna slot running: the
  app passes the startup screen, the D1 account signs in, a person can open a zone, open a
  list, add a line, start a trip and see due lines, and the watermark shows in a corner.
- In that session the browser network panel lists requests to `localhost:4205` only. A
  deliberate call from the console, for example a `HttpClient` get to a gateway URL injected
  through the app's injector, fails with the D4 message and appears in no network row.
- A reload brings the seed back: a line added before it is gone, and the D1 session is kept.
- `npx nx test velista` and `npx nx test velista/data-access` pass, including the assertions
  under Constraints.
