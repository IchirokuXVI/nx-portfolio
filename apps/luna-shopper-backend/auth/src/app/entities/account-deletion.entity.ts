import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One account deletion that core and catalog have not been told about yet (plan
 * 0232, section 5).
 *
 * The outbox of `user.deleted`. The delete writes it in the transaction that
 * removes the `users` row, so a deletion that commits always has a row here and
 * one that rolls back never does. `AccountDeletionPublisher` hands it to the
 * JetStream stream, waits for the stream's ack, and only then deletes it.
 *
 * It holds the user id, which is the one thing every other table of the account
 * has just stopped holding, and it holds it only for as long as the publish
 * takes. **No foreign key**: the user it names is gone by the time it commits.
 *
 * Not a `BaseEntity`: it is written once, never updated, and deleted as soon as
 * it has done its job.
 */
@Entity({ name: 'account_deletions' })
export class AccountDeletion {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  deletedAt!: Date;
}
