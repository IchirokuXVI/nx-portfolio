import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  MERGE_PATTERNS,
  type MergeRequestPage,
  type MergeRequestView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';
import { ListMergesQueryDto, RequestMergeDto } from './merge.dto';

/**
 * Per zone account merge (plan 0008), proxying to core over NATS. A member
 * requests a merge; the zone owner approves or rejects it; the requester may
 * cancel their own pending request. Core authorizes each against its own tables.
 */
@ApiTags('merges')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class MergeController {
  constructor(private readonly nats: NatsClient) {}

  @Post('zones/:zoneId/merges')
  request(
    @AuthUser() user: CurrentUser,
    @Param('zoneId') zoneId: string,
    @Body() dto: RequestMergeDto
  ): Promise<MergeRequestView> {
    return this.nats.send<MergeRequestView>(MERGE_PATTERNS.request, {
      userId: user.userId,
      zoneId,
      sourceUserId: dto.sourceUserId,
      targetUserId: dto.targetUserId,
    });
  }

  @Get('zones/:zoneId/merges')
  list(
    @AuthUser() user: CurrentUser,
    @Param('zoneId') zoneId: string,
    @Query() query: ListMergesQueryDto
  ): Promise<MergeRequestPage> {
    return this.nats.send<MergeRequestPage>(MERGE_PATTERNS.list, {
      userId: user.userId,
      zoneId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('merges/:id/approve')
  approve(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<MergeRequestView> {
    return this.nats.send<MergeRequestView>(MERGE_PATTERNS.approve, {
      userId: user.userId,
      mergeId: id,
    });
  }

  @Post('merges/:id/reject')
  reject(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<MergeRequestView> {
    return this.nats.send<MergeRequestView>(MERGE_PATTERNS.reject, {
      userId: user.userId,
      mergeId: id,
    });
  }

  @Post('merges/:id/cancel')
  cancel(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<MergeRequestView> {
    return this.nats.send<MergeRequestView>(MERGE_PATTERNS.cancel, {
      userId: user.userId,
      mergeId: id,
    });
  }
}
