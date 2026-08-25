import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  REALTIME_ACCESS_PATTERNS,
  type AccessCheckResult,
  type CheckListAccessRequest,
  type CheckZoneAccessRequest,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';

/**
 * Membership checks the realtime service calls before adding a socket to a room
 * (plan 0009, section 5). They reuse the same authorization the domain surface
 * uses (an APPROVED zone membership for a `zone:` room; read access for a `list:`
 * room), so a client cannot listen to a zone or list it has no access to.
 *
 * The authz services throw the house domain exceptions on denial; here that is
 * not an error to surface but a plain "no", so a domain exception is folded into
 * `{ allowed: false }`. Anything else (a real fault) propagates.
 */
@Controller()
export class RealtimeAccessController {
  constructor(
    private readonly zoneAuthz: ZoneAuthzService,
    private readonly listAccess: ListAccessService
  ) {}

  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkZone)
  async checkZone(
    @Payload() req: CheckZoneAccessRequest
  ): Promise<AccessCheckResult> {
    return this.check(() =>
      this.zoneAuthz.requireApproved(req.zoneId, req.userId)
    );
  }

  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkList)
  async checkList(
    @Payload() req: CheckListAccessRequest
  ): Promise<AccessCheckResult> {
    return this.check(() =>
      this.listAccess.requireRead(req.listId, req.userId)
    );
  }

  private async check(fn: () => Promise<unknown>): Promise<AccessCheckResult> {
    try {
      await fn();
      return { allowed: true };
    } catch (err) {
      if (err instanceof DomainException) {
        return { allowed: false };
      }
      throw err;
    }
  }
}
