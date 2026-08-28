import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Inbox for idempotent event handling (plan 0004, section 9; plan 0011). One row
 * per handled key: a handler records the key inside its transaction and skips the
 * effect if it was already present, so an at-least-once redelivery has no extra
 * effect. Backs {@link ProcessedEventStore}.
 */
@Entity({ name: 'processed_events' })
export class ProcessedEvent {
  @PrimaryColumn({ type: 'varchar' })
  key!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt!: Date;
}
