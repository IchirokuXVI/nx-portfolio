# Velista PWA and origin audit, 2026-10-23

Read only audit made for the Capacitor plans (velista 0166 and 0167). Every path is relative to the workspace root, read on `dev` at `63f740d8`. The companion report is `2026-10-23-velista-capacitor-browser-api-inventory.md`. The nginx findings were checked live against `nginx:latest` (1.31.4) with the shipped `nginx-static-app.conf`.

## 1. PWA audit

### Manifest (`apps/velista/public/manifest.webmanifest`)

1. OK. `name` and `short_name` ("Velista", L2 and L3), `description` (L4), `id: "/"` (L5), `start_url: "/"` (L6), `scope: "/"` (L7), `display: "standalone"` (L8). `theme_color` and `background_color` are both `#0a0c14` (L10 and L11). `start_url` is inside `scope`.
2. OK, icons. `icons/icon-192.png` is 192x192 (any), `icons/icon-512.png` is 512x512 (any), `icons/icon-maskable-512.png` is 512x512 (maskable), `apple-touch-icon.png` is 180x180, `favicon.ico` holds 48, 32 and 16. This meets the Chrome Android criteria.
3. OK, screenshots. `narrow-home.png` is 1170x2532 (ratio 2.16) and `wide-home.png` is 1280x800 (ratio 1.6). The declared sizes match the files and both fit Chrome's richer install UI limits.
4. Note. `orientation: "portrait"` (L9) is plan 0013 open question O3, still unresolved.
5. Minor gaps. No `lang` or `dir`. No `related_applications`, which plan 0033 D8 rejects on purpose because the manifest is environment agnostic.

### Does `start_url` `/` reach a page?

OK. `appRoutes = [appRootRoute('')]`. The parent route in `libs/velista/feature-shell/src/lib/routes.ts` has `path: ''` and `canActivate: [localeGuard]` (L652 and L664); its children are `:locale` and a last `**` NotFound child (about L1885). `apps/velista/src/app/app.routes.spec.ts` L43 to L45 asserts `/` becomes `/es`. No e2e and no spec checks the manifest file, the link tags or `ngsw.json`.

### `index.html` (`apps/velista/src/index.html`)

1. OK. `<base href="/">` (L6) and `<link rel="manifest" href="manifest.webmanifest">` (L38).
2. OK. The viewport (L17 to L20) is `width=device-width, initial-scale=1, interactive-widget=resizes-content`.
3. Defect: no `viewport-fit=cover`. The app reads `env(safe-area-inset-*)` in `libs/velista/ui/src/lib/layout/app-layout.scss` (about L92), `bottom-action-bar.ts`, `photo-viewer.scss`, `_semantic.scss` and `apps/velista/src/app/app-root.ts` L38. Without `viewport-fit=cover`, iOS standalone reports 0 for those insets, and an edge to edge WebView needs it too. Fix: add `viewport-fit=cover` to the same meta.
4. Defect, minor: one `theme-color` only (L39, `#0a0c14`), no light variant, and `libs/velista/platform/src/lib/theme-store.ts` never rewrites the meta. A Day theme user gets a Night status bar. Fix: have ThemeStore update the meta (or add a light media variant).
5. iOS meta. `apple-touch-icon` is OK (L40). No `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` or `apple-mobile-web-app-title`. iOS 16.4 and later honour the manifest `display`, so this is optional.

### Service worker (`apps/velista/ngsw-config.json`, `project.json`, built `ngsw.json`)

1. OK, registration. `serviceWorker: true` and `ngswConfigPath` on the production configuration only (`project.json` L31 and L32). Registered in `apps/velista/src/app/app.config.ts` L47 to L50 as `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`. Worker and scope are at root.
2. OK, build output. `dist/apps/velista` is flat (no `browser/` subfolder) and contains `ngsw-worker.js`, `ngsw.json`, `safety-worker.js` and `worker-basic.min.js`. `"index": "/index.html"` (L3) matches.
3. OK, app asset group. `installMode: prefetch` (L10) covers `/index.html`, `/manifest.webmanifest`, `/*.css`, `/*.js` and `/*.mjs` (L13 onward). Each hashed chunk is a new URL, so prefetch on update is sensible.
4. OK, assets group. Lazy with `updateMode: prefetch` (L23 to L26).
5. Defect, minor: fonts are not cached. The hashed fonts at the dist root (`marcellus-latin.*.woff2`, `marcellus-latin-ext.*.woff2`) match no glob, so an offline cold start draws the fallback font. Fix: add `/*.woff2` to the app group.
6. OK, `navigationUrls` (L30) is the default. Locale paths and `/auth/verify?token=…` fall back to `index.html`; dotted paths such as `/.well-known/*` are excluded. The API is on another origin, so it needs no exclusion.
7. OK, `dataGroups` is empty (plan 0013 D8), so nothing from the gateway is cached.
8. OK, `appData` is `{ "critical": false }` (L4 to L6); `isCriticalUpdate` in `libs/velista/platform/src/lib/app-updates.ts` reads it (plan 0034 D3).

### Native relevant findings in the update path

