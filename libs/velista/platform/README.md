# velista/platform

Services that wrap the **runtime environment** rather than the backend: the browser
facade, connection state, the reload blocker, storage keys, and the access-token
expiry reader.

It exists so that `ui` and `data-access` can stay siblings that cannot see each other
(plan `0004` section 3). `ui` needs the browser facade for the connection-lost screen
and the theme override, and rule D1 forbids it from importing `data-access`, so what
they share lives here instead.

Layering: `models` → `platform` → { `ui`, `data-access` } → `feature-*`.

## Running unit tests

Run `nx test velista/platform` to execute the unit tests.
