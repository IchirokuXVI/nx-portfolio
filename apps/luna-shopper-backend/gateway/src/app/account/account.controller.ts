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
import { asRejectedCredentials } from '../auth/remote-problem';
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
 *
 * Because every route here is keyed on that `userId` and on nothing else, an
 * `auth` answer of "not found" can only ever mean one thing: the account the
 * token names is gone. That is a statement about the credential rather than
 * about a resource, so it leaves as a 401 (see {@link asRejectedCredentials}) —
 * which is what lets a client holding a pair from before a deletion, or from
 * before the database was reset, drop it instead of retrying it forever.
 */
@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class AccountController {
  constructor(private readonly nats: NatsClient) {}

  /** Every call this controller makes, under the rule in the class comment. */
  private aboutTheCaller<T>(subject: string, payload: object): Promise<T> {
    return this.nats.send<T>(subject, payload).catch((error: unknown) => {
      throw asRejectedCredentials(error);
    });
  }

  /** The caller's own profile, which is where the app bar gets a name to show. */
  @Get('me')
  @ApiContractResponse(AUTH_PATTERNS.getProfile)
  @ApiProblemResponses({ auth: true })
  me(@AuthUser() user: CurrentUser): Promise<UserProfileView> {
    return this.aboutTheCaller<UserProfileView>(AUTH_PATTERNS.getProfile, {
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
    return this.aboutTheCaller<UserProfileView>(AUTH_PATTERNS.setUsername, {
      userId: user.userId,
      username: dto.username,
      propagation: dto.propagation,
    });
  }

  @Delete()
  @ApiContractResponse(AUTH_PATTERNS.deleteAccount)
  @ApiProblemResponses({ auth: true })
  remove(@AuthUser() user: CurrentUser): Promise<DeleteAccountResult> {
    return this.aboutTheCaller<DeleteAccountResult>(
      AUTH_PATTERNS.deleteAccount,
      { userId: user.userId }
    );
  }
}
