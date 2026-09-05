import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_BASKET_PATTERNS,
  ADMIN_CORE_SCHEMA_IDS,
  ADMIN_LIST_PATTERNS,
  ADMIN_MEMBERSHIP_PATTERNS,
  ADMIN_POSTAL_CODE_PATTERNS,
  ADMIN_ZONE_PATTERNS,
  type AdminBasketDetailView,
  type AdminBasketPage,
  type AdminListDetailView,
  type AdminListLinePage,
  type AdminListLineView,
  type AdminListPage,
  type AdminMembershipActionResult,
  type AdminMembershipPage,
  type AdminPostalCodePage,
  type AdminZoneDetailView,
  type AdminZoneMemberView,
  type AdminZonePage,
  type AdminZoneRowPage,
  type LineView,
  type ListView,
  type MembershipView,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import {
  ListAdminBasketsQueryDto,
  ListAdminListsQueryDto,
  ListAdminPostalCodesQueryDto,
  ListAdminZonesQueryDto,
} from './admin-directory.dto';
import {
  SetAdminLineApprovalDto,
  UpdateAdminLineDto,
  UpdateAdminListDto,
  UpdateAdminMembershipDto,
  UpdateAdminZoneDto,
} from './admin-edit.dto';
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { AdminUserNamesService } from './admin-user-names.service';
import { ActingAdmin } from './current-admin.decorator';
import { referenceFilter } from './reference-none';

/**
 * Households, for the back office (plan 0074).
 *
 * Every route in `zone.controller.ts` and `list.controller.ts` is scoped to the
 * caller by design, and no operator is a member of the zone they are looking at,
 * so none of them can answer here. These are the unscoped reads, plus the five
 * named actions of section 1.
 *
 * **Every write is named, not generic.** Each delegates to the core service that
 * owns the invariant: the membership status verbs and the per zone name to
 * `MembershipService`, the name, config, deletion mark, role, join code and
 * ownership to `ZoneService`, the deletion to `ZoneReaperService`. What none of
 * them does is write a row.
 *
 * Plan 0074 read that as a reason to offer no editing at all, and plan 0077
 * reverses the conclusion while keeping the reason: what was ruled out was the
 * generic row editor, and a `PATCH` that calls `ZoneService.update` is not one.
 *
 * **These writes are not quiet** (plan 0077, section 7). Every one of them emits
 * the realtime event its member facing twin emits, so a member with the app open
 * sees the change arrive with no explanation attached to it. That is accepted
 * because the alternative is worse: suppressing the event leaves every open
 * client showing stale data until it happens to refetch, which for a zone room is
 * possibly never, and two clients then disagree about what the list says. The
 * back office says so before it makes one.
 */
@ApiTags('admin-core')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/zones', version: '1' })
export class AdminZonesController {
  constructor(
    private readonly nats: NatsClient,
    private readonly names: AdminUserNamesService
  ) {}

