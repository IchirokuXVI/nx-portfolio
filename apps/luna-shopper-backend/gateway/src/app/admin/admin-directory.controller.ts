import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_USER_PATTERNS,
  type AdminIdentityListView,
  type AdminUserDetailView,
  type AdminUserPage,
  type DeleteAdminUserResult,
  type ResendAdminVerificationResult,
} from '@portfolio/luna-shopper/contracts';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import {
  ListAdminUsersQueryDto,
  ResendAdminVerificationDto,
} from './admin-directory.dto';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { ActingAdmin } from './current-admin.decorator';

/**
 * The people using velista, for the back office (plan 0074).
 *
 * Everything an operator can learn about a user, and the two things they can do
 * to one. **Read, plus named actions, not CRUD** (section 1): there is no PATCH
 * here and section 9 puts one permanently out of scope. Deleting an account runs
 * a cascade across three databases and a raw row editor over `users` reaches none
 * of it, so the only writes are the two that call the service the user's own
 * routes call.
 *
 * Guarded by {@link AdminJwtGuard} like everything under `/v1/admin/**`, and
 * gated **again** inside auth against the forwarded token, which is plan 0072
 * section 3's property: a route added here without the guard still cannot read
 * the user table.
 */
@ApiTags('admin-users')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
// `membership` is the option that documents 403 beside 404. The refusal is the
// platform admin gate rather than a zone membership, but the statuses and the
// envelope are the same, and `admin-catalog` already reads this way.
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/users', version: '1' })
export class AdminUsersController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * A page of users, newest first, filtered by section 2's columns.
   *
   * More than any user facing route returns, which is the point, and still
   * without a password hash: it is never selected, not merely never serialized
   * (section 4).
   */
  @Get()
  @ApiContractResponse(ADMIN_USER_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListAdminUsersQueryDto
  ): Promise<AdminUserPage> {
    return this.nats.send<AdminUserPage>(ADMIN_USER_PATTERNS.list, {
      ...adminCredential(admin),
      username: query.username,
      email: query.email,
      kind: query.kind,
      verified: query.verified,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** One user, with whether they have a password and which providers are linked. */
  @Get(':id')
  @ApiContractResponse(ADMIN_USER_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<AdminUserDetailView> {
    return this.nats.send<AdminUserDetailView>(ADMIN_USER_PATTERNS.get, {
      ...adminCredential(admin),
      targetUserId: id,
    });
  }

  /**
   * Delete somebody's account (section 1), running `account-deletion.service` by
   * way of the same `auth.deleteAccount` path a person's own deletion takes.
   *
   * Idempotent: a second call answers `deleted: false` rather than a 404, because
   * an operator who clicks twice has not made a mistake worth an error.
   */
  @Delete(':id')
  @ApiContractResponse(ADMIN_USER_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<DeleteAdminUserResult> {
    return this.nats.send<DeleteAdminUserResult>(ADMIN_USER_PATTERNS.delete, {
      ...adminCredential(admin),
      targetUserId: id,
    });
  }

  /**
   * Send somebody's confirmation mail again, past the user facing throttle
   * (section 1).
   *
   * **`@SkipThrottle` is the bypass**, and it is the whole of it. The limit this
   * skips is `THROTTLE_LIMITS.verifyResend` on the user's own route, a decorator
   * and not a rule inside auth, so there is nothing for auth to be asked to
   * ignore. Stated explicitly rather than left off, because a reader comparing
   * this route with the user's one should see that the difference is deliberate.
   *
   * Auth's own refusals are untouched: an account with no address, or one already
   * confirmed, is a conflict here exactly as it is there.
   */
  @Post(':id/resend-verification')
  @SkipThrottle()
  @ApiContractResponse(ADMIN_USER_PATTERNS.resendVerification, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  resendVerification(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: ResendAdminVerificationDto
  ): Promise<ResendAdminVerificationResult> {
    return this.nats.send<ResendAdminVerificationResult>(
      ADMIN_USER_PATTERNS.resendVerification,
      { ...adminCredential(admin), targetUserId: id, locale: dto.locale }
    );
  }
}

/**
 * Who has access to the back office (plan 0074, section 5).
 *
 * **One route, and there is no second one.** No create, no update, no delete, and
 * none may be added without changing plan 0071 section 6 first: managing admins
 * requires the server, by the commands that plan defines. This screen exists so an
 * operator can answer "who has access", which is a question worth answering from
 * a browser and an action that is not.
 *
 * The failed login attempts plan 0071 section 7 records are **not** here. They are
 * being written from the day that plan shipped, and the screen that reads them
 * belongs to a dashboard section 9 puts out of scope.
 */
@ApiTags('admin-users')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/admins', version: '1' })
export class AdminAdminsController {
  constructor(private readonly nats: NatsClient) {}

  /** Every admin, oldest first. No filters and no page: there are a handful. */
  @Get()
  @ApiContractResponse(ADMIN_AUTH_PATTERNS.listAdmins)
  list(@ActingAdmin() admin: CurrentAdmin): Promise<AdminIdentityListView> {
    return this.nats.send<AdminIdentityListView>(
      ADMIN_AUTH_PATTERNS.listAdmins,
      adminCredential(admin)
    );
  }
}
