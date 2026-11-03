# 0002 (backlog) velista runs without a backend

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-11-03. The owner asked whether velista can be served for UI and UX work with
> no Luna Shopper services running. Today it cannot. The owner asked for this plan in the
> backlog in case the answer should become yes.

`npx nx serve velista --configuration=memory` serves the real app on 4205 against the in memory
fakes of `libs/velista/data-access`. No gateway, no realtime service, no database and no slot
are needed. The fakes already exist and already enforce permissions the way the gateway does.
What is missing is the switch that binds them, the startup path that assumes a server, and
fakes for the two services that have none.

## Brief for the agent

Load `nx-portfolio-angular-developer` before you write code.

### Objective

Add a `memory` build and serve configuration to `velista` that binds every data token to its
in memory implementation, so a developer can work on screens with no backend, and keep the
default and production builds exactly as they are today.

### Context

- `apps/velista/src/app/app-providers.ts` binds each data token to its HTTP class with
  `provideService(TOKEN, XxxApi)`, about twenty five lines between `provideHttpClient` and
  the environment initializers. `REALTIME_CLIENT` is bound to `RealtimeSocket` there too.
  Nothing chooses between transports today: the app always talks to a gateway.
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
- `environment.ts` reads `LUNA_GATEWAY_URL` and `LUNA_REALTIME_URL` through the `DefinePlugin`
  in `webpack.config.ts`. The memory mode must build with both unset.
- `AuthMemory` keeps its accounts in a map and issues tokens itself. `taken@example.com`
  with `password123` is the one seeded account today.

### Target state

1. **One switch, chosen at build time.** A `memory` configuration on the `build` and `serve`
   targets of `apps/velista/project.json`, built from `development`, adds a `fileReplacements`
   entry that swaps one app file, for example `src/app/transport-providers.ts` for
   `src/app/transport-providers.memory.ts`. The real file holds the `provideService(TOKEN,
   XxxApi)` lines and `REALTIME_CLIENT`, moved out of `app-providers.ts` unchanged. The
   memory file binds the same tokens to the `*Memory` classes. `app-providers.ts` spreads
   whichever one the build picked. No runtime flag, no query parameter, and no fake reaches
   a production bundle.
2. **The startup path does not wait for a server.** In the memory file, `StartupProbe` is
   replaced by a provider that marks `BackendReadiness` ready at once, and the
   `ConnectionRecovery` and `SessionValidation` initializers are left out. `TokenStore`
   refresh must not fire an HTTP request: either the memory build issues tokens that never
   expire inside a session, or `TokenStore` gets its refresh call through an injectable seam
   that the memory file binds to `AuthMemory`. Pick the smaller change and say which.
3. **Fakes for trips and due lines.** `TripMemory` and `DueLineMemory`, written like the
   existing fakes: seeded from the static data files, permission checks through `ListMemory`
   where the gateway checks them, refusals as `GatewayError` in the gateway's shape. Add each
   to `VELISTA_DATA_ACCESS_PROVIDERS` beside its siblings.
4. **A way in.** The developer can sign in on the memory build with a documented seeded
   account, or the memory build starts signed in as `SEED_USER_ID`. Recommend one; the owner
   decides (open question 1).
5. **The service worker stays off** on the memory build, as on `development`.
6. **Docs.** One short paragraph in `CLAUDE.md` under "Serving from a worktree: dev slots":
   to work on velista screens with no backend, run `npx nx serve velista
   --configuration=memory`, which needs no slot.

### Scope

In: `apps/velista/project.json`, `apps/velista/src/app/` (the provider split and its memory
twin), `libs/velista/data-access` (the two new fakes, the seam for the refresh if chosen),
`CLAUDE.md`, specs for each.

Out: the backend, `luna-shopper-admin` (it has its own `app-providers.ts` and its own
question), e2e suites, any change to how the production or development builds behave.

### Constraints

- The default `development` and `production` bundles must be byte for byte unchanged in what
  they bind. An `app-providers.spec.ts` assertion proves the default build still binds each
  token to its `*Api` class and `REALTIME_CLIENT` to `RealtimeSocket`.
- A spec over the memory file proves every token the real file binds is also bound by the
  memory file, so a new service cannot be added to one and forgotten in the other.
- Rule D4 still holds: the fakes speak in the frontend models, never in backend DTOs.
- Do not make any `*Memory` the default of its token. The token defaults stay as they are.

### Action boundaries

Do not add a runtime toggle, a `localStorage` flag or an environment variable read in the
browser. Do not touch `ng-slot.sh`. Do not build plans other than this one.

### Progress evidence

- `npx nx build velista --configuration=memory` succeeds with `LUNA_GATEWAY_URL` unset.
- `npx nx serve velista --configuration=memory` on a machine with no Luna slot running: the
  app passes the startup screen, a person can sign in, open a zone, open a list, add a line,
  start a trip and see due lines, and the browser network panel shows no request to a
  gateway or realtime host.
- `npx nx test velista` and `npx nx test velista/data-access` pass, including the two
  assertions under Constraints.

## Open questions

1. Sign in with a seeded account, or start already signed in. Starting signed in is faster
   for screen work but hides the auth screens unless the developer signs out first.
2. Whether the fakes should keep their state across a reload (in `sessionStorage`) or reset
   on each reload. Resetting is simpler and is what the specs expect.
3. Whether the memory build should draw a small fixed badge that says "memory", so a
   screenshot from it is never mistaken for a real deployment.
