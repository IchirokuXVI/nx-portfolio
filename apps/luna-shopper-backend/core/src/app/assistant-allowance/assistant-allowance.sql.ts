import type { EntityManager } from 'typeorm';

/**
 * The statements of the assistant allowance (plan 0234, section 5).
 *
 * **One lock order, everywhere**: reservation rows first, then a person's day
 * rows in ascending day, then the deployment's day rows in ascending day. The
 * reserve, the settle, the expiry sweep and the account deletion all take them
 * in that order, so no two of them can wait on each other in a circle. The
 * deployment row is what serializes reservations across people.
 *
 * A reserve and a settle take {@link LOCK_PERSON_SQL} before all of those, and
 * that is what serializes one person's, whatever the day: two reserves either
 * side of midnight lock different day rows, and only the person's own lock
 * keeps the one turn in flight rule true between them. Nothing takes it after
 * a row lock, so it cannot close a circle.
 *
 * Every `date` is read back as `::text`. The driver would otherwise turn it
 * into a `Date` at local midnight of the process, which is the one day in the
 * year a timezone difference moves it. Every `bigint` arrives as a string and
 * goes through `Number`, which is exact far beyond any amount here.
 */

/**
 * The person's own lock, held to the end of the transaction, taken first by a
 * reserve and a settle. The two key form keeps it apart from any one key
 * advisory lock; a hash that two people share only makes them wait on each
 * other, which is harmless.
 */
export const LOCK_PERSON_SQL = `
  SELECT pg_advisory_xact_lock(hashtext('assistant_allowance'), hashtext($1::text))`;

export const ENSURE_PERSON_DAY_SQL = `
  INSERT INTO "assistant_usage_days" ("userId", "day")
  VALUES ($1::uuid, $2::date)
  ON CONFLICT DO NOTHING`;

export const ENSURE_DEPLOYMENT_DAY_SQL = `
  INSERT INTO "assistant_usage_deployment_days" ("day")
  VALUES ($1::date)
  ON CONFLICT DO NOTHING`;

const RESERVATION_COLUMNS = `
  r."id", r."userId", r."day"::text AS "day", r."purpose", r."turns",
  r."audioSeconds", r."microUsd"::text AS "microUsd"`;

/**
 * This person's expired reservations, locked. `SKIP LOCKED`, because the one
 * the sweep holds is being released by the sweep.
 */
export const LOCK_EXPIRED_OF_PERSON_SQL = `
  SELECT ${RESERVATION_COLUMNS}
    FROM "assistant_reservations" r
   WHERE r."userId" = $1::uuid AND r."expiresAt" <= $2
   ORDER BY r."id"
   FOR UPDATE SKIP LOCKED`;

/** The oldest expired reservation of anybody, locked, for the sweep. */
export const LOCK_ONE_EXPIRED_SQL = `
  SELECT ${RESERVATION_COLUMNS}
    FROM "assistant_reservations" r
   WHERE r."expiresAt" <= $1
   ORDER BY r."expiresAt", r."id"
   LIMIT 1
   FOR UPDATE SKIP LOCKED`;

export const LOCK_PERSON_DAYS_SQL = `
  SELECT "day"::text AS "day"
    FROM "assistant_usage_days"
   WHERE "userId" = $1::uuid AND "day" = ANY($2::date[])
   ORDER BY "day"
   FOR UPDATE`;

export const LOCK_DEPLOYMENT_DAYS_SQL = `
  SELECT "day"::text AS "day"
    FROM "assistant_usage_deployment_days"
   WHERE "day" = ANY($1::date[])
   ORDER BY "day"
   FOR UPDATE`;

/** One open turn of this person, which refuses another (section 5.1). */
export const TURN_IN_FLIGHT_SQL = `
  SELECT 1 AS "open"
    FROM "assistant_reservations"
   WHERE "userId" = $1::uuid AND "turns" > 0 AND "expiresAt" > $2
   LIMIT 1`;

