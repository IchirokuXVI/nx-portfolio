import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ADMIN_AUTH_PATTERNS,
  type AdminAuthTokens,
  type AdminDevAutologinRequest,
  type AdminIdentityView,
  type AdminLoginRequest,
  type AdminRefreshRequest,
  type GetAdminRequest,
} from '@portfolio/luna-shopper/contracts';
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
 */
@Controller()
export class AdminController {
  constructor(private readonly admins: AdminIdentityService) {}

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
}