1. Plan 0165 enables the worker whenever the document mount is `''`. In Capacitor the mount is also `''`, so the worker would register inside the WebView unless something else excludes it.
2. With `server.hostname: velista.app`, a worker check of `ngsw.json` is answered by the bundled copy that Capacitor intercepts, so it never sees a newer web release.
3. `AppUpdates.demandUpdate` (`app-updates.ts` about L187 to L216, plans 0072 and 0150) reloads to fetch a fresh bundle when no worker exists. In a native shell that reload returns the same APK bundle, so a gateway `x-min-client-version` floor sends the user into the "updating" face with no newer bundle to load.
4. The install page and InstallStore (`libs/velista/platform/src/lib/install-store.ts`, `feature-install`) read `beforeinstallprompt` and `display-mode`, which mean nothing in a WebView.

### Serving (Dockerfile and nginx)

`apps/velista/src/Dockerfile` has no build stage: `FROM ${TARGET_REGISTRY}nx-portfolio/local-http-server:${BUILDER_TAG}` and `COPY . /var/www/html/` (L22 to L24), context `dist`. The nginx configuration is `apps/docker/local-http-server/src/nginx-static-app.conf` (plan 0165 gives velista its own copy at `apps/velista/src/nginx.conf`). Probed live:

1. OK. `index.html`, `ngsw.json`, `ngsw-worker.js`, `manifest.webmanifest` and `remoteEntry.mjs` get `Cache-Control: no-cache` (L48 to L52).
2. OK. `/` and `/en/zones/abc` return `index.html` with no-cache through `try_files $uri $uri/ /index.html` (L63 to L66).
3. Defect, minor: wrong manifest MIME type. `manifest.webmanifest` is served as `application/octet-stream`, because the stock `mime.types` has no `webmanifest` entry. Browsers tolerate it; the spec type is `application/manifest+json`. Fix: add `application/manifest+json webmanifest;` to the `types` block.
4. Defect, minor: no cache header on hashed assets. `*.js`, `*.css` and `*.woff2` get no `Cache-Control` (L55 to L60), so caches use heuristics. Fix: `public, max-age=31536000, immutable` on hashed names only, never on the five fixed names.
5. Behaviour to know. A missing file whose extension is in the static regex returns 404; a missing `.ico`, `.webp` or extensionless path falls through to `index.html` with 200.
6. `Access-Control-Allow-Origin: *` is on every response.

## 2. How the bundle is built and served

1. Builder `@nx/angular:webpack-browser` (`project.json` L10), Angular 21.2.6, @nx/angular 22.7.2. `outputPath: dist/apps/velista` (L13) is flat. Assets copy `apps/velista/public/**/*` to the output root (L18 to L23). No `baseHref` or `deployUrl` option.
2. `production` (the default, L30 to L59): `serviceWorker`, `ngswConfigPath`, budgets, `outputHashing: "all"` (L45), `customWebpackConfig: apps/velista/webpack.prod.config.ts`, `fileReplacements` for `environment.ts` and `scripted-walk-loader.ts`.
3. `development` (L60 to L67): no optimization, source maps, named chunks, `apps/velista/webpack.config.ts`. No other configuration exists.
4. `webpack.prod.config.ts` defines, one env var each (L72 to L93):

   | Value | Env var | Default when unset |
   | --- | --- | --- |
   | `process.env.LUNA_GATEWAY_URL` | `LUNA_GATEWAY_URL` | `https://api.velista.app` |
   | `process.env.LUNA_REALTIME_URL` | `LUNA_REALTIME_URL` | `https://rt.velista.app` |
   | `process.env.VELISTA_APP_URL` | `VELISTA_APP_URL` | `https://velista.app` |
   | `process.env.VELISTA_APP_VERSION` | `VELISTA_APP_VERSION` | `0.0.0-dev` (`apps/velista/app-version.ts`) |

   `webpack.config.ts` (development) uses `http://localhost:3000`, `:3001` and `:4205`.
5. Native build env, production: a plain `nx build velista` already targets the production hosts; set `VELISTA_APP_VERSION` to the release version. Staging: `LUNA_GATEWAY_URL=https://api.staging.velista.app`, `LUNA_REALTIME_URL=https://rt.staging.velista.app`, `VELISTA_APP_URL=https://staging.velista.app`, plus a version.
6. Defect: staging bakes the production app origin. `.github/workflows/docker-ci.yml` L347 to L358 sets the two `LUNA_*` values and the version but not `VELISTA_APP_URL`, so the staging bundle carries `https://velista.app` and share links built on staging point at production. `tools/dev/ng-slot.sh` also leaves `VELISTA_APP_URL` out of `DERIVED_KEYS[velista]` (L213 and L645 to L651).
7. `VELISTA_APP_URL` is provided as `APP_STANDALONE_ORIGIN` (`apps/velista/src/app/app-providers.ts` L168) and consumed by the basket share link (`share-sheet.ts` L130, L250 to L256), the install page (`install-page.ts` L81, L98) and the account page (`account-page.ts` L120, L184, L254, L255). The group invite link does not use it: `group-page.ts` L538 to L543 and `home-page.ts` L549 to L554 read `location.origin`.