/** A person's rows of one month, which the service adds up for the day and the month. */
export const PERSON_MONTH_SQL = `
  SELECT "day"::text AS "day", "turns", "assistantAudioSeconds",
         "commentAudioSeconds", "costMicroUsd"::text AS "costMicroUsd",
         "reservedTurns", "reservedAssistantAudioSeconds",
         "reservedCommentAudioSeconds",
         "reservedMicroUsd"::text AS "reservedMicroUsd"
    FROM "assistant_usage_days"
   WHERE "userId" = $1::uuid AND "day" >= $2::date AND "day" < $3::date`;

/** The deployment's rows of one month. */
export const DEPLOYMENT_MONTH_SQL = `
  SELECT "day"::text AS "day", "costMicroUsd"::text AS "costMicroUsd",
         "reservedMicroUsd"::text AS "reservedMicroUsd"
    FROM "assistant_usage_deployment_days"
   WHERE "day" >= $1::date AND "day" < $2::date`;

export const HOLD_PERSON_SQL = `
  UPDATE "assistant_usage_days" SET
    "reservedTurns" = "reservedTurns" + $3,
    "reservedAssistantAudioSeconds" = "reservedAssistantAudioSeconds" + $4,
    "reservedCommentAudioSeconds" = "reservedCommentAudioSeconds" + $5,
    "reservedMicroUsd" = "reservedMicroUsd" + $6::bigint
  WHERE "userId" = $1::uuid AND "day" = $2::date`;

export const HOLD_DEPLOYMENT_SQL = `
  UPDATE "assistant_usage_deployment_days" SET
    "reservedMicroUsd" = "reservedMicroUsd" + $2::bigint
  WHERE "day" = $1::date`;

export const INSERT_RESERVATION_SQL = `
  INSERT INTO "assistant_reservations"
    ("id", "userId", "day", "purpose", "turns", "audioSeconds", "microUsd",
     "expiresAt")
  VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7::bigint, $8)`;

/**
 * What a reservation held, out of the reserved columns. `GREATEST`, so a
 * release can never drive a column below zero, whatever happened before it.
 */
export const RELEASE_PERSON_SQL = `
  UPDATE "assistant_usage_days" SET
    "reservedTurns" = GREATEST(0, "reservedTurns" - $3),
    "reservedAssistantAudioSeconds" =
      GREATEST(0, "reservedAssistantAudioSeconds" - $4),
    "reservedCommentAudioSeconds" =
      GREATEST(0, "reservedCommentAudioSeconds" - $5),
    "reservedMicroUsd" = GREATEST(0, "reservedMicroUsd" - $6::bigint)
  WHERE "userId" = $1::uuid AND "day" = $2::date`;

export const RELEASE_DEPLOYMENT_SQL = `
  UPDATE "assistant_usage_deployment_days" SET
    "reservedMicroUsd" = GREATEST(0, "reservedMicroUsd" - $2::bigint)
  WHERE "day" = $1::date`;

export const DELETE_RESERVATION_SQL = `
  DELETE FROM "assistant_reservations" WHERE "id" = $1::uuid`;

/** The settle's own reservation, taken out and returned in one statement. */
export const TAKE_RESERVATION_SQL = `
  DELETE FROM "assistant_reservations" r
   WHERE r."id" = $1::uuid AND r."userId" = $2::uuid
  RETURNING ${RESERVATION_COLUMNS}`;

/** What really happened, onto the used columns (section 5.3). */
export const COUNT_PERSON_SQL = `
  UPDATE "assistant_usage_days" SET
    "turns" = "turns" + $3,
    "assistantAudioSeconds" = "assistantAudioSeconds" + $4,
    "commentAudioSeconds" = "commentAudioSeconds" + $5,
    "costMicroUsd" = "costMicroUsd" + $6::bigint,
    "promptTokens" = "promptTokens" + $7::bigint,
    "responseTokens" = "responseTokens" + $8::bigint,
    "cachedPromptTokens" = "cachedPromptTokens" + $9::bigint
  WHERE "userId" = $1::uuid AND "day" = $2::date`;

