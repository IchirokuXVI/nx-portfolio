import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { WithholdBodyMiddleware } from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';
import { MessagingModule } from '../messaging/messaging.module';
import { AuthController } from './auth.controller';
import { GoogleController } from './google.controller';
import { GoogleStrategy } from './google.strategy';
import { ImpersonationGate } from './impersonation-gate';
import { ImpersonationController } from './impersonation.controller';
import { JwtStrategy } from './jwt.strategy';
import { RecoverySignInController } from './recovery-sign-in.controller';

/**
 * The gateway's authentication layer (plan 0005): the JWT strategy for offline
 * access token verification and the auth/Google endpoints that proxy to the auth
 * service. The Google strategy is only instantiated when Google is configured, so
 * an unset client id never breaks boot; the routes exist but are inert until then.
 */
const googleStrategyProvider: Provider = {
  provide: GoogleStrategy,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    configService.getOrThrow<GatewayConfig>('gateway').google.enabled
      ? new GoogleStrategy(configService)
      : null,
};

@Module({
  imports: [PassportModule, MessagingModule],
  // `ImpersonationController` is the app's half of a support session (plan
  // 0194), and `ImpersonationGate` is what the JWT strategy asks auth through.
  controllers: [
    AuthController,
    GoogleController,
    ImpersonationController,
    RecoverySignInController,
  ],
  providers: [JwtStrategy, ImpersonationGate, googleStrategyProvider],
})
export class GatewayAuthModule implements NestModule {
  /**
   * The body of `POST /v1/auth/recovery-sign-in` is a raw reset token, and it
   * never reaches a log line (plan 0210). A middleware, so the request is
   * marked before any guard can fail it.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(WithholdBodyMiddleware).forRoutes(RecoverySignInController);
  }
}
