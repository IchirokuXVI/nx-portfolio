import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_USER_PATTERNS,
  type AdminAuthTokens,
  type AdminDevAutologinRequest,
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
} from '@portfolio/luna-shopper/contracts';
import { AdminDirectoryService } from './admin-directory.service';
import { AdminIdentityService } from './admin-identity.service';

/**
 * The operator surface on the broker (plan 0071, section 5).
 *
 * Its own controller rather than four more handlers on `IdentityController`,
 * matching the separation the subjects and the table already have: a reader who
 * opens this file is looking at everything an admin token can be obtained by, and
 * a reader who opens the other one cannot accidentally add a fifth admin subject
 * beside a user one.
 *
 * There is no create, update or delete handler, and nothing here can make an
 * admin. That is section 6: changing an admin means having the server.
 *
 * Plan 0074 adds the second half: the directory an operator reads, and the two
 * actions they may take on somebody else's account. Those handlers delegate to
 * {@link AdminDirectoryService}, which gates on the forwarded operator token
 * before it touches a table. The identity handlers above them do not, and must
 * not: `adminAuth.login` is how a caller **obtains** a token, so requiring one
 * would make signing in impossible.
 */
@Controller()
export class AdminController {
  constructor(
    private readonly admins: AdminIdentityService,
    private readonly directory: AdminDirectoryService
  ) {}

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
