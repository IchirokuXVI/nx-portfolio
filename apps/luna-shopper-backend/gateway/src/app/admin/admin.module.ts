import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MessagingModule } from '../messaging/messaging.module';
import { AdminAuthController } from './admin-auth.controller';
import {
  AdminBasketsController,
  AdminListsController,
  AdminPostalCodesController,
  AdminZonesController,
} from './admin-core.controller';
import {
  AdminAdminsController,
  AdminUsersController,
} from './admin-directory.controller';
import { AdminEnvironmentController } from './admin-environment.controller';
import { AdminJwtStrategy } from './admin-jwt.strategy';
import { AdminUserNamesService } from './admin-user-names.service';

/**
 * The operator half of the gateway (plan 0071, section 5).
 *
 * Its own module rather than more providers on `GatewayAuthModule`, so the two
 * trust roots are declared in two files. `AdminJwtStrategy` registers under the
 * passport name `admin-jwt`; nothing here touches the `jwt` strategy and nothing
 * there touches this one.
 *
 * Plan 0073 moves the existing back office routes under `/v1/admin/**`, and this
 * is the module they arrive in.
 *
 * Plan 0074 adds the ones that were never built: the user directory and the admin
 * roster, and the households, lists, baskets and postal codes an operator could
 * not previously reach at all. `AdminUserNamesService` is the only provider
 * beside the strategy, and it is here rather than in a controller because the
 * cross database join it performs (section 3) is a gateway concern by
 * construction: it is the one process that talks to both auth and core.
 *
 * The catalog half of the back office is **not** here. Plan 0073 put it in
 * `catalog-admin.controller.ts`, next to the reads it was split from, and moving
 * it would separate the two halves of that split for no gain.
 */
@Module({
  imports: [PassportModule, MessagingModule],
  controllers: [
    AdminAuthController,
    AdminEnvironmentController,
    AdminUsersController,
    AdminAdminsController,
    AdminZonesController,
    AdminListsController,
    AdminBasketsController,
    AdminPostalCodesController,
  ],
  providers: [AdminJwtStrategy, AdminUserNamesService],
})
export class GatewayAdminModule {}
