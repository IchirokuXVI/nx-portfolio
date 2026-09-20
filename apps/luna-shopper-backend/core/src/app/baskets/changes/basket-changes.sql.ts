import type {
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
import type { CoveredLineRow } from '../basket.sql';

/**
 * What changed on a basket's lists, and what this viewer has seen of it (plan
 * 0138, sections 5 to 8).
 *
 * Raw SQL rather than a query builder, for the reason `basket.sql.ts` gives at
 * length: every camelCase column is quoted by hand, because TypeORM does not
 * rewrite `alias.property` inside a raw select expression, and an unquoted
 * `ch."createdAt"` reaches Postgres as `createdat` and fails at runtime where no
 * mocked repository could catch it.
 *
 * ## The marking rule is here and nowhere else
 *
 * Whether a change is still marked for one viewer is a comparison between four
 * times, and all four are the **database's**: the change's own `createdAt`, the
 * two ends of this viewer's cursor, and `now()`. Not one of them passes through
 * JavaScript, so two readers cannot disagree about what is marked because their
 * clocks differ, and a phone with a wrong clock shows a mark for the right length
 * of time.
 *
 * ## No timestamp travels in a cursor
 *
 * The changes view pages on the boundary row's **id** and reads its sort key back
 * in SQL, which is the shape `ITEM_SETTLEMENTS_SQL` established: an ISO timestamp
 * in a token is milliseconds and a `timestamptz` is microseconds, so a token
 * carrying the value skips or repeats the boundary row.
 */

/**
 * Where a viewer starts, and what they have acknowledged.
 *
 * `$1` is the participant. Two CTEs rather than one join, because the `start` is
 * needed by the `COALESCE`s below **and** as a fallback when there is no cursor
 * row at all, which is every viewer's first read.
 *
 * ## `start` is the later of joining and the basket's creation
 *
 * A person is not shown what changed before they could see the basket. For the
 * owner of a `LIVE` basket the two moments are the same by construction; for
 * somebody who left and came back the new `joinedAt` wins, and their old cursor
 * row is kept, so the later of the two decides.
 */
const VIEWER_CTES = `
  "scope" AS (
    SELECT GREATEST(p."joinedAt", gl."generatedAt") AS "start",
           p."userId" AS "userId"
    FROM "generated_list_participants" p
    JOIN "generated_lists" gl ON gl.id = p."generatedListId"
    WHERE p.id = $1::uuid
  ),
  "viewer" AS (
    SELECT COALESCE(c."seenFrom", s."start") AS "from",
           COALESCE(c."seenThrough", s."start") AS "through",
           c."ackedAt" AS "ackedAt",
           s."userId" AS "userId"
    FROM "scope" s
    LEFT JOIN "basket_change_cursors" c ON c."participantId" = $1::uuid
  )`;

/**
 * "This change is young enough to be served". `$3` is the retention in
 * milliseconds.
 *
 * **Both reads filter it themselves rather than trusting the sweep** (section
 * 10). A row the sweep has not reached yet is already invisible, so lowering the
 * retention takes effect on the next read rather than on the next tick, and no
 * screen depends on whether a timer fired.
 */
const WITHIN_RETENTION = `ch."createdAt" >= now() - ($3::double precision * interval '1 millisecond')`;

/**
 * "This change is not this viewer's own" (section 5).
 *
 * By participant **and** by account, which are two different questions: the
 * participant catches the change they made on this basket, and the account
 * catches the one they made on their own list page or from another basket. Either
 * one matching is enough, because somebody who adds a line does not want a banner
 * about it.
 *
 * A change with no actor at all is nobody's own, so it is marked for everybody.
 */
const NOT_THIS_VIEWERS = `
    (ch."actorParticipantId" IS NULL OR ch."actorParticipantId" <> $1::uuid)
    AND (
      ch."actorUserId" IS NULL
      OR v."userId" IS NULL
      OR ch."actorUserId" <> v."userId"
    )`;

/** Every column of a change the folds need, aliased for the row types below. */
const CHANGE_COLUMNS = `
    ch.id AS "id",
    ch."createdAt" AS "createdAt",
    ch."listId" AS "listId",
    ch."lineId" AS "lineId",
    ch.kind AS "kind",
    ch."contentBefore" AS "contentBefore",
    ch."contentAfter" AS "contentAfter",
    ch."quantityBefore" AS "quantityBefore",
    ch."quantityAfter" AS "quantityAfter",
    ch."approvalBefore" AS "approvalBefore",
    ch."approvalAfter" AS "approvalAfter",
    ch."mergedIntoLineId" AS "mergedIntoLineId"`;

/**
 * The changes that are still **marked** for this viewer, newest first.
 *
 * `$1` is the participant, `$2` the covered lists, `$3` the retention, `$4` the
 * mark window and `$5` the cap.
 *
 * A change is marked while it is either **unseen** or **lingering**:
 *
 * | It is     | When                                                                    |
 * | --------- | ----------------------------------------------------------------------- |
 * | unseen    | newer than what this viewer acknowledged                                 |
 * | lingering | acknowledged, and the window since **their** acknowledgement is not up   |
 *
 * So a mark lasts from the change until the window after this viewer
 * acknowledged it, however long that took. A phone in a pocket for three hours
 * acknowledges nothing, and the mark is there when it comes out.
 *
 * `v."ackedAt"` is null for a viewer with no cursor row, and `now() < NULL` is
 * unknown rather than true, so nothing lingers for somebody who has acknowledged
 * nothing. That is also arithmetically right: with no cursor the two ends of the
 * window are the same moment, so the lingering range is empty.
 */
export const MARKED_CHANGES_SQL = `
  WITH ${VIEWER_CTES}
  SELECT ${CHANGE_COLUMNS},
         (ch."createdAt" > v."through") AS "unseen"
  FROM "list_line_changes" ch
  CROSS JOIN "viewer" v
  WHERE ch."listId" = ANY($2::uuid[])
    AND ${WITHIN_RETENTION}
    AND ${NOT_THIS_VIEWERS}
    AND (
      ch."createdAt" > v."through"
      OR (
        ch."createdAt" > v."from"
        AND now() < v."ackedAt" + ($4::double precision * interval '1 millisecond')
      )
    )
  ORDER BY ch."createdAt" DESC, ch.id DESC
  LIMIT $5
`;

/**
 * How many changes this viewer has not seen, behind a cap.
 *
 * `$1` is the participant, `$2` the covered lists, `$3` the retention and `$4`
 * the cap plus one. The `LIMIT` inside the subquery is the whole point: somebody
 * back from three weeks away costs a bounded read rather than a count over
 * everything, and the answer then means "this many or more".
 */
export const UNSEEN_CHANGE_COUNT_SQL = `
  WITH ${VIEWER_CTES}
  SELECT count(*)::int AS "count"
  FROM (
    SELECT 1
    FROM "list_line_changes" ch
    CROSS JOIN "viewer" v
    WHERE ch."listId" = ANY($2::uuid[])
      AND ${WITHIN_RETENTION}
      AND ${NOT_THIS_VIEWERS}
      AND ch."createdAt" > v."through"
    LIMIT $4
  ) "capped"
`;

/**
 * One page of the changes view, newest first (section 8).
 *
 * `$1` is the participant, `$2` the covered lists, `$3` the retention, `$4` the
 * cursor row's id or null, `$5` the limit plus one.
 *
 * **The viewer's own changes are here**, unlike in the marks above, because this
 * is a history rather than a nudge: somebody looking at what happened to their
 * basket wants to see the line they added themselves in its place in the order.
 *
 * `unseen` is still computed per viewer, so the view can draw where the reading
 * mark falls without a second read.
 */
export const BASKET_CHANGES_PAGE_SQL = `
  WITH ${VIEWER_CTES}
  SELECT ${CHANGE_COLUMNS},
         ch."actorUserId" AS "actorUserId",
         ch."actorParticipantId" AS "actorParticipantId",
         ch."basketId" AS "basketId",
         (ch."createdAt" > v."through") AS "unseen"
  FROM "list_line_changes" ch
  CROSS JOIN "viewer" v
  WHERE ch."listId" = ANY($2::uuid[])
    AND ${WITHIN_RETENTION}
    AND (
      $4::uuid IS NULL
      OR (ch."createdAt", ch.id) <
         (
           SELECT b."createdAt", b.id
           FROM "list_line_changes" b
           WHERE b.id = $4::uuid
         )
    )
  ORDER BY ch."createdAt" DESC, ch.id DESC
  LIMIT $5
`;

/**
 * The lines a set of changes names, **including the ones no read serves**.
 *
 * `$1` is the line ids. Raw SQL rather than a repository find, which is what
 * makes it see a soft deleted row: `@DeleteDateColumn` filters every find and not
 * a statement. That is the point of this query, since a removed line is exactly
 * the one a mark has to describe.
 *
 * Ordered by `("createdAt", id)`, the order the basket read anchors a row by, so
 * the first line of a group is the one that names it here too.
 */
export const CHANGE_LINES_SQL = `
  SELECT ll.id AS "id",
         ll."listId" AS "listId",
         ll.content AS "content",
         ll.quantity AS "quantity",
         ll."itemSetHash" AS "itemSetHash",
         ll."approvalStatus" AS "approvalStatus",
         ll."createdAt" AS "createdAt"
  FROM "list_lines" ll
  WHERE ll.id = ANY($1::uuid[])
  ORDER BY ll."createdAt", ll.id
`;

/**
 * Where this viewer starts, as text.
 *
 * `$1` is the participant. `::text` rather than a `Date`, because the value is
 * handed straight back to {@link ACKNOWLEDGE_CHANGES_SQL} as a parameter and a
 * `timestamptz` rendered by Postgres and parsed by Postgres is exact, where a
 * JavaScript `Date` is milliseconds and loses the microseconds a cursor is
 * compared on.
 */
export const VIEWER_START_SQL = `
  SELECT GREATEST(p."joinedAt", gl."generatedAt")::text AS "start"
  FROM "generated_list_participants" p
  JOIN "generated_lists" gl ON gl.id = p."generatedListId"
  WHERE p.id = $1::uuid
`;

/**
 * "This change belongs to a list this basket covers, and is still served."
 *
 * `$1` is the change, `$2` the coverage, `$3` the retention. Asked before the
 * upsert below, so a `through` naming a change of somebody else's list is a
 * `not_found` rather than a write that quietly does nothing: the two are
 * different answers and a client can only correct one of them.
 */
export const COVERED_CHANGE_SQL = `
  SELECT ch.id AS "id"
  FROM "list_line_changes" ch
  WHERE ch.id = $1::uuid
    AND ch."listId" = ANY($2::uuid[])
    AND ch."createdAt" >= now() - ($3::double precision * interval '1 millisecond')
`;

/**
 * Move this viewer's cursor to the change they drew (section 6).
 *
 * `$1` is the participant, `$2` the change, `$3` the viewer's `start` as text and
 * `$4` the coverage.
 *
 * **One statement**, so `seenThrough` is copied from the change's own column
 * inside the database and no timestamp passes through JavaScript to lose its
 * microseconds. `ackedAt` is `now()`, which is what the mark window is measured
 * from.
 *
 * The `ON CONFLICT` shifts the old `seenThrough` into `seenFrom`, which is what
 * makes the just acknowledged changes **linger** rather than vanish, and its
 * `WHERE` is what makes the route idempotent: a `through` at or before the cursor
 * writes nothing, so two phones of one account racing each other cannot move a
 * cursor backwards.
 *
 * The `SELECT` finds no row when the change is at or before `start`, so a viewer
 * cannot acknowledge their way behind the moment they joined.
 */
export const ACKNOWLEDGE_CHANGES_SQL = `
  INSERT INTO "basket_change_cursors" ("participantId", "seenFrom", "seenThrough", "ackedAt")
  SELECT $1::uuid, $3::timestamptz, ch."createdAt", now()
  FROM "list_line_changes" ch
  WHERE ch.id = $2::uuid
    AND ch."listId" = ANY($4::uuid[])
    AND ch."createdAt" > $3::timestamptz
  ON CONFLICT ("participantId") DO UPDATE
    SET "seenFrom" = "basket_change_cursors"."seenThrough",
        "seenThrough" = EXCLUDED."seenThrough",
        "ackedAt" = now()
    WHERE "basket_change_cursors"."seenThrough" < EXCLUDED."seenThrough"
`;

/** One change, as every read of the table answers it. */
export interface ChangeRow {
  id: string;
  createdAt: Date;
  listId: string;
  lineId: string;
  kind: LineChangeKind;
  contentBefore: string | null;
  contentAfter: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  approvalBefore: LineApprovalStatus | null;
  approvalAfter: LineApprovalStatus | null;
  mergedIntoLineId: string | null;
  /** Newer than what this viewer acknowledged. */
  unseen: boolean;
}

/** One row of {@link BASKET_CHANGES_PAGE_SQL}: a change with its actor. */
export interface ChangePageRow extends ChangeRow {
  actorUserId: string | null;
  actorParticipantId: string | null;
  /**
   * The basket the write came **through**, which is how a reader learns that the
   * actor is one of this basket's own people without a query: a change stamped
   * with this basket was made by a participant of it.
   */
  basketId: string | null;
}

/**
 * One row of {@link CHANGE_LINES_SQL}: a line a change names, deleted or not.
 *
 * The same shape {@link CoveredLineRow} has, and an alias rather than a second
 * declaration of it: the two statements select the same columns on purpose, so the
 * fold can put a covered line and a line that left side by side and group both by
 * the same merge key.
 */
export type ChangeLineRow = CoveredLineRow;

/** The one row {@link UNSEEN_CHANGE_COUNT_SQL} answers. */
export interface UnseenCountRow {
  count: number;
}

/** The one row {@link VIEWER_START_SQL} answers. */
export interface ViewerStartRow {
  start: string;
}
