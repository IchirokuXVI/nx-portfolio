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
  type MembershipPage,
  type MembershipView,
  type MyZoneCounts,
  type MyZoneView,
  type UserProfileView,
  type ZonePage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';
import {
  CreateZoneDto,
  JoinZoneDto,
  ListMembersQueryDto,
  ListMyZonesQueryDto,
  SetMembershipUsernameDto,
  SetRoleDto,
  UpdateZoneDto,
} from './zone.dto';

/** Create/join carry the freshly minted token when the caller was anonymous. */
interface WithMaybeToken<T> {
  tokens?: AuthTokens;
  data: T;
}

/**
 * A resolved caller: their id, the token pair when it was minted for this
 * request, and their global username, which is the fallback per zone name when
 * the request body omitted one (plan 0018, section 9).
 */
interface ResolvedCaller {
  userId: string;
  username: string;
  tokens?: AuthTokens;
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

  /**
   * Resolves the caller, minting a temporary user when none is authenticated, and
   * resolves the username core should record (plan 0018, section 9).
   *
   * A supplied `username` wins and costs nothing extra. When it is omitted the
   * caller's global username is used, resolved by whichever branch applies: an
   * anonymous caller's name comes back on the `AuthTokens` from the mint that
   * just happened, so no second call is made; an authenticated caller costs one
   * `auth.getProfile` hop, on the two rarest operations in the product and only
   * when the client left the field out.
   */
  private async resolveIdentity(
    user: CurrentUser | undefined,
    suppliedUsername?: string
  ): Promise<ResolvedCaller> {
    if (!user) {
      const tokens = await this.nats.send<AuthTokens>(
        AUTH_PATTERNS.createTemporaryUser,
        {}
      );
      return {
        userId: tokens.userId,
        username: suppliedUsername ?? tokens.username,
        tokens,
      };
    }
    if (suppliedUsername) {
      return { userId: user.userId, username: suppliedUsername };
    }
    const profile = await this.nats.send<UserProfileView>(
      AUTH_PATTERNS.getProfile,
      { userId: user.userId }
    );
    return { userId: user.userId, username: profile.username };
  }

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(THROTTLE_LIMITS.anonymousZone)
  async create(
    @AuthUser() user: CurrentUser | undefined,
    @Body() dto: CreateZoneDto
  ): Promise<WithMaybeToken<ZoneView>> {
    const { userId, username, tokens } = await this.resolveIdentity(
      user,
      dto.username
    );
    const zone = await this.nats.send<ZoneView>(ZONE_PATTERNS.create, {
      userId,
      name: dto.name,
      username,
    });
    return { tokens, data: zone };
  }

  @Post('join')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(THROTTLE_LIMITS.anonymousZone)
  async join(
    @AuthUser() user: CurrentUser | undefined,
    @Body() dto: JoinZoneDto
  ): Promise<WithMaybeToken<MembershipView>> {
    const { userId, username, tokens } = await this.resolveIdentity(
      user,
      dto.username
    );
    const membership = await this.nats.send<MembershipView>(
      ZONE_PATTERNS.join,
      { userId, joinCode: dto.joinCode, username }
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

  /**
   * Declared before `:id`, or the router swallows `count` as a zone id (plan
   * 0017, section 10). It sits under `zones` rather than on an account resource
   * because the number is about zones.
   */
  @Get('count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  countMine(@AuthUser() user: CurrentUser): Promise<MyZoneCounts> {
    return this.nats.send<MyZoneCounts>(ZONE_PATTERNS.countsMine, {
      userId: user.userId,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<MyZoneView> {
    return this.nats.send<MyZoneView>(ZONE_PATTERNS.get, {
      userId: user.userId,
      zoneId: id,
    });
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  listMembers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: ListMembersQueryDto
  ): Promise<MembershipPage> {
    return this.nats.send<MembershipPage>(MEMBERSHIP_PATTERNS.list, {
      userId: user.userId,
      zoneId: id,
      statuses: query.statuses,
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

  /**
   * Rename one membership (plan 0018, section 5): the member themselves, or an
   * owner/admin renaming someone. Throttled with the shared rename bucket, since
   * a public, non unique, freely changeable name makes rapid renaming a
   * harassment pattern.
   */
  @Patch(':id/members/:membershipId/username')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Throttle(THROTTLE_LIMITS.usernameChange)
  setMembershipUsername(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: SetMembershipUsernameDto
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(MEMBERSHIP_PATTERNS.setUsername, {
      userId: user.userId,
      zoneId: id,
      membershipId,
      username: dto.username,
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
