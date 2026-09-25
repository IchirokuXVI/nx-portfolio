import type { BasketParticipant } from '../entities';

/**
 * What one reader of a basket is told about the households behind it (plan 0136,
 * section 3.4).
 *
 * ## What it replaces, and why the old rule could not survive
 *
 * `seesZoneData` was all or nothing: a reader who held `WRITE` on **every** list
 * the run drew from saw all the zone data, and anybody else saw none. It had a
 * known cliff, one list where they held only `READ` collapsed the whole view,
 * and plan 0051 section 11 already recorded the per list answer as the eventual
 * target.
 *
 * The permanent basket forces it. A `LIVE` basket covers every list its owner can
 * write, and the set changes whenever anybody's access does, so "every source
 * list" is not a set a second reader can be measured against at all.
 *
 * ## The rule
 *
 * **A reader is told which list a row belongs to for exactly the covered lists
 * they write themselves.** The owner writes all of them by construction, since
 * coverage is defined as the lists the owner can write. A guest holds no account
 * and therefore no list, so they get none.
 *
 * A guest still sees the entries of a row, how much each asks for, and that there
 * are two of them. That a row comes from two households is already visible today
 * as a quantity that two settles reach, and it names nobody.
 *
 * Both answers are computed **before any transaction opens** (plan 0130, section
 * 13), because every repository the access service holds draws its own connection
 * from the pool.
 */
export class BasketRedaction {
  private constructor(
    /** The covered lists this reader writes. Their refs and ids are served. */
    readonly servedListIds: ReadonlySet<string>,
    /** Whether this reader is served shop addresses (section 2). */
    readonly servesLocations: boolean
  ) {}

  /**
   * Decide both answers for one reader.
   *
   * `writable` is the result of `writableAmong(reader.userId, coverage)`, asked
   * by the caller so that a reader with no account costs no query at all rather
   * than costing one and having the result thrown away. That is the difference
   * between a rule and a filter, and it is the reasoning `namesOfLists` already
   * gives for refusing to be called without an access check.
   */
  static of(
    participant: BasketParticipant,
    writable: ReadonlySet<string>
  ): BasketRedaction {
    return new BasketRedaction(writable, servesLocations(participant));
  }

  /** A reader with no account, before anything is read. */
  static none(participant: BasketParticipant): BasketRedaction {
    return new BasketRedaction(new Set(), servesLocations(participant));
  }

  /**
   * Nothing withheld, for a caller that is not a reader at all.
   *
   * The history counts, the admin detail and the finish read the rows to count
   * or freeze them rather than to draw them for somebody. There is no
   * participant to measure, so inventing one would be a lie in whichever
   * direction it was pointed.
   */
  static unredacted(listIds: Iterable<string>): BasketRedaction {
    return new BasketRedaction(new Set(listIds), true);
  }
}

/**
 * Who is served shop addresses (plan 0163, section 4).
 *
 * **Every participant**, a link visitor included, guest or registered. A guest
 * standing in a shop picks it from the same list the owner sees, and a settle
 * they make there records the shop.
 *
 * ## This reverses plan 0136 section 2, and says what it costs
 *
 * That rule served addresses only to the owner and to the people the owner
 * named, because the shops are the owner's profile. Serving them to anybody
 * holding the link **tells a link visitor roughly where the owner shops**,
 * which is roughly where the owner lives. The user chose that on 2026-09-24,
 * so the next reader should not mistake it for an oversight.
 *
 * What a link visitor is still not served: the shops the owner bought at
 * recently (plan 0164), and anything about the owner's purchases, including the
 * shop a settlement recorded, which is served only in a person's own history.
 *
 * It is still a function of the participant rather than a constant, so that the
 * callers ask one question in one place if the rule ever narrows again. Plan
 * 0143 reads the same flag for the shop a settle may record.
 */
export function servesLocations(
  // Read by no branch since plan 0163, and kept so the callers do not change
  // shape when the rule does.
  _participant: BasketParticipant
): boolean {
  return true;
}
