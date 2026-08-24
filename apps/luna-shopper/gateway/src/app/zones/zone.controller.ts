import {
  Body,
  Controller,
  Delete,
  Get,
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
import { THROTTLE_BUCKETS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
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
  @Throttle({ [THROTTLE_BUCKETS.anonymousZone]: {} })
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
  @Throttle({ [THROTTLE_BUCKETS.anonymousZone]: {} })
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
