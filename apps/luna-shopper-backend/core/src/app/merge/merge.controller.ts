import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  MERGE_PATTERNS,
  type ListMergeRequestsRequest,
  type MergeIdRequest,
  type MergeRequestPage,
  type MergeRequestView,
  type RequestMergeRequest,
} from '@portfolio/luna-shopper/contracts';
import { MergeService } from './merge.service';

/**
 * Core's account merge NATS surface (plan 0008). The gateway is the only caller;
 * authorization runs against core's own membership table.
 */
@Controller()
export class MergeController {
  constructor(private readonly merge: MergeService) {}

  @MessagePattern(MERGE_PATTERNS.request)
  request(@Payload() req: RequestMergeRequest): Promise<MergeRequestView> {
    return this.merge.request(req);
  }

  @MessagePattern(MERGE_PATTERNS.approve)
  approve(@Payload() req: MergeIdRequest): Promise<MergeRequestView> {
    return this.merge.approve(req);
  }

  @MessagePattern(MERGE_PATTERNS.reject)
  reject(@Payload() req: MergeIdRequest): Promise<MergeRequestView> {
    return this.merge.reject(req);
  }

  @MessagePattern(MERGE_PATTERNS.cancel)
  cancel(@Payload() req: MergeIdRequest): Promise<MergeRequestView> {
    return this.merge.cancel(req);
  }

  @MessagePattern(MERGE_PATTERNS.list)
  list(@Payload() req: ListMergeRequestsRequest): Promise<MergeRequestPage> {
    return this.merge.list(req);
  }
}
