import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  PURCHASE_PATTERNS,
  type ListPurchaseSessionRowsRequest,
  type ListPurchaseSessionsRequest,
  type PurchaseEntryPage,
  type PurchaseRowPage,
  type TripKind,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  ListPurchaseSessionRowsQueryDto,
  ListPurchaseSessionsQueryDto,
} from './purchase.dto';

/**
 * What one person bought, with or without a basket (plan 0142).
 *
 * Account only, and the account is the token's: the history is the caller's own
 * purchases and there is no user id on either path. Core holds every rule,
 * including which purchases are the caller's, so nothing here decides anything.
 *
 * **It is not `GET /v1/generated-lists`**, which stays exactly as it is and
 * still answers "the baskets I made" for the lists tabs (section 6). This is
 * what the history page reads instead, and a finished basket appears in it as a
 * `BASKET` entry whose id opens the same basket page as before.
 */
@ApiTags('purchases')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'purchases', version: '1' })
export class PurchaseController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * The caller's history, newest first (section 3).
   *
   * An entry is a `GENERATED` basket they own, or a session: a run of purchases
   * separated from the next by more than six hours, across lists and across
   * baskets. Elapsed time and never a calendar day, so no time zone is involved
   * and a shop that crosses midnight stays one entry.
   */
  @Get('sessions')
  @ApiContractResponse(PURCHASE_PATTERNS.listSessions)
  @ApiProblemResponses({ auth: true })
  listSessions(
    @AuthUser() user: CurrentUser,
    @Query() query: ListPurchaseSessionsQueryDto
  ): Promise<PurchaseEntryPage> {
    const req: ListPurchaseSessionsRequest = {
      userId: user.userId,
      cursor: query.cursor,
      limit: query.limit,
    };
    return this.nats.send<PurchaseEntryPage>(
      PURCHASE_PATTERNS.listSessions,
      req
    );
  }

  /**
   * The rows of one entry, in the order the shopper walked (section 4).
   *
   * The kind rides the path in lower case and the contract in upper case, as
   * the trips route does it. Core refuses a kind it does not know, and answers
   * not found for an entry that does not exist, is not the caller's, or has had
   * every purchase in it reverted.
   */
  @Get('sessions/:kind/:id/rows')
  @ApiParam({ name: 'kind', enum: ['basket', 'session'] })
  @ApiContractResponse(PURCHASE_PATTERNS.listSessionRows)
  @ApiProblemResponses({ auth: true, body: true })
  listSessionRows(
    @AuthUser() user: CurrentUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: ListPurchaseSessionRowsQueryDto
  ): Promise<PurchaseRowPage> {
    const req: ListPurchaseSessionRowsRequest = {
      userId: user.userId,
      kind: kind.toUpperCase() as TripKind,
      entryId: id,
      cursor: query.cursor,
      limit: query.limit,
    };
    return this.nats.send<PurchaseRowPage>(
      PURCHASE_PATTERNS.listSessionRows,
      req
    );
  }
}
