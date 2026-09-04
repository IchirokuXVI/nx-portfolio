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
import { SkipThrottle } from '@nestjs/throttler';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_USER_PATTERNS,
  type AdminIdentityListView,
  type AdminUserDetailView,
  type AdminUserPage,
  type DeleteAdminUserResult,
  type ResendAdminVerificationResult,
  type UpdateAdminUserResult,
} from '@portfolio/luna-shopper/contracts';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import {
  ListAdminUsersQueryDto,
  ResendAdminVerificationDto,
} from './admin-directory.dto';
import { UpdateAdminUserDto } from './admin-edit.dto';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { ActingAdmin } from './current-admin.decorator';

/**
 * The people using velista, for the back office (plan 0074).
 *
 * Everything an operator can learn about a user, and everything they can do to
 * one. Every write calls the service the user's own routes call: deleting an
 * account runs a cascade across three databases, and renaming somebody rewrites
 * the per zone name on every membership they hold, neither of which a raw row
 * editor over `users` reaches.
 *
 * **Two fields are editable and three are not** (plan 0077, section 3).
 * `username` and `displayName` are the two. `email`, `emailVerifiedAt` and `kind`
 * are the three, and each is a decision rather than an omission: there is no
 * service that changes a registered user's email, because velista does not offer
 * it and writing the column alone would leave the credential, the linked
 * providers, the outstanding verifications and every live refresh token pointing
 * at an address the account no longer claims; setting `emailVerifiedAt` by hand
 * asserts that somebody proved control of an address, which is the one thing the
 * column exists to record and the one thing an operator cannot observe; and
 * flipping `kind` produces a registered account with no way to sign in and no
 * error anywhere. Sections 6.1 and 6.2 carry the full argument, and the back
 * office shows each field with the reason in place, so an operator looking for a
 * missing control finds the reason rather than concluding the screen is
 * unfinished.
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

  /**
   * Change a user's username or display name (plan 0077, section 3).
   *
   * **The two are not the same kind of write**, and that is the interesting part
   * of this route. `username` goes through `IdentityService.setUsername`, which
   * publishes `user.usernameChanged`; core consumes that event and rewrites the
   * per zone `zone_memberships.username` of every membership the user holds. A
   * direct column write would produce a user whose global name changed and whose
   * name in every zone did not, and the two would then disagree forever, because
   * the propagation is driven by the event and nothing reconciles them afterwards.
   *
   * `displayName` is a direct column write, and that is not an exception to the
   * rule: it has no service, no event and no consumer, core has never seen it, and
   * nothing derives from it, so there is no invariant to route around.
   */
  @Patch(':id')
  @ApiContractResponse(ADMIN_USER_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto
  ): Promise<UpdateAdminUserResult> {
    return this.nats.send<UpdateAdminUserResult>(ADMIN_USER_PATTERNS.update, {
      ...adminCredential(admin),
      targetUserId: id,
      username: dto.username,
      displayName: dto.displayName,
      usernamePropagation: dto.usernamePropagation,
    });
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