  /**
   * A page of zones, optionally filtered to one user, each row carrying its
   * owner's name.
   *
   * **The name is a second call, not a join** (section 3). Core answers with
   * `ownerUserId` and nothing more, because the users are in auth's database;
   * this route then asks auth for the names on the page it just fetched, in one
   * batched request. If that call fails or an id resolves to nobody, the row
   * carries the id instead and the listing still answers, which is the rule that
   * matters most about this route.
   */
  @Get()
  @ApiComposedResponse(ADMIN_CORE_SCHEMA_IDS.zoneRowPage, {
    description:
      'A page of zones from core, each decorated with its owner’s name from auth. An id auth could not resolve is rendered as the id.',
  })
  async list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListAdminZonesQueryDto
  ): Promise<AdminZoneRowPage> {
    // `ownerUserId=none` is the zones nobody owns (admin plan 0012, section
    // 3). Core knows that question as `withoutOwner`, and this is where the
    // literal becomes the flag.
    const owner = referenceFilter(query.ownerUserId);
    const page = await this.nats.send<AdminZonePage>(ADMIN_ZONE_PATTERNS.list, {
      ...adminCredential(admin),
      targetUserId: query.userId,
      ownerUserId: owner.id,
      withoutOwner: owner.none,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      cursor: query.cursor,
      limit: query.limit,
    });
    return this.names.decorateZones(admin, page);
  }

  /**
   * One zone: its membership, and the **names** of its lists.
   *
   * Not their lines. Reading what a household wrote down is a deliberate click on
   * the list itself, which is `GET /v1/admin/lists/:id`, and browsing zones must
   * not be a way to end up having read one by accident (section 4).
   */
  @Get(':id')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<AdminZoneDetailView> {
    return this.nats.send<AdminZoneDetailView>(ADMIN_ZONE_PATTERNS.get, {
      ...adminCredential(admin),
      zoneId: id,
    });
  }

  /**
   * Delete a zone, through `zone-reaper.service` (section 1), which is where what
   * deleting a zone means lives: the row, its cascade, and the `zone.deleted`
   * event every client needs in order to drop it.
   */
  @Delete(':id')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ADMIN_ZONE_PATTERNS.delete, {
      ...adminCredential(admin),
      zoneId: id,
    });
  }

  /** Regenerate the join code, the write the zone's own admins make (section 1). */
  @Post(':id/join-code')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.regenerateJoinCode, {
    status: HttpStatus.CREATED,
  })
  regenerateJoinCode(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ADMIN_ZONE_PATTERNS.regenerateJoinCode, {
      ...adminCredential(admin),
      zoneId: id,
    });
  }

  /**
   * Hand the zone to one of its members (section 1), which plan 0029 defines as
   * two role changes and the zone's owner in one transaction.
   *
   * The outgoing owner is found rather than named, and may be nobody: a zone
   * whose owner deleted their account is ownerless, and rescuing exactly that
   * zone is what this action is most useful for.
   */
  @Post(':id/members/:membershipId/ownership')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.transferOwnership, {
    status: HttpStatus.CREATED,
  })
  transferOwnership(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ADMIN_ZONE_PATTERNS.transferOwnership, {
      ...adminCredential(admin),
      zoneId: id,
      membershipId,
    });
  }

  /**
   * Kick a member: the write `POST /v1/zones/:id/members/:membershipId/kick`
   * makes, without the zone role the operator does not hold.
   */
  @Post(':id/members/:membershipId/kick')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.kick, {
    status: HttpStatus.CREATED,
  })
  kick(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<AdminMembershipActionResult> {
    return this.nats.send<AdminMembershipActionResult>(
      ADMIN_MEMBERSHIP_PATTERNS.kick,
      { ...adminCredential(admin), zoneId: id, membershipId }
    );
  }

  /** Ban a member: the same write the zone's own ban path makes. */
  @Post(':id/members/:membershipId/ban')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.ban, {
    status: HttpStatus.CREATED,
  })
  ban(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<AdminMembershipActionResult> {
    return this.nats.send<AdminMembershipActionResult>(
      ADMIN_MEMBERSHIP_PATTERNS.ban,
      { ...adminCredential(admin), zoneId: id, membershipId }
    );
  }

  /**
   * Change the zone's name or its config, the write its own owner makes (plan
   * 0077, section 4.1).
   *
   * The other four columns are not fields here. `joinCode` is unique and random
   * on purpose, so regenerating it is the action above; `ownerUserId` is two role
   * changes and a column in one transaction, so transfer is the action above; and
   * `status` and `markedForDeletionAt` are one state machine, which is the two
   * routes below.
   */
  @Patch(':id')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.update)
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() body: UpdateAdminZoneDto
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ADMIN_ZONE_PATTERNS.update, {
      ...adminCredential(admin),
      zoneId: id,
      name: body.name,
      config: body.config,
    });
  }

  /**
   * Mark the zone for deletion (plan 0077, section 4.2).
   *
   * A pair of routes rather than a field, because `status` and
   * `markedForDeletionAt` are written together and read together: the reaper needs
   * both to decide what to remove after the grace period, and typing either alone
   * produces a zone it never removes or one it removes anyway. Neither state is
   * reachable through any other code path and neither has a repair.
   */
  @Post(':id/deletion-mark')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.setDeletionMark, {
    status: HttpStatus.CREATED,
  })
  markForDeletion(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ADMIN_ZONE_PATTERNS.setDeletionMark, {
      ...adminCredential(admin),
      zoneId: id,
      marked: true,
    });
  }

  /** Restore a marked zone: the same pair written the other way. */
  @Delete(':id/deletion-mark')
  @ApiContractResponse(ADMIN_ZONE_PATTERNS.setDeletionMark)
  restore(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ZoneView> {
    return this.nats.send<ZoneView>(ADMIN_ZONE_PATTERNS.setDeletionMark, {
      ...adminCredential(admin),
      zoneId: id,
      marked: false,
    });
  }

  /**
   * A page of the zone's memberships (plan 0077, section 9).
   *
   * The zone detail read keeps its embedded `members` array, unchanged: the zone
   * screen renders its membership without a second call. This collection serves
   * the screen that edits one membership, which reads and writes a row through
   * its own address.
   */
  @Get(':id/members')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.list)
  listMembers(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Query() query: PageQueryDto
  ): Promise<AdminMembershipPage> {
    return this.nats.send<AdminMembershipPage>(ADMIN_MEMBERSHIP_PATTERNS.list, {
      ...adminCredential(admin),
      zoneId: id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** One membership, read through its own address. */
  @Get(':id/members/:membershipId')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.get)
  getMember(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<AdminZoneMemberView> {
    return this.nats.send<AdminZoneMemberView>(ADMIN_MEMBERSHIP_PATTERNS.get, {
      ...adminCredential(admin),
      zoneId: id,
      membershipId,
    });
  }

  /**
   * A membership's role and its per zone name (plan 0077, section 4.3).
   *
   * `status` is not a field on this body. It moves along a state machine with a
   * service method per edge, and each edge does more than write the enum, so the
   * four verbs are the four routes beside this one rather than four values here.
   */
  @Patch(':id/members/:membershipId')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.update)
  updateMember(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateAdminMembershipDto
  ): Promise<MembershipView> {
    return this.nats.send<MembershipView>(ADMIN_MEMBERSHIP_PATTERNS.update, {
      ...adminCredential(admin),
      zoneId: id,
      membershipId,
      role: body.role,
      username: body.username,
    });
  }

  /**
   * Approve a pending member: more than the enum, which is why it is a route.
   *
   * The same write the zone's own owner makes, including handing the new member
   * the lists their group shares, in the same transaction. `approvedByUserId` is
   * null on this path: an operator holds no membership in the zone, so there is
   * no id to record there, and every other reader treats that column as a
   * `users.id`.
   */
  @Post(':id/members/:membershipId/approve')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.approve, {
    status: HttpStatus.CREATED,
  })
  approve(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<AdminMembershipActionResult> {
    return this.nats.send<AdminMembershipActionResult>(
      ADMIN_MEMBERSHIP_PATTERNS.approve,
      { ...adminCredential(admin), zoneId: id, membershipId }
    );
  }

  /** Reject a pending member, which removes the pending row. */
  @Post(':id/members/:membershipId/reject')
  @ApiContractResponse(ADMIN_MEMBERSHIP_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string
  ): Promise<{ id: string }> {
    return this.nats.send(ADMIN_MEMBERSHIP_PATTERNS.reject, {
      ...adminCredential(admin),
      zoneId: id,
      membershipId,
    });
  }
}

/**
 * The standing lists inside zones, for the back office.
 *
 * Readable, and editable through the services that own the invariants (plan
 * 0077, section 5). Lines are on the detail read and on the collection below,
 * never on a zone read: reading what a household wrote down is a deliberate click
 * and not a side effect of browsing zones (plan 0074, section 4).
 *
 * **Creating a line is absent, and that is a decision.** `createdByUserId` is not
 * nullable and an operator is not a user, so a created line would be attributed to
 * nobody, or to an admin id that resolves to no user, and every list screen
 * renders that attribution. Reordering is absent too: it is a whole order rather
 * than a field, with no meaning outside the screen a member drags rows on.
 */
@ApiTags('admin-core')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/lists', version: '1' })
export class AdminListsController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(ADMIN_LIST_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListAdminListsQueryDto
  ): Promise<AdminListPage> {
    return this.nats.send<AdminListPage>(ADMIN_LIST_PATTERNS.list, {
      ...adminCredential(admin),
      zoneId: query.zoneId,
      createdByUserId: query.createdByUserId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** One list and its lines, every line, whatever its approval status. */
  @Get(':id')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<AdminListDetailView> {
    return this.nats.send<AdminListDetailView>(ADMIN_LIST_PATTERNS.get, {
      ...adminCredential(admin),
      listId: id,
    });
  }

  /**
   * A list's name and its two flags (plan 0077, section 5.1).
   *
   * `sharedWithZone` is asymmetric and the screen has to say so: turning it on
   * grants READ, WRITE and DECIDE to every currently approved non staff member,
   * and turning it off revokes nobody. The mistake to prevent is an operator who
   * toggles it off and expects the list to close.
   *
   * The per member grant set is not reachable here. It is a set of entries rather
   * than a field, and editing it well needs a screen of its own.
   */
  @Patch(':id')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.update)
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() body: UpdateAdminListDto
  ): Promise<ListView> {
    return this.nats.send<ListView>(ADMIN_LIST_PATTERNS.update, {
      ...adminCredential(admin),
      listId: id,
      name: body.name,
      autoApproveLines: body.autoApproveLines,
      sharedWithZone: body.sharedWithZone,
    });
  }

  /** Delete a list, through `ListService` (plan 0077, section 5.1). */
  @Delete(':id')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ADMIN_LIST_PATTERNS.delete, {
      ...adminCredential(admin),
      listId: id,
    });
  }

  /**
   * A page of the list's lines, in the household's own order (plan 0077, section
   * 9).
   *
   * The detail read keeps its embedded array. This collection serves the screen
   * that edits one line.
   */
  @Get(':id/lines')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.listLines)
  listLines(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Query() query: PageQueryDto
  ): Promise<AdminListLinePage> {
    return this.nats.send<AdminListLinePage>(ADMIN_LIST_PATTERNS.listLines, {
      ...adminCredential(admin),
      listId: id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** One line, read through its own address. */
  @Get(':id/lines/:lineId')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.getLine)
  getLine(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('lineId') lineId: string
  ): Promise<AdminListLineView> {
    return this.nats.send<AdminListLineView>(ADMIN_LIST_PATTERNS.getLine, {
      ...adminCredential(admin),
      listId: id,
      lineId,
    });
  }

  /**
   * Edit a line's content, quantity or product set (plan 0077, section 5.2).
   *
   * **The operator edits with `MANAGE`.** `LineService.update` uses the caller's
   * permissions twice, once to authorize the edit and once to decide what the edit
   * does to the line's approval, and an operator resolves to no membership and
   * therefore to no permissions. `MANAGE` answers both, and both answers are what
   * an operator wants: the edit is allowed, and an approved line stays approved. A
   * correction that silently un-approved the line is a second change nobody asked
   * for, visible to every member in the zone.
   *
   * A `REJECTED` line still reopens, because that rule applies to everyone.
   */
  @Patch(':id/lines/:lineId')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.updateLine)
  updateLine(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: UpdateAdminLineDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(ADMIN_LIST_PATTERNS.updateLine, {
      ...adminCredential(admin),
      listId: id,
      lineId,
      content: body.content,
      quantity: body.quantity,
      itemIds: body.itemIds,
    });
  }

  /** Approve or reject one line, the write `line.setApproval` performs. */
  @Post(':id/lines/:lineId/approval')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.setLineApproval, {
    status: HttpStatus.CREATED,
  })
  setLineApproval(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: SetAdminLineApprovalDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(ADMIN_LIST_PATTERNS.setLineApproval, {
      ...adminCredential(admin),
      listId: id,
      lineId,
      status: body.status,
    });
  }

  /** Delete one line, the write `line.delete` performs. */
  @Delete(':id/lines/:lineId')
  @ApiContractResponse(ADMIN_LIST_PATTERNS.deleteLine)
  deleteLine(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Param('lineId') lineId: string
  ): Promise<{ id: string }> {
    return this.nats.send(ADMIN_LIST_PATTERNS.deleteLine, {
      ...adminCredential(admin),
      listId: id,
      lineId,
    });
  }
}

