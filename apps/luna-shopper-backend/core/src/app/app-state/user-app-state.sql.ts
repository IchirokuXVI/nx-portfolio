/**
 * The two statements behind `user_app_state` (plan 0145, sections 1 and 3).
 *
 * Written out rather than expressed through the repository, because both rules
 * the plan states are rules about what the **database** does under two callers
 * at once, and neither survives being read into JavaScript and written back.
 */

/** One row's two timestamps, as both statements return them. */
export interface UserAppStateRow {
  setupCompletedAt: Date | null;
  tourSeenAt: Date | null;
}

/**
 * Read one account's state. `$1` is the account.
 *
 * Answers no row for an account that has never written, which the service maps
 * to two nulls. **A read never writes**, which is what keeps
 * `GET /v1/account/me` a read (section 1).
 */
export const READ_APP_STATE_SQL = `
  SELECT "setupCompletedAt", "tourSeenAt"
  FROM "user_app_state"
  WHERE "userId" = $1::uuid
`;

/**
 * Stamp the flags that were asked for. `$1` is the account, `$2` whether the
 * setup was asked for and `$3` whether the tour was.
 *
 * One statement, and that is the whole of the design:
 *
 * - **The row is created on demand.** The `INSERT` makes it, and `ON CONFLICT`
 *   catches the account that already has one, so two devices pressing Done at
 *   the same instant leave one row rather than one row and an error.
 * - **It is idempotent.** Each column is set to `COALESCE(itself, now())` when
 *   its flag was asked for, so a second call finds a timestamp already there
 *   and keeps it. The client presses Done once, retries, and gets the same
 *   answer.
 * - **A flag that was not asked for is copied from itself**, so stamping the
 *   tour cannot clear the setup, and neither can a call that races it.
 *
 * `now()` is the transaction's clock, so both columns stamped by one call carry
 * the same instant.
 */
export const STAMP_APP_STATE_SQL = `
  INSERT INTO "user_app_state" ("userId", "setupCompletedAt", "tourSeenAt")
  VALUES (
    $1::uuid,
    CASE WHEN $2::boolean THEN now() ELSE NULL END,
    CASE WHEN $3::boolean THEN now() ELSE NULL END
  )
  ON CONFLICT ("userId") DO UPDATE
    SET "setupCompletedAt" = CASE
          WHEN $2::boolean
          THEN COALESCE("user_app_state"."setupCompletedAt", now())
          ELSE "user_app_state"."setupCompletedAt"
        END,
        "tourSeenAt" = CASE
          WHEN $3::boolean
          THEN COALESCE("user_app_state"."tourSeenAt", now())
          ELSE "user_app_state"."tourSeenAt"
        END,
        "updatedAt" = now()
  RETURNING "setupCompletedAt", "tourSeenAt"
`;
