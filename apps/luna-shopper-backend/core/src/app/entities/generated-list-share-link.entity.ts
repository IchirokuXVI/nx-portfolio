import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GeneratedList } from './generated-list.entity';

/**
 * The thing you copy and send (plan 0051, section 3).
 *
 * **A generated list has zero share links or one.** It starts with zero, pressing
 * share mints one, revoking returns it to zero, and sharing again mints a fresh
 * one. Several concurrent links with per link labels were in the first draft and
 * were dropped at review: one link at a time is easier to understand, and it
 * costs nothing, because the one link can be handed to any number of people.
 *
 * That invariant is a **partial unique index** over `generatedListId` where
 * `revokedAt` is null, not a service level check. It is what makes pressing share
 * twice idempotent rather than merely usually idempotent, and it is the same
 * reasoning plan 0049 applied to a profile's single default.
 *
 * ## Revoked rows are kept
 *
 * Deleting one would orphan the participants that arrived through it, and
 * `shareLinkId` is what the cascade in section 3.4 walks to answer "revoke all
 * guests from this link?". A revoked link is history, and history is why the
 * partial index says `WHERE "revokedAt" IS NULL` rather than the table holding
 * one row per basket forever.
 *
 * ## Why `secret` is not hashed, when a participant's is
 *
 * The asymmetry is deliberate and section 3.1 argues it. A participant's session
 * secret is a **credential**: it is stored hashed, like a password, and shown
 * once. This is an **invitation**, and the owner has to be able to copy it again
 * tomorrow, from another device, for the next person, so the share sheet returns
 * it on every read and it cannot be hashed.
 *
 * The cost is named rather than hidden: a database leak hands over working
 * invitations, which mint guests on baskets until revoked or expired. It hands
 * over no participant's session, and since plan 0140 a link is dead twelve hours
 * after it was minted, which narrows the window the trade is made over. Hashing
 * it is still out, for the reason above: the owner has to be able to copy it
 * again.
 */
@Entity({ name: 'generated_list_share_links' })
@Index('uq_generated_list_share_links_live', ['generatedListId'], {
  unique: true,
  where: '"revokedAt" IS NULL',
})
export class GeneratedListShareLink extends BaseEntity {
  @Column({ type: 'uuid' })
  generatedListId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generatedListId' })
  generatedList!: GeneratedList;

  /**
   * The invitation itself, high entropy random and **not** a JWT (section 3.1).
   *
   * The requirement is that it be checked against the database on every use, and
   * a JWT you must look up anyway is a JWT with no benefit and a signing key's
   * worth of risk. Indexed uniquely because the preview and the join both arrive
   * carrying nothing else.
   */
  @Index('uq_generated_list_share_links_secret', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  secret!: string;

  /**
   * Who minted it, as a participant rather than as a user (section 3.2).
   *
   * The owner has a participant row from generation time precisely so that this
   * column, and every other attribution field in the plan, can be a single
   * foreign key instead of a nullable pair checked for exactly one being set.
   */
  @Column({ type: 'uuid' })
  createdByParticipantId!: string;

  /**
   * When the invitation lapses: `createdAt` plus `BASKET_LINK_TTL`, twelve
   * hours (plan 0140, section 4).
   *
   * **Not nullable**, and no caller may name it. Plan 0051 section 11 left this
   * a leaning, "implemented rather than settled", with a thirty day cap and a
   * null meaning for ever. Plan 0130 made a basket permanent, so a link with no
   * end became a link to a household's whole shopping for ever, and the leaning
   * became a rule with a number.
   *
   * Both columns come from one clock: the insert computes this as
   * `now() + interval`, so `createdAt` and this can never disagree about when
   * the twelve hours started.
   */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /**
   * Set when the owner revokes it. **Never consulted on the hot path**
   * (section 3.3): authorizing a participant request reads `revokedAt` on the
   * participant row alone, which is what lets section 3.4 stop a link spreading
   * without throwing out the people already in the shop.
   */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
