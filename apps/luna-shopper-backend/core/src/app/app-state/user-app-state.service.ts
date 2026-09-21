import { Injectable } from '@nestjs/common';
import type {
  GetUserAppStateRequest,
  SetUserAppStateRequest,
  UserAppStateView,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { DataSource } from 'typeorm';
import {
  READ_APP_STATE_SQL,
  STAMP_APP_STATE_SQL,
  type UserAppStateRow,
} from './user-app-state.sql';

/**
 * What one account has been shown (plan 0145).
 *
 * Two operations and one table. The service holds the mapping and the one rule
 * that is not the database's, and the database holds the two that are: a row
 * created on demand, and a stamp that never moves once it is set
 * ({@link STAMP_APP_STATE_SQL}).
 *
 * **A missing row is an ordinary answer**, not a "not found". An account that
 * has never finished the setup has never written here, and the read answers two
 * nulls for it exactly as it does for an account that wrote only the tour. That
 * is what lets the gateway compose this into `GET /v1/account/me` without a
 * "not found" ever reaching a caller who is simply new.
 */
@Injectable()
export class UserAppStateService {
  constructor(private readonly dataSource: DataSource) {}

  /** This account's state, two nulls when it has never written. */
  async get(req: GetUserAppStateRequest): Promise<UserAppStateView> {
    const rows: UserAppStateRow[] = await this.dataSource.query(
      READ_APP_STATE_SQL,
      [req.userId]
    );
    return toView(rows[0]);
  }

  /**
   * Stamp one flag or both, now, and answer the whole state.
   *
   * Asking for neither is refused here as well as at the gateway's DTO. The
   * gateway is where a person gets the 400, and this is the service's own
   * statement of the same rule, for any other caller the broker ever grows: a
   * write that writes nothing would otherwise read as a successful one.
   */
  async set(req: SetUserAppStateRequest): Promise<UserAppStateView> {
    const setup = req.setupCompleted === true;
    const tour = req.tourSeen === true;
    if (!setup && !tour) {
      throw new ValidationException(
        'Nothing to set: name setupCompleted, tourSeen, or both.'
      );
    }

    const rows: UserAppStateRow[] = await this.dataSource.query(
      STAMP_APP_STATE_SQL,
      [req.userId, setup, tour]
    );
    return toView(rows[0]);
  }
}

/** One row, or none, as the wire states it: ISO strings and nulls. */
function toView(row: UserAppStateRow | undefined): UserAppStateView {
  return {
    setupCompletedAt: row?.setupCompletedAt?.toISOString() ?? null,
    tourSeenAt: row?.tourSeenAt?.toISOString() ?? null,
  };
}
