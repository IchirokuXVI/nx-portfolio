import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IMPERSONATION_PATTERNS,
  IMPERSONATION_SCHEMA_IDS,
  type ImpersonationStatusView,
  type StartImpersonationResult,
  type StartImpersonationView,
} from '@portfolio/luna-shopper/contracts';
import {
  getRequestContext,
  NotConfiguredException,
  toSupportedLocale,
  UuidParam,
} from '@portfolio/luna-shopper/platform';
import { appUrl } from '../auth/app-url';
import type { GatewayConfig } from '../config/app-config';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import { StartImpersonationDto } from './admin-impersonation.dto';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { ActingAdmin } from './current-admin.decorator';

/** The page of the app that reads the code (velista plan 0133). */
const APP_IMPERSONATE_PATH = 'auth/impersonate';

/**
 * The operator's half of a support session (plan 0194): ask whether the
 * deployment allows one, and start one for a user.
 *
 * Guarded by {@link AdminJwtGuard} like everything under `/v1/admin/**`, and
 * gated again inside auth against the forwarded token.
 *
 * There is no route here that lists sessions or ends one, on purpose. The
 * start answer gives the id, and the app ends its own session. A history page
 * waits for a reader of the audit trail, which does not exist yet.
 */
@ApiTags('admin-users')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin', version: '1' })
export class AdminImpersonationController {
  private readonly appBaseUrl: string;

  constructor(
    private readonly nats: NatsClient,
    configService: ConfigService
  ) {
    this.appBaseUrl =
      configService.getOrThrow<GatewayConfig>('gateway').appBaseUrl;
  }

  /**
   * Whether this deployment allows a support session.
   *
   * The back office hides the action while this is false. The answer comes
   * from auth, which holds the one switch, so the gateway cannot say yes to a
   * start that auth then refuses.
   */
  @Get('impersonation')
  @ApiContractResponse(IMPERSONATION_PATTERNS.status)
  status(@ActingAdmin() admin: CurrentAdmin): Promise<ImpersonationStatusView> {
    return this.nats.send<ImpersonationStatusView>(
      IMPERSONATION_PATTERNS.status,
      adminCredential(admin)
    );
  }

  /**
   * Start a support session for one user.
   *
   * The answer carries a URL into the app. The single use code is in its
   * **fragment** and not in a query string: a fragment is never sent to a
   * server, so no access log and no `Referer` holds the code. The back office
   * opens the URL in a new tab, and the app trades the code for the token pair
   * of the session within sixty seconds.
   *
   * A new start ends each earlier live session of this operator for this user.
   * While support sessions are switched off, the answer is 403
   * `impersonation_disabled`.
   */
  @Post('users/:id/impersonation')
  @ApiComposedResponse(IMPERSONATION_SCHEMA_IDS.startView, {
    status: HttpStatus.CREATED,
    description:
      'The session, and the URL that hands it to the app. The code in the fragment of `url` is good for sixty seconds and for one use.',
  })
  @ApiProblemResponses({
    auth: true,
    membership: true,
    body: true,
    notConfigured: true,
    impersonation: 'start',
  })
  async start(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: StartImpersonationDto
  ): Promise<StartImpersonationView> {
    // Before auth is asked, so no session starts that no URL can hand over.
    if (!this.appBaseUrl) {
      throw new NotConfiguredException('APP_BASE_URL is not configured');
    }
    const session = await this.nats.send<StartImpersonationResult>(
      IMPERSONATION_PATTERNS.start,
      {
        ...adminCredential(admin),
        targetUserId: id,
        reason: dto.reason,
        note: dto.note,
      }
    );
    const locale =
      toSupportedLocale(dto.locale) ??
      toSupportedLocale(getRequestContext()?.locale);
    return {
      sessionId: session.sessionId,
      url: appUrl(this.appBaseUrl, locale, APP_IMPERSONATE_PATH, {
        code: session.code,
      }),
      codeExpiresAt: session.codeExpiresAt,
      expiresAt: session.expiresAt,
    };
  }
}
