import { Controller, Delete, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  type DeleteAccountResult,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';

/**
 * Account deletion (plan 0011). `DELETE /v1/account` removes the authenticated
 * caller's own account — the `userId` comes from the verified token, never the
 * body, so a caller can only ever delete themselves. Works for both temporary and
 * registered users (both hold a token). Auth then emits `user.deleted` and core
 * reacts (retires memberships, marks owned zones for deletion).
 */
@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class AccountController {
  constructor(private readonly nats: NatsClient) {}

  @Delete()
  remove(@AuthUser() user: CurrentUser): Promise<DeleteAccountResult> {
    return this.nats.send<DeleteAccountResult>(AUTH_PATTERNS.deleteAccount, {
      userId: user.userId,
    });
  }
}
