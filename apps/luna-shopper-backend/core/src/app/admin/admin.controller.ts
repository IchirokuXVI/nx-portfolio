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
  type AdminListIdRequest,
  type AdminListLinePage,
  type AdminListLineView,
  type AdminListPage,
  type AdminMembershipActionRequest,
  type AdminMembershipActionResult,
  type AdminMembershipPage,
  type AdminZoneDetailView,
  type AdminZoneIdRequest,
  type AdminZoneMemberView,
  type AdminZonePage,
  type DeleteAdminListLineRequest,
  type GetAdminBasketRequest,
  type GetAdminListLineRequest,
  type GetAdminListRequest,
  type GetAdminMembershipRequest,
  type GetAdminZoneRequest,
  type LineView,
  type ListAdminBasketsRequest,
  type ListAdminListLinesRequest,
  type ListAdminListsRequest,
  type ListAdminMembershipsRequest,
  type ListAdminZonesRequest,
  type ListView,
  type MembershipView,
  type SetAdminLineApprovalRequest,
  type SetAdminZoneDeletionMarkRequest,
  type UpdateAdminListLineRequest,
  type UpdateAdminListRequest,
  type UpdateAdminMembershipRequest,
  type UpdateAdminZoneRequest,
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
 * **Every handler gates before it reads or writes**, inside the service rather
 * than at the controller, so the check cannot be skipped by a future caller that
 * reaches the service another way. The gate returns the admin id from the
 * verified token, and that id is the actor every audited write records (plan
 * 0077, section 8), so nothing here can attribute a change to somebody the gate
 * did not let through.
 *
 * **No handler writes a row.** Each write delegates to the service that owns the
 * invariant, which is plan 0077 section 1 and the reason this file grew from
 * seven actions to a full editing surface without becoming a row editor.
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

  @MessagePattern(ADMIN_ZONE_PATTERNS.update)
  updateZone(@Payload() req: UpdateAdminZoneRequest): Promise<ZoneView> {
    return this.zones.update(req);
  }

  @MessagePattern(ADMIN_ZONE_PATTERNS.setDeletionMark)
  setDeletionMark(
    @Payload() req: SetAdminZoneDeletionMarkRequest
  ): Promise<ZoneView> {
    return this.zones.setDeletionMark(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.list)
  listMemberships(
    @Payload() req: ListAdminMembershipsRequest
  ): Promise<AdminMembershipPage> {
    return this.zones.listMemberships(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.get)
  getMembership(
    @Payload() req: GetAdminMembershipRequest
  ): Promise<AdminZoneMemberView> {
    return this.zones.getMembership(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.update)
  updateMembership(
    @Payload() req: UpdateAdminMembershipRequest
  ): Promise<MembershipView> {
    return this.zones.updateMembership(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.approve)
  approve(
    @Payload() req: AdminMembershipActionRequest
  ): Promise<AdminMembershipActionResult> {
    return this.zones.approve(req);
  }

  @MessagePattern(ADMIN_MEMBERSHIP_PATTERNS.reject)
  reject(
    @Payload() req: AdminMembershipActionRequest
  ): Promise<{ id: string }> {
    return this.zones.reject(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.list)
  listLists(@Payload() req: ListAdminListsRequest): Promise<AdminListPage> {
    return this.lists.list(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.get)
  getList(@Payload() req: GetAdminListRequest): Promise<AdminListDetailView> {
    return this.lists.get(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.update)
  updateList(@Payload() req: UpdateAdminListRequest): Promise<ListView> {
    return this.lists.update(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.delete)
  deleteList(@Payload() req: AdminListIdRequest): Promise<{ id: string }> {
    return this.lists.remove(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.listLines)
  listLines(
    @Payload() req: ListAdminListLinesRequest
  ): Promise<AdminListLinePage> {
    return this.lists.listLines(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.getLine)
  getLine(
    @Payload() req: GetAdminListLineRequest
  ): Promise<AdminListLineView> {
    return this.lists.getLine(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.updateLine)
  updateLine(@Payload() req: UpdateAdminListLineRequest): Promise<LineView> {
    return this.lists.updateLine(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.setLineApproval)
  setLineApproval(
    @Payload() req: SetAdminLineApprovalRequest
  ): Promise<LineView> {
    return this.lists.setLineApproval(req);
  }

  @MessagePattern(ADMIN_LIST_PATTERNS.deleteLine)
  deleteLine(
    @Payload() req: DeleteAdminListLineRequest
  ): Promise<{ id: string }> {
    return this.lists.deleteLine(req);
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
