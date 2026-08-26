import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  type DeleteAccountResult,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { UpdateProfileDto } from './account.dto';

/**
 * The caller's own account: the profile routes (plan 0018, section 12) and
 * deletion (plan 0011).
 *
 * Every route takes its `userId` from the verified token, never from the body or
 * a path parameter, so a caller can only ever read or change themselves. Deletion
 * works for temporary and registered users alike (both hold a token): auth then
 * emits `user.deleted` and core reacts by retiring memberships and marking owned
 * zones for deletion.
 */
@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class AccountController {
  constructor(private readonly nats: NatsClient) {}

  /** The caller's own profile, which is where the app bar gets a name to show. */
  @Get('me')
  @ApiContractResponse(AUTH_PATTERNS.getProfile)
  @ApiProblemResponses({ auth: true })
  me(@AuthUser() user: CurrentUser): Promise<UserProfileView> {
    return this.nats.send<UserProfileView>(AUTH_PATTERNS.getProfile, {
      userId: user.userId,
    });
  }

  /**
   * Change the global username, and optionally the per zone copies of it.
   * Throttled: a public, non unique, freely changeable name makes rapid renaming
   * a plausible harassment pattern (plan 0018, section 6).
   */
  @Patch('me')
  @Throttle(THROTTLE_LIMITS.usernameChange)
  @ApiContractResponse(AUTH_PATTERNS.setUsername)
  @ApiProblemResponses({ auth: true, body: true })
  updateMe(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpdateProfileDto
  ): Promise<UserProfileView> {
    return this.nats.send<UserProfileView>(AUTH_PATTERNS.setUsername, {
      userId: user.userId,
      username: dto.username,
      propagation: dto.propagation,
    });
  }

  @Delete()
  @ApiContractResponse(AUTH_PATTERNS.deleteAccount)
  @ApiProblemResponses({ auth: true })
  remove(@AuthUser() user: CurrentUser): Promise<DeleteAccountResult> {
    return this.nats.send<DeleteAccountResult>(AUTH_PATTERNS.deleteAccount, {
      userId: user.userId,
    });
  }
}
