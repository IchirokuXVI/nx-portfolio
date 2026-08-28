import type { PresenceUser } from '@portfolio/velista/models';

/**
 * The people in a presence snapshot, named, without the reader (plan 0022, section 3).
 *
 * Three joins, and each of them is a decision rather than plumbing. They were written
 * once for the resume card in `0017` and are now made in four places, so they are one
 * function: three copies of a rule this quiet is three chances to get one of them
 * subtly wrong.
 *
 * - **The reader is removed, here.** `PresenceStore` keeps them on purpose, because a
 *   store that dropped a user id quietly would make `viewersOf` disagree with the count
 *   the server broadcast. Filtering is a rendering decision, made where the sentence is
 *   written, and a card that counts the person reading it is wrong about the only thing
 *   it says.
 * - **A name that does not resolve is left out rather than rendered as an id.** To the
 *   person reading, "not loaded yet", "left the group" and "not allowed to see them"
 *   are one fact, and none of the three is a hex string.
 * - **A wire username wins if one ever appears.** Presence carries a user id and no
 *   name today, so this always falls through to the zone's memberships; reading the
 *   field first is what makes the day it is filled in a no-op here.
 *
 * The result may therefore be shorter than the snapshot, which is correct: presence
 * under reports by design and every surface drawn from it is advisory (plan 0004,
 * section 6.7).
 */
export function presenceNames(
  users: readonly PresenceUser[],
  me: string | null,
  nameOf: (userId: string) => string | null
): readonly string[] {
  const names: string[] = [];

  for (const user of users) {
    if (user.userId === me) {
      continue;
    }

    const name = user.username !== '' ? user.username : nameOf(user.userId);
    if (name !== null && name !== '') {
      names.push(name);
    }
  }

  return names;
}

/**
 * Whether a presence snapshot holds anybody but the reader.
 *
 * The question behind every `MemberNames.ensure` on a presence surface, and it applies
 * the same rule `presenceNames` applies, one step earlier: a group whose only occupant
 * is the person looking at it has nobody to name, and naming costs a request.
 *
 * Names are deliberately not consulted. This asks whether somebody is **there**, and
 * the request it gates is the one that answers what they are called. Asking it of
 * resolved names instead would gate the fetch on the fetch having already happened,
 * which is a condition that can never become true on its own.
 */
export function hasOthers(
  users: readonly PresenceUser[],
  me: string | null
): boolean {
  return users.some((user) => user.userId !== me);
}
