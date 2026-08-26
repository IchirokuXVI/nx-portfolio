import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  MEMBERSHIP_PATTERNS,
  ZONE_PATTERNS,
  type AuthTokens,
  type MembershipView,
  type ZonePage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  CreateZoneDto,
  JoinZoneDto,
  ListMyZonesQueryDto,
  SetRoleDto,
  UpdateZoneDto,
} from './zone.dto';

/** Create/join carry the freshly minted token when the caller was anonymous. */
interface WithMaybeToken<T> {
  tokens?: AuthTokens;
  data: T;
}

/**
 * The public zone surface (plan 0006). Create and join use the token handshake:
 * an anonymous client is given a temporary identity (minted only here, never on
 * merely opening the app), then the zone operation runs with that userId. Every
 * other route requires a valid token; core authorizes against its own tables.
 */
@ApiTags('zones')
@Controller({ path: 'zones', version: '1' })
export class ZoneController {
  constructor(private readonly nats: NatsClient) {}

  /** Resolves the caller, minting a temporary user when none is authenticated. */
  private async resolveIdentity(
    user?: CurrentUser
  ): Promise<{ userId: string; tokens?: AuthTokens }> {
    if (user) {
      return { userId: user.userId };
    }
    const tokens = await this.nats.send<AuthTokens>(
      AUTH_PATTERNS.createTemporaryUser,
      {}
    );
    return { userId: tokens.userId, tokens };
  }

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(THROTTLE_LIMITS.anonymousZone)
  @ApiContractResponse(ZONE_PATTERNS.create, {
    status: HttpStatus.CREATED,
    envelope: 'tokenHandshake',
    description:
      'The new zone. `tokens` is present when the caller was anonymous.',
  })
  @ApiProblemResponses({ body: true })
  async create(
    @AuthUser() user: CurrentUser | undefined,
    @Body() dto: CreateZoneDto
  ): Promise<WithMaybeToken<ZoneView>> {
    const { userId, tokens } = await this.resolveIdentity(user);
    const zone = await this.nats.send<ZoneView>(ZONE_PATTERNS.create, {
      userId,
      name: dto.name,
      username: dto.username,
    });
    return { tokens, data: zone };
  }

  @Post('join')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(THROTTLE_LIMITS.anonymousZone)
  @ApiContractResponse(ZONE_PATTERNS.join, {
    status: HttpStatus.CREATED,
    envelope: 'tokenHandshake',
    description:
      'The pending membership. `tokens` is present when the caller was anonymous.',
  })
  @ApiProblemResponses({ body: true, membership: true, conflict: true })
  async join(
    @AuthUser() user: CurrentUser | undefined,
    @Body() dto: JoinZoneDto
  ): Promise<WithMaybeToken<MembershipView>> {
    const { userId, tokens } = await this.resolveIdentity(user);
    const membership = await this.nats.send<MembershipView>(
      ZONE_PATTERNS.join,
      { userId, joinCode: dto.joinCode, username: dto.username }
    );
    return { tokens, data: membership };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.listMine)
  @ApiProblemResponses({ auth: true })
  listMine(
    @AuthUser() user: CurrentUser,
    @Query() query: ListMyZonesQueryDto
  ): Promise<ZonePage> {
    return this.nats.send<ZonePage>(ZONE_PATTERNS.listMine, {
      userId: user.userId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.update)
  @ApiProblemResponses({ auth: true, membership: true, body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ZONE_PATTERNS.update, {
      userId: user.userId,
      zoneId: id,
      name: dto.name,
      config: dto.config,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.delete)
  @ApiProblemResponses({ auth: true, membership: true })
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ZONE_PATTERNS.delete, {
      userId: user.userId,
      zoneId: id,
    });
  }

  @Post(':id/regenerate-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.regenerateJoinCode, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, membership: true })
  regenerateCode(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ZONE_PATTERNS.regenerateJoinCode, {
      userId: user.userId,
      zoneId: id,
    });
  }

  @Post(':id/claim-ownership')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.claimOwnership, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, membership: true, conflict: true })
  claimOwnership(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ZONE_PATTERNS.claimOwnership, {
      userId: user.userId,
      zoneId: id,
    });
  }

  @Patch(':id/members/:membershipId/role')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.setRole)
  @ApiProblemResponses({ auth: true, membership: true, body: true })
  setRole(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: SetRoleDto
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(ZONE_PATTERNS.setRole, {
      userId: user.userId,
      zoneId: id,
      membershipId,
      role: dto.role,
    });
  }

  @Post(':id/members/:membershipId/transfer-ownership')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.transferOwnership, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, membership: true })
  transferOwnership(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ZONE_PATTERNS.transferOwnership, {
      userId: user.userId,
      zoneId: id,
      membershipId,
    });
  }

  @Post(':id/members/:membershipId/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(MEMBERSHIP_PATTERNS.approve, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, membership: true })
  approve(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(MEMBERSHIP_PATTERNS.approve, {
      userId: user.userId,
      zoneId: id,
      membershipId,
    });
  }

  @Post(':id/members/:membershipId/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(MEMBERSHIP_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, membership: true })
  reject(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<{ id: string }> {
    return this.nats.send(MEMBERSHIP_PATTERNS.reject, {
      userId: user.userId,
      zoneId: id,
      membershipId,
    });
  }

  @Post(':id/members/:membershipId/kick')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(MEMBERSHIP_PATTERNS.kick, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ auth: true, membership: true })
  kick(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(MEMBERSHIP_PATTERNS.kick, {
      userId: user.userId,
      zoneId: id,
      membershipId,
    });
  }

  @Post(':id/members/:membershipId/ban')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(MEMBERSHIP_PATTERNS.ban, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ auth: true, membership: true })
  ban(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(MEMBERSHIP_PATTERNS.ban, {
      userId: user.userId,
      zoneId: id,
      membershipId,
    });
  }
}
