/**
 * Locale-less navigation must be answered with a locale, by **the app that owns the
 * URL** rather than by the shell (plan 0003).
 *
 * This spec is a rewrite, not an adjustment. It used to assert that the leading
 * segment of every path is a locale, which is exactly what moving the locale below
 * each app's mount reverses. The invariant now is:
 *
 *   the segment **after the mount** is a supported, canonical locale.
 *
 * Running it for every app is still deliberate, and still proves two things at once:
 * that the locale is settled, and that no app's own path is mistaken for one. The
 * shell resolves `/en` (landingV2 in English) from `/velista` (velista with no locale
 * yet) by trying app mounts first and falling through to the empty path app, so an
 * app whose mount were treated as a locale would lose its mount segment here.
 */

/** Apps mounted at their own path, and the app at the site root (`''`). */
const APP_MOUNTS = ['odontogram', 'damoclesSword', 'velista', ''];

/** Same shape the locale routing accepts. */
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

describe('locale-less navigation is answered with a locale', () => {
  for (const mount of APP_MOUNTS) {
    const label = mount === '' ? '/ (root)' : `/${mount}`;

    it(`settles a locale below ${label}`, () => {
      cy.visit(`/${mount}`);

      cy.location('pathname').should((pathname) => {
        const segments = pathname.split('/').filter(Boolean);

        if (mount === '') {
          // The app at the site root contributes no mount segment, so the locale is
          // the first one and nothing was invented after it.
          expect(
            segments[0],
            `leading segment of "${pathname}" is a locale`
          ).to.match(LOCALE_SEGMENT);
          expect(segments, `"${pathname}" is only a locale`).to.have.length(1);
          return;
        }

        // The mount survives, which is what catches it being mistaken for a locale.
        expect(segments[0], `mount preserved in "${pathname}"`).to.eq(mount);
        // And the locale was inserted directly below it.
        expect(
          segments[1],
          `segment after the mount in "${pathname}" is a locale`
        ).to.match(LOCALE_SEGMENT);
      });
    });
  }

  it('replaces a locale-shaped segment no app supports', () => {
    // `zz` occupies the locale slot and is not a locale any app has, so it is
    // consumed rather than kept as a path segment.
    cy.visit('/odontogram/zz');

    cy.location('pathname').should('not.match', /\/zz(\/|$)/);
    cy.location('pathname').should('match', /^\/odontogram\/[a-z]{2}(\/|$)/i);
  });
});
