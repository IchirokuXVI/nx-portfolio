import {
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
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
  type AdminListPage,
  type AdminMembershipActionResult,
  type AdminPostalCodePage,
  type AdminZoneDetailView,
  type AdminZonePage,
  type AdminZoneRowPage,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
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
import { AdminJwtGuard } from './admin-jwt.guard';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { AdminUserNamesService } from './admin-user-names.service';
import { ActingAdmin } from './current-admin.decorator';

/**
 * Households, for the back office (plan 0074).
 *
 * Every route in `zone.controller.ts` and `list.controller.ts` is scoped to the
 * caller by design, and no operator is a member of the zone they are looking at,
 * so none of them can answer here. These are the unscoped reads, plus the five
 * named actions of section 1.
 *
 * **The actions are named, not generic.** Each delegates to the core service that
 * owns the invariant: the kick and the ban to `MembershipService`, the join code
 * and the ownership transfer to `ZoneService`, the deletion to
 * `ZoneReaperService`. What none of them does is write a row: a list line
 * participates in settlements, generated list bindings and realtime broadcasts
 * other clients have already applied, and section 9 rules out a row editor over
 * core now and permanently.
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
    const page = await this.nats.send<AdminZonePage>(ADMIN_ZONE_PATTERNS.list, {
      ...adminCredential(admin),
      targetUserId: query.userId,
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
}

/**
 * The standing lists inside zones, for the back office.
 *
 * Read only, entirely, and lines only on the detail read (section 4).
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
}

/**
 * Generated shopping lists, which are the baskets people take round the shop
 * (plan 0050).
 *
 * A basket belongs to a person rather than to a zone, so the zone filter matches
 * through the line origins: the zones a basket's lines were drawn from.
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