## 3. Backend origin handling

1. Gateway CORS. `CORS_ORIGINS` is a comma split allowlist (`gateway/src/app/config/app-config.ts` L170, L385 to L388); `main.ts` L54 to L66 calls `enableCors({ origin: list, credentials: true, exposedHeaders: ['x-min-client-version'] })` only when the list is non empty. Matching is exact string equality, no wildcard, no regex. A missing or `null` Origin simply gets no allow header. No Origin or Referer check, no helmet, no CSRF anywhere.
2. Realtime. Its own `CORS_ORIGINS` (`realtime/src/app/config/app-config.ts` L36, L68 to L71) feeds `enableCors` (`realtime/src/main.ts` L32 to L34). The socket server is `@WebSocketGateway({ transports: ['websocket'], cors: { origin: true, credentials: true } })` (`realtime/src/app/socket/realtime.gateway.ts` L79 to L82): WebSocket only, no origin check on the upgrade. The client forces `transports: ['websocket']` (`realtime-socket.ts` L315).
3. Cookies and tokens. Nothing sets a cookie. Access and refresh tokens live in `localStorage` (`libs/velista/data-access/src/lib/auth/token-store.ts`) and travel as `Authorization: Bearer` (`gateway-interceptor.ts`). Refresh is `POST /v1/auth/refresh` with `{ refreshToken }` in the body. The Google callback returns the pair in the URL fragment. Storage is per origin: a WebView on `https://velista.app` and Chrome on `velista.app` hold different sessions.
4. Configured values. Production `values.production.yaml` L90: `https://ichirokuxvi.com,https://velista.app,https://admin.velista.app`. Staging `values.staging.yaml` L64: `https://staging.ichirokuxvi.com,https://staging.velista.app,https://admin.staging.velista.app`. The ConfigMap key is `CORS_ORIGINS` (`configmap.yaml.tpl` L21), read through `_env.tpl` L67 to L71, one value shared by every service. Compose: `compose.apps.yml` `${CORS_ORIGINS:-http://localhost:4200,http://localhost:4205}` at L76, L160, L193, L259, L310. CI `e2e-velista-luna`: `https://staging.velista.app` (`docker-ci.yml` L640). Slots: `luna-slot.sh` `frontend_origins()` (L992 to L1005) lists every slot's localhost ports.
5. Conclusion. A WebView origin of `https://velista.app` (production) or `https://staging.velista.app` (staging) is already allowed everywhere; no backend change. A WebView origin of `https://localhost` would need the origin added in `values.production.yaml`, `values.staging.yaml`, `compose.apps.yml` (five lines), `luna-slot.sh` and the docker-ci gate.

## 4. Deep links and share links

1. Front end built, locale inserted by `localeGuard` on arrival (`libs/velista/platform/src/lib/share-url.ts`): basket share `{VELISTA_APP_URL}{mount}/s/{secret}` (route `s/:secret`, `routes.ts` L1775); group invite `{location.origin}{mount}/join/{code}` (route `join/:code`, L1786).
2. Mail, built by `apps/luna-shopper-backend/auth/src/app/mail/mail.service.ts`: verification `{MAIL_VERIFY_BASE_URL}?token=…` (L199, L213); password reset and recovery `{MAIL_RESET_BASE_URL}?token=…` plus `&mode=sign-in` (L115 to L121). Production values `https://velista.app/auth/verify` and `https://velista.app/auth/reset-password` (`values.production.yaml` L142, L147); staging the same under `staging.velista.app` (`values.staging.yaml` L94, L95).
3. Gateway redirects from `APP_BASE_URL` (`gateway/src/app/auth/app-url.ts`): Google OAuth return `{APP_BASE_URL}/auth/callback#accessToken=…` (not wired in the UI yet) and the support handoff `…/auth/impersonate#code=…`. Values `https://velista.app/{locale}` and `https://staging.velista.app/{locale}`.
4. Path shapes: `/s/*`, `/join/*`, `/auth/verify`, `/auth/reset-password` (optionally locale prefixed, with a query), `/{locale}/auth/callback` and `/{locale}/auth/impersonate` (with a fragment), and any `/{en|es}/…` page. No push links exist.

## 5. Static file serving for `.well-known`

1. `apps/velista/public/.well-known/assetlinks.json` is copied by the Angular build: the asset glob `**/*` runs with `dot: true` and ignores only `.gitkeep`, `.DS_Store` and `Thumbs.db`. It lands at `dist/apps/velista/.well-known/assetlinks.json`.
2. nginx serves `/.well-known/assetlinks.json` with 200, `Content-Type: application/json` and `Access-Control-Allow-Origin: *` (the `\.(…|json|…)$` block, L55 to L60). A missing `.json` returns 404, never `index.html`. An extensionless `apple-app-site-association` would be served as `application/octet-stream` and would need a `types` override.
3. The velista HTTPRoute is `PathPrefix /` with no rewrite; certificates use DNS01, so nothing else claims `/.well-known`.
4. The velista image is the same file in staging and production, so one `assetlinks.json` must list both package names if they differ.
