import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  REALTIME_ACCESS_PATTERNS,
  type AccessCheckResult,
  type CheckListAccessRequest,
  type CheckParticipantAccessRequest,
  type CheckZoneAccessRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  DomainException,
  ForbiddenException,
} from '@portfolio/luna-shopper/platform';
import { GeneratedListSharingService } from '../generated-lists/generated-list-sharing.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { managesZone } from '../zones/zone.mappers';

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
    private readonly listAccess: ListAccessService,
    private readonly sharing: GeneratedListSharingService
  ) {}

  /**
   * The zone check also answers which of the zone's lists the caller may read
   * (plan 0032, section 4.1), so the realtime service can join a presence room
   * per list without a second round trip.
   *
   * The ids are fetched only once the membership check has passed, so a caller
   * with no business in the zone is answered `{ allowed: false }` without a
   * second query being run on their behalf.
   */
  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkZone)
  async checkZone(
    @Payload() req: CheckZoneAccessRequest
  ): Promise<AccessCheckResult> {
    const result = await this.check(() =>
      this.zoneAuthz.requireApproved(req.zoneId, req.userId)
    );
    if (!result.allowed) {
      return result;
    }
    return {
      allowed: true,
      listIds: await this.listAccess.readableListIds(req.zoneId, req.userId),
    };
  }

  /**
   * Gates the `zone:{id}:staff` room (plan 0017, section 9). It asks the same
   * question the REST summary asks before filling the governance fields, from
   * the same helper, so a socket can never see what a fetch would withhold.
   */
  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkZoneStaff)
  async checkZoneStaff(
    @Payload() req: CheckZoneAccessRequest
  ): Promise<AccessCheckResult> {
    return this.check(async () => {
      const membership = await this.zoneAuthz.requireApproved(
        req.zoneId,
        req.userId
      );
      if (!managesZone(membership)) {
        throw new ForbiddenException('Not a governor of this zone');
      }
      return membership;
    });
  }

  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkList)
  async checkList(
    @Payload() req: CheckListAccessRequest
  ): Promise<AccessCheckResult> {
    return this.check(() =>
      this.listAccess.requireRead(req.listId, req.userId)
    );
  }

  /**
   * Gates the two `generated:{id}` rooms (plan 0051, section 7).
   *
   * The one check here that names a participant rather than a user, because a
   * guest has no user id and none of the three above could be asked about them.
   * It is a single indexed read of the participant row, and the basket is checked
   * rather than trusted, so a participant id for one basket cannot admit a socket
   * to another's room.
   */
  @MessagePattern(REALTIME_ACCESS_PATTERNS.checkParticipant)
  async checkParticipant(
    @Payload() req: CheckParticipantAccessRequest
  ): Promise<AccessCheckResult> {
    const participant = await this.sharing.livePresenceEntry(
      req.participantId,
      req.generatedListId
    );
    // The entry rides back with the answer so the realtime service can seed
    // presence without a second call, and without the display name having been
    // baked into a token minted before the guest renamed themselves.
    return participant ? { allowed: true, participant } : { allowed: false };
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
