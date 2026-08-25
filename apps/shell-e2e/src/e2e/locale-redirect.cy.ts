/**
 * Locale-less navigation must be redirected to a locale-prefixed URL by the
 * shell's `localeGuard` (apps/shell/src/app/app.routes.ts): visiting `/<app>`
 * with no locale lands on `/<locale>/<app>`.
 *
 * Running this for every child of the `:locale` route is deliberate — it proves
 * the redirect works AND that no app's own path collides with the locale regex
 * (a two-letter remote path such as `os` would otherwise be swallowed as a
 * locale). If a child treated its path as a locale, the app segment would be
 * missing after the redirect and the per-path assertion below would fail.
 */

// Children of the shell's `:locale` route. Keep in sync with the shell's
// app.routes.ts (`''` is the root landing app; the `**` wildcard is not a real
// entry path and is exercised by the existing 404 spec instead).
const APP_PATHS = ['', 'odontogram', 'damoclesSword', 'velista'];

// Same shape the shell's locale routing accepts.
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

describe('locale-less navigation redirects to a locale-prefixed URL', () => {
  for (const path of APP_PATHS) {
    const label = path === '' ? '/ (root)' : `/${path}`;

    it(`redirects ${label} to /<locale>${path ? '/' + path : ''}`, () => {
      cy.visit(`/${path}`);

      cy.location('pathname').should((pathname) => {
        const segments = pathname.split('/').filter(Boolean);

        // A valid locale was prepended.
        expect(segments[0], `leading segment of "${pathname}" is a locale`).to.match(
          LOCALE_SEGMENT
        );

        if (path === '') {
          // Root: just the locale, nothing was invented after it.
          expect(segments, `"${pathname}" is only a locale`).to.have.length(1);
        } else {
          // The app path is preserved right after the locale (this is what
          // catches a path being mistaken for a locale).
          expect(segments[1], `app path preserved in "${pathname}"`).to.eq(path);
        }
      });
    });
  }
});
