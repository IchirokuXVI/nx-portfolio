import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiFoundResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  type AuthTokens,
  type GoogleProfile,
  type MintOAuthStateResult,
  type OAuthStatePayload,
} from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_LOCALE,
  ERROR_CODES,
  getRequestContext,
  toSupportedLocale,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { AuthUser } from './current-user.decorator';
import {
  GoogleAuthGuard,
  GoogleCallbackGuard,
  GoogleConfiguredGuard,
  stateOf,
} from './google-auth.guard';
import { OptionalJwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';
import { errorCodeOf } from './remote-problem';

/**
 * The little of a response this controller uses, so the handler can be called
 * with a double rather than an Express response.
 */
interface RedirectResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { end(): unknown };
}

/** Substituted with the flow's locale; see `APP_BASE_URL` in the gateway config. */
const LOCALE_PLACEHOLDER = '{locale}';

/** The page in the app that reads the fragment (velista plan 0009, section 5.6). */
const APP_CALLBACK_PATH = 'auth/callback';

/**
 * Google login endpoints (plan 0005, section 4.4; plan 0023).
 *
 * `POST /v1/auth/google/state` mints the opaque state that carries the caller
 * across the round trip, `GET /v1/auth/google` starts the OAuth redirect with it,
 * and the callback spends it, asks auth to create or link the account, and sends
 * the browser back to the app.
 *
 * The routes stay registered whether or not Google is configured, so the
 * published OpenAPI document describes the same API in every environment; what is
 * conditional is the strategy behind them (see the gateway auth module), which is
 * why an unset client id never breaks boot.
 */
@ApiTags('auth')
@Controller({ path: 'auth/google', version: '1' })
export class GoogleController {
  private readonly logger = new Logger(GoogleController.name);
  private readonly appBaseUrl: string;
  private readonly googleEnabled: boolean;

  constructor(
    private readonly nats: NatsClient,
    configService: ConfigService
  ) {
    const config = configService.getOrThrow<GatewayConfig>('gateway');
    this.appBaseUrl = config.appBaseUrl;
    this.googleEnabled = config.google.enabled;
  }

