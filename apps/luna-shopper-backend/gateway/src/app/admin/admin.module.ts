import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MessagingModule } from '../messaging/messaging.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminEnvironmentController } from './admin-environment.controller';
import { AdminJwtStrategy } from './admin-jwt.strategy';

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
 */
@Module({
  imports: [PassportModule, MessagingModule],
  controllers: [AdminAuthController, AdminEnvironmentController],
  providers: [AdminJwtStrategy],
})
export class GatewayAdminModule {}
