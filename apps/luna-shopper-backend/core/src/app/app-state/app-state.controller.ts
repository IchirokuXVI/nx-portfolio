import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  APP_STATE_PATTERNS,
  type GetUserAppStateRequest,
  type SetUserAppStateRequest,
  type UserAppStateView,
} from '@portfolio/luna-shopper/contracts';
import { UserAppStateService } from './user-app-state.service';

/**
 * Core's app state surface (plan 0145). The gateway is the only caller, and
 * every request carries the `userId` a verified token resolved to, so a caller
 * can only ever read or stamp themselves.
 */
@Controller()
export class AppStateController {
  constructor(private readonly state: UserAppStateService) {}

  @MessagePattern(APP_STATE_PATTERNS.get)
  get(@Payload() req: GetUserAppStateRequest): Promise<UserAppStateView> {
    return this.state.get(req);
  }

  @MessagePattern(APP_STATE_PATTERNS.set)
  set(@Payload() req: SetUserAppStateRequest): Promise<UserAppStateView> {
    return this.state.set(req);
  }
}
