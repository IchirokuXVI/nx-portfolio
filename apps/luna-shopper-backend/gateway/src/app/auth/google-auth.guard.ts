import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { NotConfiguredException } from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';

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
 * Answers 501 when this deployment has no Google credentials (plan 0026,
 * section 3.3).
 *
 * It must run BEFORE `GoogleAuthGuard`. With Google unset the strategy provider
 * resolves to `null`, so passport has nothing registered under the name
 * `'google'` and `AuthGuard('google')` throws `Unknown authentication strategy`
 * — which the global filter renders as a 500 with the `internal` code. A caller
 * then cannot tell "this deployment has no Google" from "the gateway is broken",
 * and the log fills with internal errors for a configuration that is deliberate.
 *
 * The routes themselves stay registered either way, so the published OpenAPI
 * document describes the same API in every environment. What is conditional is
 * the strategy behind them, and now the answer when it is absent.
 */
@Injectable()
export class GoogleConfiguredGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    this.enabled =
      configService.getOrThrow<GatewayConfig>('gateway').google.enabled;
  }

  canActivate(): boolean {
    if (!this.enabled) {
      throw new NotConfiguredException('Google sign in is not configured');
    }
    return true;
  }
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
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    super();
    this.enabled =
      configService.getOrThrow<GatewayConfig>('gateway').google.enabled;
  }

  override canActivate(context: ExecutionContext) {
    // Deliberately NOT GoogleConfiguredGuard here (plan 0026, section 2). A 501
    // is an error page on the API's origin, which is the one thing this route
    // must never produce. With Google unset, skip the passport dance — there is
    // no strategy registered under `'google'`, so running it would throw
    // `Unknown authentication strategy` — and let the handler through with no
    // user, which it already answers with a redirect carrying `#error=`.
    if (!this.enabled) {
      return true;
    }
    return super.canActivate(context);
  }

  override handleRequest<TUser>(_err: unknown, user: unknown): TUser {
    // Passport hands `false` for a failure and an error object for a thrown one.
    // Both become undefined, which the handler reads as "the dance did not
    // resolve a profile" and answers with a redirect.
    return (user || undefined) as TUser;
  }
}
