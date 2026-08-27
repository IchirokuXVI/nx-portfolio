import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** The query passport reads the state out of on the way out and back. */
interface GoogleRequest {
  query?: Record<string, unknown>;
  user?: unknown;
}

/** The raw `state` on a request, or `''` when it carries none. */
export function stateOf(request: GoogleRequest | undefined): string {
  const value = request?.query?.['state'];
  return typeof value === 'string' ? value : '';
}

/**
 * Starts the Google redirect carrying the caller's OAuth state (plan 0023,
 * section 4.3, step 3).
 *
 * `getAuthenticateOptions` is the whole guard: what it returns is merged into the
 * options passport builds the authorization URL from, so a `state` here is
 * appended to the URL Google is sent. `passport-oauth2` leaves the value alone
 * while `state: true` is unset (its default store is the null store), so it round
 * trips untouched and no session is involved.
 *
 * A request with no state still goes to Google, and fails at the callback rather
 * than here. That costs one wasted trip in a case that should not occur; the
 * alternative, being lenient at the callback instead, costs an orphaned account
 * (section 4.4).
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override getAuthenticateOptions(
    context: ExecutionContext
  ): Record<string, unknown> {
    const state = stateOf(context.switchToHttp().getRequest<GoogleRequest>());
    return state ? { state } : {};
  }
}

/**
 * The guard on the callback, which must never answer with an error (plan 0023,
 * section 3.3).
 *
 * The browser arrives here by following Google's redirect: a top level
 * navigation, not an XHR. An error rendered at this point is a page on the API's
 * origin that the user has no way back from, and the app that started the flow
 * never learns the flow ended. So every failure passport can produce, a refused
 * consent, a bad code, an unreachable token endpoint, is turned into "no user"
 * and the handler redirects to the app with an `#error=` instead.
 *
 * Overriding `handleRequest` rather than `canActivate` keeps the passport dance
 * itself untouched; all that changes is what happens to its verdict.
 */
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  override handleRequest<TUser>(_err: unknown, user: unknown): TUser {
    // Passport hands `false` for a failure and an error object for a thrown one.
    // Both become undefined, which the handler reads as "the dance did not
    // resolve a profile" and answers with a redirect.
    return (user || undefined) as TUser;
  }
}
