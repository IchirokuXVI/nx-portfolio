import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ZONE_PATTERNS,
  type CreateZoneRequest,
  type JoinZoneRequest,
  type ListMyZonesRequest,
  type MembershipActionRequest,
  type MembershipView,
  type SetRoleRequest,
  type UpdateZoneRequest,
  type ZoneIdRequest,
  type ZonePage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { ZoneService } from './zone.service';

/**
 * Core's zone NATS surface (plan 0006). The gateway is the only caller; each
 * request carries the resolved `userId` from the verified token. Authorization
 * runs inside {@link ZoneService} against core's own membership table.
 */
@Controller()
export class ZoneController {
  constructor(private readonly zones: ZoneService) {}

  @MessagePattern(ZONE_PATTERNS.create)
  create(@Payload() req: CreateZoneRequest): Promise<ZoneView> {
    return this.zones.create(req);
  }

  @MessagePattern(ZONE_PATTERNS.join)
  join(@Payload() req: JoinZoneRequest): Promise<MembershipView> {
    return this.zones.join(req);
  }

  @MessagePattern(ZONE_PATTERNS.update)
  update(@Payload() req: UpdateZoneRequest): Promise<ZoneView> {
    return this.zones.update(req);
  }

  @MessagePattern(ZONE_PATTERNS.delete)
  delete(@Payload() req: ZoneIdRequest): Promise<{ id: string }> {
    return this.zones.delete(req);
  }

  @MessagePattern(ZONE_PATTERNS.regenerateJoinCode)
  regenerateJoinCode(@Payload() req: ZoneIdRequest): Promise<ZoneView> {
    return this.zones.regenerateJoinCode(req);
  }

  @MessagePattern(ZONE_PATTERNS.setRole)
  setRole(@Payload() req: SetRoleRequest): Promise<MembershipView> {
    return this.zones.setRole(req);
  }

  @MessagePattern(ZONE_PATTERNS.transferOwnership)
  transferOwnership(
    @Payload() req: MembershipActionRequest
  ): Promise<ZoneView> {
    return this.zones.transferOwnership(req);
  }

  @MessagePattern(ZONE_PATTERNS.claimOwnership)
  claimOwnership(@Payload() req: ZoneIdRequest): Promise<ZoneView> {
    return this.zones.claimOwnership(req);
  }

  @MessagePattern(ZONE_PATTERNS.listMine)
  listMine(@Payload() req: ListMyZonesRequest): Promise<ZonePage> {
    return this.zones.listMine(req);
  }
}
