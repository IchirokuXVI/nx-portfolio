import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  EXISTING_USER_IDS_MAX,
  RECONCILIATION_PATTERNS,
  type ExistingUserIdsRequest,
  type ExistingUserIdsResponse,
} from '@portfolio/luna-shopper/contracts';
import { isUuid, ValidationException } from '@portfolio/luna-shopper/platform';
import { DataSource } from 'typeorm';

/**
 * Which of a list of ids are still accounts (plan 0232, section 7).
 *
 * The mirror of core's `core.usersWithoutMemberships`. The release task that
 * cleans what earlier deletions left in core and catalog collects the user ids
 * those services hold and asks here, at most {@link EXISTING_USER_IDS_MAX} at a
 * time, which of them auth still knows. Every id it does not get back is an
 * account that was deleted.
 *
 * An id that is not a uuid cannot be an account, so it is left out of the
 * query rather than handed to Postgres, which would refuse the whole request
 * over the `uuid` cast. The payload is checked here by hand, because auth's
 * transport applies no schema to what it receives.
 */
@Controller()
export class ReconciliationController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @MessagePattern(RECONCILIATION_PATTERNS.existingUserIds)
  async existingUserIds(
    @Payload() req: ExistingUserIdsRequest
  ): Promise<ExistingUserIdsResponse> {
    const userIds = req?.userIds;
    if (!Array.isArray(userIds)) {
      throw new ValidationException('userIds must be an array');
    }
    if (userIds.length > EXISTING_USER_IDS_MAX) {
      throw new ValidationException(
        `userIds must contain no more than ${EXISTING_USER_IDS_MAX} elements`,
        {
          details: { userIds: 'maxItems' },
          messageArgs: { max: EXISTING_USER_IDS_MAX },
        }
      );
    }
    // Lower case, as Postgres prints a uuid, so the answer compares equal to
    // the rows it came from.
    const candidates = [
      ...new Set(userIds.filter(isUuid).map((id) => id.toLowerCase())),
    ];
    if (candidates.length === 0) {
      return { userIds: [] };
    }
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT "id" FROM "users" WHERE "id" = ANY($1::uuid[])`,
      [candidates]
    );
    // In the order asked, so a caller that pairs the answer with its batch
    // reads it the same way every time.
    const found = new Set(rows.map((row) => row.id));
    return { userIds: candidates.filter((id) => found.has(id)) };
  }
}
