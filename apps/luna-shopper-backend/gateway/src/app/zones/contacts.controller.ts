import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ZONE_PATTERNS,
  type ContactPage,
  type ContactsRequest,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { ContactsQueryDto } from './contacts.dto';

/**
 * The people the caller shares an approved group with (plan 0114, section 2),
 * for choosing who a basket is shared with.
 *
 * Its own path rather than a route under `zones`, because it belongs to no one
 * zone: it reads every group the caller is approved in at once.
 */
@ApiTags('zones')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'contacts', version: '1' })
export class ContactsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * One page of contacts: one row per membership, so a person in two of the
   * caller's groups is two rows, each under the name that group knows them by.
   *
   * Neither grouped nor ordered for display. A client that draws people by group
   * groups these rows by `zoneId` with the group names it already reads from
   * `GET /v1/zones`, and sorts them itself; the order a page arrives in exists
   * only to keep the cursor exact. Temporary accounts are included, and the
   * caller never is.
   */
  @Get()
  @ApiContractResponse(ZONE_PATTERNS.contacts)
  @ApiProblemResponses({ auth: true, body: true })
  contacts(
    @AuthUser() user: CurrentUser,
    @Query() query: ContactsQueryDto
  ): Promise<ContactPage> {
    const req: ContactsRequest = {
      userId: user.userId,
      cursor: query.cursor,
      limit: query.limit,
    };
    return this.nats.send<ContactPage>(ZONE_PATTERNS.contacts, req);
  }
}
