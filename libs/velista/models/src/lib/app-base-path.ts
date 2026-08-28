import { InjectionToken } from '@angular/core';

/**
 * The path segment this app is mounted under, without a trailing slash.
 *
 * Extraction contract item 5 (plan 0001): routing is relative. Nothing in the app
 * may construct a URL that hardcodes the `velista` mount segment. Code that
 * genuinely needs it — a share link, a deep link handed to an external system —
 * asks for this token.
 *
 * While the app runs as a remote of the portfolio shell the value is `/velista`.
 * The standalone build supplies an empty string and nothing else changes.
 *
 * The **locale** segment is not part of this value and never should be: it varies
 * per navigation. Absolute links are built from the router's own URL tree, which
 * already carries the active locale, with this token supplying only the mount.
 */
export const APP_BASE_PATH = new InjectionToken<string>('APP_BASE_PATH');
