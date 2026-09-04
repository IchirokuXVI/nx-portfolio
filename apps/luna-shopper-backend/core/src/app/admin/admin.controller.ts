import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ADMIN_BASKET_PATTERNS,
  ADMIN_LIST_PATTERNS,
  ADMIN_MEMBERSHIP_PATTERNS,
  ADMIN_ZONE_PATTERNS,
  type AdminBasketDetailView,
  type AdminBasketPage,
  type AdminListDetailView,
  type AdminListPage,
  type AdminMembershipActionRequest,
  type AdminMembershipActionResult,
  type AdminZoneDetailView,
  type AdminZoneIdRequest,
  type AdminZonePage,
  type GetAdminBasketRequest,
  type GetAdminListRequest,
  type GetAdminZoneRequest,
  type ListAdminBasketsRequest,
  type ListAdminListsRequest,
  type ListAdminZonesRequest,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { AdminListService } from './admin-list.service';
import { AdminZoneService } from './admin-zone.service';

/**
 * Core's back office surface on the broker (plan 0074).
 *
 * Its own controller rather than more handlers on `ZoneController` and
 * `ListController`, matching the separation the subjects have. Everything here
 * is unscoped and everything here is gated on an operator token; every handler on
 * those two is scoped to a member and gated on nothing but their membership.
 * Keeping the two apart means nobody adds an ungated read to this file by
 * copying the handler above it, and nobody widens a user facing subject by
 * copying one from here.
 *
 * **Every handler gates before it reads**, inside the service rather than at the
 * controller, so the check cannot be skipped by a future caller that reaches the
 * service another way.
 */
@Controller()
export class CoreAdminController {
  constructor(
    private readonly zones: AdminZoneService,
    private readonly lists: AdminListService
  ) {}

  @MessagePattern(ADMIN_ZONE_PATTERNS.list)
  listZones(@Payload() req: ListAdminZonesRequest): Promise<AdminZonePage> {
    return this.zones.list(req);
  }

  @MessagePattern(ADMIN_ZONE_PATTERNS.get)
  getZone(@Payload() req: GetAdminZoneRequest): Promise<AdminZoneDetailView> {
    return this.zones.get(req);
  }

  @MessagePattern(ADMIN_ZONE_PATTERNS.delete)
  deleteZone(@Payload() req: AdminZoneIdRequest): Promise<{ id: string }> {
    return this.zones.remove(req);
  }

  @MessagePattern(ADMIN_ZONE_PATTERNS.regenerateJoinCode)
  regenerateJoinCode(@Payload() req: AdminZoneIdRequest): Promise<ZoneView> {
    return this.zones.regenerateJoinCode(req);
  }

  @MessagePattern(ADMIN_ZONE_PATTERNS.transferOwnership)
  transferOwnership(
    @Payload() req: AdminMembershipActionRequest
  ): Promise<ZoneView> {
    return this.zones.transferOwnership(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.kick)
  kick(
    @Payload() req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    return this.zones.kick(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.ban)
  ban(
    @Payload() req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    return this.zones.ban(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.list)
  listLists(@Payload() req: ListAdminListsRequest): Promise<AdminListPage> {
    return this.lists.list(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.get)
  getList(@Payload() req: GetAdminListRequest): Promise<AdminListDetailView> {
    return this.lists.get(req);
  }

  @MessagePattern(ADMIN_BASKET_PATTERNS.list)
  listBaskets(
    @Payload() req: ListAdminBasketsRequest
  ): Promise<AdminBasketPage> {
    return this.lists.listBaskets(req);
  }

  @MessagePattern(ADMIN_BASKET_PATTERNS.get)
  getBasket(
    @Payload() req: GetAdminBasketRequest
  ): Promise<AdminBasketDetailView> {
    return this.lists.getBasket(req);
  }
}