export const COUNT_DEPLOYMENT_SQL = `
  UPDATE "assistant_usage_deployment_days" SET
    "costMicroUsd" = "costMicroUsd" + $2::bigint
  WHERE "day" = $1::date`;

/** Section 4's retention: a person's rows before the cutoff. */
export const DELETE_OLD_PERSON_DAYS_SQL = `
  DELETE FROM "assistant_usage_days" WHERE "day" < $1::date`;

/** Section 4's retention: deployment rows before the cutoff. */
export const DELETE_OLD_DEPLOYMENT_DAYS_SQL = `
  DELETE FROM "assistant_usage_deployment_days" WHERE "day" < $1::date`;

/** A reservation row as the statements above return it. */
export interface ReservationRow {
  id: string;
  userId: string;
  day: string;
  purpose: string;
  turns: number;
  audioSeconds: number;
  microUsd: string;
}

/**
 * The rows of a `DELETE ... RETURNING` or a `SELECT`. The postgres driver
 * answers a `DELETE` through `query()` as `[rows, rowCount]` and a `SELECT` as
 * the rows, and a caller must not count the pair as two rows.
 */
export function rowsOf<T>(answered: unknown): T[] {
  if (
    Array.isArray(answered) &&
    answered.length === 2 &&
    Array.isArray(answered[0]) &&
    typeof answered[1] === 'number'
  ) {
    return answered[0] as T[];
  }
  return (answered as T[]) ?? [];
}

/** The audio of a reservation, split by its purpose. */
export function reservedAudio(
  row: Pick<ReservationRow, 'purpose' | 'audioSeconds'>
): {
  assistant: number;
  comment: number;
} {
  return {
    assistant: row.purpose === 'VOICE_TURN' ? row.audioSeconds : 0,
    comment: row.purpose === 'TRANSCRIPTION' ? row.audioSeconds : 0,
  };
}

/** Takes one reservation's amounts out of the reserved columns and deletes it. */
export async function releaseReservation(
  manager: EntityManager,
  row: ReservationRow
): Promise<void> {
  const audio = reservedAudio(row);
  await manager.query(RELEASE_PERSON_SQL, [
    row.userId,
    row.day,
    row.turns,
    audio.assistant,
    audio.comment,
    row.microUsd,
  ]);
  await manager.query(RELEASE_DEPLOYMENT_SQL, [row.day, row.microUsd]);
  await manager.query(DELETE_RESERVATION_SQL, [row.id]);
}

/**
 * A person's allowance rows, gone, inside the account deletion's transaction
 * (plan 0234, section 9; plan 0232, section 2). The deployment rows hold no
 * person and stay, with what the person's open reservations held taken out of
 * them, so a deletion does not leave the deployment's day looking fuller than
 * it is. In the lock order of the file comment: reservations, the person's
 * days, then the deployment's days.
 */
export async function deleteAllowanceRowsOf(
  manager: EntityManager,
  userId: string
): Promise<void> {
  const taken = rowsOf<{ day: string; microUsd: string }>(
    await manager.query(
      `DELETE FROM "assistant_reservations" WHERE "userId" = $1::uuid
       RETURNING "day"::text AS "day", "microUsd"::text AS "microUsd"`,
      [userId]
    )
  );
  await manager.query(
    `SELECT "day" FROM "assistant_usage_days" WHERE "userId" = $1::uuid
      ORDER BY "day" FOR UPDATE`,
    [userId]
  );
  const heldByDay = new Map<string, number>();
  for (const row of taken) {
    heldByDay.set(
      row.day,
      (heldByDay.get(row.day) ?? 0) + Number(row.microUsd)
    );
  }
  for (const day of [...heldByDay.keys()].sort()) {
    await manager.query(RELEASE_DEPLOYMENT_SQL, [day, heldByDay.get(day)]);
  }
  await manager.query(
    `DELETE FROM "assistant_usage_days" WHERE "userId" = $1::uuid`,
    [userId]
  );
}
