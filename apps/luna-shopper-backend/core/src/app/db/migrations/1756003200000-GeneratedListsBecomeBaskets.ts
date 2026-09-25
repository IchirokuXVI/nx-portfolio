import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A generated list is called a basket, in the database too (plan 0144).
 *
 * Three tables, two columns, twelve indexes and eleven constraints, and not one
 * row moves. Every statement here is an `ALTER ... RENAME`, which Postgres does
 * transactionally by rewriting a catalog entry, so the whole migration holds its
 * locks for an instant and is exactly as cheap in either direction.
 *
 * ## Why the names are not the ones plan 0144's table guessed
 *
 * They are read from the database rather than from that table, as section 3
 * says to. Half the names the plan lists belong to `generated_list_lines` and
 * its two children, which plan 0136 dropped, and two more (`basket_status` and
 * `basket_kind`) plan 0133 had already renamed. What is below is what
 * `pg_class`, `pg_constraint` and `information_schema.columns` still answer for
 * after every earlier migration has run.
 *
 * ## What is deliberately left alone
 *
 * `generated_lists."generatedAt"` keeps its name. Section 1 renames the words
 * `generated list`, and that column says neither: it is the moment the basket
 * was made. The obvious new name is `createdAt`, which `BaseEntity` already
 * gives every row in core, so the rename would be a collision rather than a
 * rename, and deciding what the two dates mean apart is a change of behaviour
 * this plan refuses. The wire has called it `createdAt` since plan 0136 and the
 * mapper is where the two names meet.
 *
 * The enum value `GENERATED` on `kind` also stays. It is the name of a kind of
 * basket, not the old name of the table.
 *
 * ## The rollback
 *
 * `down` is the same statements with the two names swapped, in the reverse
 * order, and it loses nothing. A rename is neither an expansion nor a
 * contraction, so a rollback of the deployment is two steps in this order:
 * `helm rollback`, then this `down` through `node migrate.js` from the older
 * image. `helm rollback` alone leaves old code on new names.
 */
export class GeneratedListsBecomeBaskets1756003200000 implements MigrationInterface {
  name = 'GeneratedListsBecomeBaskets1756003200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The columns first, while the old table names still read naturally.
    await queryRunner.query(
      `ALTER TABLE "generated_list_participants" RENAME COLUMN "generatedListId" TO "basketId"`
    );
    await queryRunner.query(
      `ALTER TABLE "generated_list_share_links" RENAME COLUMN "generatedListId" TO "basketId"`
    );

    // Then the tables. Every foreign key pointing at them follows by itself,
    // and so does each table's implicit composite type.
    await queryRunner.query(
      `ALTER TABLE "generated_lists" RENAME TO "baskets"`
    );
    await queryRunner.query(
      `ALTER TABLE "generated_list_participants" RENAME TO "basket_participants"`
    );
    await queryRunner.query(
      `ALTER TABLE "generated_list_share_links" RENAME TO "basket_share_links"`
    );

    // Then the names that hang off them. The three primary keys are constraints
    // rather than bare indexes, so they are renamed below with the rest and
    // their backing index follows.
    for (const [from, to] of INDEXES) {
      await queryRunner.query(`ALTER INDEX "${from}" RENAME TO "${to}"`);
    }
    for (const [table, from, to] of CONSTRAINTS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" RENAME CONSTRAINT "${from}" TO "${to}"`
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, from, to] of CONSTRAINTS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" RENAME CONSTRAINT "${to}" TO "${from}"`
      );
    }
    for (const [from, to] of INDEXES) {
      await queryRunner.query(`ALTER INDEX "${to}" RENAME TO "${from}"`);
    }

    await queryRunner.query(
      `ALTER TABLE "basket_share_links" RENAME TO "generated_list_share_links"`
    );
    await queryRunner.query(
      `ALTER TABLE "basket_participants" RENAME TO "generated_list_participants"`
    );
    await queryRunner.query(
      `ALTER TABLE "baskets" RENAME TO "generated_lists"`
    );

    await queryRunner.query(
      `ALTER TABLE "generated_list_share_links" RENAME COLUMN "basketId" TO "generatedListId"`
    );
    await queryRunner.query(
      `ALTER TABLE "generated_list_participants" RENAME COLUMN "basketId" TO "generatedListId"`
    );
  }
}

/**
 * The bare indexes, old name to new.
 *
 * `_list` becomes `_basket` where the index is over the renamed column, because
 * the thing it points at stopped being a list when plan 0136 deleted the rows.
 */
const INDEXES: ReadonlyArray<readonly [string, string]> = [
  ['ix_generated_lists_owner', 'ix_baskets_owner'],
  ['ix_generated_lists_owner_open', 'ix_baskets_owner_open'],
  ['uq_generated_lists_idempotency', 'uq_baskets_idempotency'],
  ['uq_generated_lists_live_owner', 'uq_baskets_live_owner'],
  ['ix_generated_list_participants_list', 'ix_basket_participants_basket'],
  ['ix_generated_list_participants_link', 'ix_basket_participants_link'],
  ['ix_generated_list_participants_user', 'ix_basket_participants_user'],
  [
    'ix_generated_list_participants_expiring',
    'ix_basket_participants_expiring',
  ],
  ['uq_generated_list_participants_user', 'uq_basket_participants_user'],
  ['uq_generated_list_participants_secret', 'uq_basket_participants_secret'],
  ['uq_generated_list_share_links_live', 'uq_basket_share_links_live'],
  ['uq_generated_list_share_links_secret', 'uq_basket_share_links_secret'],
];

/** The constraints, as `[table after the rename, old name, new name]`. */
const CONSTRAINTS: ReadonlyArray<readonly [string, string, string]> = [
  ['baskets', 'pk_generated_lists', 'pk_baskets'],
  ['baskets', 'ck_generated_lists_live_shape', 'ck_baskets_live_shape'],
  [
    'basket_participants',
    'pk_generated_list_participants',
    'pk_basket_participants',
  ],
  [
    'basket_participants',
    'fk_generated_list_participants_list',
    'fk_basket_participants_basket',
  ],
  [
    'basket_participants',
    'fk_generated_list_participants_link',
    'fk_basket_participants_link',
  ],
  [
    'basket_participants',
    'ck_generated_list_participants_ended',
    'ck_basket_participants_ended',
  ],
  [
    'basket_participants',
    'ck_generated_list_participants_ended_reason',
    'ck_basket_participants_ended_reason',
  ],
  [
    'basket_participants',
    'ck_generated_list_participants_expiry',
    'ck_basket_participants_expiry',
  ],
  [
    'basket_share_links',
    'pk_generated_list_share_links',
    'pk_basket_share_links',
  ],
  [
    'basket_share_links',
    'fk_generated_list_share_links_list',
    'fk_basket_share_links_basket',
  ],
  [
    'basket_share_links',
    'ck_generated_list_share_links_expiry',
    'ck_basket_share_links_expiry',
  ],
];
