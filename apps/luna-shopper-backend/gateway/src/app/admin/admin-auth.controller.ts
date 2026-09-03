import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_AUTH_SCHEMA_IDS,
  type AdminAuthTokens,
  type AdminIdentityView,
  type AdminMeView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import type { Request } from 'express';
import type { GatewayConfig } from '../config/app-config';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { AdminLoginDto } from './admin-auth.dto';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { ActingAdmin } from './current-admin.decorator';

/**
 * The operator authentication surface (plan 0071, section 5).
 *
 * Three routes under `/v1/admin/**`, the namespace plan 0073 formalizes, and
 * this plan ends with an admin able to obtain a token and call exactly one thing:
 * the routes that issued it. Nothing else in the gateway accepts one yet.
 *
 * Deliberately a separate controller and module from `AuthController`. The two
 * surfaces authenticate different principals against different keys, and keeping
 * them in one file is how a user route eventually acquires an `AdminJwtGuard` by
 * being copied from the handler above it.
 */
@ApiTags('admin-auth')
@Controller({ path: 'admin/auth', version: '1' })
export class AdminAuthController {
  private readonly config: GatewayConfig;

  constructor(
    private readonly nats: NatsClient,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<GatewayConfig>('gateway');
  }

  /**
   * Sign in (section 5), throttled with the same bucket the user facing login
   * uses, keyed on the caller's address.
   *
   * That throttle is not the account protection: it limits a *source*, and one
   * admin username is a far better brute force target than a user base, because
   * the attacker knows the name is one of very few. The lockout in auth is what
   * protects the account, and section 7 is why the two exist separately.
   *
   * The address and user agent are read here and passed on, because auth is
   * behind the broker and has no request of its own to read them from. They are
   * recorded against a failed attempt and nothing else.
   */
  @Post('login')
  @Throttle(THROTTLE_LIMITS.login)
  @ApiContractResponse(ADMIN_AUTH_PATTERNS.login, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, auth: true })
  login(
    @Body() dto: AdminLoginDto,
    @Req() request: Request
  ): Promise<AdminAuthTokens> {
    // The development autologin never reaches the password: it asks for a token
    // for the configured admin and ignores the body entirely. Auth refuses to
    // boot with the switch on against a non local database, so a deployment where
    // this branch could do harm cannot start (section 8).
    if (this.config.admin.devAutologin) {
      return this.nats.send(ADMIN_AUTH_PATTERNS.devAutologin, {
        username: this.config.admin.devAutologinUsername,
      });
    }

    return this.nats.send(ADMIN_AUTH_PATTERNS.login, {
      username: dto.username,
      password: dto.password,
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  /**
   * Renew a live token (section 5). Presenting a valid one returns a new one, and
   * there is no refresh token anywhere in this design: the session is a short
   * lived token that renews itself while it is still valid
   * (`apps/luna-shopper-admin/plans/0003`).
   *
   * It is a round trip to auth rather than a re-sign at the gateway because auth
   * re-reads the row, which is what makes disabling an admin take effect within
   * one token lifetime instead of never.
   */
  @Post('refresh')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth('admin-token')
  @ApiContractResponse(ADMIN_AUTH_PATTERNS.refresh, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true })
  refresh(@ActingAdmin() admin: CurrentAdmin): Promise<AdminAuthTokens> {
    return this.nats.send(ADMIN_AUTH_PATTERNS.refresh, {
      adminId: admin.adminId,
    });
  }

  /**
   * Who is signed in, and which deployment they are signed in to (section 5).
   *
   * The environment name is the second half and it comes from the server on
   * purpose (`apps/luna-shopper-admin/plans/0001`, section 6): the back office
   * renders a different accent colour per environment so an operator cannot
   * mistake which database they are about to write to, and the failure being
   * guarded against is believing you are in staging when you are in production. A
   * build time constant is exactly what is wrong in that scenario.
   */
  @Get('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth('admin-token')
  @ApiComposedResponse(ADMIN_AUTH_SCHEMA_IDS.adminMeView, {
    description:
      'The signed in operator, plus the name this deployment reports itself by. The environment comes from the API rather than the bundle so it cannot disagree with the database being written to.',
  })
  @ApiProblemResponses({ auth: true })
  async me(@ActingAdmin() admin: CurrentAdmin): Promise<AdminMeView> {
    const identity = await this.nats.send<AdminIdentityView>(
      ADMIN_AUTH_PATTERNS.getAdmin,
      { adminId: admin.adminId }
    );
    return { admin: identity, environment: this.config.environmentName };
  }
}
