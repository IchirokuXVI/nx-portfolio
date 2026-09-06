import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_DASHBOARD_PATTERNS,
  ADMIN_USER_PATTERNS,
  type AdminAuthTokens,
  type AdminDashboardRequest,
  type AdminDevAutologinRequest,
  type AdminIdentityDashboard,
  type AdminIdentityListView,
  type AdminIdentityView,
  type AdminLoginRequest,
  type AdminRefreshRequest,
  type AdminUserDetailView,
  type AdminUserPage,
  type DeleteAdminUserRequest,
  type DeleteAdminUserResult,
  type GetAdminRequest,
  type GetAdminUserRequest,
  type ListAdminsRequest,
  type ListAdminUsersRequest,
  type ResendAdminVerificationRequest,
  type ResendAdminVerificationResult,
  type ResolveAdminUsersRequest,
  type ResolveAdminUsersResult,
  type UpdateAdminUserRequest,
  type UpdateAdminUserResult,
} from '@portfolio/luna-shopper/contracts';
import { AdminDirectoryService } from './admin-directory.service';
import { AdminIdentityService } from './admin-identity.service';
import { AuthDashboardService } from './dashboard.service';

/**
 * The operator surface on the broker (plan 0071, section 5).
 *
 * Its own controller rather than four more handlers on `IdentityController`,
 * matching the separation the subjects and the table already have: a reader who
 * opens this file is looking at everything an admin token can be obtained by, and
 * a reader who opens the other one cannot accidentally add a fifth admin subject
 * beside a user one.
 *
 * There is no handler that creates, changes or removes an **admin**, and there
 * never will be. That is section 6: changing an admin means having the server,
 * because a back office that can make back office accounts is a back office where
 * one compromised session is permanent. `admin-user-immutable-fields.spec.ts`
 * asserts it over every pattern this controller answers, so the rule survives a
 * future author who only reads the code.
 *
 * Plan 0074 adds the second half: the directory an operator reads, and the
 * actions they may take on somebody else's account. Plan 0077 adds the third,
 * `adminUser.update`, which reaches a user's username and display name and no
 * other column. All of them delegate to {@link AdminDirectoryService}, which
 * gates on the forwarded operator token before it touches a table. The identity
 * handlers above them do not, and must not: `adminAuth.login` is how a caller
 * **obtains** a token, so requiring one would make signing in impossible.
 */
@Controller()
export class AdminController {
  constructor(
    private readonly admins: AdminIdentityService,
    private readonly directory: AdminDirectoryService,
    private readonly dashboard: AuthDashboardService
  ) {}

  /**
   * Auth's block of the back office dashboard (plan 0088). Gated like every
   * handler below it: the service verifies the forwarded operator token before
   * it counts a single row.
   */
  @MessagePattern(ADMIN_DASHBOARD_PATTERNS.identity)
  identityDashboard(
    @Payload() req: AdminDashboardRequest
  ): Promise<AdminIdentityDashboard> {
    return this.dashboard.dashboard(req);
  }

  @MessagePattern(ADMIN_AUTH_PATTERNS.login)
  login(@Payload() req: AdminLoginRequest): Promise<AdminAuthTokens> {
    return this.admins.login(req);
  }

  @MessagePattern(ADMIN_AUTH_PATTERNS.refresh)
  refresh(@Payload() req: AdminRefreshRequest): Promise<AdminAuthTokens> {
    return this.admins.refresh(req);
  }

  @MessagePattern(ADMIN_AUTH_PATTERNS.getAdmin)
  getAdmin(@Payload() req: GetAdminRequest): Promise<AdminIdentityView> {
    return this.admins.getAdmin(req);
  }

  @MessagePattern(ADMIN_AUTH_PATTERNS.devAutologin)
  devAutologin(
    @Payload() req: AdminDevAutologinRequest
  ): Promise<AdminAuthTokens> {
    return this.admins.devAutologin(req);
  }

  @MessagePattern(ADMIN_AUTH_PATTERNS.listAdmins)
  listAdmins(
    @Payload() req: ListAdminsRequest
  ): Promise<AdminIdentityListView> {
    return this.directory.listAdmins(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.list)
  listUsers(@Payload() req: ListAdminUsersRequest): Promise<AdminUserPage> {
    return this.directory.list(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.get)
  getUser(@Payload() req: GetAdminUserRequest): Promise<AdminUserDetailView> {
    return this.directory.get(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.resolveMany)
  resolveUsers(
    @Payload() req: ResolveAdminUsersRequest
  ): Promise<ResolveAdminUsersResult> {
    return this.directory.resolveMany(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.update)
  updateUser(
    @Payload() req: UpdateAdminUserRequest
  ): Promise<UpdateAdminUserResult> {
    return this.directory.update(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.delete)
  deleteUser(
    @Payload() req: DeleteAdminUserRequest
  ): Promise<DeleteAdminUserResult> {
    return this.directory.deleteUser(req);
  }

  @MessagePattern(ADMIN_USER_PATTERNS.resendVerification)
  resendVerification(
    @Payload() req: ResendAdminVerificationRequest
  ): Promise<ResendAdminVerificationResult> {
    return this.directory.resendVerification(req);
  }
}
