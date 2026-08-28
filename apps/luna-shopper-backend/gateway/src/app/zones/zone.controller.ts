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
  type MembershipPage,
  type MembershipView,
  type MyZoneCounts,
  type MyZoneView,
  type UserProfileView,
  type ZoneByCodeView,
  type ZonePage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { asRejectedCredentials } from '../auth/remote-problem';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
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
   *
   * That hop is also the one place these two routes learn whether the account
   * behind the token still exists, and a token naming a deleted user is answered
   * 401 rather than 404. See {@link asRejectedCredentials} for why the difference
   * decides whether the client can ever recover.
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
    const profile = await this.nats
      .send<UserProfileView>(AUTH_PATTERNS.getProfile, { userId: user.userId })
      .catch((error: unknown) => {
        throw asRejectedCredentials(error);
      });
    return { userId: user.userId, username: profile.username };
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
  // `auth: true` on an optionally authenticated route is not a contradiction: a
  // caller who presents a token is claiming an identity, and a token that is
  // expired, malformed or names a deleted account is a 401 rather than a silent
  // fall through to anonymous (plan 0020).
  @ApiProblemResponses({ auth: true, body: true })
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
  @ApiContractResponse(ZONE_PATTERNS.join, {
    status: HttpStatus.CREATED,
    envelope: 'tokenHandshake',
    description:
      'The pending membership. `tokens` is present when the caller was anonymous.',
  })
  @ApiProblemResponses({
    auth: true,
    body: true,
    membership: true,
    conflict: true,
  })
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

  /**
   * Declared before `:id`, or the router swallows `count` as a zone id (plan
   * 0017, section 10). It sits under `zones` rather than on an account resource
   * because the number is about zones.
   */
  @Get('count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.countsMine)
  @ApiProblemResponses({ auth: true })
  countMine(@AuthUser() user: CurrentUser): Promise<MyZoneCounts> {
    return this.nats.send<MyZoneCounts>(ZONE_PATTERNS.countsMine, {
      userId: user.userId,
    });
  }

  /**
   * Preview the group behind a join code (plan 0024, section 1), so the join
   * sheet can name it before anybody commits to joining it.
   *
   * Public, like the platform stats and for the same reason: the caller pasting
   * a code has not signed in yet. It carries the join code bucket rather than the
   * default one, because an unauthenticated lookup leaves no membership row and
   * nothing for an owner to notice, which makes it a cheaper enumeration oracle
   * than the join route it sits beside. Two fields is the other half of that
   * answer: a successful guess yields a group name and a number, never a way in.
   *
   * Declared above `:id` with the other static routes. This particular pair
   * would not collide, since `by-code/:code` has two segments, but a future
   * single segment sibling declared below `:id` would be swallowed silently.
   */
  @Get('by-code/:code')
  @Throttle(THROTTLE_LIMITS.joinCode)
  @ApiContractResponse(ZONE_PATTERNS.getByCode, {
    description:
      'The group behind the code. A code that never existed and one whose zone is no longer active are the same 404.',
  })
  @ApiProblemResponses({ notFound: true })
  getByCode(@Param('code') code: string): Promise<ZoneByCodeView> {
    return this.nats.send<ZoneByCodeView>(ZONE_PATTERNS.getByCode, {
      joinCode: code,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(ZONE_PATTERNS.get)
  @ApiProblemResponses({ auth: true, membership: true })
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
  @ApiContractResponse(MEMBERSHIP_PATTERNS.list)
  @ApiProblemResponses({ auth: true, membership: true })
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
  @ApiContractResponse(MEMBERSHIP_PATTERNS.setUsername)
  @ApiProblemResponses({ auth: true, membership: true, body: true })
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
