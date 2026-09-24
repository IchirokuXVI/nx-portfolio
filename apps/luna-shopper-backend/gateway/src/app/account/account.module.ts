import { Module } from '@nestjs/common';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { MessagingModule } from '../messaging/messaging.module';
import { AccountController } from './account.controller';
import { RecentShopsController } from './recent-shops.controller';

/**
 * The caller's own account: deletion (plan 0011), the profile routes (plan 0018)
 * and the shopping profiles (plan 0049), the last of which reach core rather
 * than auth.
 *
 * It provides its own {@link ScopeResolutionService} rather than importing the
 * catalog module: what it needs is the one method that drops a user's cached
 * scopes, and importing a module of eight controllers to reach it would register
 * the whole catalog surface twice.
 */
@Module({
  imports: [MessagingModule],
  // Plan 0164: the shops the caller bought at recently.
  controllers: [AccountController, RecentShopsController],
  providers: [ScopeResolutionService],
})
export class GatewayAccountModule {}
