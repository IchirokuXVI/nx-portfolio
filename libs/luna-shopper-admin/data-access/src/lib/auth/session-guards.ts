import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SessionStore } from './session-store';

/** Where an operator with no session is sent. The app's only public route. */
export const SIGN_IN_PATH = 'sign-in';

/**
 * Nothing renders without a session (plan 0002: the login screen is the first
 * thing the app shows and the only thing it shows until it succeeds).
 *
 * A guard rather than a check inside each page, so a route added in `0004` or
 * `0005` is protected by existing rather than by remembering.
 */
export const requireSession: CanActivateFn = () => {
  const sessions = inject(SessionStore);
  const router = inject(Router);

  return sessions.signedIn() ? true : router.createUrlTree([SIGN_IN_PATH]);
};

/**
 * The mirror: an operator who already has a session has no business on the
 * login screen, so a reload that lands there sends them on.
 *
 * It returns the **landing route**, never the URL it was asked for. A guard that
 * answers with the URL it was handed loops forever with no error and a white
 * tab, and this is exactly the pair of routes where that mistake is available.
 */
export const requireNoSession: CanActivateFn = () => {
  const sessions = inject(SessionStore);
  const router = inject(Router);

  return sessions.signedIn() ? router.createUrlTree(['/']) : true;
};
