import {
  Body,
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
  type ExchangeGoogleSignInRequest,
  type GoogleProfile,
  type MintOAuthStateRequest,
  type MintOAuthStateResult,
  type OAuthStatePayload,
  type StageGoogleSignInRequest,
  type StageGoogleSignInResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  getRequestContext,
  toSupportedLocale,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { appUrl } from './app-url';
import { ExchangeGoogleSignInDto, MintOAuthStateDto } from './auth.dto';
import { AuthUser } from './current-user.decorator';
import {
  GoogleAuthGuard,
  GoogleCallbackGuard,
  GoogleConfiguredGuard,
  stateOf,
} from './google-auth.guard';
import { OptionalJwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';
import { RefuseImpersonation } from './refuse-impersonation.decorator';
import { errorCodeOf } from './remote-problem';

/**
 * The little of a response this controller uses, so the handler can be called
 * with a double rather than an Express response.
 */
interface RedirectResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { end(): unknown };
}

/** The page in the app that reads the fragment (velista plan 0009, section 5.6). */
const APP_CALLBACK_PATH = 'auth/callback';

/**
 * Google login endpoints (plan 0005, section 4.4; plan 0023).
 *
 * `POST /v1/auth/google/state` mints the opaque state that carries the caller
 * across the round trip, `GET /v1/auth/google` starts the OAuth redirect with it,
 * and the callback spends it, stages what Google said, and sends the browser
 * back to the app with a single use code. `POST /v1/auth/google/exchange` trades
 * that code and the verifier only the minting browser holds for the pair, and
 * only there does an account change (plan 0230).
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
  // A support session cannot link a Google identity onto the account (plan
  // 0194): the link is permanent, and the identity would be the operator's.
  @RefuseImpersonation()
  @UseGuards(GoogleConfiguredGuard, OptionalJwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(AUTH_PATTERNS.mintOAuthState, {
    status: HttpStatus.CREATED,
    description:
      'An opaque, single use state valid for ten minutes. Pass it as the `state` query parameter when navigating to `GET /v1/auth/google`.',
  })
  @ApiProblemResponses({
    body: true,
    auth: true,
    notConfigured: true,
    impersonation: 'refused',
    terms: true,
  })
  mintState(
    @Body() dto: MintOAuthStateDto,
    @AuthUser() user?: CurrentUser
  ): Promise<MintOAuthStateResult> {
    const request: MintOAuthStateRequest = {
      // From the verified token or not at all. A body could name somebody else,
      // and linking a Google identity onto an account is permanent.
      userId: user?.userId,
      locale: getRequestContext()?.locale,
      // The one field the body requires (plan 0230, section 2). The verifier
      // behind it stays in the browser until the exchange.
      codeChallenge: dto.codeChallenge,
      // Checked by auth now, at the start, and recorded at the exchange (plan
      // 0231, section 4.2).
      ...(dto.acceptedTermsVersion
        ? { acceptedTermsVersion: dto.acceptedTermsVersion }
        : {}),
    };
    return this.nats.send(AUTH_PATTERNS.mintOAuthState, request);
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
   * **Nothing permanent happens here** (plan 0230). The state is spent, what
   * Google said is staged under a single use code, and the code rides in the
   * URL **fragment**, never the query string: a fragment is never sent to a
   * server (plan 0023, section 3.1). The pair no longer travels in a URL at
   * all. The app trades the code at `POST /v1/auth/google/exchange` with the
   * verifier only the minting browser holds, so a link to the start route sent
   * to somebody else stages a profile nobody can redeem.
   *
   * Every failure ends at the same page with `#error=`, because the one thing
   * this route must never do is leave the user on the API's origin.
   */
  @Get('callback')
  @UseGuards(GoogleCallbackGuard)
  @ApiFoundResponse({
    description:
      'Redirects to the app. On success the fragment is `#code=<single use code>`, to trade at `POST /v1/auth/google/exchange` within two minutes; on any failure the fragment is `#error=<code>`. There is no response body either way.',
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
    // <url>`, url and all. On the success path that url carries the code in its
    // fragment, so the one route that must never put it in a body on this
    // origin would be putting it in one, in the response Google's redirect
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

      // Staged, not signed in (plan 0230, section 3.3). The link target rides
      // along so a guest keeps every zone they own, but it is applied only at
      // the exchange, by a browser holding the verifier and the guest's bearer.
      const stage: StageGoogleSignInRequest = {
        ...req.user,
        linkUserId: payload.userId,
        codeChallenge: payload.codeChallenge,
        locale: payload.locale,
        // Carried, never checked here (plan 0231, section 4.2): a refusal at
        // a redirect costs the person the whole sign in.
        acceptedTermsVersion: payload.acceptedTermsVersion,
      };
      const { code } = await this.nats.send<StageGoogleSignInResult>(
        AUTH_PATTERNS.stageGoogleSignIn,
        stage
      );

      return this.redirect(locale, { code });
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
   * Trade the code of the callback for the pair (plan 0230, section 4.3).
   *
   * The account changes here and nowhere else. Auth spends the code, checks
   * `base64url(sha256(codeVerifier))` against the challenge of the mint, and,
   * when the state carried a link target, requires the bearer to name it. A
   * missing, spent, expired or mismatched code is one answer, 401
   * `unauthorized`.
   *
   * Guarded by the optional guard of plan 0020 for the reason the mint is: a
   * guest whose access token expired is refused and refreshes first, so the
   * bearer auth compares is a current one or none.
   */
  @Post('exchange')
  // A support session cannot finish a link either (plan 0194): the identity
  // would be the operator's.
  @RefuseImpersonation()
  @UseGuards(GoogleConfiguredGuard, OptionalJwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(AUTH_PATTERNS.exchangeGoogleSignIn, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    body: true,
    auth: true,
    notConfigured: true,
    impersonation: 'refused',
  })
  exchange(
    @Body() dto: ExchangeGoogleSignInDto,
    @AuthUser() user?: CurrentUser
  ): Promise<AuthTokens> {
    const request: ExchangeGoogleSignInRequest = {
      code: dto.code,
      codeVerifier: dto.codeVerifier,
      // From the verified token or not at all, as on the mint.
      callerUserId: user?.userId,
    };
    return this.nats.send<AuthTokens>(
      AUTH_PATTERNS.exchangeGoogleSignIn,
      request
    );
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
    return {
      url: appUrl(this.appBaseUrl, locale, APP_CALLBACK_PATH, fragment),
      statusCode: HttpStatus.FOUND,
    };
  }
}