  /**
   * Mint the OAuth state (plan 0023, section 4.2).
   *
   * Guarded by the **optional** guard, and that choice is the point of the route.
   * A caller with no token at all gets a state with no `userId`, which is the
   * genuine sign in from scratch. A caller who presents a token must present a
   * good one: under a laxer guard a guest whose access token had expired would
   * mint a state carrying nobody, sail through the Google flow, and land on a
   * fresh account with every zone they own orphaned behind the old identity.
   */
  // GoogleConfiguredGuard first: minting a state for a flow that cannot proceed
  // is the same error one step earlier, and answering it here is what lets the
  // frontend hide the button before the user clicks it (plan 0026, section 3.3).
  @Post('state')
  @UseGuards(GoogleConfiguredGuard, OptionalJwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(AUTH_PATTERNS.mintOAuthState, {
    status: HttpStatus.CREATED,
    description:
      'An opaque, single use state valid for ten minutes. Pass it as the `state` query parameter when navigating to `GET /v1/auth/google`.',
  })
  @ApiProblemResponses({ auth: true, notConfigured: true })
  mintState(@AuthUser() user?: CurrentUser): Promise<MintOAuthStateResult> {
    return this.nats.send(AUTH_PATTERNS.mintOAuthState, {
      // From the verified token or not at all. A body could name somebody else,
      // and linking a Google identity onto an account is permanent.
      userId: user?.userId,
      locale: getRequestContext()?.locale,
    });
  }

  // Ordered: with Google unset there is no passport strategy registered under
  // `'google'`, so GoogleAuthGuard would throw `Unknown authentication strategy`
  // and the filter would render a 500. GoogleConfiguredGuard answers 501 first.
  @Get()
  @UseGuards(GoogleConfiguredGuard, GoogleAuthGuard)
  // The guard answers with a redirect before the handler runs, so what a client
  // sees is a `Location` header, not a payload.
  @ApiFoundResponse({
    description: "Redirects to Google's consent screen.",
  })
  @ApiProblemResponses({ notConfigured: true })
  // The guard triggers the redirect to Google; this body never runs.
  start(): void {
    return;
  }

  /**
   * Where Google sends the browser back (plan 0023, sections 3 and 4).
   *
   * It answers with a redirect and never with a body. The browser arrived here by
   * following Google's redirect, so JSON at this point is a page of the user's own
   * tokens on the API's origin with no way back into the app, which is what this
   * route used to do.
   *
   * The pair rides in the URL **fragment**, never the query string: a fragment is
   * never sent to a server, and a refresh token in a query string is a refresh
   * token in the gateway's access log, in every proxy log in front of it, and in
   * the `Referer` of whatever the app requests next (section 3.1). The app is
   * required to `history.replaceState` it away as soon as it has read it.
   *
   * Every failure ends at the same page with `#error=`, because the one thing
   * this route must never do is leave the user on the API's origin.
   */
  @Get('callback')
  @UseGuards(GoogleCallbackGuard)
  @ApiFoundResponse({
    description:
      'Redirects to the app. On success the token pair rides in the URL fragment (`#accessToken=…&refreshToken=…&userId=…&kind=…&username=…`); on any failure the fragment is `#error=<code>`. There is no response body either way.',
  })
  // Deliberately not `{ auth: true }`, though the route can certainly fail to
  // authenticate: a refused sign in leaves here as a 302 carrying `#error=`, not
  // as a 401, and documenting a status this route cannot produce would send a
  // client author looking for a response that never arrives.
  @ApiProblemResponses()
  async callback(
    @Req() req: { user?: GoogleProfile; query?: Record<string, unknown> },
    @Res() res: RedirectResponse
  ): Promise<void> {
    const { url, statusCode } = await this.resolveCallback(req);
    // Written by hand rather than through `@Redirect()`, which reaches Express's
    // `res.redirect` and gets a courtesy body with it: `Found. Redirecting to
    // <url>`, url and all. On the success path that url carries the token pair
    // in its fragment, so the one route that must never put those in a body on
    // this origin was putting them in one, in the response Google's redirect
    // landed on. A browser discards it and follows the header either way, so
    // there is nothing to lose by leaving it out.
    res.setHeader('Location', url);
    res.status(statusCode).end();
  }

  /**
   * Where the callback ends up, as a plain value: the app URL to send the
   * browser to and the status to send it with. Split from the handler so the
   * decision is testable without a response to write into, and so the writing
   * stays the three lines above it.
   */
  async resolveCallback(req: {
    user?: GoogleProfile;
    query?: Record<string, unknown>;
  }): Promise<{ url: string; statusCode: number }> {
    if (!req.user) {
      // Two ways to get here, and they deserve different codes.
      //
      // With Google unconfigured the callback guard skipped the dance entirely
      // (plan 0026), so the honest answer is the same `not_configured` the other
      // two routes give as a 501 — reported here as a fragment instead, because
      // this route answers with a redirect and never with an error page on this
      // origin.
      if (!this.googleEnabled) {
        this.logger.warn(
          'Google callback reached, but Google is not configured'
        );
        return this.redirect(undefined, {
          error: ERROR_CODES.NOT_CONFIGURED,
        });
      }
      // Otherwise the passport dance resolved no profile: a refused consent, a
      // bad code, or Google being unreachable. The callback guard turned all
      // three into this rather than into an error page on this origin. There is
      // no state to read a locale from yet, so the app is met in the default
      // language.
      this.logger.warn('Google sign in did not complete: no profile resolved');
      return this.redirect(undefined, { error: ERROR_CODES.UNAUTHORIZED });
    }

    let locale: SupportedLocale | undefined;
    try {
      // Consumed before anything is created, and single use, so a replayed state
      // cannot link a second Google identity onto the same account.
      const payload = await this.nats.send<OAuthStatePayload>(
        AUTH_PATTERNS.consumeOAuthState,
        { state: stateOf(req) }
      );
      locale = toSupportedLocale(payload.locale);

      const tokens = await this.nats.send<AuthTokens>(
        AUTH_PATTERNS.googleLogin,
        // The parameter this whole plan exists to deliver. Without it a guest who
        // taps Continue with Google gets a brand new account and loses every zone.
        { ...req.user, linkUserId: payload.userId }
      );

      return this.redirect(locale, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: tokens.userId,
        kind: tokens.kind,
        username: tokens.username,
      });
    } catch (error) {
      const code = errorCodeOf(error);
      this.logger.warn(`Google sign in did not complete: ${code}`);
      // No fallback to "sign in without linking" (section 4.4): that is precisely
      // the data loss, and it would depend on a race between a token's expiry and
      // a user's typing speed.
      return this.redirect(locale, { error: code });
    }
  }

  /**
   * The app URL to send the browser to, built from `APP_BASE_URL` and a locale
   * this service resolved, and from nothing the client supplied. That is what
   * keeps this from being an open redirect, so both halves matter: the locale is
   * narrowed to the supported set before it is interpolated, even though it
   * reached us from auth rather than from a query parameter.
   */
  private redirect(
    locale: SupportedLocale | undefined,
    fragment: Record<string, string>
  ): { url: string; statusCode: number } {
    const language = locale ?? DEFAULT_LOCALE;
    const base = this.appBaseUrl.includes(LOCALE_PLACEHOLDER)
      ? this.appBaseUrl.replace(LOCALE_PLACEHOLDER, language)
      : `${this.appBaseUrl.replace(/\/+$/, '')}/${language}`;
    const params = new URLSearchParams(fragment).toString();
    return {
      url: `${base.replace(/\/+$/, '')}/${APP_CALLBACK_PATH}#${params}`,
      statusCode: HttpStatus.FOUND,
    };
  }
}