/**
 * Generated shopping lists, which are the baskets people take round the shop
 * (plan 0050).
 *
 * A basket belongs to a person rather than to a zone, so the zone filter matches
 * through the line origins: the zones a basket's lines were drawn from.
 *
 * **Read only in full, and it stays that way** (plan 0077, section 6.4). A
 * `GeneratedList` is output: it is composed from the wanted, approved lines of the
 * zones and lists a person chose, at the moment `sourceSnapshot` records, and
 * every line in it carries an origin naming the list line it came from. A changed
 * `content` contradicts that origin, a changed `quantity` contradicts settlement
 * rows already written against it, and none of it is repairable. A basket is
 * readable only by its owner, so the change would land silently inside one
 * person's private working document. Deleting a whole basket is the one basket
 * write worth having, and it needs a service that does not exist yet.
 */
@ApiTags('admin-core')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/baskets', version: '1' })
export class AdminBasketsController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(ADMIN_BASKET_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListAdminBasketsQueryDto
  ): Promise<AdminBasketPage> {
    return this.nats.send<AdminBasketPage>(ADMIN_BASKET_PATTERNS.list, {
      ...adminCredential(admin),
      ownerUserId: query.ownerUserId,
      zoneId: query.zoneId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiContractResponse(ADMIN_BASKET_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<AdminBasketDetailView> {
    return this.nats.send<AdminBasketDetailView>(ADMIN_BASKET_PATTERNS.get, {
      ...adminCredential(admin),
      basketId: id,
    });
  }
}

/**
 * The shipped postal code table (plan 0074, section 2).
 *
 * Under `admin/catalog/` rather than beside the two open `postalCode.*` reads,
 * because those have no HTTP surface at all: they are service to service, and a
 * gateway route over them would be a geocoding service nobody asked for. This is
 * a table an operator reads, and the question it answers is coverage: which codes
 * do we hold, and which of them have a shop in them.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/postal-codes', version: '1' })
export class AdminPostalCodesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(ADMIN_POSTAL_CODE_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListAdminPostalCodesQueryDto
  ): Promise<AdminPostalCodePage> {
    return this.nats.send<AdminPostalCodePage>(
      ADMIN_POSTAL_CODE_PATTERNS.list,
      {
        ...adminCredential(admin),
        country: query.country,
        postalCode: query.postalCode,
        served: query.served,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}
