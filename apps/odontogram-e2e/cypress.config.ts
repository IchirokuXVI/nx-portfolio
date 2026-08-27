import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';

// Odontogram is a remote: served on its own port it bootstraps `RemoteEntry`,
// whose template has no `<router-outlet>`, so the page stays blank and nothing
// renders. It renders only through the shell, which supplies the outlet, so this
// suite drives the shell's `/odontogram` mount.
//
// `baseUrl` is the shell's **origin** and nothing more. It used to carry the app's
// route as well, which quietly broke every `cy.visit`: Cypress resolves a url
// beginning with `/` against the origin and discards the path in `baseUrl`, so
// `cy.visit('/')` went to the site root rather than to odontogram, and the specs
// asserted against whatever the front page happened to do. Each spec names the path
// it means instead.
//
// **This suite still cannot run locally**, which is why CI continues to exclude it.
// Neither `shell:serve` nor `shell:serve-static` serves a history API fallback, so
// every client route deep link answers 404: `/en`, `/en/odontogram` and
// `/odontogram/en` alike. Measured on both, and on the old URL shape as well, so it
// predates the locale reorder and is a gap in the local server rather than in this
// app. Until that is fixed the guard contract is covered by
// `apps/odontogram/src/app/remote-entry/entry.routes.spec.ts`, which drives the real
// Angular router through the same nesting the shell builds.
//
// The locale is **below** the mount now (plan 0003): the shell no longer owns a
// `:locale` route on this app's behalf, and odontogram's own guard settles the
// segment after `/odontogram`.

// E2E_BASE_URL points the suite at an already-running deployment (e.g. the
// local Docker/Kubernetes reverse proxy at http://portfolio.localhost).
const origin = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';
const dockerOrigin = process.env['E2E_BASE_URL'];

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run shell:serve',
        production: 'npx nx run shell:serve-static',
      },
      ciWebServerCommand: 'npx nx run shell:serve-static',
      ciBaseUrl: origin,
    }),
    baseUrl: origin,
    chromeWebSecurity: false,
    // The remote is lazy-loaded and, in the dev configuration, ships unbundled
    // as hundreds of separate chunk requests, so the first render lands well
    // after `load`. Give the assertions room for that (and more again when
    // running against the slower docker deployment).
    defaultCommandTimeout: dockerOrigin ? 30000 : 15000,
    pageLoadTimeout: dockerOrigin ? 120000 : 60000,
  },
});
