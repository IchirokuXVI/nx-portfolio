/**
 * The one statement the retention sweep runs (plan 0138, section 10).
 *
 * Raw SQL rather than a query builder, for the reason every other statement in
 * core is raw: every camelCase column is quoted by hand, because TypeORM does not
 * rewrite `alias.property` inside a raw expression, and an unquoted `"createdAt"`
 * reaches Postgres as `createdat` and fails at runtime where no mocked repository
 * could catch it.
 *
 * `$1` is the retention in milliseconds and `$2` the batch size.
 *
 * The inner `SELECT` is what makes the batch a batch: a bare `DELETE ... LIMIT`
 * is not valid Postgres, and deleting by a set of ids read in the same statement
 * rides `ix_list_line_changes_created` for both halves. `ORDER BY "createdAt"`
 * takes the oldest first, so a backlog drains in the order it was written rather
 * than leaving the same old rows at the back for ever.
 *
 * The cutoff is `now()`, the **database's** clock. An application server that
 * computed it would decide what is still readable, which is the one thing a
 * background task must not do here.
 */
export const DELETE_STALE_CHANGES_SQL = `
  DELETE FROM "list_line_changes"
  WHERE id IN (
    SELECT c.id
    FROM "list_line_changes" c
    WHERE c."createdAt" < now() - ($1::double precision * interval '1 millisecond')
    ORDER BY c."createdAt"
    LIMIT $2
  )
  RETURNING "id"
`;
