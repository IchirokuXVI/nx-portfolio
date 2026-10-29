import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * What one person used of the assistant on one day (plan 0234, section 4).
 *
 * The day is the date in the deployment's allowance timezone, which the
 * assistant sends with each request: core holds no setting of its own. The
 * month is the sum of a person's rows in it. Money is integer micro dollars;
 * a `bigint` arrives from the driver as a string, which is why those columns
 * are typed `string` and every read goes through `Number`.
 *
 * Keyed by an opaque `userId` with **no foreign key**, as `UserAppState` is:
 * core holds no user table, and the account deletion of plan 0232 deletes
 * these rows by user id.
 *
 * The service reads and writes this table in raw SQL (`assistant-allowance.sql.ts`),
 * because every rule here is a rule about two callers at once. The entity
 * exists so the table is named in `CORE_ENTITIES` beside its siblings.
 */
@Entity({ name: 'assistant_usage_days' })
export class AssistantUsageDay {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'date' })
  @Index('ix_assistant_usage_days_day')
  day!: string;

  @Column({ type: 'integer', default: 0 })
  turns!: number;

  @Column({ type: 'integer', default: 0 })
  assistantAudioSeconds!: number;

  @Column({ type: 'integer', default: 0 })
  commentAudioSeconds!: number;

  @Column({ type: 'bigint', default: 0 })
  costMicroUsd!: string;

  /** Recorded for the read and the dashboard; no limit reads the tokens. */
  @Column({ type: 'bigint', default: 0 })
  promptTokens!: string;

  @Column({ type: 'bigint', default: 0 })
  responseTokens!: string;

  @Column({ type: 'bigint', default: 0 })
  cachedPromptTokens!: string;

  /** What open reservations hold, released by a settle or by expiry. */
  @Column({ type: 'integer', default: 0 })
  reservedTurns!: number;

  @Column({ type: 'integer', default: 0 })
  reservedAssistantAudioSeconds!: number;

  @Column({ type: 'integer', default: 0 })
  reservedCommentAudioSeconds!: number;

  @Column({ type: 'bigint', default: 0 })
  reservedMicroUsd!: string;
}

/**
 * What the whole deployment spent on the assistant on one day (plan 0234,
 * section 4). It holds no person, and is kept for 13 months as the operator's
 * record of the bill.
 */
@Entity({ name: 'assistant_usage_deployment_days' })
export class AssistantUsageDeploymentDay {
  @PrimaryColumn({ type: 'date' })
  day!: string;

  @Column({ type: 'bigint', default: 0 })
  costMicroUsd!: string;

  @Column({ type: 'bigint', default: 0 })
  reservedMicroUsd!: string;
}

/**
 * The worst case of one call sequence, held against a person's allowance until
 * it settles or expires (plan 0234, section 5).
 *
 * `purpose` is `TURN`, `VOICE_TURN` or `TRANSCRIPTION`, and a check constraint
 * says so. `day` is the day of the usage rows whose reserved columns hold the
 * amounts, so a settle after midnight releases them where they were added.
 */
@Entity({ name: 'assistant_reservations' })
export class AssistantReservation {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Index('ix_assistant_reservations_user')
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'text' })
  purpose!: string;

  @Column({ type: 'integer' })
  turns!: number;

  @Column({ type: 'integer' })
  audioSeconds!: number;

  @Column({ type: 'bigint' })
  microUsd!: string;

  @Index('ix_assistant_reservations_expires')
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
