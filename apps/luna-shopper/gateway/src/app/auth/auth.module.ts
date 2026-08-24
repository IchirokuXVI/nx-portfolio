import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import type { GatewayConfig } from '../config/app-config';
import { MessagingModule } from '../messaging/messaging.module';
import { AuthController } from './auth.controller';
import { GoogleController } from './google.controller';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';

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
  controllers: [AuthController, GoogleController],
  providers: [JwtStrategy, googleStrategyProvider],
})
export class GatewayAuthModule {}
