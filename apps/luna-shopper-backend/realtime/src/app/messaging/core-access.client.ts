import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  REALTIME_ACCESS_PATTERNS,
  type AccessCheckResult,
  type CheckListAccessRequest,
  type CheckZoneAccessRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';

/** Injection token for the realtime service's request/reply client to core. */
export const CORE_ACCESS_CLIENT = 'CORE_ACCESS_CLIENT';

/**
 * The realtime service's authorization link to core (plan 0009, section 5).
 *
 * Before a socket joins a room, or an SSE stream opens, the service asks core
 * whether the caller may access that zone or list. Core resolves membership from
 * its own tables, so a client cannot listen to something it has no access to.
 * Each check carries a correlation id so the authorization decision can be traced
 * alongside the connection that triggered it.
 */
@Injectable()
export class CoreAccessClient {
  constructor(
    @Inject(CORE_ACCESS_CLIENT) private readonly client: ClientProxy
  ) {}

  checkZone(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.check(REALTIME_ACCESS_PATTERNS.checkZone, req);
  }

  /**
   * Whether the caller governs the zone, which gates the `zone:{id}:staff` room
   * (plan 0017, section 9). Core answers from the same rule that decides whether
   * a REST summary fills the governance fields.
   */
  checkZoneStaff(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.check(REALTIME_ACCESS_PATTERNS.checkZoneStaff, req);
  }

  checkList(userId: string, listId: string): Promise<boolean> {
    const req: CheckListAccessRequest = { userId, listId };
    return this.check(REALTIME_ACCESS_PATTERNS.checkList, req);
  }

  private async check(subject: string, payload: object): Promise<boolean> {
    const result = await traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(buildNatsHeaders({ correlationId: randomUUID() }))
        .build();
      return firstValueFrom(
        this.client.send<AccessCheckResult>(subject, record)
      );
    });
    return result.allowed;
  }
}
